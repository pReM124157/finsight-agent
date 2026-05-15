import { Telegraf, Markup } from "telegraf";
import { masterAgent } from "../agents/master.agent.js";
import { safeObject, safeString, safeSubstring } from "../core/safety.js";
import { parseInput } from "../core/router.js";
import { isValidSymbol } from "../core/validator.js";
import { isPro } from "../core/user.js";
import { buildMessage } from "../core/messageBuilder.js";
import { runAnalysisSafe } from "../core/analysisRunner.js";

// Global Production Guards
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

import { checkSymbolExists } from "./marketData.service.js";
import { scannerAgent } from "../agents/scanner.agent.js";
import { sectorScannerAgent } from "../agents/sectorScanner.agent.js";
import { buildPortfolioReview } from "../agents/portfolioReview.agent.js";
import {
  addHolding,
  getPortfolio,
  removeHolding,
  updateHolding
} from "./portfolioMemory.service.js";
import { createPaymentLink, cancelSubscriptionNow, cancelSubscriptionLater } from "../routes/payment.js";
import supabase from "./supabase.service.js";
import { handleUsage } from "./usage.service.js";
import { generateChatReply } from "./chat.service.js";
import { formatIST } from "../utils/time.js";
import { formatPortfolioReview } from "../core/portfolioFormatter.js";
import { buildAnalysisContext } from "../core/analysisContext.js";
import {
  claimEphemeralKey,
  consumeState,
  putState
} from "./distributedState.service.js";
import { createTraceId, logError, logEvent } from "./telemetry.service.js";
import {
  claimSchedulerLease,
  getInstanceId,
  releaseSchedulerLease,
  renewSchedulerLease
} from "./schedulerLease.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const THROTTLE_MS = 2000; // 2s cooldown
const ANALYZE_STATE_TTL_SECONDS = 10 * 60;
const CHAT_MEMORY_TTL_SECONDS = 24 * 60 * 60;
const BOT_LEASE_NAME = "telegram_bot_polling";
const BOT_LEASE_TTL_SECONDS = 120;
const BOT_LEASE_HEARTBEAT_MS = 30000;
const BOT_LEASE_RETRY_MS = 15000;
const BOT_INSTANCE_ID = getInstanceId();
const TELEGRAM_LEASE_REQUIRED = process.env.TELEGRAM_LEASE_REQUIRED === "true";
let botStarted = false;
let botSupervisorStarted = false;
let botHeartbeatTimer = null;
let botSupervisorTimer = null;
let botLeaseOwner = false;
let botLaunchInFlight = false;
let botStartedInFallbackMode = false;

async function canCall(userId) {
  try {
    const ownerId = createTraceId(`throttle_${userId}`);
    return claimEphemeralKey("telegram_throttle", userId, ownerId, Math.ceil(THROTTLE_MS / 1000));
  } catch (error) {
    logError("telegram.throttle.error", error, { userId });
    return true;
  }
}

async function launchBotIfNeeded(mode = "lease") {
  if (botStarted || botLaunchInFlight) return;

  botLaunchInFlight = true;
  try {
    await bot.launch();
    botStarted = true;
    botStartedInFallbackMode = mode === "fallback";
    logEvent("telegram.bot.started", {
      ownerId: BOT_INSTANCE_ID,
      mode
    });
  } catch (err) {
    if (err.response && err.response.error_code === 409) {
      logEvent("telegram.bot.conflict", { ownerId: BOT_INSTANCE_ID, mode });
    } else {
      logError("telegram.bot.launch_error", err, { ownerId: BOT_INSTANCE_ID, mode });
      throw err;
    }
  } finally {
    botLaunchInFlight = false;
  }
}


// ─────────────────────────────────────────────

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

function isCasualMessage(text) {
  const casual = [
    "hi", "hello", "hey", "ok", "okay", "thanks",
    "thank you", "yo", "sup", "bro", "nothing",
    "bye", "good", "nice", "hmm"
  ];
  const clean = safeString(text).toLowerCase().trim();
  return casual.includes(clean) || clean.length < 4;
}

