import { Telegraf, Markup, session } from "telegraf";
import { masterAgent } from "../agents/master.agent.js";
import { extractSymbol, shouldAnalyze, safeObject, safeString, safeSubstring } from "../core/safety.js";

// Global Production Guards
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

import { getCompanyOverview, checkSymbolExists } from "./marketData.service.js";
import { analyzePortfolio } from "../agents/portfolioAgent.js";
import { scannerAgent } from "../agents/scanner.agent.js";
import { sectorScannerAgent } from "../agents/sectorScanner.agent.js";
import { analyzePortfolioHealth } from "../agents/portfolioHealth.agent.js";
import {
  addHolding,
  getPortfolio,
  removeHolding,
  updateHolding
} from "./portfolioMemory.service.js";
import { createPaymentLink, cancelSubscriptionNow, cancelSubscriptionLater } from "../routes/payment.js";
import supabase from "./supabase.service.js";
import { checkUsage, incrementUsage, FREE_LIMIT, getRemainingUsage } from "./usage.service.js";
import { generateChatReply } from "./chat.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
bot.use(session());

const userStates = new Map();

// Rate Limiting (Institutional Safety)
const lastCall = new Map();
const THROTTLE_MS = 2000; // 2s cooldown

function canCall(userId) {
  const now = Date.now();
  const last = lastCall.get(userId) || 0;
  if (now - last < THROTTLE_MS) return false;
  lastCall.set(userId, now);
  return true;
}


// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// SUBSCRIPTION CHECK
// ─────────────────────────────────────────────

async function isProUser(chatId) {
  try {
    const { data } = await supabase
      .from('subscribers')
      .select('status, plan, expires_at')
      .eq('telegram_chat_id', chatId.toString())
      .maybeSingle();

    if (!data) return false;

    const now = new Date();
    if (data.status === 'active' && data.plan === 'pro') return true;
    if (data.status === 'grace' && data.expires_at && new Date(data.expires_at) > now) return true;
    
    return false;
  } catch (err) {
    console.error('Subscription check failed:', err.message);
    return false;
  }
}

function getFreeUserFooter(usage, isUpgrade = false) {
  const projected = usage + 1;
  const stars = "⭐".repeat(Math.min(projected, 10));
  
  if (isUpgrade) {
    return `\n\n💎 *Unlock FinSight Pro*\nUnlimited analysis and sharp signals.\n/subscribe — ₹299/month`;
  }
  
  return `\n\n📈 *Requests:* ${projected}/10\n${stars}\nGet unlimited access with /subscribe`;
}

function getNextSessionNote(status) {
  if (status.isWeekend || status.isHoliday || status.isPostMarket) {
    const next = status.nextTradingDay ? new Date(status.nextTradingDay) : null;
    if (next && status.istTime) {
      const dateStr = next.toDateString().split(' ').slice(0, 3).join(' ');
      const diffMs = next - new Date(status.istTime);
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      let countdown = `${hours}h ${mins}m`;
      if (hours > 48) {
        countdown = `${Math.floor(hours / 24)} days`;
      }
      
      let note = `👉 Next session: ${dateStr} 9:15 AM\n`;
      note += `⏳ Opens in ${countdown}`;
      return note;
    }
  }
  return "";
}

function getOpenStrategy(preMarket) {
  if (!preMarket) return "";
  if (preMarket.gapType === "gap up") {
    return "Watch for breakout continuation above opening high";
  }
  if (preMarket.gapType === "gap down") {
    return "Avoid early entry — wait for reversal or support";
  }
  return "Wait for first 15-min range breakout";
}

