import express from "express";
import { initializePortfolioDefenseAgent } from "./agents/portfolioDefense.agent.js";
import { initializeInfrastructure } from "./services/infrastructure.service.js";
import { staggerSchedulerExecution } from "./services/schedulerStagger.service.js";
import { startInstitutionalWorkers } from "./workers/index.js";

const PORT = process.env.PORT || 5000;
const RENDER_DEMO_MODE = String(process.env.RENDER_DEMO_MODE || "")
  .trim()
  .toLowerCase() === "true";

console.log("[BOOT CONFIG]", {
  nodeEnv: process.env.NODE_ENV || null,
  renderDemoMode: RENDER_DEMO_MODE,
  rawRenderDemoMode: process.env.RENDER_DEMO_MODE || null
});
const app = express();
let backgroundServicesInitialized = false;

// 1. START SERVER IMMEDIATELY FOR HEALTH CHECK
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
  console.log(`✅ Health check path / is now responsive.`);

  // 2. DELAY ALL HEAVY BACKGROUND SERVICES
  setTimeout(async () => {
    if (backgroundServicesInitialized) {
      console.log("⏳ Background services already initialized — skipping duplicate startup");
      return;
    }
    backgroundServicesInitialized = true;
    console.log("⏳ Initializing heavy background services...");
    try {
      // Dynamic imports to prevent top-level blocking
      const telegramModule = await import("./services/telegram.service.js");
      const { startBot } = telegramModule;

      if (RENDER_DEMO_MODE) {
        startBot();
        console.log("🧪 Render demo mode enabled — Telegram bot running, all heavy imports/schedulers skipped.");
        return;
      }

      const telegramBot = telegramModule.default;
      const { default: supabase } = await import("./services/supabase.service.js");
      const { startPublicAnalyticsScheduler } = await import("./scheduler/publicAnalytics.scheduler.js");
      const { startBacktestingScheduler } = await import("./scheduler/backtesting.scheduler.js");
      const { startAdaptiveIntelligenceScheduler } = await import("./scheduler/adaptiveIntelligence.scheduler.js");
      const { startRecommendationDeliveryScheduler } = await import("./scheduler/recommendationDelivery.scheduler.js");
      const { startSubscriptionLifecycleScheduler } = await import("./scheduler/subscriptionLifecycle.scheduler.js");
      const { startSubscriptionReconciliationScheduler } = await import("./scheduler/subscriptionReconciliation.scheduler.js");
      const { processRecommendationDeliveryBatch } = await import("./services/recommendationDelivery.service.js");
      const { startMacroReportScheduler, runDailyMacroReportFlow, runWeeklyMacroReportFlow, runMacroRiskAlertFlow } = await import("./scheduler/macroReport.scheduler.js");
      const { getRecentMacroDeliveries } = await import("./services/macroDelivery.service.js");

      await initializeInfrastructure();
      initializePortfolioDefenseAgent();
      startInstitutionalWorkers();

      app.get("/test-telegram", async (_req, res) => {
        try {
          const chatId = String(process.env.TELEGRAM_CHAT_ID || "");
          if (!chatId) {
            return res.status(500).send("TELEGRAM_CHAT_ID missing");
          }
          await telegramBot.telegram.sendMessage(chatId, "Finsight test message");
          console.log("[TELEGRAM TEST] sent", { chatId });
          return res.send("sent");
        } catch (err) {
          console.error("[TELEGRAM TEST] failed", err);
          return res.status(500).send(err?.message || "send failed");
        }
      });

      app.get("/test-live-signal", async (_req, res) => {
        try {
          const message = [
            "🚨 LIVE TEST SIGNAL",
            "BUY: RELIANCE",
            "Entry: ₹2840",
            "Target: ₹2910",
            "SL: ₹2810",
            "Confidence: 87%",
            "Risk/Reward: 2.3"
          ].join("\n");

          console.log("=== STARTING TELEGRAM DELIVERY ===");
          console.log("=== FETCHING SUBSCRIBERS ===");
          const { data: subscribers, error: subscribersError } = await supabase
            .from("subscribers")
            .select("*")
            .eq("status", "active");

          if (subscribersError) {
            throw subscribersError;
          }

          console.log("=== SUBSCRIBERS FETCHED ===");
          console.log("Subscribers found:", subscribers?.length || 0);

          for (const sub of subscribers || []) {
            console.log("=== SENDING TELEGRAM SIGNAL ===");
            console.log("Chat ID:", sub.telegram_chat_id);
            await telegramBot.telegram.sendMessage(sub.telegram_chat_id, message);
            console.log("=== TELEGRAM SIGNAL SENT ===");
          }

          return res.send("Signal test sent");
        } catch (err) {
          console.error("=== TELEGRAM ERROR ===");
          console.error(err?.response?.description || err?.message);
          console.error(err);
          return res.status(500).send(err?.message || "send failed");
        }
      });


      app.get("/test-recommendation-delivery-send", async (_req, res) => {
        try {
          const now = new Date();
          const recommendationId = `TEST-REC-${now.getTime()}`;

          const testRow = {
            recommendation_id: recommendationId,
            symbol: "RELIANCE",
            exchange: "NSE",
            recommendation_type: "BUY",
            action: "BUY",
            confidence: 88,
            conviction: "TEST_SIGNAL",
            entry_price: 1350,
            stop_loss: 1325,
            target_price: 1410,
            rr_ratio: 2.4,
            horizon: "SWING",
            sector: "Energy",
            risk_score: 3,
            ai_summary: "TEST ONLY: controlled recommendation delivery verification through production Telegram pipeline.",
            reasoning_snapshot: {
              test: true,
              reason: "Manual delivery test route",
              technical: {
                trend: "Bullish",
                momentum: "Measured",
                volume: "Above Average"
              }
            },
            indicator_snapshot: {
              trend: "Bullish",
              momentum: "Measured",
              volumeTrend: "Above Average"
            },
            market_snapshot: {
              trend: "Bullish",
              volumeTrend: "Above Average"
            },
            provider_metadata: {
              test: true,
              source: "manual:test-recommendation-delivery-send"
            },
            analysis_version: "manual-test-v1",
            generated_by: "manual.test.route",
            telegram_delivery_status: "PENDING",
            telegram_delivery_attempts: 0,
            telegram_delivery_error: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString()
          };

          const { error: insertError } = await supabase
            .from("recommendation_audit")
            .insert([testRow]);

          if (insertError) {
            console.error("[TEST RECOMMENDATION INSERT] failed", insertError);
            return res.status(500).json({
              error: insertError.message || "test recommendation insert failed",
              details: insertError
            });
          }

          const result = await processRecommendationDeliveryBatch({ batchSize: 1 });

          return res.json({
            status: "OK",
            recommendationId,
            inserted: true,
            deliveryResult: result,
            note: "Inserted one TEST recommendation row and processed the real recommendation delivery pipeline."
          });
        } catch (err) {
          console.error("[TEST RECOMMENDATION DELIVERY SEND] failed", err);
          return res.status(500).json({ error: err?.message || "test recommendation delivery failed" });
        }
      });

      app.get("/test-lifecycle-alert", async (req, res) => {
        try {
          const eventType = String(req.query.eventType || "TARGET_HIT").toUpperCase();
          const allowed = new Set(["TARGET_HIT", "STOP_HIT", "TRAILING_SL_UPDATE", "TRADE_CLOSED"]);
          if (!allowed.has(eventType)) {
            return res.status(400).json({
              error: "Invalid eventType",
              allowed: Array.from(allowed)
            });
          }

          const { deliverLifecycleEvent } = await import("./services/recommendationOutcome.service.js");

          const now = new Date();
          const recommendationId = `TEST-LIFECYCLE-${now.getTime()}`;

          const audit = {
            recommendation_id: recommendationId,
            symbol: "RELIANCE",
            exchange: "NSE",
            action: "BUY",
            entry_price: 1350,
            target_price: 1410,
            stop_loss: 1325,
            horizon: "SWING",
            created_at: now.toISOString(),
            risk_score: 3,
            sector: "Energy"
          };

          const outcome = {
            recommendation_id: recommendationId,
            symbol: "RELIANCE",
            entry_price: 1350,
            provider_metadata: {
              current_stop_loss: 1350,
              previous_stop_loss: 1325,
              sent_events: {}
            }
          };

          const update = {
            recommendation_id: recommendationId,
            symbol: "RELIANCE",
            entry_price: 1350,
            latest_price: eventType === "STOP_HIT" ? 1325 : 1410,
            realized_return_pct: eventType === "STOP_HIT" ? -1.85 : 4.44,
            unrealized_return_pct: eventType === "STOP_HIT" ? -1.85 : 4.44,
            closed_at: now.toISOString()
          };

          const result = await deliverLifecycleEvent(
            outcome,
            audit,
            update,
            eventType,
            {
              previousSL: 1325,
              newSL: 1350,
              outcomeText: "TEST ONLY: controlled lifecycle alert verification through production Telegram formatter and delivery path."
            }
          );

          return res.json({
            status: result?.sentCount > 0 ? "SENT" : result?.status || "UNKNOWN",
            eventType,
            recommendationId,
            sentCount: result?.sentCount || 0,
            failedCount: result?.failedCount || 0,
            duplicateSuppressed: result?.duplicateSuppressed || 0,
            note: "Sent one TEST lifecycle alert through the real lifecycle Telegram delivery function."
          });
        } catch (err) {
          console.error("[TEST LIFECYCLE ALERT] failed", err);
          return res.status(500).json({ error: err?.message || "test lifecycle alert failed" });
        }
      });


      app.get("/test-process-recommendation-delivery", async (_req, res) => {
        try {
          const result = await processRecommendationDeliveryBatch({ batchSize: 1 });
          return res.json(result);
        } catch (err) {
          console.error("[RECOMMENDATION DELIVERY TEST] failed", err);
          return res.status(500).json({ error: err?.message || "delivery test failed" });
        }
      });

      // ── MACRO INTELLIGENCE FORCE-TRIGGER ROUTES ────────────────────────
      // Used for live trial delivery and production verification

      app.get("/test-macro-daily", async (_req, res) => {
        try {
          console.log("[MACRO TRIAL] Forcing daily macro report through production flow...");
          const { report, result } = await runDailyMacroReportFlow({
            schedulerSource: "manual:force_trigger_daily"
          });
          return res.json({
            status: result.status,
            idempotencyKey: result.idempotencyKey,
            sentCount: result.sentCount,
            subscriberCount: result.subscriberCount,
            duplicateSuppressed: result.duplicateSuppressed,
            reportSummary: report.summary,
            reportPreview: report.reportText.slice(0, 500)
          });
        } catch (err) {
          console.error("[MACRO TRIAL DAILY] failed:", err.message);
          return res.status(500).json({ error: err?.message || "macro daily trial failed" });
        }
      });

      app.get("/test-macro-weekly", async (_req, res) => {
        try {
          console.log("[MACRO TRIAL] Forcing weekly institutional report through production flow...");
          const { report, result } = await runWeeklyMacroReportFlow({
            schedulerSource: "manual:force_trigger_weekly"
          });
          return res.json({
            status: result.status,
            idempotencyKey: result.idempotencyKey,
            sentCount: result.sentCount,
            subscriberCount: result.subscriberCount,
            duplicateSuppressed: result.duplicateSuppressed,
            reportSummary: report.summary,
            reportPreview: report.reportText.slice(0, 500)
          });
        } catch (err) {
          console.error("[MACRO TRIAL WEEKLY] failed:", err.message);
          return res.status(500).json({ error: err?.message || "macro weekly trial failed" });
        }
      });

      app.get("/test-macro-risk-alert", async (_req, res) => {
        try {
          console.log("[MACRO TRIAL] Forcing macro risk alert through production flow...");
          const { report, result } = await runMacroRiskAlertFlow({
            schedulerSource: "manual:force_trigger_risk_alert",
            drivers: [
              "RBI policy uncertainty active",
              "US bond yield elevated",
              "Crude oil instability"
            ],
            recommendation: "Reduce aggressive exposure. Prioritize capital protection."
          });
          return res.json({
            status: result.status,
            idempotencyKey: result.idempotencyKey,
            sentCount: result.sentCount,
            subscriberCount: result.subscriberCount,
            duplicateSuppressed: result.duplicateSuppressed,
            reportSummary: report.summary,
            reportPreview: report.reportText.slice(0, 500)
          });
        } catch (err) {
          console.error("[MACRO TRIAL RISK ALERT] failed:", err.message);
          return res.status(500).json({ error: err?.message || "macro risk alert trial failed" });
        }
      });

      app.get("/macro-delivery-state", async (_req, res) => {
        try {
          const recent = await getRecentMacroDeliveries(10);
          return res.json({
            deliveries: recent,
            count: recent.length,
            note: "Shows last 10 macro report delivery records (idempotency + duplicate suppression state)"
          });
        } catch (err) {
          console.error("[MACRO STATE] failed:", err.message);
          return res.status(500).json({ error: err?.message || "macro state query failed" });
        }
      });

      const { default: mainApp } = await import("./app.js");
      app.use(mainApp);

      startBot();

      const { startPortfolioScheduler } = await import("./scheduler/portfolio.scheduler.js");
      const { startMonitoringJob } = await import("./scheduler/monitor.job.js");
      const { startDailyHook } = await import("./scheduler/dailyHook.scheduler.js");
      const { startSpikeHook } = await import("./scheduler/spikeHook.scheduler.js");
      const { startRecommendationTrackingScheduler } = await import("./scheduler/recommendationTracking.scheduler.js");
      const { startStatisticalValidationScheduler } = await import("./scheduler/statisticalValidation.scheduler.js");

      await staggerSchedulerExecution("portfolio_surveillance", async () => startPortfolioScheduler());
      await staggerSchedulerExecution("monitoring", async () => startMonitoringJob());
      await staggerSchedulerExecution("daily_hook", async () => startDailyHook());
      await staggerSchedulerExecution("spike_hook", async () => startSpikeHook());
      await staggerSchedulerExecution("recommendation_tracking", async () => startRecommendationTrackingScheduler());
      await staggerSchedulerExecution("statistical_validation", async () => startStatisticalValidationScheduler());
      await staggerSchedulerExecution("public_analytics", async () => startPublicAnalyticsScheduler());
      await staggerSchedulerExecution("backtesting", async () => startBacktestingScheduler());
      await staggerSchedulerExecution("adaptive_intelligence", async () => startAdaptiveIntelligenceScheduler());
      await staggerSchedulerExecution("recommendation_delivery", async () => startRecommendationDeliveryScheduler());
      await staggerSchedulerExecution("subscription_lifecycle", async () => startSubscriptionLifecycleScheduler());
      await staggerSchedulerExecution("subscription_reconciliation", async () => startSubscriptionReconciliationScheduler());
      await staggerSchedulerExecution("macro_report", async () => startMacroReportScheduler());

      console.log("🚀 All background services initialized.");
      console.log("📊 Macro Intelligence Scheduler: ACTIVE");
    } catch (error) {
      console.error("❌ Failed to initialize background services:", error);
    }
  }, 3000); // 3-second delay to ensure deployment stability
});
