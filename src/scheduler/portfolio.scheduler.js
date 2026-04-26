import cron from "node-cron";
import { runAutoMonitor } from "../agents/autoMonitor.agent.js";

export function startPortfolioScheduler() {
  console.log("⏰ Portfolio Scheduler Started");

  cron.schedule("0 */6 * * *", async () => {
    console.log("Running scheduled portfolio scan...");
    await runAutoMonitor();
  });
}