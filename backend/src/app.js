import express from "express";
import cors from "cors";
import supabase from "./services/supabase.service.js";
import { getCompanyOverview } from "./services/marketData.service.js";
import { generateInvestmentAnalysis } from "./services/claude.service.js";
import { masterAgent } from "./agents/master.agent.js";
import webhookRouter from "./routes/webhook.js";
import analyticsRouter from "./routes/analytics.routes.js";
import backtestingRouter from "./routes/backtesting.routes.js";
import adaptiveRouter from "./routes/adaptive.routes.js";
import infraRouter from "./routes/infra.routes.js";
import { buildAnalysisContext } from "./core/analysisContext.js";
import { createTraceId, logError, logEvent } from "./services/telemetry.service.js";


const app = express();
const REQUEST_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = Number(process.env.RATE_LIMIT_PER_MIN || 120);
const rateBuckets = new Map();

app.get("/", (req, res) => {
  res.status(200).send("OK");
});


const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS not allowed"), false);
  }
}));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

app.use((req, res, next) => {
  const key = `${req.ip || "unknown"}:${req.path}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, start: now };
  if (now - bucket.start > REQUEST_WINDOW_MS) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ success: false, message: "Rate limit exceeded" });
  }
  next();
});

app.use((req, res, next) => {
  const traceId = req.headers["x-trace-id"] || createTraceId("http");
  req.traceId = traceId;
  res.setHeader("x-trace-id", traceId);
  const startedAt = Date.now();
  logEvent("http.request.started", {
    traceId,
    method: req.method,
    path: req.path
  });
  res.on("finish", () => {
    logEvent("http.request.completed", {
      traceId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});

app.use('/webhook', webhookRouter);
app.use('/analytics', analyticsRouter);
app.use('/backtesting', backtestingRouter);
app.use('/adaptive', adaptiveRouter);
app.use('/infra', infraRouter);
app.use(express.json());



/*
Supabase Test Route
*/
app.get("/test-db", async (req, res) => {
  try {
    const response = await supabase
      .from("test_table")
      .select("*");

    console.log("SUPABASE RESPONSE:", response);

    return res.json(response);
  } catch (error) {
    console.log("FULL ERROR:", error);

    return res.status(500).json({
      error: error.message
    });
  }
});

/*
Stock Data Test Route
*/
app.get("/test-stock", async (req, res) => {
  try {
    const data = await getCompanyOverview("AAPL");

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/*
Multi-Agent Stock Analysis Route
*/
app.get("/analyze-stock", async (req, res) => {
  try {
    const companyData = await getCompanyOverview("AAPL");
    const fullAnalysis = await generateInvestmentAnalysis(companyData);

    return res.json({
      success: true,
      symbol: "AAPL",

      agents: {
        research:
          "Strong financials, premium valuation, and strong long-term profitability.",
        risk:
          "Moderate risk due to regulation, competition, and supply chain dependency.",
        portfolio:
          "Suitable for long-term diversified growth allocation.",
        news:
          "Positive analyst sentiment and strong institutional confidence.",
        decision:
          "BUY"
      },

      analysis: fullAnalysis
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.post("/api/analyze", async (req, res) => {
  try {
    const traceId = req.traceId || createTraceId("http_analyze");
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required"
      });
    }
    const { stockData: companyData } = await buildAnalysisContext(symbol);
    const multiAgentAnalysis = await masterAgent(companyData, { strictValidation: true });
    logEvent("http.analyze.completed", {
      traceId,
      symbol,
      unavailable: multiAgentAnalysis?.status === "VERIFIED_ANALYSIS_UNAVAILABLE"
    });
    if (multiAgentAnalysis?.status === "VERIFIED_ANALYSIS_UNAVAILABLE") {
      return res.json({
        success: true,
        stock: symbol,
        unavailable: true,
        message: multiAgentAnalysis.message,
        decision: {
          finalAction: "UNAVAILABLE",
          confidenceScore: null,
          reasoning: multiAgentAnalysis.message
        },
        risk: {
          riskLevel: "N/A",
          riskScore: null,
          majorRisks: []
        },
        learning: {
          confidenceBoost: 0,
          learningInsight: "Analysis blocked until verified market and fundamental data is available."
        },
        performance: {
          performanceScore: 0,
          performanceInsight: "No performance validation because verified analysis was not generated."
        },
        rebalancing: {
          rebalancingAdvice: "Retry after market and company data sources recover."
        },
        portfolio: {
          healthScore: null,
          dominantSector: "N/A"
        },
        analysis: {
          stockFundamentals: multiAgentAnalysis.message
        }
      });
    }
    return res.json({
      success: true,
      stock: symbol,
      decision: {
        finalAction: multiAgentAnalysis.decision?.finalDecision || "HOLD",
        confidenceScore: multiAgentAnalysis.decision?.finalConfidenceScore || 0,
        reasoning: multiAgentAnalysis.decision?.reason || "No reasoning available"
      },
      risk: {
        riskLevel: multiAgentAnalysis.risk?.riskLevel || "N/A",
        riskScore: multiAgentAnalysis.risk?.riskScore || 0,
        majorRisks: multiAgentAnalysis.risk?.majorRisks || []
      },
      learning: {
        confidenceBoost: multiAgentAnalysis.learning?.learningBoost || 0,
        learningInsight: multiAgentAnalysis.learning?.learningInsight || "N/A"
      },
      performance: {
        performanceScore: multiAgentAnalysis.performance?.performanceScore || 0,
        performanceInsight: multiAgentAnalysis.performance?.performanceInsight || "N/A"
      },
      rebalancing: {
        rebalancingAdvice: multiAgentAnalysis.rebalancing?.rebalancingAdvice || "No rebalancing needed"
      },
      portfolio: {
        healthScore: multiAgentAnalysis.portfolio?.healthScore || 0,
        dominantSector: multiAgentAnalysis.portfolio?.dominantSector || "Unknown"
      },
      analysis: {
        stockFundamentals: multiAgentAnalysis.analysis?.stockFundamentals || "No research analysis available"
      }
    });
  } catch (error) {
    logError("http.analyze.error", error, {
      traceId: req.traceId || null
    });
    return res.status(500).json({
      success: false,
      message: "Failed to analyze stock"
    });
  }
});



export default app;