function shouldAnalyze(symbol, originalText) {
  if (!symbol) return false;
  const text = safeString(originalText).toLowerCase();
  if (text.includes(" ")) return false;
  const ignoreWords = [
    "hi", "hello", "hey", "thanks", "thank", "you",
    "ok", "okay", "friend", "assistance", "nothing",
    "good", "nice", "yes", "no"
  ];
  if (ignoreWords.includes(symbol.toLowerCase())) return false;
  if (!/^[A-Z]{3,10}$/.test(symbol)) return false;
  return true;
}

function extractSymbol(text) {
  if (!text) return null;
  const clean = safeString(text)
    .replace("/", "")
    .replace("analyze", "")
    .trim();
  if (clean.includes(" ")) return null;
  return clean.toUpperCase();
}

function smartFallback(label, data, context = {}) {
  if (data !== undefined && data !== null && data !== "") return data;
  switch (label) {
    case "support":
      return context.price ? `Near ₹${Math.round(context.price * 0.97)}` : "Not clearly defined";
    case "resistance":
      return context.price ? `Near ₹${Math.round(context.price * 1.03)}` : "Not clearly defined";
    case "momentum":
      if (context.priceChange > 1) return "Bullish momentum building";
      if (context.priceChange < -1) return "Weak momentum";
      return "Sideways";
    case "interpretation":
      return "Mixed fundamentals — moderate growth with balanced risk profile.";
    case "news_positive":
      return "No major positive triggers recently.";
    case "news_negative":
      return "No major negative developments detected.";
    case "trigger_up":
      return context.price
        ? `Break above ₹${Math.round(context.price * 1.02)}`
        : "Watch resistance breakout";
    case "trigger_down":
      return context.price
        ? `Break below ₹${Math.round(context.price * 0.98)}`
        : "Watch support breakdown";
    case "final_insight":
      return "Stock is in a neutral zone — wait for confirmation before taking positions.";
    default:
      return "-";
  }
}

function isVerifiedAnalysisUnavailable(result) {
  return safeString(result?.status) === "VERIFIED_ANALYSIS_UNAVAILABLE" || result?.blockExecution === true;
}

function clampPublicConfidence(value, floor = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return floor;
  return Math.max(Math.round(numeric), floor);
}

