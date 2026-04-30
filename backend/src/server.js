import app from "./app.js";

const PORT = process.env.PORT || 5000;

// 1. START SERVER IMMEDIATELY FOR HEALTH CHECK
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
  console.log(`✅ Health check path / is now responsive.`);

  // 2. DELAY ALL HEAVY BACKGROUND SERVICES
  setTimeout(async () => {
    console.log("⏳ Initializing heavy background services...");
    try {
      // Dynamic imports to prevent top-level blocking
      const { startBot } = await import("./services/telegram.service.js");
      const { startPortfolioScheduler } = await import("./scheduler/portfolio.scheduler.js");
      const { startMonitoringJob } = await import("./scheduler/monitor.job.js");

      startBot();
      startPortfolioScheduler();
      startMonitoringJob();
      
      console.log("🚀 All background services initialized.");
    } catch (error) {
      console.error("❌ Failed to initialize background services:", error);
    }
  }, 3000); // 3-second delay to ensure deployment stability
});