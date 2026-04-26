import TelegramBot from "node-telegram-bot-api";
import { masterAgent } from "../agents/master.agent.js";
import { getCompanyOverview } from "./marketData.service.js";
import { analyzePortfolio } from "../agents/portfolioAgent.js";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});



const userStates = new Map();

/**
 * Helper to perform analysis and send message
 */
async function performAnalysis(chatId, symbol) {
  await bot.sendMessage(chatId, `Analyzing ${symbol}...`);
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
`;
    await bot.sendMessage(chatId, message);
  } catch (err) {
    await bot.sendMessage(
      chatId,
      `❌ Error analyzing ${symbol}: ${err.message}`
    );
  }
}

bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || "";

    if (!text) return;

    const lowerText = text.toLowerCase();

    // 1. Check if user is in a waiting state for a stock name
    if (userStates.get(chatId) === "AWAITING_STOCK") {
      userStates.delete(chatId);
      await performAnalysis(chatId, text);
      return;
    }

    // 2. PORTFOLIO COMMAND
    if (lowerText.startsWith("/portfolio")) {
      const lines = text.split("\n").slice(1);
      const stocks = lines
        .map((line) => {
          const [symbol, allocation] = line.trim().split(" ");
          if (!symbol || !allocation) return null;
          return { symbol, allocation: Number(allocation) };
        })
        .filter(Boolean);

      if (!stocks.length) {
        await bot.sendMessage(
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

      await bot.sendMessage(chatId, message);
      return;
    }

    // 3. ANALYZE COMMANDS
    if (lowerText === "analyze" || lowerText === "/analyze") {
      userStates.set(chatId, "AWAITING_STOCK");
      await bot.sendMessage(chatId, "Please enter the stock/company name");
      return;
    }

    if (lowerText.startsWith("analyze ")) {
      const ticker = text.substring(8).trim();
      if (!ticker) {
        userStates.set(chatId, "AWAITING_STOCK");
        await bot.sendMessage(chatId, "Please enter the stock/company name");
        return;
      }
      await performAnalysis(chatId, ticker);
      return;
    }

    if (lowerText.startsWith("/analyze ")) {
      const ticker = text.substring(9).trim();
      if (!ticker) {
        userStates.set(chatId, "AWAITING_STOCK");
        await bot.sendMessage(chatId, "Please enter the stock/company name");
        return;
      }
      await performAnalysis(chatId, ticker);
      return;
    }

  } catch (error) {
    console.error("Telegram Bot Error:", error);
    await bot.sendMessage(
      msg.chat.id,
      "❌ Error while processing your request."
    );
  }
});

console.log("✅ Telegram Bot Started");

export default bot;