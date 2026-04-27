import cron from "node-cron";
import supabase from "../services/supabase.service.js";

import { runRiskAgent } from "../agents/risk.agent.js";
import { analyzePortfolio as runPortfolioAgent } from "../agents/portfolioAgent.js";
import { runRebalancingAgent } from "../agents/rebalancing.agent.js";

import { sendTelegramAlert } from "../services/alert.service.js";

export const startMonitoringJob = () => {
  console.log("🚀 Monitoring Job Started");

  /*
    Runs every day at 9:00 AM
    Cron Format:
    ┌──────── minute (0 - 59)
    │ ┌────── hour (0 - 23)
    │ │ ┌──── day of month (1 - 31)
    │ │ │ ┌── month (1 - 12)
    │ │ │ │ ┌ day of week (0 - 7)
    │ │ │ │ │
    │ │ │ │ │
    0 9 * * *
  */

  cron.schedule("0 9 * * *", async () => {
    console.log("📊 Running daily portfolio monitoring...");

    try {
      const { data: portfolio, error } = await supabase
        .from("portfolio")
        .select("*");

      if (error || !portfolio?.length) {
        console.log("No portfolio data found");
        return;
      }

      // Step 1 — Risk Analysis
      const riskResult = await runRiskAgent(portfolio);

      // Step 2 — Portfolio Analysis
      const portfolioResult = await runPortfolioAgent(portfolio);

      // Step 3 — Rebalancing Analysis
      const rebalanceResult = await runRebalancingAgent(portfolio);

      const finalAlert = `
🚨 *FINSIGHT DAILY SUMMARY*

📊 Portfolio Health Score:
${portfolioResult.healthScore || "N/A"}/10

⚠ Risk Level:
${riskResult.riskLevel || "Moderate"}

📌 Suggested Action:
${rebalanceResult.suggestedAction || "Hold"}

🧠 Top Concern:
${portfolioResult.dominantSector || "None"}

Generated automatically by Finsight AI
`;

      await sendTelegramAlert(finalAlert);
    } catch (error) {
      console.error("Monitoring job failed:", error.message);
    }
  });
};