import { Telegraf } from "telegraf";
import { masterAgent } from "../agents/master.agent.js";
import { getCompanyOverview } from "./marketData.service.js";
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

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const userStates = new Map();

/**
 * Helper to perform analysis and send message
 */
async function performAnalysis(chatId, symbol) {
  await bot.telegram.sendMessage(chatId, `Analyzing ${symbol}...`);

  try {
    const stockData = await getCompanyOverview(symbol);
    const result = await masterAgent(stockData);

    const entryTiming = result.entryTiming || {};
    const exitSignal = result.exitSignal || {};
    const positionSizing = result.positionSizing || {};
    const rebalancer = result.rebalancer || {};
    const eventRisk = result.eventRisk || {};
    const ticker = symbol.toUpperCase();

    // Use the final execution advice directly from the agent
    const executionAdvice = entryTiming?.finalExecutionAdvice || "No clear entry signal at this time. Maintain caution and monitor price action.";

    const message = `
🚨 ${result.decision?.finalDecision || "HOLD"} Signal Detected
📈 Stock: ${ticker}
🎯 Confidence Score: ${result.decision?.finalConfidenceScore || 0}/10
⚠ Risk Level: ${result.risk?.riskLevel || "N/A"}
🏆 Priority Level: ${result.ranking?.priority || "MEDIUM"}
📊 Rank Score: ${result.ranking?.rankScore || 0}/10

💰 Recommended Allocation: ${positionSizing.allocation || "0%"}
🧠 Conviction Level: ${positionSizing.conviction || "MODERATE"}
📌 Capital Action: ${positionSizing.capitalAction || "No action"}

⚖️ PORTFOLIO REBALANCING
Action: ${rebalancer.action || "HOLD"}
Adjustment: ${rebalancer.adjustment || "0%"}
Urgency: ${rebalancer.urgency || "LOW"}
Reason: ${rebalancer.reason || "Alignment confirmed"}

🔄 Rebalancing Action:
${result.rebalancing?.rebalancingAction || "No action required"}

🧠 Reason:
${result.decision?.reason || "No reasoning available"}
${positionSizing.reason ? `\n📊 Sizing Logic: ${positionSizing.reason}` : ""}

📌 Recommended Action:
${result.rebalancing?.action || "Monitor and wait for confirmation"}

🚨 EVENT RISK ANALYSIS
Risk Level: ${eventRisk.eventRisk || "LOW"}
Event Type: ${eventRisk.eventType || "NONE"}
Action: ${eventRisk.action || "Monitor as usual"}
Reason: ${eventRisk.reason || "No imminent high-impact events."}

🚨 ENTRY SIGNAL DETECTED
🎯 Strategy: ${entryTiming?.strategy || "AVOID ENTRY"}
📍 Current Market Price: ₹${entryTiming?.currentPrice || 0}
💰 Ideal Entry Zone: ${entryTiming?.idealEntryZone || "Avoid"}
🛑 Stop Loss: ${entryTiming?.stopLoss || "-"}
🎯 Initial Target: ${entryTiming?.initialTarget || "-"}
📊 Reward/Risk Ratio: ${entryTiming?.rewardRiskRatio || "-"}
⚡ Entry Urgency: ${entryTiming?.entryUrgency || "VERY LOW"}

🧠 Reason:
${entryTiming?.reasoning || "Insufficient market conviction"}

📌 Final Execution Advice:
${executionAdvice}

🚨 EXIT SIGNAL
Signal: ${exitSignal?.signal || "HOLD"}
Urgency: ${exitSignal?.urgency || "LOW"}
Action: ${exitSignal?.action || "Continue holding"}
Reason: ${exitSignal?.reason || "No significant exit triggers detected"}

⚠️ For educational purposes only.
Not SEBI registered investment advice.
Do your own research before investing.
`.trim();

    await bot.telegram.sendMessage(chatId, message);
  } catch (err) {
    await bot.telegram.sendMessage(
      chatId,
      `❌ Error analyzing ${symbol}: ${err.message}`
    );
  }
}