function formatAnalysis(res, symbol, stockData = {}) {
  const result = safeObject(res);
  if (isVerifiedAnalysisUnavailable(result)) {
    return safeString(
      result.message ||
      `⚠ Unable to generate verified institutional analysis for ${symbol} right now.\nCore market or financial data could not be validated.\nPlease retry in a few moments.`
    );
  }

  const entryTiming = safeObject(result.entryTiming);
  const technical = safeObject(result.technical);
  const valuation = safeObject(result.valuation);
  const risk = safeObject(result.risk);
  const exitSignal = safeObject(result.exitSignal);
  const intelligence = safeObject(result.intelligence);
  const sector = safeObject(intelligence.sector);
  const relStrength = safeObject(intelligence.relativeStrength);
  const preMarket = safeObject(result.preMarket);
  const nextSessionPlan = safeObject(result.nextSessionPlan);
  const news = safeObject(result.news);
  const priceField = safeString(result.priceField || "");

  let marketStatusLabel = "Closed (Last Close Data)";
  if (priceField === "postMarketPrice") {
    marketStatusLabel = "Closed (Post-Market Live Data)";
  } else if (priceField === "preMarketPrice") {
    marketStatusLabel = "Pre-Market (Live Discovery)";
  } else if (result.isMarketOpen) {
    marketStatusLabel = "Open (Live Data)";
  } else if (priceField === "regularMarketPrice" || priceField === "currentPrice") {
    marketStatusLabel = "Closed (Latest Regular Session Price)";
  }

  const price = Number(result.currentPrice || entryTiming.currentPrice || 0);
  const priceChange = Number(technical.priceChangePercent || technical.changePercent || 0);

  const normalized = {
    verdict: safeString(result.direction || result.action || result?.decision?.finalDecision || "HOLD"),
    rating: clampPublicConfidence(result?.decision?.finalConfidenceScore || result.confidence || 5),
    confidence: clampPublicConfidence(result.confidence || result?.decision?.finalConfidenceScore || 0),
    asset: safeString(symbol || "UNKNOWN"),
    currentPrice: price,
    marketStatus: marketStatusLabel,
    trend: safeString(technical.trend || "Neutral"),
    support: smartFallback("support", technical.supportLevel, { price }),
    resistance: smartFallback("resistance", technical.resistanceLevel, { price }),
    momentum: smartFallback("momentum", safeString(technical.momentum || technical.signal), { priceChange }),
    volume: safeString(technical.volumeTrend || (technical.isVolumeSpike ? "Spike" : "Normal")),
    entryZone: safeString(entryTiming.idealEntryZone || "Watch opening range"),
    stopLoss: safeString(entryTiming.stopLoss || (price ? `₹${Math.round(price * 0.96)}` : "Dynamic by volatility")),
    target: safeString(entryTiming.initialTarget || (price ? `₹${Math.round(price * 1.06)}` : "Trend continuation target")),
    tradeAction: safeString(entryTiming.finalExecutionAdvice || "Wait for confirmation with price and volume."),
    pe: stockData.PERatio ?? "-",
    roe: stockData.ReturnOnEquityTTM ?? "-",
    profitMargin: stockData.ProfitMargin ?? "-",
    debtEquity: stockData.DebtToEquityRatio ?? "-",
    revenueGrowth: stockData.QuarterlyRevenueGrowthYOY ?? "-",
    earningsGrowth: stockData.QuarterlyEarningsGrowthYOY ?? "-",
    fundamentalView: smartFallback("interpretation", result.analysis || ""),
    sectorName: safeString(stockData.Sector || "Unknown Sector"),
    sectorBias: safeString(sector.bias || "NEUTRAL"),
    relStrength: safeString(relStrength.status || "Neutral"),
    institutionalBias: safeString(result.marketNote || "Institutional activity appears balanced."),
    newsPositive: smartFallback("news_positive", safeString(news.positive)),
    newsNegative: smartFallback("news_negative", safeString(news.negative)),
    sentiment: safeString(news.sentiment || "NEUTRAL"),
    riskLevel: safeString(result.riskLevel || risk.riskLevel || "MEDIUM"),
    exitAction: safeString(exitSignal.action || "Monitor closely"),
    exitReason: safeString(exitSignal.reason || "No strong exit trigger yet."),
    bullishScenario: smartFallback("trigger_up", safeString(nextSessionPlan.entryTrigger), { price }),
    bearishScenario: smartFallback("trigger_down", safeString(nextSessionPlan.stopLoss), { price }),
    keyTrigger: safeString(nextSessionPlan.note || "Opening gap + volume confirmation"),
    finalInsight: smartFallback("final_insight", result.analysis || "")
  };

  const fmt = (value, pct = false) => {
    if (value === "-" || value === "") return "-";
    const n = Number(value);
    if (Number.isNaN(n)) return `${value}`;
    return pct ? `${(n * 100).toFixed(1)}%` : n.toString();
  };

  const priceText = normalized.currentPrice > 0 ? `₹${normalized.currentPrice}` : "Price discovery in progress";

  return `
🏛 *FINSIGHT AI — INSTITUTIONAL REPORT (V2)*
━━━━━━━━━━━━━━━━━━
📊 *VERDICT:* ${normalized.verdict}
⭐ *RATING:* ${normalized.rating}/10 | Confidence: ${normalized.confidence}/10
📈 *Asset:* ${normalized.asset}
💰 *Current Price:* ${priceText}
🕒 *Market Status:* ${normalized.marketStatus}
━━━━━━━━━━━━━━━━━━
📊 *TECHNICAL VIEW*
• Trend: ${normalized.trend}
• Support: ${normalized.support}
• Resistance: ${normalized.resistance}
• Momentum: ${normalized.momentum}
• Volume: ${normalized.volume}
📍 Trade Setup:
• Entry Zone: ${normalized.entryZone}
• Stop Loss: ${normalized.stopLoss}
• Target: ${normalized.target}
• Action: ${normalized.tradeAction}
━━━━━━━━━━━━━━━━━━
📉 *FUNDAMENTAL SNAPSHOT*
• P/E Ratio: ${fmt(normalized.pe)}
• ROE: ${fmt(normalized.roe, true)}
• Profit Margin: ${fmt(normalized.profitMargin, true)}
• Debt/Equity: ${fmt(normalized.debtEquity)}
• Revenue Growth (YoY): ${fmt(normalized.revenueGrowth, true)}
• Earnings Growth (YoY): ${fmt(normalized.earningsGrowth, true)}
🧠 Interpretation:
${normalized.fundamentalView}
━━━━━━━━━━━━━━━━━━
🌐 *SECTOR & RELATIVE STRENGTH*
• Sector: ${normalized.sectorName} → ${normalized.sectorBias}
• Relative Strength vs Nifty: ${normalized.relStrength}
• Institutional Bias: ${normalized.institutionalBias}
━━━━━━━━━━━━━━━━━━
📰 *LATEST NEWS & SENTIMENT*
• Positive: ${normalized.newsPositive}
• Negative: ${normalized.newsNegative}
• Overall Sentiment: ${normalized.sentiment}
━━━━━━━━━━━━━━━━━━
🚨 *RISK & EXIT VIEW*
• Risk Level: ${normalized.riskLevel}
• Exit Signal: ${normalized.exitAction}
• Suggested Action: ${normalized.exitAction}
• Reason: ${normalized.exitReason}
━━━━━━━━━━━━━━━━━━
🔮 *WHAT HAPPENS AFTER MARKET OPENS*
• If price breaks confirmation zone → ${normalized.bullishScenario}
• If price weakens below risk zone → ${normalized.bearishScenario}
• Key Trigger: ${normalized.keyTrigger}
━━━━━━━━━━━━━━━━━━
🧠 *FINAL INSIGHT*
${normalized.finalInsight}
━━━━━━━━━━━━━━━━━━
⚠️ Educational use only. Not financial advice.`.trim();
}

