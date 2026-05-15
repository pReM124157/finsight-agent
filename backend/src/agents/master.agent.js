import { riskAgent } from "./risk.agent.js";
import { generatePreMarketInsight } from "../services/premarket.service.js";
import { portfolioAgent } from "./portfolioAgent.js";
import { buildPortfolioReview } from "./portfolioReview.agent.js";
import { decisionAgent } from "./decision.agent.js";
import { rebalancingAgent } from "./rebalancing.agent.js";
import { rankingAgent } from "./ranking.agent.js";
import { capitalAgent } from "./capital.agent.js";
import { analyzeEntryTiming } from "./entryTiming.agent.js";
import { getLiveMarketData } from "../services/marketData.service.js";
import { technicalAgent } from "./technical.agent.js";
import { valuationAgent } from "./valuation.agent.js";
import { getIndianIndices, getIndianMarketNews, getIndianSectors } from "../services/marketData.service.js";
import { analyzeExitSignal } from "./exitSignal.agent.js";
import { calculatePositionSize } from "./positionSizing.agent.js";
import { analyzeRebalancing } from "./rebalancer.agent.js";
import { getPortfolio } from "../services/portfolioMemory.service.js";
import { formatPortfolioReview } from "../core/portfolioFormatter.js";
import { logRecommendation, getLearningBoost } from "./performanceTracker.agent.js";
import { analyzeEventRisk } from "./eventRisk.agent.js";
import { 
  calculateRelativeStrength, 
  generateSignals, 
  getSectorMomentum,
  calculatePositionSize as calcPositionIntelligence
} from "../services/intelligence.service.js";

import { generateTieredAnalysis } from "../services/claude.service.js";
import { safeString, safeSubstring } from "../core/safety.js";
import { fetchCompanyNews } from "../services/news.service.js";
import { executeTool } from "../tools/registry.js";

// --- Global Cache for Market Updates ---
let marketCache = {
  data: null,
  timestamp: 0,
  state: null
};
let isFetchingMarketUpdate = false;

// --- Global Cache for Top Opportunities ---
let topOpsCache = {
  data: null,
  timestamp: 0
};
let isFetchingTopOps = false;

function smartFallback(label, data, context = {}) {
  if (data !== undefined && data !== null && data !== "") return data;
  switch (label) {
    case "support":
      return context.price ? `Near ₹${Math.round(context.price * 0.97)}` : "Not clearly defined";
    case "resistance":
      return context.price ? `Near ₹${Math.round(context.price * 1.03)}` : "Not clearly defined";
    case "momentum":
      if (context.priceChange > 1) return "Bullish momentum building";
      if (context.priceChange < -1) return "Weak momentum";
      return "Sideways";
    case "interpretation":
      return "Mixed fundamentals — moderate growth with balanced risk profile.";
    case "news_positive":
      return "No major positive triggers recently.";
    case "news_negative":
      return "No major negative developments detected.";
    case "trigger_up":
      return context.price
        ? `Break above ₹${Math.round(context.price * 1.02)}`
        : "Watch resistance breakout";
    case "trigger_down":
      return context.price
        ? `Break below ₹${Math.round(context.price * 0.98)}`
        : "Watch support breakdown";
    case "final_insight":
      return "Stock is in a neutral zone — wait for confirmation before taking positions.";
    default:
      return "-";
  }
}

const TOP_OPS_UNIVERSE = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS",
  "TATAMOTORS.NS", "LT.NS", "BHARTIARTL.NS", "SBIN.NS", "ITC.NS"
];

function getMarketStateKey() {
  return isMarketOpenIST() ? "OPEN" : "CLOSED";
}

/**
 * Checks if Indian Market (NSE) is currently open.
 */
function isMarketOpenIST() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hours = istNow.getHours();
  const minutes = istNow.getMinutes();
  const day = istNow.getDay();
  
  if (day === 0 || day === 6) return false; // Weekend
  const timeInMinutes = hours * 60 + minutes;
  return timeInMinutes >= (9 * 60 + 15) && timeInMinutes <= (15 * 60 + 30); // 9:15 AM - 3:30 PM
}

function generateExitSignal(triggers, stopLoss) {
  if (!triggers || triggers.length === 0) {
    return {
      signal: "HOLD POSITION",
      reason: `No exit triggers detected. Monitor stop loss at ₹${stopLoss}`
    };
  }
  if (
    triggers.includes("stop_loss_breach") ||
    triggers.includes("trend_reversal")
  ) {
    return {
      signal: "REDUCE OR EXIT",
      reason: triggers.join(", ")
    };
  }
  return {
    signal: "HOLD POSITION",
    reason: "No strong exit triggers"
  };
}

function formatMetric(value, formatter, fallback = "Data unavailable — check manually") {
  if (value === null || value === undefined || value === "" || value === "-") {
    return fallback;
  }
  return formatter(value);
}

function interpretDebt(debtToEquity) {
  if (debtToEquity == null) return "";
  if (debtToEquity > 4.0) {
    return `⚠️ CRITICAL — D/E of ${debtToEquity} is extremely high, solvency risk if revenues decline`;
  }
  if (debtToEquity > 2.0) {
    return `⚠️ High leverage — D/E of ${debtToEquity}, monitor debt servicing`;
  }
  return "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return 0;
  }
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSectorKey(sector) {
  const upper = safeString(sector).trim().toUpperCase();
  const aliases = {
    TECHNOLOGY: "IT",
    "INFORMATION TECHNOLOGY": "IT",
    BANKS: "FINANCIAL_SERVICES",
    "FINANCIAL SERVICES": "FINANCIAL_SERVICES",
    FINANCIAL: "FINANCIAL_SERVICES",
    INSURANCE: "FINANCIAL_SERVICES",
    OILGAS: "ENERGY",
    "OIL & GAS": "ENERGY",
    OIL: "ENERGY",
    AUTOMOBILES: "AUTO",
    AUTOMOBILE: "AUTO",
    AUTO: "AUTO",
    HEALTHCARE: "PHARMA",
    PHARMACEUTICALS: "PHARMA"
  };
  return aliases[upper] || upper.replace(/[^A-Z]/g, "_");
}

function scoreFromBands(value, bands, defaultScore = 5) {
  for (const band of bands) {
    if (band.test(value)) return band.score;
  }
  return defaultScore;
}

function computeFundamentalScore(stockData) {
  const pe = toNumber(stockData?.PERatio);
  const roe = toNumber(stockData?.ReturnOnEquityTTM);
  const revenueGrowth = toNumber(stockData?.QuarterlyRevenueGrowthYOY);
  const profitMargin = toNumber(stockData?.ProfitMargin);
  const debtToEquity = toNumber(stockData?.DebtToEquityRatio);

  const peScore = pe <= 0
    ? 5
    : scoreFromBands(pe, [
        { test: (v) => v <= 15, score: 9 },
        { test: (v) => v <= 22, score: 8 },
        { test: (v) => v <= 30, score: 6 },
        { test: (v) => v <= 40, score: 4 },
        { test: () => true, score: 2 }
      ]);
  const roeScore = scoreFromBands(roe, [
    { test: (v) => v >= 22, score: 10 },
    { test: (v) => v >= 18, score: 8 },
    { test: (v) => v >= 12, score: 6 },
    { test: (v) => v >= 8, score: 4 },
    { test: () => true, score: 2 }
  ]);
  const growthScore = scoreFromBands(revenueGrowth, [
    { test: (v) => v >= 18, score: 10 },
    { test: (v) => v >= 12, score: 8 },
    { test: (v) => v >= 6, score: 6 },
    { test: (v) => v >= 0, score: 4 },
    { test: () => true, score: 2 }
  ]);
  const marginScore = scoreFromBands(profitMargin, [
    { test: (v) => v >= 20, score: 9 },
    { test: (v) => v >= 12, score: 7 },
    { test: (v) => v >= 6, score: 5 },
    { test: (v) => v >= 0, score: 3 },
    { test: () => true, score: 2 }
  ]);
  const leverageScore = scoreFromBands(debtToEquity, [
    { test: (v) => v === 0, score: 5 },
    { test: (v) => v <= 0.5, score: 9 },
    { test: (v) => v <= 1.0, score: 7 },
    { test: (v) => v <= 2.0, score: 5 },
    { test: (v) => v <= 3.0, score: 3 },
    { test: () => true, score: 1 }
  ]);

  return Number((((peScore + roeScore + growthScore + marginScore + leverageScore) / 5)).toFixed(1));
}