function formatAnalysis(res, symbol) {
  const lastUpdated = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: '2-digit',
    minute: '2-digit'
  });

  const intel = res.intelligence || {};
  const relStrength = intel.relativeStrength?.status || "Neutral";
  const sectorBias = intel.sector?.bias || "NEUTRAL";
  
  let signalLine = "";
  if (intel.signals?.length > 0) {
    signalLine = `\n🚨 *Intelligence Signals:*\n${intel.signals.map(s => `• ${s.type}: ${s.note}`).join("\n")}\n`;
  }

  const preMarketLine = res.preMarket ? `\n🔍 *Pre-Market:* ${res.preMarket.bias} (${res.preMarket.gap}%)\n` : "";
  const nextSession = res.marketStatus ? getNextSessionNote(res.marketStatus) : "";
  const nextLine = nextSession ? `\n📅 *Market Context:*\n${nextSession}` : `\n👉 *Next Step:* ${res.nextStep || "Wait for confirmation"}`;

  const transparencyIcon = res.dataConfidence === "CACHED" ? "🟡" : (res.dataConfidence === "DEGRADED_SOURCE" ? "🔴" : "🟢");
  const transparencyText = res.dataConfidence === "CACHED" ? `Cached (${res.dataAge}s old)` : (res.dataConfidence === "DEGRADED_SOURCE" ? "Fallback" : "Live");

  const insight = safeSubstring(res?.analysis, 200).trim();

  return `
🏛 *FINSIGHT AI — INSTITUTIONAL REPORT*
━━━━━━━━━━━━━━━━━━
📊 *VERDICT:* ${res.direction}
📈 *Asset:* ${symbol} | *Confidence:* ${res.confidence}/10

🎯 *EDGE:* ${relStrength}
🌐 *SECTOR:* ${sectorBias}
${signalLine}${preMarketLine}
🧠 *INSIGHT:*
${insight}...
${nextLine}

🕒 *Updated:* ${lastUpdated} IST | ${transparencyIcon} ${transparencyText}
━━━━━━━━━━━━━━━━━━`.trim();
}

// ─────────────────────────────────────────────
// ANALYSIS HELPERS
// ─────────────────────────────────────────────

async function performAnalysis(chatId, symbol, footer = "") {
  await bot.telegram.sendMessage(chatId, `🔍 Analyzing ${symbol}...\nPulling fundamentals, technicals, and risk profile.`);
  console.log("[ANALYZE]", {
    symbol,
    valid: shouldAnalyze(safeString(symbol).toUpperCase())
  });

  try {
    const stockData = await getCompanyOverview(symbol);
    const result = await masterAgent(stockData);

    const entryTiming = safeObject(result?.entryTiming);
    const exitSignal = safeObject(result?.exitSignal);
    const positionSizing = safeObject(result?.positionSizing);
    const rebalancer = safeObject(result?.rebalancer);
    const ticker = safeString(symbol).toUpperCase();

    if (result.status === "DATA_UNAVAILABLE") {
      await bot.telegram.sendMessage(chatId, `⚠️ Couldn't fetch data for ${ticker}.\nVerify the symbol or try again later.`);
      return;
    }

    let message = formatAnalysis(result, ticker);

    const executionAdvice = entryTiming?.finalExecutionAdvice || "No clear entry signal at this time. Maintain caution and monitor price action.";

    if (rebalancer.action && rebalancer.action !== "HOLD") {
      message += `\n\n⚖️ Portfolio Action:\n${rebalancer.action}: ${rebalancer.reason || "Alignment confirmed"}`;
    }

    message += `\n\n📍 Trade Setup:
Price: ₹${entryTiming?.currentPrice || 0} ${result.priceSource !== "LIVE" ? "(last close)" : ""}  
Watch Zone: ${entryTiming?.idealEntryZone || "Avoid"}  
Stop Loss: ${entryTiming?.stopLoss || "-"}  
Target: ${entryTiming?.initialTarget || "-"}  
Action: ${executionAdvice}

🚨 Exit View:
${exitSignal?.action || "Continue holding"}
Reason: ${exitSignal?.reason || "No significant exit triggers detected"}`;

    if (result.nextSessionPlan) {
      message += `\n\n🚀 Next Market Plan:
Watch the ${result.nextSessionPlan.entryTrigger} zone after market opens.  
Take action only if price confirms strength.  
Maintain discipline with stop loss at ${result.nextSessionPlan.stopLoss}.  
Avoid impulsive entries without confirmation.`;
    }

    message += `\n\n⚠️ This is an AI-generated analysis for educational purposes only. Not financial advice.`;
    if (footer) message += footer;

    await bot.telegram.sendMessage(chatId, message);
  } catch (err) {
    console.error("ANALYSIS ERROR:", err);
    return await bot.telegram.sendMessage(chatId, "⚠️ Temporary issue. Please try again.");
  }
}

// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// FREE COMMANDS (no gate)
// ─────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    `👋 Welcome to *FinSight AI*!\n\n` +
    `I'm your institutional-grade stock analysis assistant.\n\n` +
    `🆓 Free Plan: 10 requests / 12h\n` +
    `💎 Upgrade for unlimited:\n` +
    `👉 /subscribe\n\n` +
    `Type /help to see all commands.`,
    { parse_mode: 'Markdown' }
  );
});


bot.command('subscribe', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const name = ctx.from?.first_name || "there";

  await ctx.reply('⏳ Generating your payment link...');
  try {
    const { url } = await createPaymentLink(chatId);

    return ctx.reply(
      `💎 *Subscribe to FinSight Pro*\n\n` +
      `Hey ${name},\n` +
      `₹299 one-time (Full Month Access)\n\n` +
      `👉 ${url}\n\n` +
      `⚡ Unlock unlimited analysis instantly.\n` +
      `Access activates automatically after payment.`,
      { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }
    );
  } catch (err) {
    console.error('Payment link error:', err.message, err);
    await ctx.reply(`⚠️ Could not generate payment link.\nCheck server logs for details.`);
  }
});

// ─────────────────────────────────────────────
// /cancel COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('expires_at')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (!data) {
    return ctx.reply('❌ No active subscription found.');
  }

  const expiryDate = data.expires_at
    ? new Date(data.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Not set';

  return ctx.reply(
    `⚙️ *Cancel Subscription*\n\n` +
    `Your plan is active until: *${expiryDate}*\n\n` +
    `Choose an option:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel Now', 'cancel_now')],
        [Markup.button.callback('⏳ Cancel Later', 'cancel_later')]
      ])
    }
  );
});

// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// /status COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('status, expires_at, cancel_at_period_end, plan, razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  const now = new Date();
  const isActive =
    (data?.status === 'active' || data?.status === 'grace') &&
    (data.expires_at && new Date(data.expires_at) > now);

  if (!data || !isActive) {
    return ctx.reply(
      `🆓 *Free Plan*\n\n` +
      `You don't have an active Pro subscription.\n\n` +
      `👉 Type /subscribe to unlock FinSight Pro for ₹299/month.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data.status === 'grace') {
    return ctx.reply(
      `⚠️ *Payment Failed*\n\n` +
      `Your subscription is in a 48-hour grace period.\n` +
      `We'll retry the payment automatically.\n` +
      `Update your payment method to avoid interruption.`,
      { parse_mode: 'Markdown' }
    );
  }

  const expiryDate = data.expires_at
    ? new Date(data.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Not set';

  let expiryText = `Expires: ${expiryDate}`;
  let autoRenewText = `Auto-renew: ${data.cancel_at_period_end ? '❌ Off (cancels at expiry)' : '✅ On'}`;
  
  if (data.razorpay_subscription_id && !data.cancel_at_period_end) {
    expiryText = `Renews on: ${expiryDate}`;
    autoRenewText = `Auto-renew: ✅ On`;
  } else if (data.razorpay_subscription_id) {
    expiryText = `Expires on: ${expiryDate}`;
    autoRenewText = `Auto-renew: ❌ Off`;
  }

  const subIdText = data.razorpay_subscription_id ? `Sub ID: \`${data.razorpay_subscription_id}\`\n` : '';

  return ctx.reply(
    `💎 *Pro Active*\n\n` +
    `Plan: ${data.plan || 'Pro'}\n` +
    `${expiryText}\n` +
    `${autoRenewText}\n` +
    `${subIdText}\n` +
    `Type /cancel to manage your subscription.`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// BUTTON HANDLERS
// ─────────────────────────────────────────────

bot.action('cancel_now', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (data?.razorpay_subscription_id) {
    try {
      await cancelSubscriptionNow(data.razorpay_subscription_id);
    } catch (err) {
      console.error('Razorpay cancel error:', err.message);
    }
  }

  await supabase
    .from('subscribers')
    .update({
      status: 'cancelled',
      plan: 'free',
      cancelled_at: new Date().toISOString()
    })
    .eq('telegram_chat_id', chatId);
  
  await ctx.answerCbQuery('Subscription cancelled immediately.');
  return ctx.reply('❌ *Subscription Cancelled*\n\nYou are now on the free plan.', { parse_mode: 'Markdown' });
});

bot.action('cancel_later', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (data?.razorpay_subscription_id) {
    try {
      await cancelSubscriptionLater(data.razorpay_subscription_id);
    } catch (err) {
      console.error('Razorpay update error:', err.message);
    }
  }

  await supabase
    .from('subscribers')
    .update({
      cancel_at_period_end: true
    })
    .eq('telegram_chat_id', chatId);
  
  await ctx.answerCbQuery('Cancellation scheduled for end of billing period.');
  return ctx.reply('✅ Your subscription will continue until expiry and then stop automatically.');
});