/**
 * Main message handler
 */
bot.on("text", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    console.log("CHAT ID:", chatId);
    const text = ctx.message.text?.trim() || "";

    if (!text) return;

    const lowerText = text.toLowerCase();

    if (lowerText === "/help") {
      await bot.telegram.sendMessage(
        chatId,
        `📊 Nexa — Command Menu
📈 Analysis
/analyze TICKER — Full AI report
/quick TICKER — Fast verdict only
⚖ Comparison
/compare TICKER1 TICKER2 — Compare two stocks
🏆 Rankings
/top — Rank your best watchlist opportunities
💼 Portfolio
/portfolio — Analyze your holdings
⚠️ For educational purposes only.
Not SEBI registered investment advice.`
      );
      return;
    }

    if (lowerText.startsWith("/quick ")) {
      const ticker = text.substring(7).trim();
      if (!ticker || ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(
          chatId,
          "Please enter a valid stock ticker like TCS, RELIANCE, INFY, HDFCBANK"
        );
        return;
      }
      await bot.telegram.sendMessage(
        chatId,
        `⚡ Quick scan: ${ticker}...`
      );
      try {
        const stockData = await getCompanyOverview(ticker);
        const result = await masterAgent(stockData);
        const message = `
⚡ QUICK VERDICT
📈 Stock: ${ticker.toUpperCase()}
📊 Verdict: ${result.decision?.finalDecision || "HOLD"}
🎯 Confidence: ${result.decision?.finalConfidenceScore || 0}/10
⚠ Risk Level: ${result.risk?.riskLevel || "N/A"}
📝 Summary:
${result.decision?.reason || "No summary available"}
📌 Suggested Action:
${result.rebalancing?.action || "Monitor closely"}
For full report:
${"/analyze " + ticker}
⚠️ Educational only.
Not SEBI registered investment advice.
`.trim();
        await bot.telegram.sendMessage(chatId, message);
      } catch (error) {
        await bot.telegram.sendMessage(
          chatId,
          `❌ Could not analyze ${ticker}`
        );
      }
      return;
    }

    if (lowerText.startsWith("/compare ")) {
      const parts = text.split(" ");
      if (parts.length < 3) {
        await bot.telegram.sendMessage(
          chatId,
          "Please provide two stock tickers.\nExample: /compare TCS.NS INFY.NS"
        );
        return;
      }
      const ticker1 = parts[1].trim();
      const ticker2 = parts[2].trim();
      await bot.telegram.sendMessage(
        chatId,
        `⚖ Comparing ${ticker1} vs ${ticker2}...`
      );
      try {
        const stock1 = await getCompanyOverview(ticker1);
        const stock2 = await getCompanyOverview(ticker2);
        const result1 = await masterAgent(stock1);
        const result2 = await masterAgent(stock2);
        const score1 = result1.decision.finalConfidenceScore;
        const score2 = result2.decision.finalConfidenceScore;
        const winner =
          score1 >= score2
            ? ticker1.toUpperCase()
            : ticker2.toUpperCase();
        const message = `
⚖ STOCK COMPARISON
📈 ${ticker1.toUpperCase()}
Verdict: ${result1.decision?.finalDecision || "HOLD"}
Confidence: ${score1 || 0}/10
Risk: ${result1.risk?.riskLevel || "N/A"}
📈 ${ticker2.toUpperCase()}
Verdict: ${result2.decision?.finalDecision || "HOLD"}
Confidence: ${score2 || 0}/10
Risk: ${result2.risk?.riskLevel || "N/A"}
🏆 Better Opportunity:
${winner}
⚠️ Educational only.
Not SEBI registered investment advice.
`.trim();
        await bot.telegram.sendMessage(chatId, message);
      } catch (error) {
        await bot.telegram.sendMessage(
          chatId,
          "❌ Comparison failed. Please check ticker symbols."
        );
      }
      return;
    }

    if (text.toLowerCase() === "/scanner" || 
        text.toLowerCase() === "/top" || 
        text.toLowerCase() === "/opportunities") {
      await bot.telegram.sendMessage(
        chatId,
        "🔍 Running Institutional Scanner...\nPlease wait while FinSight analyzes top opportunities."
      );
      const opportunities = await scannerAgent();
      if (!opportunities || !opportunities.length) {
        return await bot.telegram.sendMessage(
          chatId,
          "No strong opportunities found right now. Please try again later."
        );
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
      message += "⚠️ For educational purposes only.\n";
      message += "Not SEBI registered investment advice.";
      return await bot.telegram.sendMessage(chatId, message);
    }

    if (
      text.toLowerCase() === "/sector" ||
      text.toLowerCase() === "/sectors" ||
      text.toLowerCase() === "/rotation"
    ) {
      await bot.telegram.sendMessage(
        chatId,
        "📊 Running Sector Rotation Scanner...\nAnalyzing strongest sectors now..."
      );
      const sectors = await sectorScannerAgent();
      if (!sectors.length) {
        return await bot.telegram.sendMessage(
          chatId,
          "No sector strength data available right now."
        );
      }
      let message = "📊 SECTOR ROTATION REPORT\n\n";
      sectors.slice(0, 5).forEach((item, index) => {
        message += `#${index + 1} ${item.sector}\n`;
        message += `🏆 Strength Score: ${item.avgScore}/10\n\n`;
      });
      message += "⚠️ For educational purposes only.\n";
      message += "Not SEBI registered investment advice.";
      return await bot.telegram.sendMessage(chatId, message);
    }

    /**
     * 1. Waiting state for stock input
     */
    if (userStates.get(chatId) === "AWAITING_STOCK") {
      userStates.delete(chatId);
      
      const ticker = text.trim().toUpperCase();
      if (ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(
          chatId,
          "Please enter a valid stock ticker like TCS, RELIANCE, INFY, HDFCBANK"
        );
        return;
      }
      
      await performAnalysis(chatId, text);
      return;
    }

    /**
     * 2. Portfolio Commands
     */
    if (lowerText.startsWith("/add ")) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) {
        return bot.telegram.sendMessage(
          chatId,
          "Usage: /add TICKER QUANTITY PRICE\nExample: /add HDFCBANK 50 1450"
        );
      }

      const symbol = parts[1].toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);

      if (isNaN(quantity) || isNaN(avgPrice)) {
        return bot.telegram.sendMessage(chatId, "❌ Invalid quantity or price. Please use numbers.");
      }

      try {
        await addHolding(chatId, { symbol, quantity, avgPrice });
        await bot.telegram.sendMessage(
          chatId,
          `✅ Holding Added\nStock: ${symbol}\nQuantity: ${quantity}\nAvg Buy Price: ₹${avgPrice}`
        );
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error adding holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/update ")) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) {
        return bot.telegram.sendMessage(
          chatId,
          "Usage: /update TICKER QUANTITY PRICE\nExample: /update HDFCBANK 80 1425"
        );
      }

      const symbol = parts[1].toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);

      if (isNaN(quantity) || isNaN(avgPrice)) {
        return bot.telegram.sendMessage(chatId, "❌ Invalid quantity or price. Please use numbers.");
      }

      try {
        await updateHolding(chatId, symbol, { 
          quantity, 
          avg_price: avgPrice,
          updated_at: new Date()
        });
        await bot.telegram.sendMessage(
          chatId,
          `✅ Holding Updated\nStock: ${symbol}\nNew Quantity: ${quantity}\nNew Avg Price: ₹${avgPrice}`
        );
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error updating holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/remove ")) {
      const symbol = text.substring(8).trim().toUpperCase();
      if (!symbol) return bot.telegram.sendMessage(chatId, "Usage: /remove TICKER");

      try {
        await removeHolding(chatId, symbol);
        await bot.telegram.sendMessage(chatId, `✅ Removed ${symbol} from portfolio.`);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error removing holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/portfolio")) {
      const lines = text.split("\n").slice(1);

      let stocks = lines
        .map((line) => {
          const [symbol, allocation] = line.trim().split(" ");
          if (!symbol || !allocation) return null;
          return { symbol, allocation: Number(allocation) };
        })
        .filter(Boolean);

      // If no manual stocks provided, fetch from persistent storage
      if (!stocks.length) {
        const dbHoldings = await getPortfolio(chatId);
        if (!dbHoldings || dbHoldings.length === 0) {
          await bot.telegram.sendMessage(
            chatId,
            `Your portfolio is empty.\nUse /add TICKER QTY PRICE to add holdings.`
          );
          return;
        }
        stocks = dbHoldings;
      }

      const health = await analyzePortfolioHealth(stocks);

      const message = `
🏥 PORTFOLIO HEALTH
Score: ${health.score}/10
Status: ${health.status}
Risk Level: ${health.riskLevel}
Diversification: ${health.diversification}
Concentration Risk: ${health.concentrationRisk}

📌 Advice:
${health.action}

📊 Stats:
- Holdings: ${health.details.stockCount}
- Top Weight: ${health.details.highestAllocation}
- Unique Sectors: ${health.details.uniqueSectors}

⚠️ For educational purposes only.
Not SEBI registered investment advice.
Do your own research before investing.
`.trim();

      await bot.telegram.sendMessage(chatId, message);
      return;
    }

    /**
     * 3. Analyze commands
     */
    if (lowerText === "analyze" || lowerText === "/analyze") {
      userStates.set(chatId, "AWAITING_STOCK");

      await bot.telegram.sendMessage(
        chatId,
        "Please enter the stock/company name"
      );
      return;
    }

    if (lowerText.startsWith("analyze ")) {
      const ticker = text.substring(8).trim();

      if (!ticker || ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(
          chatId,
          "Please enter a valid stock ticker like TCS, RELIANCE, INFY, HDFCBANK"
        );
        return;
      }

      await performAnalysis(chatId, ticker);
      return;
    }

    if (lowerText.startsWith("/analyze ")) {
      const ticker = text.substring(9).trim();

      if (!ticker || ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(
          chatId,
          "Please enter a valid stock ticker like TCS, RELIANCE, INFY, HDFCBANK"
        );
        return;
      }

      await performAnalysis(chatId, ticker);
      return;
    }

    /**
     * Conversational AI Fallback
     * If message is not a command, handle like a financial assistant
     */
    let contextualQuery = text;
    // Check if user replied to a previous bot message
    if (ctx.message.reply_to_message && ctx.message.reply_to_message.text) {
      const repliedText = ctx.message.reply_to_message.text;
      contextualQuery = `
Previous Context:
${repliedText}

User Follow-up:
${text}
      `.trim();
    }

    const aiResponse = await masterAgent({
      userQuery: contextualQuery,
      mode: "conversation"
    });

    const needsDisclaimer =
      text.toLowerCase().includes("buy") ||
      text.toLowerCase().includes("invest") ||
      text.toLowerCase().includes("stock") ||
      text.toLowerCase().includes("portfolio") ||
      text.toLowerCase().includes("money") ||
      text.toLowerCase().includes("market");

    const finalMessage = needsDisclaimer
      ? `${aiResponse.response}
⚠️ For educational purposes only.
Not SEBI registered investment advice.
Do your own research before investing.`
      : aiResponse.response;

    await bot.telegram.sendMessage(chatId, finalMessage);
    return;
  } catch (error) {

    console.error("Telegram Bot Error:", error);

    await ctx.reply("❌ Error while processing your request.");
  }
});

/**
 * Start bot
 */
bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

console.log("✅ Telegram Bot Started");

export default bot;