function computeWeightedConfidence({
  technical,
  liveMarketData,
  stockData,
  relStrength,
  sectorData,
  valuationScore
}) {
  const rsi = toNumber(technical?.rsi);
  const sma20 = toNumber(technical?.sma20);
  const sma50 = toNumber(technical?.sma50);
  const sma200 = toNumber(technical?.sma200);
  const currentPrice = toNumber(technical?.currentPrice || liveMarketData?.currentPrice);
  const priceVsMA50 = sma50 > 0 ? ((currentPrice - sma50) / sma50) * 100 : 0;
  const volumeRatio = toNumber(technical?.volumeRatio) || 1;
  const fundamentals = computeFundamentalScore(stockData);

  const rsiScore = scoreFromBands(rsi, [
    { test: (v) => v >= 52 && v <= 66, score: 9 },
    { test: (v) => v >= 45 && v < 52, score: 7 },
    { test: (v) => v > 66 && v <= 72, score: 6 },
    { test: (v) => v >= 35 && v < 45, score: 5 },
    { test: () => true, score: 3 }
  ]);

  let trendScore = 4;
  if (currentPrice > sma20) trendScore += 2;
  if (currentPrice > sma50) trendScore += 2;
  if (currentPrice > sma200) trendScore += 2;
  if (sma20 > sma50) trendScore += 1;
  if (technical?.trend === "BEARISH") trendScore -= 2;
  trendScore = clamp(trendScore, 1, 10);

  const volumeScore = scoreFromBands(volumeRatio, [
    { test: (v) => v >= 2.0, score: 10 },
    { test: (v) => v >= 1.5, score: 8 },
    { test: (v) => v >= 1.1, score: 6 },
    { test: (v) => v >= 0.8, score: 5 },
    { test: () => true, score: 3 }
  ]);

  const relStrengthScore =
    relStrength?.strength === "STRONG"
      ? 9
      : relStrength?.strength === "MODERATE"
      ? 7
      : relStrength?.strength === "NEUTRAL"
      ? 5
      : 3;

  const sectorScore =
    sectorData?.bias === "STRONG_BULLISH"
      ? 9
      : sectorData?.bias === "BULLISH"
      ? 7
      : sectorData?.bias === "NEUTRAL"
      ? 5
      : 3;

  const valuationBlend = valuationScore > 0
    ? ((fundamentals * 0.7) + (valuationScore * 0.3))
    : fundamentals;

  const rawScore =
    (rsiScore * 0.15) +
    (trendScore * 0.20) +
    (volumeScore * 0.15) +
    (relStrengthScore * 0.15) +
    (valuationBlend * 0.20) +
    (sectorScore * 0.15);

  return {
    score: Number(clamp(rawScore, 1, 10).toFixed(1)),
    components: {
      rsiScore,
      trendScore,
      volumeScore,
      relStrengthScore,
      valuationBlend: Number(valuationBlend.toFixed(1)),
      sectorScore,
      fundamentals,
      priceVsMA50: Number(priceVsMA50.toFixed(1)),
      volumeRatio: Number(volumeRatio.toFixed(2))
    }
  };
}

function deriveDecisionFromConfidence(score, technical, riskLevel) {
  const trend = technical?.trend || "UNKNOWN";
  const rsi = toNumber(technical?.rsi);

  if (score >= 7.2 && trend === "BULLISH" && rsi >= 48 && riskLevel !== "HIGH") {
    return "BUY";
  }
  if (score <= 4.2 && (trend === "BEARISH" || rsi >= 74 || riskLevel === "HIGH")) {
    return "SELL";
  }
  return "HOLD";
}

function buildDeterministicDecisionReason({
  ticker,
  decisionValue,
  technical,
  liveMarketData,
  stockData,
  relStrength,
  sectorData,
  weightedConfidence
}) {
  const currentPrice = toNumber(technical?.currentPrice || liveMarketData?.currentPrice);
  const sma50 = toNumber(technical?.sma50);
  const priceVsMA50 = sma50 > 0 ? ((currentPrice - sma50) / sma50) * 100 : 0;
  const volumeRatio = toNumber(technical?.volumeRatio) || 1;
  const rsi = toNumber(technical?.rsi);
  const pe = toNumber(stockData?.PERatio);
  const roe = toNumber(stockData?.ReturnOnEquityTTM);
  const revenueGrowth = toNumber(stockData?.QuarterlyRevenueGrowthYOY);
  const sectorBias = sectorData?.bias || "NEUTRAL";
  const directionText =
    decisionValue === "BUY"
      ? "Momentum and structure justify a constructive bias."
      : decisionValue === "SELL"
      ? "Structure is not supportive enough to justify risk."
      : "Signal quality is mixed, so patience is warranted.";
  const valuationText =
    pe > 0
      ? pe <= 20
        ? `Valuation is still reasonable at ${pe.toFixed(1)}x earnings`
        : `Valuation is fuller at ${pe.toFixed(1)}x earnings`
      : "Valuation data is limited";

  return `${ticker} has RSI at ${rsi.toFixed(0)} and is ${priceVsMA50 >= 0 ? "trading above" : "trading below"} the 50DMA by ${Math.abs(priceVsMA50).toFixed(1)}%. Volume is ${volumeRatio.toFixed(2)}x average, relative strength is ${safeString(relStrength?.status || "neutral vs index").toLowerCase()}, and sector bias is ${sectorBias.toLowerCase().replace(/_/g, " ")}. ${valuationText}; ROE is ${roe.toFixed(1)}% and revenue growth is ${revenueGrowth.toFixed(1)}%. ${directionText} Weighted conviction is ${weightedConfidence.toFixed(1)}/10.`;
}

function buildVerifiedAnalysisFailure(ticker, details = {}) {
  return {
    status: "VERIFIED_ANALYSIS_UNAVAILABLE",
    error: true,
    blockExecution: true,
    ticker,
    invalidFields: details.invalidFields || [],
    message:
      `⚠ Unable to generate verified institutional analysis for ${ticker} right now.\n` +
      `Core market or financial data could not be validated.\n` +
      `Possible causes:\n` +
      `• Yahoo Finance temporary issue\n` +
      `• API timeout\n` +
      `• Exchange data delay\n` +
      `Please retry in a few moments.`
  };
}

/**
 * Generates a fresh market update with full intelligence pipeline.
 */
async function generateMarketUpdate() {
  const indices = await getIndianIndices();
  const news = await getIndianMarketNews();
  const sectors = await getIndianSectors();
  
  let state = indices.nifty.change < -0.5 ? "Market weak." : 
                indices.nifty.change > 0.5 ? "Market strong." : "Market range-bound.";
  
  if (!isMarketOpenIST()) {
    state = "Market closed. Last session data.";
  }

  function deriveDriver(newsData) {
    if (!newsData || newsData.length === 0) return null;
    const headline = newsData[0].toLowerCase();
    if (headline.includes("rbi")) {
      return "Banks reacting to RBI cues.";
    }
    if (headline.includes("earnings")) {
      return "Earnings driving moves.";
    }
    if (headline.includes("oil")) {
      return "Energy stocks tracking oil.";
    }
    return null;
  }

  const driver = deriveDriver(news);
  const driverLine = driver ? driver : "No strong setups right now.";

  return `
India — Market Update
${state}
Nifty 50: ${indices.nifty.price?.toLocaleString()} (${indices.nifty.change?.toFixed(2)}%)
Sensex: ${indices.sensex.price?.toLocaleString()} (${indices.sensex.change?.toFixed(2)}%)
${driverLine}
What matters: Market is range-bound—wait for clearer direction.
`.trim();
}

