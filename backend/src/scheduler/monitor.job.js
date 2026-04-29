import cron from "node-cron";
import supabase from "../services/supabase.service.js";

import { runRiskAgent } from "../agents/risk.agent.js";
import { analyzePortfolio as runPortfolioAgent } from "../agents/portfolioAgent.js";
import { runRebalancingAgent } from "../agents/rebalancing.agent.js";
import { scannerAgent } from "../agents/scanner.agent.js";

import { sendTelegramAlert } from "../services/alert.service.js";
import { sendEmail, sendEmailAlert } from "../services/email.service.js";
import { updatePerformanceTracking } from "../agents/performanceTracker.agent.js";

import { masterAgent } from "../agents/master.agent.js";
import { shouldSendAlert, saveAlert } from "../services/alertMemory.service.js";
import bot from "../services/telegram.service.js";

export const runPortfolioMonitor = async () => {
  console.log("🚨 Running Portfolio Risk Monitor...");
  const { data: holdings, error } = await supabase
    .from("holdings")
    .select("*");
  if (error || !holdings?.length) {
    console.log("No holdings found.");
    return;
  }
  for (const holding of holdings) {
    try {
      const result = await masterAgent({
        Symbol: holding.symbol
      });
      const exitSignal = result.exitSignal || {};
      const eventRisk = result.eventRisk || {};
      
      // FORCED ALERT TEST: Temporarily true
      const isUrgent = true; 
      /*
      const isUrgent =
        exitSignal.signal === "STOP LOSS EXIT" ||
        exitSignal.signal === "FULL EXIT" ||
        (
          exitSignal.signal === "TRIM POSITION" &&
          exitSignal.urgency === "HIGH"
        ) ||
        (
          eventRisk.riskLevel === "HIGH" &&
          eventRisk.eventType === "EARNINGS RESULT"
        );
      */

      if (!isUrgent) continue;
      const alertType = exitSignal.signal || eventRisk.eventType || "URGENT TEST";
      const allowed = await shouldSendAlert(
        holding.chat_id,
        holding.symbol,
        alertType
      );
      if (!allowed) continue;
      const message = `
🚨 URGENT PORTFOLIO ALERT
📈 Stock: ${holding.symbol}
⚠ Alert Type: ${alertType}
🔥 Urgency: ${exitSignal.urgency || eventRisk.riskLevel || "HIGH"}
📌 Action Required:
${exitSignal.action || eventRisk.action || "Immediate review recommended."}
🧠 Reason:
${exitSignal.reason || eventRisk.reason || "Forced alert test for verification."}
⚠ Immediate review recommended.
`.trim();
      await bot.telegram.sendMessage(
        holding.chat_id,
        message
      );
      await sendEmail({
        subject: `URGENT PORTFOLIO ALERT — ${holding.symbol}`,
        text: message
      });
      await saveAlert(
        holding.chat_id,
        holding.symbol,
        alertType
      );
      console.log(`Alert sent for ${holding.symbol}`);
    } catch (err) {
      console.error(
        `Portfolio monitor failed for ${holding.symbol}`,
        err.message
      );
    }
  }
};

export const startMonitoringJob = () => {
  console.log("🚀 Monitoring Job Started");

  // TRIGGER IMMEDIATELY FOR TEST
  runPortfolioMonitor();

  // Portfolio Risk Monitor (8:00 AM)
  cron.schedule(
    "0 8 * * *",
    runPortfolioMonitor,
    {
      timezone: "Asia/Kolkata"
    }
  );

  // Daily Performance Update Loop (Midnight)
  cron.schedule(
    "0 0 * * *",
    async () => {
      console.log("⏰ Daily Performance Update Loop Triggered");
      try {
        const result = await updatePerformanceTracking();
        console.log(`✅ Performance tracking updated: ${result.updated} entries processed.`);
      } catch (error) {
        console.error("Performance Tracking Update Error:", error.message);
      }
    },
    {
      timezone: "Asia/Kolkata"
    }
  );

  cron.schedule(
    "30 8 * * *",
    async () => {
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
    },
    {
      timezone: "Asia/Kolkata"
    }
  );
};