// ─────────────────────────────────────────────
// ANALYSIS HELPERS
// ─────────────────────────────────────────────

async function performAnalysis(chatId, symbol, footer = "") {
  await bot.telegram.sendMessage(chatId, `🔍 Analyzing ${symbol}...\nPulling fundamentals, technicals, and risk profile.`);
  console.log("[ANALYZE]", { symbol });

  const result = await runAnalysisSafe(symbol, async (sym) => {
    const { stockData } = await buildAnalysisContext(sym);
    console.log("MASTER AGENT CALLED");
    console.log("MESSAGE:", sym);
    const data = await masterAgent(stockData, { strictValidation: true });
    if (!data) {
      console.log("[GLOBAL GUARD] No data at all for", sym);
      throw new Error("DATA_UNAVAILABLE");
    }
    return formatAnalysis(data, sym, stockData);
  });

  if (!result.ok) {
    await bot.telegram.sendMessage(chatId, result.message);
    return;
  }

  // We only get here if result.ok is true and result.text is the formatted analysis.
  // We apply the footer. Because we don't have the full `user` object here,
  // we just append the footer if it's truthy (since the handler already decided if the user gets a footer or not).
  let finalMessage = result.text;
  if (footer) finalMessage += `\n\n${footer}`;

  await bot.telegram.sendMessage(chatId, finalMessage);
}

