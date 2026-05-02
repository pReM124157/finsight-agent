import express from "express";

const PORT = process.env.PORT || 5000;
const app = express();

// 1. START SERVER IMMEDIATELY FOR HEALTH CHECK
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
  console.log(`✅ Health check path / is now responsive.`);

  // 2. DELAY ALL HEAVY BACKGROUND SERVICES
  setTimeout(async () => {
    console.log("⏳ Initializing heavy background services...");
    try {
      // Dynamic imports to prevent top-level blocking
      const { default: mainApp } = await import("./app.js");
      app.use(mainApp);

      const { startBot } = await import("./services/telegram.service.js");
      const { startPortfolioScheduler } = await import("./scheduler/portfolio.scheduler.js");
      const { startMonitoringJob } = await import("./scheduler/monitor.job.js");
      const { startDailyHook } = await import("./scheduler/dailyHook.scheduler.js");
      const { startSpikeHook } = await import("./scheduler/spikeHook.scheduler.js");

      startBot();
      startPortfolioScheduler();
      startMonitoringJob();
      startDailyHook();
      startSpikeHook();
      
      console.log("🚀 All background services initialized.");
    } catch (error) {
      console.error("❌ Failed to initialize background services:", error);
    }
  }, 3000); // 3-second delay to ensure deployment stability
});