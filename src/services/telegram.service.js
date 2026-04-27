import { Telegraf } from "telegraf";
import { masterAgent } from "../agents/master.agent.js";
import { getCompanyOverview } from "./marketData.service.js";
import { analyzePortfolio } from "../agents/portfolioAgent.js";

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

    const entryTiming = result.entryTiming;
    const ticker = symbol.toUpperCase();

    let executionAdvice = "";

    if (entryTiming.strategy === "BUY ON DIP") {
      executionAdvice = `Strong long-term buy, but wait for dip near ${entryTiming.entryZone} before accumulating.`;
    } else if (entryTiming.strategy === "IMMEDIATE BUY") {
      executionAdvice = `Strong long-term buy and current price offers a good entry opportunity.`;
    } else if (entryTiming.strategy === "WAIT FOR CONFIRMATION") {
      executionAdvice = `Good stock, but wait for stronger confirmation before deploying capital.`;
    } else if (entryTiming.strategy === "BREAKOUT BUY") {
      executionAdvice = `Momentum is building; consider entry ${entryTiming.entryZone} for confirmation.`;
    } else {
      executionAdvice = `No clear entry signal at this time. Maintain caution and monitor price action.`;
    }

    const message = `
🚨 ${result.decision.finalDecision} Signal Detected
📈 Stock: ${ticker}
🎯 Confidence Score: ${result.decision.finalConfidenceScore}/10
⚠ Risk Level: ${result.risk.riskLevel}
🏆 Priority Level: ${result.ranking.priority}
📊 Rank Score: ${result.ranking.rankScore}/10
💰 Suggested Allocation: ${result.capital.suggestedAllocation}

🔄 Rebalancing Action:
${result.rebalancing.rebalancingAction}

🧠 Reason:
${result.decision.reason}

📌 Recommended Action:
${result.rebalancing.action}

🚨 ENTRY SIGNAL DETECTED
🎯 Strategy: ${result.entryTiming.strategy}
📍 Current Market Price: ₹${result.entryTiming.currentPrice}
💰 Ideal Entry Zone: ${result.entryTiming.entryZone}
🛑 Stop Loss: ₹${result.entryTiming.stopLoss || "-"}
🎯 Initial Target: ₹${result.entryTiming.target || "-"}
📊 Reward/Risk Ratio: ${result.entryTiming.rewardRiskRatio || "-"}
⚡ Entry Urgency: ${result.entryTiming.urgency}

🧠 Reason:
${result.entryTiming.reason}

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
      if (!ticker) {
        await bot.telegram.sendMessage(
          chatId,
          "Please provide a stock ticker.\nExample: /quick RELIANCE.NS"
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
📊 Verdict: ${result.decision.finalDecision}
🎯 Confidence: ${result.decision.finalConfidenceScore}/10
⚠ Risk Level: ${result.risk.riskLevel}
📝 Summary:
${result.decision.reason}
📌 Suggested Action:
${result.rebalancing.action}
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
Verdict: ${result1.decision.finalDecision}
Confidence: ${score1}/10
Risk: ${result1.risk.riskLevel}
📈 ${ticker2.toUpperCase()}
Verdict: ${result2.decision.finalDecision}
Confidence: ${score2}/10
Risk: ${result2.risk.riskLevel}
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

    if (lowerText === "/top") {
      await bot.telegram.sendMessage(
        chatId,
        "🏆 Ranking top opportunities..."
      );
      try {
        const topStocks = [
          "TCS.NS",
          "INFY.NS",
          "RELIANCE.NS",
          "HDFCBANK.NS",
          "ICICIBANK.NS"
        ];
        const results = [];
        for (const ticker of topStocks) {
          try {
            const stockData = await getCompanyOverview(ticker);
            const result = await masterAgent(stockData);
            results.push({
              ticker,
              verdict: result.decision.finalDecision,
              confidence: result.decision.finalConfidenceScore,
              risk: result.risk.riskLevel
            });
          } catch (err) {
            console.log(`Skipping ${ticker}`);
          }
        }
        results.sort((a, b) => b.confidence - a.confidence);
        let message = `🏆 TOP OPPORTUNITIES\n\n`;
        results.forEach((stock, index) => {
          message += `${index + 1}. ${stock.ticker}\n`;
          message += `Verdict: ${stock.verdict}\n`;
          message += `Confidence: ${stock.confidence}/10\n`;
          message += `Risk: ${stock.risk}\n\n`;
        });
        message += `⚠️ Educational only.\nNot SEBI registered investment advice.`;
        await bot.telegram.sendMessage(chatId, message);
      } catch (error) {
        await bot.telegram.sendMessage(
          chatId,
          "❌ Could not rank top opportunities right now."
        );
      }
      return;
    }

    /**
     * 1. Waiting state for stock input
     */
    if (userStates.get(chatId) === "AWAITING_STOCK") {
      userStates.delete(chatId);
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

      if (!ticker) {
        userStates.set(chatId, "AWAITING_STOCK");

        await bot.telegram.sendMessage(
          chatId,
          "Please enter the stock/company name"
        );
        return;
      }

      await performAnalysis(chatId, ticker);
      return;
    }

    if (lowerText.startsWith("/analyze ")) {
      const ticker = text.substring(9).trim();

      if (!ticker) {
        userStates.set(chatId, "AWAITING_STOCK");

        await bot.telegram.sendMessage(
          chatId,
          "Please enter the stock/company name"
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