async function sendSubscriptionLink(chatId) {
  const { url } = await createPaymentLink(chatId.toString());
  await bot.telegram.sendMessage(
    chatId,
    `💎 Unlock FinSight Pro
• Unlimited chats
• Full analysis access
• Priority insights
👉 Pay here: ${url}`
  );
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
  try {
    await sendSubscriptionLink(ctx.chat.id);
    return;
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
    ? formatIST(data.expires_at)
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
      `👉 Type /subscribe to unlock FinSight Pro for ₹599/month.`,
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
    ? formatIST(data.expires_at)
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
      plan: 'FREE',
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
    const chatId = ctx.chat.id.toString();

    const traceId = createTraceId("tg");
    logEvent("telegram.message.received", { traceId, chatId });

    if (!(await canCall(ctx.chat.id))) return;

    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    // ── Single DB fetch ─────────────────────────────────────────────
    let { data: user } = await supabase
      .from("subscribers")
      .select("plan, is_pro, subscription_end, status, expires_at")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    const effectiveExpiry = user?.expires_at || user?.subscription_end || null;
    if (
      user?.plan === "PRO" &&
      effectiveExpiry &&
      new Date(effectiveExpiry) < new Date()
    ) {
      console.log("⚠️ Auto downgrade triggered:", chatId);
      await supabase
        .from("subscribers")
        .update({
          plan: "FREE",
          is_pro: false,
          status: "expired",
          expires_at: null,
          subscription_end: null,
          free_usage_count: 0,
          usage_started_at: new Date()
        })
        .eq("telegram_chat_id", chatId);
      user.plan = "FREE";
      user.is_pro = false;
      user.free_usage_count = 0;
      
      await bot.telegram.sendMessage(
        chatId, 
        "⚠️ *Subscription Expired*\nYour FinSight Pro access has ended. You are now on the Free plan.\n\n👉 /subscribe to renew.",
        { parse_mode: "Markdown" }
      );
    }

    const proUser = isPro(user);

    // ── Usage gate (FREE only) ──────────────────────────────────────
    let usage = { allowed: true, count: 0, reset_time: null };
    if (!proUser) {
      usage = await handleUsage(chatId);
      if (!usage.allowed) {
        if (usage.reason === "USAGE_UNAVAILABLE") {
          await ctx.reply("⚠️ Usage control is temporarily unavailable. Please try again shortly.");
          return;
        }
        const resetIST = new Date(usage.reset_time).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit"
        });
        await ctx.reply(`⛔ Limit reached (10/10)\nYou can chat again at ${resetIST}\n💎 Want unlimited access?\n👉 /subscribe`);
        return; // HARD STOP
      }
    }

    const footer = proUser ? "" : `\n\n📈 Requests: ${usage.count}/10`;

    // Single send helper — all messages pass through buildMessage
    const send = (msg, opts) =>
      bot.telegram.sendMessage(chatId, buildMessage(msg, user, footer), opts);

    const lowerText = text.toLowerCase();

    // ── /subscribe ─────────────────────────────────────────────────
    if (lowerText === "/subscribe") {
      await sendSubscriptionLink(chatId);
      return;
    }

    // ── /help ──────────────────────────────────────────────────────
    if (lowerText === "/help") {
      await bot.telegram.sendMessage(chatId,
        `🏦 *Finsight AI — Command Menu*\n━━━━━━━━━━━━━━━━━━\n\n` +
        `• /analyze <TICKER> — Full deep-dive report\n• /quick <TICKER> — Quick trend check\n` +
        `• /compare <T1> <T2> — Side-by-side comparison\n• /top — 🚀 Top market opportunities\n` +
        `• /sector — 📊 Sector rotation report\n• /portfolio — 🏥 Portfolio health\n` +
        `• /add <T> <Q> <P> — Add holding\n• /update <T> <Q> <P> — Update holding\n• /remove <T> — Remove holding\n\n` +
        `━━━━━━━━━━━━━━━━━━\n⚠️ Educational purposes only. Not SEBI registered advice.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // ── /quick ─────────────────────────────────────────────────────
    if (lowerText.startsWith("/quick")) {
      const ticker = text.replace(/^\/quick\s*/i, "").trim().toUpperCase();
      if (!isValidSymbol(ticker)) { await send("Please enter a valid ticker like TCS, RELIANCE, INFY"); return; }
      await bot.telegram.sendMessage(chatId, `⚡ Quick scan: ${ticker}...`);
      try {
        const { stockData } = await buildAnalysisContext(ticker);
        const result = await masterAgent(stockData);
        const quickConfidence = clampPublicConfidence(result.decision?.finalConfidenceScore || 0);
        const msg =
          `⚡ *QUICK VERDICT — ${ticker}*\n\n` +
          `📊 Verdict: ${result.decision?.finalDecision || "HOLD"}\n` +
          `🎯 Confidence: ${quickConfidence}/10\n` +
          `⚠ Risk Level: ${result.risk?.riskLevel || "MEDIUM"}\n\n` +
          `📝 Summary:\n${result.decision?.reason || "No summary available"}`;
        await send(msg, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("[QUICK ERROR]", err);
        await bot.telegram.sendMessage(chatId, "⚠️ Temporary issue. Try again in a moment.");
      }
      return;
    }

    // ── /compare ───────────────────────────────────────────────────
    if (lowerText.startsWith("/compare ")) {
      const parts = text.split(" ");
      if (parts.length < 3) { await send("Example: /compare TCS INFY"); return; }
      const t1 = parts[1].trim().toUpperCase();
      const t2 = parts[2].trim().toUpperCase();
      await bot.telegram.sendMessage(chatId, `⚖ Comparing ${t1} vs ${t2}...`);
      try {
        const [{ stockData: s1 }, { stockData: s2 }] = await Promise.all([
          buildAnalysisContext(t1),
          buildAnalysisContext(t2)
        ]);
        const [r1, r2] = await Promise.all([masterAgent(s1), masterAgent(s2)]);
        const sc1 = clampPublicConfidence(r1.decision?.finalConfidenceScore || 0);
        const sc2 = clampPublicConfidence(r2.decision?.finalConfidenceScore || 0);
        const winner = sc1 >= sc2 ? t1 : t2;
        const msg =
          `⚖ *STOCK COMPARISON*\n\n` +
          `📈 *${t1}*\nVerdict: ${r1.decision?.finalDecision || "HOLD"}\nConfidence: ${sc1}/10\nRisk: ${r1.risk?.riskLevel || "MEDIUM"}\n\n` +
          `📈 *${t2}*\nVerdict: ${r2.decision?.finalDecision || "HOLD"}\nConfidence: ${sc2}/10\nRisk: ${r2.risk?.riskLevel || "MEDIUM"}\n\n` +
          `🏆 Better Opportunity: *${winner}*\n\n⚠️ Educational only. Not SEBI advice.`;
        await send(msg, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("[COMPARE ERROR]", err);
        await bot.telegram.sendMessage(chatId, "❌ Comparison failed. Please check ticker symbols.");
      }
      return;
    }

    // ── /top /scanner ───────────────────────────────────────────────
    if (["/scanner", "/top", "/opportunities"].includes(lowerText)) {
      await bot.telegram.sendMessage(chatId, "🔍 Running Institutional Scanner...\nPlease wait.");
      try {
        const opportunities = await scannerAgent();
        if (!opportunities?.length) { await bot.telegram.sendMessage(chatId, "No strong opportunities found right now."); return; }
        let msg = "🏆 TOP OPPORTUNITIES TODAY\n\n";
        opportunities.forEach((s, i) => {
          msg += `#${i+1} ${s.stock}\n📊 Decision: ${s.decision} (${s.confidenceScore}/10)\n💰 Price: ₹${s.currentPrice}\n🎯 Entry: ${s.idealEntryZone}\n🛑 SL: ${s.stopLoss}\n🎯 Target: ${s.initialTarget}\n⚖️ R/R: ${s.rewardRiskRatio}\n⚡ Urgency: ${s.entryUrgency}\n🧠 ${s.entryReasoning}\n📌 ${s.finalExecutionAdvice}\n\n`;
        });
        msg += "⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
        await send(msg);
      } catch (err) { console.error("[SCANNER ERROR]", err); await bot.telegram.sendMessage(chatId, "⚠️ Scanner temporarily unavailable."); }
      return;
    }

    // ── /sector ────────────────────────────────────────────────────
    if (["/sector", "/sectors", "/rotation"].includes(lowerText)) {
      await bot.telegram.sendMessage(chatId, "📊 Running Sector Rotation Scanner...");
      try {
        const sectors = await sectorScannerAgent();
        if (!sectors?.length) { await bot.telegram.sendMessage(chatId, "No sector data available right now."); return; }
        let msg = "📊 SECTOR ROTATION REPORT\n\n";
        sectors.slice(0, 5).forEach((item, i) => { msg += `#${i+1} ${item.sector}\n🏆 Strength Score: ${item.avgScore}/10\n\n`; });
        msg += "⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
        await send(msg);
      } catch (err) { console.error("[SECTOR ERROR]", err); await bot.telegram.sendMessage(chatId, "⚠️ Sector scanner temporarily unavailable."); }
      return;
    }

    // ── Portfolio commands ──────────────────────────────────────────
    if (lowerText.startsWith("/add ")) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await send("Usage: /add TICKER QUANTITY PRICE\nExample: /add HDFCBANK 50 1450"); return; }
      const symbol = parts[1].toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);
      if (isNaN(quantity) || isNaN(avgPrice)) { await send("❌ Invalid quantity or price."); return; }
      try {
        await addHolding(chatId, { symbol, quantity, avgPrice });
        await send(`✅ Holding Added\n📈 Stock: ${symbol}\n📦 Qty: ${quantity}\n💰 Avg Price: ₹${avgPrice}\n📊 Invested: ₹${quantity * avgPrice}\n\nUse /portfolio to view health.`);
      } catch (err) { await bot.telegram.sendMessage(chatId, `❌ Error: ${err.message}`); }
      return;
    }

    if (lowerText.startsWith("/update ")) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await send("Usage: /update TICKER QUANTITY PRICE"); return; }
      const symbol = parts[1].toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);
      if (isNaN(quantity) || isNaN(avgPrice)) { await send("❌ Invalid quantity or price."); return; }
      try {
        await updateHolding(chatId, symbol, { quantity, avg_price: avgPrice, updated_at: new Date() });
        await send(`🔄 Holding Updated\n📈 Stock: ${symbol}\n📦 New Qty: ${quantity}\n💰 New Avg Price: ₹${avgPrice}`);
      } catch (err) { await bot.telegram.sendMessage(chatId, `❌ Error: ${err.message}`); }
      return;
    }

    if (lowerText.startsWith("/remove")) {
      const symbol = text.replace(/^\/remove\s*/i, "").trim().toUpperCase();
      if (!symbol) { await send("Usage: /remove TICKER"); return; }
      try {
        await removeHolding(chatId, symbol);
        await send(`🗑 ${symbol} removed from your portfolio.`);
      } catch (err) { await bot.telegram.sendMessage(chatId, `❌ Error: ${err.message}`); }
      return;
    }

    if (lowerText.startsWith("/portfolio")) {
      try {
        const dbHoldings = await getPortfolio(chatId);
        if (!dbHoldings?.length) { await bot.telegram.sendMessage(chatId, `Your portfolio is empty.\nUse /add TICKER QTY PRICE to add holdings.`); return; }
        const review = await buildPortfolioReview(dbHoldings);
        const msg = formatPortfolioReview(review);
        await bot.telegram.sendMessage(chatId, msg);
      } catch (err) {
        console.error("[PORTFOLIO ERROR]", err);
        await bot.telegram.sendMessage(chatId, "⚠️ Unable to fetch portfolio right now.");
      }
      return;
    }

    // ── AWAITING_STOCK state ────────────────────────────────────────
    const pendingAnalyzeState = await consumeState("telegram_flow", chatId);
    if (pendingAnalyzeState?.state === "AWAITING_STOCK") {
      const ticker = text.trim().toUpperCase();
      if (!isValidSymbol(ticker)) { await send("Please enter a valid stock ticker like TCS, RELIANCE, INFY"); return; }
      await performAnalysis(chatId, ticker, footer);
      return;
    }

    // ── Core intent routing via parseInput ──────────────────────────
    const intent = parseInput(text);

    if (intent.type === "analyze") {
      if (!intent.symbol) {
        await putState("telegram_flow", chatId, { state: "AWAITING_STOCK" }, ANALYZE_STATE_TTL_SECONDS);
        await bot.telegram.sendMessage(chatId, "Please enter the stock ticker (e.g. TCS, RELIANCE)");
        return;
      }
      if (!isValidSymbol(intent.symbol)) {
        await send("⚠️ Please share a valid ticker like TCS or RELIANCE.");
        return;
      }
      const exists = await checkSymbolExists(intent.symbol);
      if (!exists) {
        await send("⚠️ I couldn't find that stock. Please check the ticker (e.g., TCS, RELIANCE) and try again.");
        return;
      }
      await performAnalysis(chatId, intent.symbol, footer);
      return;
    }

    // ── Chat fallback ───────────────────────────────────────────────
    const financeIntent =
      /(portfolio|invest|allocation|allocate|stock|shares|price|buy|sell|market|nifty|sensex|₹\d+)/i.test(text);
    if (financeIntent) {
      console.log("ROUTING TO MASTER AGENT");
      console.log("MESSAGE:", text);
      const result = await masterAgent({
        mode: "conversation",
        userQuery: text,
        chatId
      });
      await send(result?.response || "Unable to process finance query right now.");
      return;
    }

    let reply = "";
    try {
      reply = await generateChatReply(chatId, text);
    } catch (err) {
      console.error("[CHAT FAIL]", err);
      reply = "Ask me about any stock or market — I'll break it down.";
    }
    await send(reply, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("Telegram Bot Error:", error);
    await ctx.reply("⚠️ Temporary issue processing your request. Please try again in a moment.");
  }
});

