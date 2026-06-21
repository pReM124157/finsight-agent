import { initializePortfolioDefenseAgent } from "./agents/portfolioDefense.agent.js";
import { initializeInfrastructure } from "./services/infrastructure.service.js";
import { staggerSchedulerExecution } from "./services/schedulerStagger.service.js";
import { startInstitutionalWorkers } from "./workers/index.js";
import { warmupYahooSession } from "./services/marketData.service.js";
import { startBot } from "./services/telegram.service.js";
import { startKalshiScannerScheduler } from "./kalshi/scheduler/kalshiScannerScheduler.js";
import app from "./app.js";

const PORT = process.env.PORT || 5000;
const RENDER_DEMO_MODE = String(process.env.RENDER_DEMO_MODE || "")
  .trim()
  .toLowerCase() === "true";

console.log("[BOOT CONFIG]", {
  nodeEnv: process.env.NODE_ENV || null,
  renderDemoMode: RENDER_DEMO_MODE,
  rawRenderDemoMode: process.env.RENDER_DEMO_MODE || null
});
let backgroundServicesInitialized = false;

async function startSchedulerSafely(name, starter) {
  try {
    await starter();
    console.log(`✅ Scheduler started: ${name}`);
  } catch (error) {
    console.error(`❌ Scheduler failed to start: ${name}`, error);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
  console.log("✅ Health check path / is now responsive.");

  startKalshiScannerScheduler();

  startBot();

  warmupYahooSession()
    .then(() => {
      console.log("[BOOT] Yahoo session warmup completed");
    })
    .catch((error) => {
      console.error("[BOOT] Yahoo session warmup failed:", error?.message || error);
    });
});