// ─────────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ─────────────────────────────────────────────

bot.on("text", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    // 1. Rate Limit Check
    if (!canCall(chatId)) {
        return; // Silent drop or minimal feedback
    }

    console.log("CHAT ID:", chatId);
    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    const lowerText = text.toLowerCase();
    const skipUsage = ["ok", "okay", "thanks", "hi"].includes(lowerText);

    const subscribed = await isProUser(chatId);

    let usageCount = 0;
    if (!subscribed) {
      const usage = await checkUsage(chatId);
      usageCount = usage.count;
      if (!usage.allowed) {
        return ctx.reply(
          `🚫 Limit reached (10/10)\nResets in 12 hours\n💎 Upgrade:\n👉 /subscribe`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    const displayedUsage = skipUsage ? usageCount : usageCount + 1;
    console.log(`[DEBUG] ChatID: ${chatId} | skipUsage: ${skipUsage} | usageCount: ${usageCount} | displayedUsage: ${displayedUsage}`);

    // ── /help ──────────────────────────────────
    if (lowerText === "/help") {
      await bot.telegram.sendMessage(
        chatId,
        `🏦 *Finsight AI — Command Menu*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `• /analyze <TICKER> — Full deep-dive report\n` +
        `• /quick <TICKER> — Quick trend check\n` +
        `• /compare <T1> <T2> — Side-by-side comparison\n` +
        `• /top — 🚀 Top market opportunities\n` +
        `• /sector — 📊 Sector rotation report\n` +
        `• /portfolio — 🏥 Portfolio health\n` +
        `• /add <T> <Q> <P> — Add holding\n` +
        `• /update <T> <Q> <P> — Update holding\n` +
        `• /remove <T> — Remove holding\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ Educational purposes only. Not SEBI registered advice.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // ── /quick (Free) ──────────────────────────
    if (lowerText.startsWith("/quick")) {
      const ticker = extractSymbol(text.replace(/^\/quick/i, ""));
      if (!ticker || ticker.length > 15) {
        await bot.telegram.sendMessage(chatId, "Please enter a valid ticker like TCS, RELIANCE, INFY");
        return;
      }
      await bot.telegram.sendMessage(chatId, `⚡ Quick scan: ${ticker}...`);
      try {
        const stockData = await getCompanyOverview(ticker);
        const result = await masterAgent(stockData);
        const counterLine = subscribed ? '' : getFreeUserFooter(displayedUsage, true);
        const message =
          `⚡ *QUICK VERDICT — ${safeString(ticker).toUpperCase()}*\n\n` +
          `📊 Verdict: ${result.decision?.finalDecision || "HOLD"}\n` +
          `🎯 Confidence: ${result.decision?.finalConfidenceScore || 0}/10\n` +
          `⚠ Risk Level: ${result.risk?.riskLevel || "N/A"}\n\n` +
          `📝 Summary:\n${result.decision?.reason || "No summary available"}` +
          counterLine;
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (error) {
        await bot.telegram.sendMessage(chatId, "⚠️ Temporary issue analyzing this stock. Try again in a moment.");
      }
      return;
    }

    // ── PRO: /compare ──────────────────────────
    if (lowerText.startsWith("/compare ")) {
      const parts = text.split(" ");
      if (parts.length < 3) {
        await bot.telegram.sendMessage(chatId, "Example: /compare TCS INFY");
        return;
      }
      const ticker1 = safeString(parts[1]).trim();
      const ticker2 = safeString(parts[2]).trim();
      await bot.telegram.sendMessage(chatId, `⚖ Comparing ${ticker1} vs ${ticker2}...`);
      try {
        const [stock1, stock2] = await Promise.all([getCompanyOverview(ticker1), getCompanyOverview(ticker2)]);
        const [result1, result2] = await Promise.all([masterAgent(stock1), masterAgent(stock2)]);
        const score1 = result1.decision.finalConfidenceScore;
        const score2 = result2.decision.finalConfidenceScore;
        const winner = score1 >= score2 ? safeString(ticker1).toUpperCase() : safeString(ticker2).toUpperCase();
        const message =
          `⚖ *STOCK COMPARISON*\n\n` +
          `📈 *${safeString(ticker1).toUpperCase()}*\n` +
          `Verdict: ${result1.decision?.finalDecision || "HOLD"}\n` +
          `Confidence: ${score1 || 0}/10\n` +
          `Risk: ${result1.risk?.riskLevel || "N/A"}\n\n` +
          `📈 *${safeString(ticker2).toUpperCase()}*\n` +
          `Verdict: ${result2.decision?.finalDecision || "HOLD"}\n` +
          `Confidence: ${score2 || 0}/10\n` +
          `Risk: ${result2.risk?.riskLevel || "N/A"}\n\n` +
          `🏆 Better Opportunity: *${winner}*\n\n` +
          `⚠️ Educational only. Not SEBI advice.`;
        if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (error) {
        await bot.telegram.sendMessage(chatId, "❌ Comparison failed. Please check ticker symbols.");
      }
      return;
    }

    // ── PRO: /top /scanner /opportunities ─────
    if (["/scanner", "/top", "/opportunities"].includes(lowerText)) {
      await bot.telegram.sendMessage(chatId, "🔍 Running Institutional Scanner...\nPlease wait.");
      const opportunities = await scannerAgent();
      if (!opportunities || !opportunities.length) {
        return await bot.telegram.sendMessage(chatId, "No strong opportunities found right now. Try again later.");
      }
      let message = "🏆 TOP OPPORTUNITIES TODAY\n\n";
      opportunities.forEach((stock, index) => {
        message += `#${index + 1} ${stock.stock}\n`;
        message += `📊 Decision: ${stock.decision} (${stock.confidenceScore}/10)\n`;
        message += `💰 Price: ₹${stock.currentPrice}\n`;
        message += `🎯 Entry Zone: ${stock.idealEntryZone}\n`;
        message += `🛑 Stop Loss: ${stock.stopLoss}\n`;
        message += `🎯 Target: ${stock.initialTarget}\n`;
        message += `⚖️ R/R Ratio: ${stock.rewardRiskRatio}\n`;
        message += `⚡ Urgency: ${stock.entryUrgency}\n`;
        message += `🧠 Reason:\n${stock.entryReasoning}\n`;
        message += `📌 Advice:\n${stock.finalExecutionAdvice}\n\n`;
      });
      message += "⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
      if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
      await bot.telegram.sendMessage(chatId, message);
      if (!subscribed && !skipUsage) await incrementUsage(chatId);
      return;
    }

    // ── PRO: /sector /sectors /rotation ───────
    if (["/sector", "/sectors", "/rotation"].includes(lowerText)) {
      await bot.telegram.sendMessage(chatId, "📊 Running Sector Rotation Scanner...");
      const sectors = await sectorScannerAgent();
      if (!sectors.length) {
        return await bot.telegram.sendMessage(chatId, "No sector strength data available right now.");
      }
      let message = "📊 SECTOR ROTATION REPORT\n\n";
      sectors.slice(0, 5).forEach((item, index) => {
        message += `#${index + 1} ${item.sector}\n`;
        message += `🏆 Strength Score: ${item.avgScore}/10\n\n`;
      });
      message += "⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
      if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
      await bot.telegram.sendMessage(chatId, message);
      if (!subscribed && !skipUsage) await incrementUsage(chatId);
      return;
    }

    // ── Awaiting stock input ───────────────────
    if (userStates.get(chatId) === "AWAITING_STOCK") {
      userStates.delete(chatId);
      const ticker = safeString(text).trim().toUpperCase();
      if (ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(chatId, "Please enter a valid stock ticker like TCS, RELIANCE, INFY");
        return;
      }
      await performAnalysis(chatId, text, !subscribed ? getFreeUserFooter(displayedUsage, true) : "");
      if (!subscribed && !skipUsage) await incrementUsage(chatId);
      return;
    }

    // ── PRO: Portfolio Commands ────────────────
    if (lowerText.startsWith("/add ")) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) {
        return bot.telegram.sendMessage(chatId, "Usage: /add TICKER QUANTITY PRICE\nExample: /add HDFCBANK 50 1450");
      }
      const symbol = safeString(parts[1]).toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);
      if (isNaN(quantity) || isNaN(avgPrice)) {
        return bot.telegram.sendMessage(chatId, "❌ Invalid quantity or price. Please use numbers.");
      }
      try {
        await addHolding(chatId, { symbol, quantity, avgPrice });
        let msg = `✅ Holding Added Successfully\n📈 Stock: ${symbol}\n📦 Quantity: ${quantity}\n💰 Avg Buy Price: ₹${avgPrice}\n📊 Total Invested: ₹${quantity * avgPrice}\n\nUse /portfolio to view full health.`;
        if (!subscribed) msg += getFreeUserFooter(displayedUsage, true);
        await bot.telegram.sendMessage(chatId, msg);
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error adding holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/update ")) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) {
        return bot.telegram.sendMessage(chatId, "Usage: /update TICKER QUANTITY PRICE\nExample: /update HDFCBANK 80 1425");
      }
      const symbol = safeString(parts[1]).toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);
      if (isNaN(quantity) || isNaN(avgPrice)) {
        return bot.telegram.sendMessage(chatId, "❌ Invalid quantity or price. Please use numbers.");
      }
      try {
        await updateHolding(chatId, symbol, { quantity, avg_price: avgPrice, updated_at: new Date() });
        let msg = `🔄 Holding Updated\n📈 Stock: ${symbol}\n📦 New Quantity: ${quantity}\n💰 New Avg Price: ₹${avgPrice}\n📊 New Total Invested: ₹${quantity * avgPrice}`;
        if (!subscribed) msg += getFreeUserFooter(displayedUsage, true);
        await bot.telegram.sendMessage(chatId, msg);
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error updating holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/remove")) {
      const symbol = extractSymbol(text.replace(/^\/remove/i, ""));
      if (!symbol) return bot.telegram.sendMessage(chatId, "Usage: /remove TICKER");
      try {
        await removeHolding(chatId, symbol);
        let msg = `🗑 ${symbol} removed from your portfolio.`;
        if (!subscribed) msg += getFreeUserFooter(displayedUsage);
        await bot.telegram.sendMessage(chatId, msg);
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error removing holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/portfolio")) {
      try {
        const lines = text.split("\n").slice(1);
        let stocks = lines
          .map((line) => {
            const [symbol, allocation] = line.trim().split(" ");
            if (!symbol || !allocation) return null;
            return { symbol, allocation: Number(allocation) };
          })
          .filter(Boolean);

        if (!stocks.length) {
          const dbHoldings = await getPortfolio(chatId);
          if (!dbHoldings || dbHoldings.length === 0) {
            await bot.telegram.sendMessage(chatId, `Your portfolio is empty.\nUse /add TICKER QTY PRICE to add holdings.`);
            return;
          }
          stocks = dbHoldings;
        }

        const health = await analyzePortfolioHealth(stocks);
        const details = safeObject(health?.details);
        
        const message =
          `🏥 PORTFOLIO HEALTH REPORT\n━━━━━━━━━━━━━━━━━━\n` +
          `📊 Health Score: ${health.score}/10\n` +
          `🏅 Status: ${health.status}\n` +
          `⚠️ Risk Level: ${health.riskLevel}\n` +
          `🌐 Diversification: ${health.diversification}\n` +
          `⚖️ Concentration: ${health.concentrationRisk}\n\n` +
          `🧠 Institutional Advice:\n${health.action}\n\n` +
          `📈 Portfolio Stats:\n` +
          `• Holdings: ${details.stockCount || 0} Stocks\n` +
          `• Max Weight: ${details.highestAllocation || "N/A"}\n` +
          `• Sector Mix: ${details.uniqueSectors || 0} Sectors\n\n` +
          `Use /analyze <TICKER> for deep dive on any holding.\n━━━━━━━━━━━━━━━━━━\n` +
          `⚠️ Educational purposes only.`;
        if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
        await bot.telegram.sendMessage(chatId, message);
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (err) {
        console.error("PORTFOLIO ERROR:", err);
        await bot.telegram.sendMessage(chatId, "⚠️ Unable to fetch portfolio health right now. Please try again later.");
      }
      return;
    }

    // ── /analyze (tiered) ─────────────────────
    if (lowerText === "analyze" || lowerText === "/analyze") {
      userStates.set(chatId, "AWAITING_STOCK");
      await bot.telegram.sendMessage(chatId, "Please enter the stock ticker (e.g. TCS, RELIANCE)");
      return;
    }

    // ── Intent Detection (Strict Routing) ───
    const symbolCandidate = extractSymbol(text);
    // 🔥 FINAL HARD SANITIZE (Gate 0)
    const normalizedSymbol = safeString(symbolCandidate).replace(/\//g, "").trim().toUpperCase();

    const isExplicitAnalyze = lowerText.startsWith("/analyze") || lowerText.startsWith("analyze");
    const isTickerPattern = shouldAnalyze(normalizedSymbol);

    if (isExplicitAnalyze || isTickerPattern) {
      if (normalizedSymbol && normalizedSymbol.length <= 15) {
        // Second-Layer Validation: Check if symbol actually exists
        const exists = await checkSymbolExists(normalizedSymbol);
        if (exists) {
          await performAnalysis(chatId, normalizedSymbol, !subscribed ? getFreeUserFooter(displayedUsage) : "");
          if (!subscribed && !skipUsage) await incrementUsage(chatId);
          return;
        } else if (isExplicitAnalyze) {
          return await bot.telegram.sendMessage(chatId, "⚠️ I couldn't find that stock. Please check the ticker (e.g., TCS, RELIANCE) and try again.");
        }
        // If it was just a ticker pattern (e.g. "GOOD") and it doesn't exist, let it flow to chat
      }
    }

    const simpleReplies = {
      'hi': "What do you want to check — a stock or the market?",
      'hello': "What do you want to analyze today?",
      'how are you': "Focused on markets. What do you want to check?",
      'ok': "Got it.",
      'okay': "Got it.",
      'thanks': "Anytime.",
      'thank you': "Anytime.",
      'bye': "Alright. Reach out when you need clarity."
    };

    if (simpleReplies[lowerText]) {
      return await bot.telegram.sendMessage(chatId, simpleReplies[lowerText]);
    }

    // ── AI Conversation (Finance or Casual) ───
    let finalMessage = "";
    try {
      const aiResponse = await masterAgent({ userQuery: text, mode: "conversation", isPro: subscribed });
      finalMessage = aiResponse.response;
    } catch (err) {
      console.error("AI FAIL:", err);
      finalMessage = "Ask me about any stock or market — I’ll break it down.";
    }

    if (!subscribed) {
      finalMessage += getFreeUserFooter(displayedUsage);
    }
    
    await bot.telegram.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
    if (!subscribed && !skipUsage) await incrementUsage(chatId);
    return;

  } catch (error) {
    console.error("Telegram Bot Error:", error);
    await ctx.reply("⚠️ Temporary issue processing your request. Please try again in a moment.");
  }
});

// ─────────────────────────────────────────────
// START BOT
// ─────────────────────────────────────────────

export const startBot = () => {
  if (global.botStarted) {
    console.log("⚠️ Bot already initialized. Skipping...");
    return;
  }
  global.botStarted = true;

  bot.launch().catch((err) => {
    if (err.response && err.response.error_code === 409) {
      console.log("⚠️ Telegram Bot already running (409 Conflict). Skipping launch.");
    } else {
      console.error("❌ Telegram Bot Launch Error:", err);
    }
  });
  console.log("✅ Telegram Bot Started");
};

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default bot;