/**
 * Handles caching and rate control for market updates.
 */
async function getCachedMarketUpdate() {
  const now = Date.now();
  const currentState = getMarketStateKey();
  
  // Concurrency Lock: Prevent duplicate API hits under load
  if (isFetchingMarketUpdate) {
    if (marketCache.data) return marketCache.data;
    return `India — Market Update\nNo clear market view yet.\nWhat matters: Wait for clarity before acting.`;
  }

  // 5-minute TTL (300,000 ms) + State Awareness (Reset on Open/Close)
  const isFresh = marketCache.data && 
                  (now - marketCache.timestamp < 300000) && 
                  marketCache.state === currentState;

  if (isFresh) {
    console.log("MARKET_UPDATE: Serving from cache.");
    return marketCache.data;
  }
  
  try {
    isFetchingMarketUpdate = true;
    const fresh = await generateMarketUpdate();
    marketCache = { data: fresh, timestamp: now, state: currentState };
    return fresh;
  } catch (err) {
    console.error("MARKET_UPDATE_ERROR:", err.message);
    if (marketCache.data) return marketCache.data; // Serve stale if failure
    return `India — Market Update\nMarket data currently unavailable.\nWhat matters: Wait for clarity before acting.`;
  } finally {
    isFetchingMarketUpdate = false;
  }
}

/**
 * Generates Top Opportunities based on technical scoring.
 */
