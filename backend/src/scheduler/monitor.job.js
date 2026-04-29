import cron from "node-cron";
import supabase from "../services/supabase.service.js";

import { runRiskAgent } from "../agents/risk.agent.js";
import { analyzePortfolio as runPortfolioAgent } from "../agents/portfolioAgent.js";
import { runRebalancingAgent } from "../agents/rebalancing.agent.js";
import { scannerAgent } from "../agents/scanner.agent.js";

import { sendTelegramAlert } from "../services/alert.service.js";
import { sendEmailAlert } from "../services/email.service.js";
import { updatePerformanceTracking } from "../agents/performanceTracker.agent.js";

export const startMonitoringJob = () => {
  console.log("🚀 Monitoring Job Started");

  // Daily Performance Update Loop (Midnight)
  cron.schedule("0 0 * * *", async () => {
    console.log("⏰ Daily Performance Update Loop Triggered");
    try {
      const result = await updatePerformanceTracking();
      console.log(`✅ Performance tracking updated: ${result.updated} entries processed.`);
    } catch (error) {
      console.error("Performance Tracking Update Error:", error.message);
    }
  });

  /*
    Runs every hour
    Cron Format:
    ┌──────── minute (0 - 59)
    │ ┌────── hour (0 - 23)
    │ │ ┌──── day of month (1 - 31)
    │ │ │ ┌── month (1 - 12)
    │ │ │ │ ┌ day of week (0 - 7)
    │ │ │ │ │
    │ │ │ │ │
    0 * * * *
  */

  cron.schedule("30 8 * * *", async () => {
    console.log("⏰ Morning Scanner Alert Triggered");
    try {
      const opportunities = await scannerAgent();
      if (!opportunities.length) {
        console.log("No opportunities found");
        return;
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
      
      await sendTelegramAlert(message);
      await sendEmailAlert(
        "FinSight Morning Scanner Report",
        message
      );
      console.log("✅ Morning scanner alert sent");
    } catch (error) {
      console.log("Monitor Job Error:", error.message);
    }
  });
};