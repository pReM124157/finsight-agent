import { Telegraf } from "telegraf";
import { masterAgent } from "../agents/master.agent.js";
import { getCompanyOverview } from "./marketData.service.js";
import { analyzePortfolio } from "../agents/portfolioAgent.js";
import { scannerAgent } from "../agents/scanner.agent.js";
import { sectorScannerAgent } from "../agents/sectorScanner.agent.js";

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
💰 Suggested Allocation: ${result.capital?.suggestedAllocation || "0%"}

🔄 Rebalancing Action:
${result.rebalancing?.rebalancingAction || "No action required"}

🧠 Reason:
${result.decision?.reason || "No reasoning available"}

📌 Recommended Action:
${result.rebalancing?.action || "Monitor and wait for confirmation"}

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
      if (!opportunities.length) {
        return await bot.telegram.sendMessage(
          chatId,
          "No strong opportunities found right now. Please try again later."
        );
      }
      let message = "🏆 TOP OPPORTUNITIES TODAY\n\n";
      opportunities.forEach((stock, index) => {
        message += `#${index + 1} ${stock.stock}\n`;
        message += `🎯 Confidence: ${stock.confidenceScore}/10\n`;
        message += `🏆 Priority: ${stock.priorityLevel}\n`;
        message += `💰 Allocation: ${stock.allocation}\n`;
        message += `⚡ Entry: ${stock.entrySignal}\n`;
        message += `📊 Urgency: ${stock.entryUrgency}\n\n`;
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
     * 2. Portfolio command
     */
    if (lowerText.startsWith("/portfolio")) {
      const lines = text.split("\n").slice(1);

      const stocks = lines
        .map((line) => {
          const [symbol, allocation] = line.trim().split(" ");

          if (!symbol || !allocation) return null;

          return {
            symbol,
            allocation: Number(allocation),
          };
        })
        .filter(Boolean);

      if (!stocks.length) {
        await bot.telegram.sendMessage(
          chatId,
          `Please provide portfolio in format:

/portfolio
tcs 40
hdfcbank 30
reliance 30`
        );
        return;
      }

      const result = await analyzePortfolio(stocks);

      const message = `
📊 Portfolio Health Score: ${result.healthScore}/10

⚠ Dominant Sector:
${result.dominantSector} (${result.dominantSectorWeight}%)

📌 Highest Allocation:
${result.highestStock?.symbol?.toUpperCase() || "N/A"} (${
        result.highestStock?.normalizedAllocation || 0
      }%)

🧠 Suggested Action:
${result.suggestion}

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