async function generateTopOpportunities() {
  const NAME_MAP = {
    RELIANCE: "Reliance",
    TCS: "TCS",
    HDFCBANK: "HDFC Bank",
    ICICIBANK: "ICICI Bank",
    INFY: "Infosys",
    TATAMOTORS: "Tata Motors",
    LT: "Larsen",
    BHARTIARTL: "Airtel",
    SBIN: "SBI",
    ITC: "ITC"
  };

  try {
    const stocks = await Promise.all(TOP_OPS_UNIVERSE.map(async (sym) => {
      const tech = await technicalAgent(sym);
      let score = 0;
      
      // 1. Trend/Momentum
      if (tech.trend === "BULLISH") score += 3;
      if (tech.momentumStrength === "STRONG") score += 2;
      
      // 2. Structural Health
      if (tech.currentPrice > tech.sma50) score += 2;
      
      // 3. RSI Window (High Probability Zone)
      if (tech.rsi > 55 && tech.rsi < 70) score += 2;
      if (tech.rsi < 40) score += 1; 

      const ticker = sym.split('.')[0];
      return {
        ticker,
        name: NAME_MAP[ticker] || ticker,
        score,
        rsi: tech.rsi,
        trend: tech.trend,
        currentPrice: tech.currentPrice
      };
    }));

    const ranked = stocks
      .filter(s => s.currentPrice > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (ranked[0]?.score < 4) {
      return `Top Opportunities — India\nNo strong setups right now.\nWhat matters: Market is range-bound—wait for clearer direction.`;
    }

    const output = ranked.map((s, i) => {
      let action = "AVOID";
      let reason = "weak structure";
      
      if (s.score >= 7) {
        action = "BUY";
        reason = s.rsi > 60 ? "momentum + structure" : "breakout focus";
      } else if (s.score >= 5) {
        action = "WAIT";
        reason = "structure forming";
      }
      
      return `${i + 1}. ${s.name} — ${action} (${reason})`;
    }).join("\n");

    return `
Top Opportunities — India
${output}
What matters: Stick to strength, avoid mixed setups.
`.trim();
  } catch (err) {
    console.error("TOP_OPS_ERROR:", err.message);
    return "Top Opportunities — India\nSystem recalibrating. Check back shortly.\nWhat matters: Technical data sync in progress.";
  }
}

/**
 * Handles caching and rate control for Top Opportunities.
 */
async function getTopOpportunities() {
  const now = Date.now();
  // 1-hour TTL (3,600,000 ms) for Top Ops
  if (topOpsCache.data && (now - topOpsCache.timestamp < 3600000)) {
    return topOpsCache.data;
  }

  if (isFetchingTopOps) {
    return topOpsCache.data || "Top Opportunities — India\nScanning universe...\nWhat matters: Data analysis in progress.";
  }

  try {
    isFetchingTopOps = true;
    const fresh = await generateTopOpportunities();
    topOpsCache = { data: fresh, timestamp: now };
    return fresh;
  } finally {
    isFetchingTopOps = false;
  }
}

/**
 * Generates a clean Portfolio Snapshot for the user.
 */
async function getPortfolioSnapshot(chatId) {
  const holdings = await getPortfolio(chatId);
  if (!holdings || holdings.length === 0) {
    return `Portfolio — Snapshot
No holdings yet.
Add a stock to start tracking.`.trim();
  }

  try {
    const review = await buildPortfolioReview(holdings);
    return formatPortfolioReview(review);
  } catch (err) {
    console.error("PORTFOLIO_SNAPSHOT_ERROR:", err.message);
    return "Portfolio — Snapshot\nError calculating performance.\nWhat matters: Technical data sync in progress.";
  }
}

export async function masterAgent(input, options = {}) {
  try {
    const strictValidation = options?.strictValidation === true;
    // Check if it's a conversation mode request
    if (input && input.mode === "conversation") {
      const { userQuery, isPro = false } = input;

      // 1. Intent Detection: Casual / Social (PRIORITY 1)
      const isCasual = /^(hi|hello|hey|who are you|why|how|what can you do)\b/i.test(userQuery.trim());
      if (isCasual) {
        const lowerQuery = userQuery.toLowerCase();
        
        const greetings = [
          "Hi — I’m FinSight. I track markets and give clear signals. What do you want to check?",
          "Hey — FinSight here. I help with stocks and market moves. What do you want to look at?",
          "Hi — I’m FinSight. I break down markets into clear actions. What do you want to check?"
        ];
        const who = [
          "I’m FinSight. I analyze stocks and give buy/hold/exit signals. Try: /analyze TCS",
          "FinSight. I track markets and turn them into decisions. Run: /analyze TCS",
          "I’m FinSight. I spot setups and give clear actions. Try: /analyze TCS"
        ];
        const why = [
          "Clarity over noise. But I can keep it conversational too—just tell me.",
          "Direct answers save time. If you want a different style, say it.",
          "I keep it sharp so decisions are easier. Can adjust tone if you want."
        ];

        if (/^hi|hello|hey/i.test(lowerQuery)) {
          return { response: greetings[Math.floor(Math.random() * greetings.length)] };
        }
        if (/who are you/i.test(lowerQuery)) {
          return { response: who[Math.floor(Math.random() * who.length)] };
        }
        if (/why/i.test(lowerQuery)) {
          return { response: why[Math.floor(Math.random() * why.length)] };
        }
        if (/how|what can you do/i.test(lowerQuery)) {
          return { response: "I’m an institutional intelligence system. I track price action, fundamentals, and news to give you clear entry and exit signals.\n\nTell me what you want to check." };
        }
      }

      // 1.5. Intent Detection: Acknowledgement / Closure (PRIORITY 1.5)
      const isAckMatch = /^(thanks|thank you|ok|okay|cool|got it|fine|alright|nothing|all good)/i.test(userQuery.trim());
      // Prevent false positives on "ok check tcs"
      if (isAckMatch && userQuery.length < 25 && !/analyze|check|market/i.test(userQuery)) {
        const ACK_RESPONSES = [
          "Got it.",
          "Alright.",
          "Okay.",
          "Done."
        ];
        return { response: ACK_RESPONSES[Math.floor(Math.random() * ACK_RESPONSES.length)] };
      }

      // 2. Intent Detection: Vague / Open-ended (PRIORITY 2)
      const isVague = /do one task|help me|can you help|do something/i.test(userQuery);
      if (isVague) {
        return { response: "Tell me what you'd like to analyze — stock, market, or portfolio." };
      }

      // 3. Intent Detection: Market Updates (PRIORITY 3 - India Override)
      const isMarketUpdate = /market analysis|market update|what.*market|news update|india market|^market$/i.test(userQuery);
      if (isMarketUpdate) {
        const response = await getCachedMarketUpdate();
        return { response };
      }

      // 4. Intent Detection: Top Opportunities (PRIORITY 4)
      const isTopOps = /best stocks|top opportunities|what should i buy|top picks/i.test(userQuery);
      if (isTopOps) {
        const response = await getTopOpportunities();
        return { response };
      }

      // 5. Persona & Helpers (Analyst / Chat Hybrid)
      const FINSIGHT_PERSONA = `
- Speak like a sharp trader, not a bot
- No AI filler (I understand, I believe, Certainly)
- No long paragraphs; use short, natural sentences
- Focus on signals and data, not explanations
- Be conversational but precise
- Max 4–5 lines
Tone: A sharp trader texting insights. Professional, fast, non-AI.
`.trim();

      const userMessage = userQuery || "";
      const buildPortfolioIntent =
        /(build|create|make).*(portfolio)|portfolio.*₹|₹.*portfolio/i.test(userMessage);
      if (buildPortfolioIntent) {
        console.log("BUILD PORTFOLIO TOOL CALLED");
        const amountMatch = userMessage.match(/(?:₹|rs\.?\s?|inr\s?)([\d,]+(?:\.\d+)?)/i) || userMessage.match(/\b([\d,]{4,}(?:\.\d+)?)\b/);
        const totalAmount = amountMatch ? (Number(String(amountMatch[1]).replace(/,/g, "")) || 20000) : 20000;
        const chatId = input.chatId || "DEFAULT";

        const currentPortfolio = await getPortfolio(String(chatId));
        const holdingReviews = [];
        let currentTotal = 0;
        const sectorExposure = {};
        const tickerMap = {
          HDFC: "HDFCBANK",
          ICICI: "ICICIBANK",
          INFOSYS: "INFY"
        };

        for (const h of currentPortfolio) {
          const normalizedTicker = tickerMap[h.symbol] || h.symbol;
          const live = await executeTool("getStockPrice", { ticker: normalizedTicker });
          const livePrice = Number(live?.price || 0);
          const qty = Number(h.quantity || 0);
          const avg = Number(h.avgPrice || 0);
          const invested = qty * avg;
          const currentValue = livePrice > 0 ? qty * livePrice : invested;
          currentTotal += currentValue;
          const pnlPct = invested > 0 ? ((currentValue - invested) / invested) * 100 : 0;
          const action = pnlPct < -5 ? "REDUCE" : "HOLD";
          const reason = action === "REDUCE"
            ? "Weak momentum and capital protection priority."
            : "Position remains stable within current risk limits.";
          holdingReviews.push({
            symbol: normalizedTicker,
            qty,
            avg,
            livePrice,
            invested,
            currentValue,
            pnlPct,
            action,
            reason
          });
        }

        const portfolioData = await executeTool("buildPortfolio", {
          totalAmount,
          allocations: [
            { ticker: "HDFCBANK", percentage: 40 },
            { ticker: "INFY", percentage: 30 },
            { ticker: "TATACONSUM", percentage: 15 },
            { ticker: "ICICIPRULI", percentage: 15 }
          ]
        });

        const positions = Array.isArray(portfolioData?.positions) ? portfolioData.positions : [];
        const reduceTickers = new Set(
          holdingReviews
            .filter((h) => h.action === "REDUCE")
            .map((h) => h.symbol)
        );
        const filteredPositions = positions.filter((p) => !reduceTickers.has(p.ticker));
        let deployed = 0;
        for (const p of filteredPositions) {
          deployed += Number(p.actual_cost || 0);
        }
        let undeployed = Math.max(0, Number(totalAmount) - deployed);
        const fmtINR = (value) => `₹${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
        const thesisByTicker = {
          INFY: "Strong cash reserves and improving IT demand recovery.",
          ICICIPRULI: "Insurance sector momentum improving with favorable valuations.",
          TATACONSUM: "Defensive consumption exposure improves portfolio balance.",
          HDFCBANK: "High-quality banking franchise with resilient credit growth."
        };

        // Secondary deterministic redistribution to reduce idle cash.
        if (undeployed > 3000 && filteredPositions.length > 0) {
          const priority = ["INFY", "ICICIPRULI", "TATACONSUM"];
          let progressed = true;
          while (undeployed > 3000 && progressed) {
            progressed = false;
            for (const t of priority) {
              const p = filteredPositions.find((x) => x.ticker === t);
              if (!p) continue;
              const price = Number(p.live_price || 0);
              if (price > 0 && undeployed >= price) {
                p.shares = Number(p.shares || 0) + 1;
                p.actual_cost = Number(p.actual_cost || 0) + price;
                undeployed -= price;
                progressed = true;
              }
              if (undeployed <= 3000) break;
            }
          }
          deployed = filteredPositions.reduce((sum, p) => sum + Number(p.actual_cost || 0), 0);
          undeployed = Math.max(0, Number(totalAmount) - deployed);
          filteredPositions.forEach((p) => {
            p.actual_percentage = deployed > 0
              ? ((Number(p.actual_cost || 0) / deployed) * 100).toFixed(1)
              : 0;
          });
        }

        const currentLines = holdingReviews.length
          ? holdingReviews.map((h) =>
              `${h.action === "REDUCE" ? "🔴" : "🟢"} ${h.symbol}\n` +
              `• Status: ${h.action}\n` +
              `• Live Price: ${h.livePrice ? fmtINR(h.livePrice) : "Unavailable"}\n` +
              `• Quantity: ${h.qty}\n` +
              `• PnL: ${h.pnlPct >= 0 ? "+" : ""}${h.pnlPct.toFixed(1)}%\n` +
              `• Insight:\n${h.reason}`
            ).join("\n")
          : "No existing holdings found for this account.";

        const newLines = filteredPositions.length
          ? filteredPositions.map((p) =>
              `📈 ${p.ticker}\n` +
              `• Live Price: ${fmtINR(p.live_price)}\n` +
              `• Suggested Shares: ${p.shares}\n` +
              `• Capital Allocation: ${fmtINR(p.actual_cost)}\n` +
              `• Portfolio Weight: ${p.actual_percentage || 0}%\n` +
              `• Thesis:\n${thesisByTicker[p.ticker] || "Balanced risk-adjusted exposure with stable market structure."}`
            ).join("\n")
          : "No deployable positions generated.";

        const response = `🏛 FINSIGHT — PORTFOLIO REBALANCE REPORT
━━━━━━━━━━━━━━━━━━
📦 CURRENT PORTFOLIO
${currentLines}
━━━━━━━━━━━━━━━━━━
💰 CAPITAL REALLOCATION STRATEGY
${newLines}
━━━━━━━━━━━━━━━━━━
📊 FINAL PORTFOLIO SUMMARY
• Existing Holdings: ${holdingReviews.length}
• Fresh Capital Added: ${fmtINR(totalAmount)}
• Capital Deployed: ${fmtINR(deployed)}
• Remaining Cash: ${fmtINR(undeployed)}
📌 Risk Profile: ${holdingReviews.some((h) => h.action === "REDUCE") ? "MODERATE" : "BALANCED"}
📌 Diversification: ${filteredPositions.length >= 3 ? "IMPROVED" : "STABLE"}
📌 Sector Balance: ${holdingReviews.some((h) => h.action === "REDUCE") ? "HEALTHIER" : "BALANCED"}
📌 Expected Stability: ${holdingReviews.some((h) => h.action === "REDUCE") ? "STRONGER" : "STABLE"}
${undeployed > Number(totalAmount) * 0.1 ? "📌 Cash Reserve Note: Elevated cash retained intentionally due to current allocation constraints." : ""}
━━━━━━━━━━━━━━━━━━
🧠 STRATEGIC OUTLOOK
Portfolio now has lower concentration risk,
improved sector diversification, and stronger
defensive balance versus the previous allocation.
Current structure favors medium-term stability
over aggressive short-term growth.
━━━━━━━━━━━━━━━━━━
⚠ Educational only. Not financial advice.`;

        return { response };
      }

      // 6. Intent Detection: Portfolio Snapshot (PRIORITY 6)
      const isPortfolio = /analy[sz]e.*portfolio|review.*holdings|portfolio snapshot|my holdings|check.*portfolio/i.test(userQuery);
      if (isPortfolio) {
        const chatId = input.chatId || "DEFAULT";
        const response = await getPortfolioSnapshot(chatId);
        return { response };
      }

      const ensureWhatMatters = (text) => {
        if (!text.includes("What matters:")) {
          return text + "\n\nWhat matters: Watch key levels—no clear trend yet.";
        }
        // if line exists but empty or broken
        if (/What matters:\s*$/i.test(text)) {
          return text.replace(/What matters:\s*$/i, "What matters: Watch key levels—no clear trend yet.");
        }
        return text;
      };

      const cleanOutput = (original, isAnalysis = false) => {
        if (isAnalysis) return original; 
        let text = original;
        const bannedPhrases = [
          "I understand that you", "I'm excited to", "I'm happy to", "delighted to", "pleased to",
          "esteemed", "cutting-edge", "excited", "collaborate", "vast amounts", "advanced", "sophisticated",
          "I believe", "In my opinion", "I would suggest", "Data shows"
        ];
        bannedPhrases.forEach(p => { text = text.replace(new RegExp(p, "gi"), ""); });
        
        text = text
          .replace(/Take action only if/gi, "Act only if")
          .replace(/Maintain discipline/gi, "Stay disciplined")
          .replace(/Execute only after/gi, "Only act after")
          .replace(/This analysis is based on/gi, "This is based on");
        
        const hasCriticalData = (t) => /₹|\d+%|\b\d{3,}\b/.test(t);
        if (!hasCriticalData(text) && hasCriticalData(original)) return original;
        return text.trim();
      };

      const validateResponse = (text, original) => {
        if (text.length < 20 || text.split(" ").length < 3) return original;
        if (/I am|I’m an AI|AI assistant|sophisticated AI/i.test(text)) return original;
        return text;
      };
      
      const extractAllocationAmount = (query) => {
        const match = query.match(/(?:₹|rs\.?\s?|inr\s?)([\d,]+(?:\.\d+)?)/i) || query.match(/\b([\d,]+(?:\.\d+)?)\b/);
        if (!match) return 0;
        return Number(String(match[1]).replace(/,/g, "")) || 0;
      };

      const buildApiBackedSharePlan = async (ticker, allocation) => {
        const live = await getLiveMarketData(ticker);
        const price = Number(live?.currentPrice || 0);
        if (!price || price <= 0) {
          return {
            ticker,
            error: "Price unavailable"
          };
        }

        const shares = Math.floor(allocation / price);
        const totalCost = shares * price;
        const remainder = allocation - totalCost;
        return {
          ticker,
          shares,
          pricePerShare: price,
          totalCost,
          undeployed: remainder,
          note: shares === 0
            ? `₹${allocation} insufficient for 1 share at ₹${price}`
            : null
        };
      };

      const isPitchQuery = (query) => {
        const lower = query.toLowerCase();
        return lower.includes("what are you") || lower.includes("who are you") || lower.includes("pitch");
      };

      const generateProofResponse = () => {
        return `FinSight — Equity Intelligence\nTCS — HOLD (structure weak)\nICICI — BUY (momentum intact)\nReliance — WAIT (earnings pressure)\nRun it live:\n /analyze TCS`.trim();
      };

      // 3. Identity & Proof
      if (isPitchQuery(userQuery)) {
        return { response: generateProofResponse() };
      }

      // 4. Live Data Snippet (Ticker Extraction)
      const tickerMatch = userQuery.match(/\b[A-Z]{2,10}(\.NS)?\b/);
      const isLikelyTicker = tickerMatch && !/^(HI|HEY|WHY|WHAT|HELP|DO|CAN|THE|AND|THIS|THAT|YOUR|WORK|WITH|FROM|INTO|ONTO)\b/i.test(tickerMatch[0]);
      const requiresLivePricing =
        /portfolio|invest|allocation|shares|stock price|price of|buy|₹|\d+\s*(rs|rupees)?/i
          .test(userMessage || "");
      const extractTickers = (query) => {
        const blocked = new Set(["HI", "HEY", "WHY", "WHAT", "HELP", "DO", "CAN", "THE", "AND", "THIS", "THAT", "YOUR", "WORK", "WITH", "FROM", "INTO", "ONTO"]);
        const matches = String(query || "").toUpperCase().match(/\b[A-Z]{2,10}(?:\.NS)?\b/g) || [];
        return [...new Set(matches.map((t) => t.split(".")[0]).filter((t) => !blocked.has(t)))];
      };
      
      let liveDataSnippet = "";
      if (isLikelyTicker) {
          const ticker = tickerMatch[0];
          try {
              const data = await getLiveMarketData(ticker);
              if (data && data.currentPrice > 0 && data.priceSource !== "FAILED") {
                  liveDataSnippet = `[LIVE MARKET DATA FOR ${ticker}] Price: ₹${data.currentPrice} | 52W: ₹${data.fiftyTwoWeekLow}-₹${data.fiftyTwoWeekHigh} | Vol: ${data.volume} | MCAP: ${data.marketCap}`;
              }
          } catch (err) {}
      }

      const isPortfolioConversation = /portfolio|my holdings|holdings|my stocks/i.test(userQuery);
      const tickers = new Set(extractTickers(userQuery));
      if (isLikelyTicker) tickers.add(tickerMatch[0].split(".")[0].toUpperCase());
      if (isPortfolioConversation && input?.chatId) {
        try {
          const holdings = await getPortfolio(String(input.chatId));
          holdings.forEach((h) => {
            if (h?.symbol) tickers.add(String(h.symbol).split(".")[0].toUpperCase());
          });
        } catch (err) {}
      }

      let verifiedMarketData = {};
      if (requiresLivePricing && tickers.size > 0) {
        for (const ticker of tickers) {
          const stockData = await executeTool("getStockPrice", { ticker });
          verifiedMarketData[ticker] = stockData;
        }
      }

      // 5. Final Intent Check (Safety Guard)
      const hasExplicitIntent = /analyze|market|nifty|sensex|stock/i.test(userQuery);
      if (!isLikelyTicker && !hasExplicitIntent) {
        return { response: "Tell me what you'd like to analyze — stock, market, or portfolio." };
      }

      // 6. LLM Call (tiered by subscription)
      const masterPrompt = `${FINSIGHT_PERSONA}\n\n${liveDataSnippet}\n\n${
        Object.keys(verifiedMarketData).length > 0
          ? `
VERIFIED YAHOO FINANCE DATA
(Use ONLY these values)
${Object.entries(verifiedMarketData)
  .map(([ticker, d]) =>
    `${ticker}:
Price = ₹${d.price}
Change = ${d.change}
Change % = ${d.changePercent}
Source = ${d.source}`
  )
  .join('\n\n')}
CRITICAL RULES:
- NEVER invent stock prices
- NEVER approximate prices
- NEVER use memory-based prices
- Use ONLY verified values above
`
          : ''
      }\n\nUser Question: ${userQuery}\n\nINSTRUCTION: ${isPro ? '6-8 lines max. Include entry zones, stop loss, targets if relevant.' : '3 sentences max. General overview only.'} Trader tone. If providing market data, end with a "What matters:" line. Only suggest allocation % and rationale. Do NOT calculate share quantities.\nDo NOT use words:\n- approximately\n- approx\n- around\n- estimated`.trim();
      let originalResponse = await generateTieredAnalysis(masterPrompt, isPro);
      let response = isPro ? cleanOutput(originalResponse) : originalResponse;
      response = validateResponse(response, originalResponse);
      response = response
        .split("\n")
        .filter((line) => !/\b\d+\s+shares?\b/i.test(line))
        .join("\n");
      if (requiresLivePricing) {
        response = response.replace(
          /₹\s?\d+(,\d{3})*(\.\d+)?\s*(approx|approximately|around|estimated)/gi,
          ""
        );
        response += "\n\n📊 VERIFIED LIVE PRICES\n";
        for (const [ticker, d] of Object.entries(verifiedMarketData)) {
          response += `• ${ticker}: ₹${d.price}\n`;
        }
      }
      
      // Telegram safe limit
      if (response.length > 4000) {
        response = response.slice(0, 4000);
      }

      // Optional bridge (60% chance)
      const bridges = ["Here’s the view:", "Quick take:", "Right now:"];
      if (Math.random() < 0.6) {
        response = bridges[Math.floor(Math.random() * bridges.length)] + "\n\n" + response;
      }

      const allocationAmount = extractAllocationAmount(userQuery);
      if (isLikelyTicker && allocationAmount > 0) {
        const plan = await buildApiBackedSharePlan(tickerMatch[0], allocationAmount);
        if (!plan.error) {
          const cost = Number(plan.totalCost || 0).toFixed(2);
          const undeployed = Number(plan.undeployed || 0).toFixed(2);
          response += `\n\n${plan.ticker} — ${plan.shares} shares at ₹${plan.pricePerShare} (₹${cost} used, ₹${undeployed} unused)`;
        }
      }

      response = ensureWhatMatters(response);
      return { response };
    }

    // Otherwise, treat as stock analysis request
    const stockData = input || {};
    const safeInput = safeString(JSON.stringify(stockData));
    console.log("MASTER AGENT INPUT:", safeSubstring(safeInput, 200));

    const ticker = 
      stockData.Symbol || 
      stockData.ticker || 
      stockData.symbol || 
      "UNKNOWN";

    console.log("--- MASTER AGENT DEBUG ---");
    console.log("TICKER:", ticker);
    console.log("INPUT DATA KEYS:", Object.keys(stockData));

    // Fix: Pre-declare execution variables for safety overrides
    let entryStrategy = "WAIT";
    let allocation = 0;
    let capitalAction = "Blocked by execution layer";

    // PHASE 1: Data Fetch & Integrity Guard
    console.log(`[Phase 1] Fetching live market data for ${ticker}...`);
    const liveMarketData = await getLiveMarketData(ticker);

    const invalidFields = [];
    const livePrice = Number(liveMarketData?.currentPrice || liveMarketData?.price || 0);
    const peRatio = Number.parseFloat(String(stockData?.PERatio ?? "").replace(/[^0-9.-]/g, ""));
    const roeValue = Number.parseFloat(String(stockData?.ReturnOnEquityTTM ?? "").replace(/[^0-9.-]/g, ""));
    const sectorName = safeString(stockData?.Sector || "");

    if (
      !liveMarketData ||
      !livePrice ||
      livePrice === 100 ||
      liveMarketData?.source === "fallback" ||
      liveMarketData?.status === "FALLBACK_SAFE"
    ) {
      invalidFields.push("price");
    }
    if (!Number.isFinite(peRatio) || peRatio <= 0) {
      invalidFields.push("peRatio");
    }
    if (!Number.isFinite(roeValue)) {
      invalidFields.push("roe");
    }
    if (!sectorName || sectorName.toLowerCase() === "fallback") {
      invalidFields.push("sector");
    }

    if (strictValidation && invalidFields.length > 0) {
      console.warn(`[STRICT VALIDATION] ${ticker}: blocking verified report due to ${invalidFields.join(", ")}`);
      return buildVerifiedAnalysisFailure(ticker, { invalidFields });
    }

    // FINAL GLOBAL GUARD: Data Integrity Check
    if (
        !liveMarketData || 
        !liveMarketData.currentPrice || 
        liveMarketData.currentPrice === 0 || 
        liveMarketData.error
    ) {
        console.warn(`[GLOBAL GUARD] Critical failure for ${ticker}. Aborting analysis.`);
        return {
            status: "DATA_UNAVAILABLE",
            message: `⚠ Data Unavailable for ${ticker}`,
            ticker,
            blockExecution: true
        };
    }

    console.log(`[Phase 1.5] Proceeding with full analysis for ${ticker}...`);
    const [risk, decision, technical, valuation] = await Promise.all([
      riskAgent(stockData),
      decisionAgent(stockData),
      technicalAgent(ticker),
      valuationAgent(stockData)
    ]);
    console.log(`[Phase 1] Completed. Live Price: ₹${liveMarketData.currentPrice}`);
    
    // CRITICAL GUARD: Hard block if price data is missing or invalid
    if (!liveMarketData.currentPrice || liveMarketData.currentPrice === 0) {
      console.warn(`[BLOCK] Market data unavailable for ${ticker}. Skipping full analysis.`);
      return {
        error: true,
        message: "Market data unavailable. Technical execution skipped.",
        ticker: ticker,
        decision: {
          finalDecision: "DATA UNAVAILABLE",
          reason: `Unable to fetch live market price for ${ticker}. Fallback sources exhausted.`
        },
        entryTiming: {
          strategy: "NO TRADE",
          reasoning: "⚠ Data Unavailable — Skipping technical execution",
          stopLoss: null,
          target: null,
          entryZone: null
        }
      };
    }

    // PHASE 2: Execution Intelligence (Entry Timing)
    const activePrice = Number(liveMarketData?.currentPrice || technical?.currentPrice || 0);
    const isDegraded = liveMarketData.isStale || false;

    console.log(`[Phase 2] Pre-flight Price Check for ${ticker}: ₹${activePrice} ${isDegraded ? "(STALE/DEGRADED)" : ""}`);

    const entryTiming = await analyzeEntryTiming({
      stock: ticker,
      currentPrice: activePrice,
      confidenceScore: decision.finalConfidenceScore || 5,
      riskLevel: risk.riskLevel || "MEDIUM",
      valuationScore: valuation.score || 5,
      momentumScore: technical.score || 5,
      technicalData: technical,
      marketData: liveMarketData,
      companyData: stockData
    });

    // PHASE 2.5: Exit Strategy Analysis
    const parseCurrency = (str) => Number(str?.replace(/[^0-9.]/g, "")) || 0;
    
    const exitSignal = await analyzeExitSignal({
      stock: ticker,
      currentPrice: activePrice,
      stopLoss: parseCurrency(entryTiming.stopLoss),
      target: parseCurrency(entryTiming.initialTarget),
      technicalData: technical,
      marketData: liveMarketData,
      companyData: stockData,
      valuationScore: valuation.score
    });
    const normalizedExitTriggers = [];
    if (exitSignal?.signal === "STOP LOSS EXIT") normalizedExitTriggers.push("stop_loss_breach");
    if (exitSignal?.signal === "TRIM POSITION" || technical?.trend === "BEARISH") normalizedExitTriggers.push("trend_reversal");

    // PHASE 2.6: Event Risk Analysis
    const eventRisk = await analyzeEventRisk({
      symbol: ticker,
      earningsDate: stockData.EarningsDate
    });

    // PHASE 3: Confidence Alignment & Learning Feedback
    const learningBoost = await getLearningBoost(ticker);

    // PHASE 2.7: Intelligence Layer (Decision Edge)
    const indices = await getIndianIndices();
    const niftyChange = indices.nifty.change || 0;
    const relStrength = calculateRelativeStrength(liveMarketData.change, niftyChange);
    
    const sectorMap = getSectorMomentum();
    const sectorData = sectorMap[normalizeSectorKey(stockData.Sector)] || { strength: 0, bias: "NEUTRAL" };
    
    const intelligenceSignals = generateSignals({
      roe: parseFloat(stockData.ReturnOnEquityTTM) || 0,
      revenueGrowth: parseFloat(stockData.QuarterlyRevenueGrowthYOY) || 0,
      pe: parseFloat(stockData.PERatio) || 0,
      priceAboveMA200: technical.priceAboveMA200 || false,
      volumeSpike: technical.isVolumeSpike || false
    });

    const weightedSignals = computeWeightedConfidence({
      technical,
      liveMarketData,
      stockData,
      relStrength,
      sectorData,
      valuationScore: valuation.score || 0
    });

    let adjustedConfidence = weightedSignals.score + learningBoost;
    
    // --- MARKET STATE CONTEXT ---
    const isLive = liveMarketData.priceSource === "LIVE" && !liveMarketData.latencyBlocked;
    const marketStatus = liveMarketData.marketStatus || {};
    
    let marketNote = isLive ? null : "⚠️ Market Closed";
    if (marketStatus.isWeekend) {
      marketNote = "📅 Market closed (Weekend)";
      marketNote += "\n⚠ Weekend gap risk possible";
    } else if (marketStatus.isHoliday) {
      marketNote = "📅 Market closed (Holiday)";
    } else if (marketStatus.isPostMarket) {
      marketNote = "🌙 Post-market (closed for today)";
    }
    
    if (intelligenceSignals.length > 0) adjustedConfidence += 0.4;

    // PARTIAL DATA GUARD: Downgrade confidence if key metrics are missing
    const hasMissingFundamentals = !stockData.ReturnOnEquityTTM || !stockData.DebtToEquityRatio || !stockData.QuarterlyRevenueGrowthYOY;
    if (hasMissingFundamentals) {
      console.log(`[PARTIAL DATA] Missing key fundamental metrics for ${ticker}. Reducing confidence.`);
      adjustedConfidence -= 1.0;
    }

    if (entryTiming.strategy === "CAUTIOUS ENTRY") {
      adjustedConfidence -= 0.4;
    } else if (entryTiming.strategy === "AVOID ENTRY") {
      adjustedConfidence -= 1.5;
    } else if (entryTiming.strategy === "STRONG ENTRY") {
      adjustedConfidence += 0.4;
    }
    
    adjustedConfidence = clamp(adjustedConfidence, 1, 10);
    
    if (marketStatus.isPreMarket) {
      marketNote = "⏳ Pre-market (opens soon)";
    } else if (liveMarketData.isMarketOpen && !isLive) {
      marketNote = "⏱ Data delayed — verify before entry";
    }

    // CRITICAL: Adjust confidence if data is degraded but ALLOW analysis
    if (!isLive) {
      console.log(`[DEGRADED MODE] ${ticker}. Source: ${liveMarketData.priceSource}. Proceeding with caution.`);
      adjustedConfidence = Math.min(adjustedConfidence, 6.2);
    }

    // Ensure score stays within 1-10 range
    adjustedConfidence = clamp(adjustedConfidence, 1, 10);

    // PHASE 3.5: Pre-Market Intelligence (ROI Upgrade)
    let preMarket = null;
    if (marketStatus.isPreMarket) {
      preMarket = generatePreMarketInsight({
        previousClose: liveMarketData.previousClose,
        currentPrice: liveMarketData.price,
        sector: stockData.Sector
      });
      console.log(`[PRE-MARKET] Generated insight for ${ticker}: ${preMarket?.note}`);
    }

    // Adjust for Data Completeness
    if (liveMarketData.completeness === "PARTIAL") {
      adjustedConfidence = Math.min(adjustedConfidence, 5);
      marketNote = marketNote ? `${marketNote}\n⚠ Limited data source — confidence reduced` : "⚠ Limited data source";
    }

    // PHASE 3.6: Deterministic Decision Synthesis
    let finalDecisionValue = deriveDecisionFromConfidence(
      adjustedConfidence,
      technical,
      risk.riskLevel || "MEDIUM"
    );
    const professionalReasoning = buildDeterministicDecisionReason({
      ticker,
      decisionValue: finalDecisionValue,
      technical,
      liveMarketData,
      stockData,
      relStrength,
      sectorData,
      weightedConfidence: adjustedConfidence
    });

    const finalDecision = {
      ...decision,
      finalDecision: finalDecisionValue,
      finalConfidenceScore: adjustedConfidence,
      reason: professionalReasoning
    };

    // PHASE 4: Strategic Allocation (Portfolio, Ranking, Capital, Rebalancing)
    const portfolio = await portfolioAgent({
      ...stockData,
      riskLevel: risk.riskLevel
    });

    const ranking = await rankingAgent({
      ...stockData,
      confidenceScore: adjustedConfidence,
      riskScore:
        risk.riskLevel === "LOW"
          ? 2
          : risk.riskLevel === "MEDIUM"
          ? 5
          : 8
    });

    const capital = await capitalAgent({
      ...stockData,
      priority: ranking.priority,
      confidenceScore: adjustedConfidence,
      riskLevel: risk.riskLevel
    });

    const rebalancing = await rebalancingAgent({
      ...stockData,
      finalDecision: finalDecision.finalDecision,
      suggestedAllocation: capital.suggestedAllocation
    });

    // Logical Consistency Check: Entry vs Rebalancing
    if (entryTiming.strategy === "AVOID ENTRY" && rebalancing.action.includes("Accumulate")) {
        console.log(`[Logical Alignment] ${ticker}: Overriding aggressive accumulation because Entry Timing is AVOID.`);
        rebalancing.action = "No action. Monitor closely";
    }

    // PHASE 4.5: Position Sizing
    const positionSizing = await calculatePositionSize({
      stock: ticker,
      confidenceScore: adjustedConfidence,
      riskLevel: risk.riskLevel || "MEDIUM",
      rewardRiskRatio: parseCurrency(entryTiming.rewardRiskRatio),
      entryUrgency: entryTiming.entryUrgency || "MEDIUM",
      volatility: technical.volatility || "MEDIUM",
      sectorExposure: 0, // Placeholder for future portfolio integration
      portfolioRisk: 5   // Placeholder for future portfolio integration
    });

    // Fix 1: Correct Portfolio Scaling Formula
    const suggestedPct = parseCurrency(positionSizing.allocation);
    const existingTotal = portfolio.totalWeight || 0;
    const remainingRoom = Math.max(0, 100 - existingTotal);

    if (suggestedPct > remainingRoom && suggestedPct > 0) {
        console.log(`[RISK] Insufficient portfolio room (${remainingRoom}%). Scaling down ${ticker}.`);
        const finalAllocation = Math.min(suggestedPct, remainingRoom);
        
        positionSizing.allocation = `${finalAllocation.toFixed(2)}%`;
        positionSizing.reason = `Capped at ${finalAllocation.toFixed(2)}% based on remaining portfolio capacity.`;
        
        if (finalAllocation < 1) {
            positionSizing.allocation = "0%";
            positionSizing.capitalAction = "No room in portfolio";
        }
    }

    // PHASE 4.6: Portfolio Rebalancing
    const rebalancer = await analyzeRebalancing({
      stock: ticker,
      targetAllocation: parseCurrency(positionSizing.allocation),
      actualAllocation: portfolio.currentAllocation || 0,
      sectorExposure: portfolio.sectorExposure || 0,
      exitSignal: exitSignal.signal,
      convictionScore: adjustedConfidence,
      riskConcentration: 5 // Placeholder
    });

    // PHASE 4.7: Conflict Resolution Engine (Signal Hierarchy)
    // EXIT SIGNAL overrides ENTRY SIGNAL (Risk Management > Opportunity)
    if (
      exitSignal.signal === "FULL EXIT" ||
      exitSignal.signal === "STOP LOSS EXIT" ||
      exitSignal.signal === "TRIM POSITION"
    ) {
      console.log(`[Conflict Resolution] ${ticker}: Exit signal (${exitSignal.signal}) overriding entry advice.`);
      
      entryTiming.finalExecutionAdvice = 
        `Risk management (${exitSignal.signal}) takes priority. Avoid fresh entry or accumulation until structure improves.`;
      entryTiming.entryUrgency = "LOW";
      entryTiming.strategy = "AVOID ENTRY";
      
      // Override Position Sizing (Risk Management > Capital Deployment)
      positionSizing.capitalAction = "Avoid fresh deployment. Focus on risk reduction.";
      positionSizing.conviction = "LOW";
      positionSizing.allocation = "0%";
      positionSizing.reason = `Risk priority (${exitSignal.signal}) overrides fresh allocation decisions until structure improves.`;

      // Override Rebalancing (Downstream must obey risk)
      rebalancing.rebalancingAction = "Reduce exposure immediately. Avoid maintaining full position size.";
      rebalancing.action = "Trim existing allocation and preserve capital.";
      rebalancer.action = exitSignal.signal;
      rebalancer.reason = `Exit signal (${exitSignal.signal}) takes precedence over allocation maintenance.`;

      // Downgrade conviction to reflect high-risk exit priority
      finalDecision.finalConfidenceScore = Math.min(finalDecision.finalConfidenceScore, 4);
    }

    // Ensure consistency: If decision is SELL, exit signal must reflect it
    if (finalDecision.finalDecision === "SELL") {
      exitSignal.signal = "FULL EXIT";
      exitSignal.action = "Reduce or exit position";
      exitSignal.urgency = "HIGH";
    }

    // EVENT RISK OVERRIDE (Event Risk > All Entry/Sizing Decisions)
    if (eventRisk.eventRisk === "HIGH" || eventRisk.eventRisk === "CRITICAL") {
      console.log(`[Conflict Resolution] ${ticker}: High Event Risk (${eventRisk.eventType}) detected. Overriding analysis.`);
      
      entryTiming.finalExecutionAdvice = `${eventRisk.action}. ${eventRisk.reason}`;
      entryTiming.entryUrgency = "LOW";
      entryTiming.strategy = "AVOID ENTRY";
      
      positionSizing.capitalAction = "Avoid fresh deployment before high-impact events.";
      positionSizing.conviction = "LOW";
      positionSizing.allocation = "0%";
      
      finalDecision.finalConfidenceScore = Math.min(finalDecision.finalConfidenceScore, 3);
    }

    const exit = generateExitSignal(normalizedExitTriggers, parseCurrency(entryTiming.stopLoss));
    exitSignal.signal = exit.signal;
    exitSignal.reason = exit.reason;

    // PHASE 5: Action Alignment
    // Override recommended action based on combined verdict + timing urgency
    function getRecommendedAction(verdict, entryUrgency) {
      const v = verdict.toUpperCase();
      if (v.includes("AVOID")) return "Exit or reduce position";
      if (v.includes("HOLD")) return "No action. Monitor closely";
      
      if (v.includes("BUY")) {
        if (entryUrgency === "VERY HIGH") return "Accumulate aggressively";
        if (entryUrgency === "HIGH") return "Build position gradually";
        if (entryUrgency === "MEDIUM") return "Start partial accumulation";
        if (entryUrgency === "LOW") return "Watchlist. Wait for better entry zone before deploying capital";
      }
      return "Monitor and wait for confirmation";
    }

    rebalancing.action = getRecommendedAction(
      finalDecision.finalDecision,
      entryTiming.entryUrgency
    );

    // PERSISTENCE: Log recommendation for future performance tracking
    await logRecommendation({
      symbol: ticker,
      decision: finalDecision.finalDecision,
      confidence: finalDecision.finalConfidenceScore,
      entryPrice: activePrice,
      stopLoss: parseCurrency(entryTiming.stopLoss),
      target: parseCurrency(entryTiming.initialTarget),
      reasoning: finalDecision.reason
    });

    // FINAL EXECUTION SAFETY CHECK
    // Fix 1: Block non-live or critical latency for execution
    if (liveMarketData.priceSource !== "LIVE" || liveMarketData.latencyBlocked) {
      const blockReason = liveMarketData.latencyBlocked ? "critical execution latency (>4s)" : `non-live data source (${liveMarketData.priceSource})`;
      console.log(`[EXECUTION BLOCK] Nullifying capital deployment for ${ticker} due to ${blockReason}.`);
      positionSizing.allocation = "0%";
      positionSizing.capitalAction = "Blocked by execution layer";
      positionSizing.reason = `Institutional Guard: Capital deployment blocked due to ${blockReason}.`;
      entryTiming.strategy = "WAIT";
      entryTiming.entryUrgency = "LOW";
      entryTiming.finalExecutionAdvice = "Wait for confirmation after market opens.";
    }

    // PHASE 6: Forward Guidance (Next Session Plan)
    let nextSessionPlan = null;
    if (liveMarketData.priceSource !== "LIVE") {
      nextSessionPlan = {
        plan: entryStrategy === "WAIT" ? "Prepare breakout watch" : "Prepare entry",
        action: "Wait for confirmation before acting.",
        entryTrigger: entryTiming.idealEntryZone || "Watch opening range",
        stopLoss: entryTiming.stopLoss || "To be confirmed on open",
        target: entryTiming.initialTarget || "Based on momentum",
        note: `Keep the stop loss tight at ${entryTiming.stopLoss || 'the opening range'}.`
      };
    }

    const news = await fetchCompanyNews(ticker, stockData?.Name);
    console.log("[NEWS DATA]", news);

    return {
      risk,
      portfolio,
      decision: finalDecision,
      ranking,
      capital,
      rebalancing,
      technical,
      valuation,
      entryTiming,
      exitSignal,
      ...positionSizing,
      status: "SUCCESS",
      isLive,
      marketNote,
      isMarketOpen: liveMarketData.isMarketOpen,
      currentPrice: activePrice,
      confidence: adjustedConfidence,
      riskLevel: risk.riskLevel || "MEDIUM",
      preMarket,
      news,
      intelligence: {
        relativeStrength: relStrength,
        sector: sectorData,
        signals: intelligenceSignals
      },
      action: isLive ? (finalDecision.finalDecision || "HOLD") : "Wait for market open confirmation",
      nextStep: marketStatus.isWeekend ? "Re-evaluate on Monday after open" : 
                (marketStatus.isPostMarket ? "Monitor tomorrow's open" : 
                (marketStatus.isPreMarket ? "Wait for market open" : 
                (entryTiming.strategy === "AVOID ENTRY" ? "Monitor for setup" : "Wait for price confirmation"))),
      analysisTimestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    };
  } catch (error) {
    console.error("Master Agent Error:", error.message);

    return {
      error: true,
      message: error.message
    };
  }
}