// ─────────────────────────────────────────────
// START BOT
// ─────────────────────────────────────────────

export const startBot = () => {
  if (botSupervisorStarted) {
    console.log("⚠️ Bot supervisor already initialized. Skipping...");
    return;
  }
  botSupervisorStarted = true;

  const ensureLease = async () => {
    if (botLaunchInFlight) return;

    try {
      const claimed = await claimSchedulerLease(BOT_LEASE_NAME, BOT_LEASE_TTL_SECONDS);
      if (!claimed) {
        if (botLeaseOwner) {
          logEvent("telegram.bot.lease.lost", { ownerId: BOT_INSTANCE_ID });
          stopBot();
        }
        botLeaseOwner = false;
        return;
      }

      if (!botLeaseOwner) {
        logEvent("telegram.bot.lease.claimed", { ownerId: BOT_INSTANCE_ID });
      }
      botLeaseOwner = true;

      await launchBotIfNeeded("lease");

      if (!botHeartbeatTimer) {
        botHeartbeatTimer = setInterval(async () => {
          try {
            const renewed = await renewSchedulerLease(BOT_LEASE_NAME, BOT_LEASE_TTL_SECONDS);
            if (!renewed) {
              logEvent("telegram.bot.lease.renew_failed", { ownerId: BOT_INSTANCE_ID });
              stopBot();
              botLeaseOwner = false;
            }
          } catch (error) {
            logError("telegram.bot.lease.heartbeat_error", error, { ownerId: BOT_INSTANCE_ID });
            stopBot();
            botLeaseOwner = false;
          }
        }, BOT_LEASE_HEARTBEAT_MS);
      }
    } catch (error) {
      logError("telegram.bot.lease.claim_error", error, { ownerId: BOT_INSTANCE_ID });
      if (!TELEGRAM_LEASE_REQUIRED) {
        await launchBotIfNeeded("fallback");
      }
    }
  };

  ensureLease();
  botSupervisorTimer = setInterval(ensureLease, BOT_LEASE_RETRY_MS);
  console.log("✅ Telegram Bot Supervisor Started");
};

export const stopBot = () => {
  if (botHeartbeatTimer) {
    clearInterval(botHeartbeatTimer);
    botHeartbeatTimer = null;
  }

  if (botStarted) {
    bot.stop("LEASE_LOST");
    botStarted = false;
    logEvent("telegram.bot.stopped", {
      ownerId: BOT_INSTANCE_ID,
      mode: botStartedInFallbackMode ? "fallback" : "lease"
    });
  }
  botStartedInFallbackMode = false;
};

export const shutdownBotSupervisor = async () => {
  if (botSupervisorTimer) {
    clearInterval(botSupervisorTimer);
    botSupervisorTimer = null;
  }
  botSupervisorStarted = false;
  stopBot();
  if (botLeaseOwner) {
    try {
      await releaseSchedulerLease(BOT_LEASE_NAME);
    } catch (error) {
      logError("telegram.bot.lease.release_error", error, { ownerId: BOT_INSTANCE_ID });
    }
  }
  botLeaseOwner = false;
};

process.once("SIGINT", () => {
  shutdownBotSupervisor().finally(() => bot.stop("SIGINT"));
});
process.once("SIGTERM", () => {
  shutdownBotSupervisor().finally(() => bot.stop("SIGTERM"));
});

export default bot;
