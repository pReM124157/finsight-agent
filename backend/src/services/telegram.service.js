import { Telegraf, Markup } from "telegraf";
import { masterAgent } from "../agents/master.agent.js";
import { safeObject, safeString, safeSubstring, safeArray } from "../core/safety.js";
import { parseInput } from "../core/router.js";
import { classifyUserIntent } from "../core/intentRouter.js";
import { isValidSymbol } from "../core/validator.js";
import { isPro } from "../core/user.js";
import { buildMessage } from "../core/messageBuilder.js";
import { runAnalysisSafe } from "../core/analysisRunner.js";
import { processNaturalLanguage } from "../core/agentOrchestrator.js";

// Global Production Guards
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

import {
  validateTickerSyntax,
  checkSymbolExistence,
  checkMarketAvailability,
  EXISTENCE_STATE,
  MARKET_AVAILABILITY
} from "../core/tickerContracts.js";
import { getLiveMarketData, getCompanyOverview, getMarketStatusIST } from "./marketData.service.js";
import { scannerAgent } from "../agents/scanner.agent.js";
import { sectorScannerAgent } from "../agents/sectorScanner.agent.js";
import { buildPortfolioReview } from "../agents/portfolioReview.agent.js";
import { formatInstitutionalScannerReport } from "../scanner/scannerFormatter.js";
import { validateSignal } from "../scanner/signalGuards.js";
import {
  addHolding,
  getPortfolio,
  removeHolding,
  updateHolding
} from "./portfolioMemory.service.js";
import { createPaymentLink, cancelSubscriptionNow, cancelSubscriptionLater } from "../routes/payment.js";
import supabase from "./supabase.service.js";
import { handleUsage } from "./usage.service.js";
import { generateChatReply } from "./chat.service.js";
import { formatIST, getMarketStateIST } from "../utils/time.js";
import { formatPortfolioReview } from "../core/portfolioFormatter.js";
import { buildAnalysisContext } from "../core/analysisContext.js";
import { parseAddCommand, parseRemoveCommand } from "./portfolioCommandParser.service.js";
import { normalizeTickerAlias } from "../core/tickerAliases.js";
import { optimizePortfolioCandidate } from "./portfolioOptimizer.service.js";
import {
  claimEphemeralKey,
  consumeState,
  deleteState,
  getState,
  putState
} from "./distributedState.service.js";
import { createTraceId, logError, logEvent } from "./telemetry.service.js";
import {
  claimSchedulerLease,
  getInstanceId,
  releaseSchedulerLease,
  renewSchedulerLease
} from "./schedulerLease.service.js";
import {
  abstractStatus,
  sanitizeInstitutionalAction,
  synthesizePrimaryLimitation
} from "./presentationAbstraction.service.js";
import {
  buildInstitutionalFundamentalNarrative,
  classifyInstitutionalConfidence,
  buildGovernanceExplanation,
  buildEvidenceConstraintSummary,
  buildDecisionTrace,
  computeInstitutionalFactorWeights
} from "./institutionalInterpretation.service.js";
import { computeCompositeScores } from "../scoring/compositeScoreEngine.js";
import { getInstitutionalRuntimeSnapshot } from "./institutionalStatus.service.js";
import { reconcileSubscriberEntitlement } from "./subscriptionReconciliation.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];
const THROTTLE_MS = 2000; // 2s cooldown
const ANALYZE_STATE_TTL_SECONDS = 10 * 60;
const CHAT_MEMORY_TTL_SECONDS = 24 * 60 * 60;
const BOT_LEASE_NAME = "telegram_bot_polling";
const BOT_LEASE_TTL_SECONDS = 120;
const BOT_LEASE_HEARTBEAT_MS = 30000;
const BOT_LEASE_RETRY_MS = 15000;
const BOT_INSTANCE_ID = getInstanceId();
const TELEGRAM_LEASE_REQUIRED = process.env.TELEGRAM_LEASE_REQUIRED === "true";
let botStarted = false;
let botSupervisorStarted = false;
let botHeartbeatTimer = null;
let botSupervisorTimer = null;
let botLeaseOwner = false;
let botLaunchInFlight = false;
let botStartedInFallbackMode = false;
let conflictStateActive = false;
let botLaunchRetryTimer = null;
let botLaunchRetryAttempts = 0;
const telegramRuntimeState = {
  connected: false,
  degradedMode: true,
  lastSuccessfulConnection: null
};

function getRetryDelayMs(attempt) {
  const idx = Math.max(0, Math.min(attempt, TELEGRAM_RETRY_DELAYS_MS.length - 1));
  return TELEGRAM_RETRY_DELAYS_MS[idx];
}

function setTelegramConnected() {
  telegramRuntimeState.connected = true;
  telegramRuntimeState.degradedMode = false;
  telegramRuntimeState.lastSuccessfulConnection = new Date().toISOString();
  botLaunchRetryAttempts = 0;
  if (botLaunchRetryTimer) {
    clearTimeout(botLaunchRetryTimer);
    botLaunchRetryTimer = null;
  }
  logEvent("telegram.bot.connected", {
    ownerId: BOT_INSTANCE_ID,
    lastSuccessfulConnection: telegramRuntimeState.lastSuccessfulConnection
  });
}

function setTelegramDegraded(reason = "UNKNOWN") {
  telegramRuntimeState.connected = false;
  telegramRuntimeState.degradedMode = true;
  logEvent("telegram.bot.launch_failed", {
    ownerId: BOT_INSTANCE_ID,
    reason
  });
}

function scheduleBotLaunchRetry(reason = "LAUNCH_FAILED") {
  if (botLaunchRetryTimer) return;
  const delayMs = getRetryDelayMs(botLaunchRetryAttempts);
  logEvent("telegram.bot.retry_scheduled", {
    ownerId: BOT_INSTANCE_ID,
    attempt: botLaunchRetryAttempts + 1,
    delay_ms: delayMs,
    reason
  });
  botLaunchRetryTimer = setTimeout(async () => {
    botLaunchRetryTimer = null;
    botLaunchRetryAttempts += 1;
    await launchBotIfNeeded("retry");
  }, delayMs);
}

export async function verifyTelegramConnectivity(timeoutMs = 5000) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logEvent("telegram.network.dns_failure", {
      ownerId: BOT_INSTANCE_ID,
      reason: "missing_bot_token"
    });
    return false;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET",
      signal: controller.signal
    });
    if (response.ok) {
      logEvent("telegram.network.ok", { ownerId: BOT_INSTANCE_ID });
      return true;
    }
    logEvent("telegram.network.dns_failure", {
      ownerId: BOT_INSTANCE_ID,
      reason: `http_${response.status}`
    });
    return false;
  } catch (error) {
    const message = String(error?.message || "");
    if (error?.name === "AbortError") {
      logEvent("telegram.network.timeout", { ownerId: BOT_INSTANCE_ID, timeout_ms: timeoutMs });
      return false;
    }
    if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
      logEvent("telegram.network.dns_failure", {
        ownerId: BOT_INSTANCE_ID,
        reason: "dns_lookup_failed",
        message
      });
      return false;
    }
    logError("telegram.network.dns_failure", error, { ownerId: BOT_INSTANCE_ID, reason: "network_error" });
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function canCall(userId) {
  try {
    const ownerId = createTraceId(`throttle_${userId}`);
    return claimEphemeralKey("telegram_throttle", userId, ownerId, Math.ceil(THROTTLE_MS / 1000));
  } catch (error) {
    logError("telegram.throttle.error", error, { userId });
    return true;
  }
}

async function launchBotIfNeeded(mode = "lease") {
  if (botStarted || botLaunchInFlight) return;

  botLaunchInFlight = true;
  try {
    const networkOk = await verifyTelegramConnectivity();
    if (!networkOk) {
      setTelegramDegraded("network_unreachable");
      scheduleBotLaunchRetry("network_unreachable");
      return;
    }
    await bot.launch();
    botStarted = true;
    setTelegramConnected();
    if (conflictStateActive) {
      conflictStateActive = false;
      logEvent("telegram.bot.conflict", { ownerId: BOT_INSTANCE_ID, mode, state: "recovered" });
    }
    botStartedInFallbackMode = mode === "fallback";
    logEvent("telegram.bot.started", {
      ownerId: BOT_INSTANCE_ID,
      mode
    });
  } catch (err) {
    if (err.response && err.response.error_code === 409) {
      if (!conflictStateActive) {
        conflictStateActive = true;
        logEvent("telegram.bot.conflict", { ownerId: BOT_INSTANCE_ID, mode, state: "entered" });
      }
    } else {
      conflictStateActive = false;
      setTelegramDegraded(err?.code || "launch_error");
      logError("telegram.bot.launch_error", err, { ownerId: BOT_INSTANCE_ID, mode });
      scheduleBotLaunchRetry(err?.code || "launch_error");
      return;
    }
  } finally {
    botLaunchInFlight = false;
  }
}


// ─────────────────────────────────────────────

function getNextSessionNote(status) {
  if (status.isWeekend || status.isHoliday || status.isPostMarket) {
    const next = status.nextTradingDay ? new Date(status.nextTradingDay) : null;
    if (next && status.istTime) {
      const dateStr = next.toDateString().split(' ').slice(0, 3).join(' ');
      const diffMs = next - new Date(status.istTime);
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      let countdown = `${hours}h ${mins}m`;
      if (hours > 48) {
        countdown = `${Math.floor(hours / 24)} days`;
      }
      
      let note = `👉 Next session: ${dateStr} 9:15 AM\n`;
      note += `⏳ Opens in ${countdown}`;
      return note;
    }
  }
  return "";
}

function getOpenStrategy(preMarket) {
  if (!preMarket) return "";
  if (preMarket.gapType === "gap up") {
    return "Watch for breakout continuation above opening high";
  }
  if (preMarket.gapType === "gap down") {
    return "Avoid early entry — wait for reversal or support";
  }
  return "Wait for first 15-min range breakout";
}

function isCasualMessage(text) {
  const casual = [
    "hi", "hello", "hey", "ok", "okay", "thanks",
    "thank you", "yo", "sup", "bro", "nothing",
    "bye", "good", "nice", "hmm"
  ];
  const clean = safeString(text).toLowerCase().trim();
  return casual.includes(clean) || clean.length < 4;
}

function shouldAnalyze(symbol, originalText) {
  if (!symbol) return false;
  const text = safeString(originalText).toLowerCase();
  if (text.includes(" ")) return false;
  const ignoreWords = [
    "hi", "hello", "hey", "thanks", "thank", "you",
    "ok", "okay", "friend", "assistance", "nothing",
    "good", "nice", "yes", "no"
  ];
  if (ignoreWords.includes(symbol.toLowerCase())) return false;
  if (!/^[A-Z]{3,10}$/.test(symbol)) return false;
  return true;
}

function extractSymbol(text) {
  if (!text) return null;
  const clean = safeString(text)
    .replace("/", "")
    .replace("analyze", "")
    .trim();
  if (clean.includes(" ")) return null;
  return clean.toUpperCase();
}

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

function isVerifiedAnalysisUnavailable(result) {
  return safeString(result?.status) === "VERIFIED_ANALYSIS_UNAVAILABLE" || result?.blockExecution === true;
}

function clampPublicConfidence(value, floor = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return floor;
  return Math.max(Math.round(numeric), floor);
}

function isValidPositiveInteger(text = "") {
  const trimmed = String(text || "").trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const qty = Number(trimmed);
  return Number.isInteger(qty) && qty > 0;
}

function extractIndexPriceAndChange(result) {
  if (!result) return { price: null, change: null };
  const price = Number(
    result.currentPrice ??
    result.price ??
    result.regularMarketPrice ??
    result.lastPrice ??
    0
  );
  
  let change = null;
  const rawChangePercent = result.changePercent ?? result.regularMarketChangePercent ?? result.percentChange ?? result.change;
  if (rawChangePercent !== undefined && rawChangePercent !== null) {
    change = Number(rawChangePercent);
  } else {
    const prevClose = Number(result.regularMarketPreviousClose ?? result.previousClose ?? 0);
    if (price > 0 && prevClose > 0) {
      change = ((price - prevClose) / prevClose) * 100;
    }
  }

  return {
    price: price > 0 ? price : null,
    change: Number.isFinite(change) ? change : null
  };
}

async function buildMarketOverviewText() {
  let niftyText = "NIFTY 50: Unavailable safely";
  let sensexText = "SENSEX: Unavailable safely";
  let niftyChange = null;
  let sensexChange = null;
  let dataSource = "Yahoo";

  try {
    const niftyData = await getLiveMarketData("^NSEI");
    const extractedNifty = extractIndexPriceAndChange(niftyData);
    if (extractedNifty.price !== null) {
      const formattedChange = extractedNifty.change !== null ? `${extractedNifty.change >= 0 ? "+" : ""}${extractedNifty.change.toFixed(2)}%` : "N/A";
      niftyText = `NIFTY 50: ${extractedNifty.price.toLocaleString("en-IN")} | ${formattedChange}`;
      niftyChange = extractedNifty.change;
      if (niftyData.priceSource) {
        dataSource = niftyData.priceSource;
      }
    }
  } catch (err) {
    console.error("Error fetching NIFTY:", err);
  }

  try {
    const sensexData = await getLiveMarketData("^BSESN");
    const extractedSensex = extractIndexPriceAndChange(sensexData);
    if (extractedSensex.price !== null) {
      const formattedChange = extractedSensex.change !== null ? `${extractedSensex.change >= 0 ? "+" : ""}${extractedSensex.change.toFixed(2)}%` : "N/A";
      sensexText = `SENSEX: ${extractedSensex.price.toLocaleString("en-IN")} | ${formattedChange}`;
      sensexChange = extractedSensex.change;
      if (sensexData.priceSource) {
        dataSource = sensexData.priceSource;
      }
    }
  } catch (err) {
    console.error("Error fetching SENSEX:", err);
  }

  const marketState = getMarketStateIST();
  const stateLabel = marketState.open ? "Open" : "Closed / Last close data";

  let shortViewText = "Market tone is neutral today.";
  if (niftyChange !== null && sensexChange !== null) {
    if (niftyChange > 0.3 && sensexChange > 0.3) {
      shortViewText = "Market tone is positive today as both NIFTY and SENSEX are trading higher.";
    } else if (niftyChange < -0.3 && sensexChange < -0.3) {
      shortViewText = "Market tone is weak today as both NIFTY and SENSEX are trading lower.";
    } else {
      shortViewText = "Market tone is neutral today with mixed or sideways action.";
    }
  }

  return `📊 *Market Overview*\n\n` +
         `• ${niftyText}\n` +
         `• ${sensexText}\n` +
         `• Market State: ${stateLabel}\n` +
         `• Data Source: ${dataSource}\n\n` +
         `Short View: ${shortViewText}\n` +
         `⚠️ Educational only. Not financial advice.`;
}


async function executePortfolioBatchAdd(chatId, rawEntries = []) {
  const seen = new Set();
  const entries = [];
  for (const item of rawEntries) {
    const symbol = String(item.symbol || "").toUpperCase().trim();
    const quantity = Number(item.quantity);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    entries.push({ symbol, quantity });
  }

  const symbols = entries.map((x) => x.symbol);
  const { data: existingRows, error: existingErr } = symbols.length
    ? await supabase
        .from("holdings")
        .select("symbol")
        .eq("chat_id", String(chatId))
        .in("symbol", symbols)
    : { data: [], error: null };

  if (existingErr) {
    throw new Error("Could not validate existing holdings right now.");
  }

  const existing = new Set((existingRows || []).map((r) => String(r.symbol || "").toUpperCase()));
  const successes = [];
  const failures = [];

  for (const entry of entries) {
    if (existing.has(entry.symbol)) {
      failures.push({ symbol: entry.symbol, reason: "Already exists" });
      continue;
    }
    try {
      await addHolding(chatId, {
        symbol: entry.symbol,
        quantity: entry.quantity,
        avgPrice: 0
      });
      successes.push(entry);
    } catch (err) {
      failures.push({ symbol: entry.symbol, reason: err?.message || "Insert failed" });
    }
  }

  return { successes, failures };
}


export function formatAnalysis(res, symbol, stockData = {}, options = {}) {
  const result = safeObject(res);
  if (isVerifiedAnalysisUnavailable(result)) {
    return safeString(
      result.message ||
      `⚠ Unable to generate verified institutional analysis for ${symbol} right now.\nCore market or financial data could not be validated.\nPlease retry in a few moments.`
    );
  }

  const entryTiming = safeObject(result.entryTiming);
  const technical = safeObject(result.technical);
  const risk = safeObject(result.risk);
  const exitSignal = safeObject(result.exitSignal);
  const intelligence = safeObject(result.intelligence);
  const sector = safeObject(intelligence.sector);
  const relStrength = safeObject(intelligence.relativeStrength);
  const nextSessionPlan = safeObject(result.nextSessionPlan);
  const news = safeObject(result.news);
  const confidenceEvidence = safeObject(result.confidenceEvidence);
  const institutionalEvidence = safeObject(result.institutionalEvidence);
  const priceField = safeString(result.priceField || "");

  const istMarket = getMarketStateIST();
  let marketStatusLabel = istMarket.open ? "Open (IST Session)" : "Closed (IST Session)";
  if (priceField === "postMarketPrice") marketStatusLabel = "Closed (Post-Market Live Data)";
  else if (priceField === "preMarketPrice") marketStatusLabel = "Pre-Market (Live Discovery)";
  else if (result.isMarketOpen) marketStatusLabel = "Open (Live Data)";
  else if (istMarket.open && (priceField === "regularMarketPrice" || priceField === "currentPrice")) marketStatusLabel = "Open (Live Data)";
  else if (!istMarket.open && (priceField === "regularMarketPrice" || priceField === "currentPrice")) marketStatusLabel = "Closed (Latest Regular Session Price)";

  const stockDataPrice = Number(
    stockData?.currentPrice ||
    stockData?.CurrentPrice ||
    stockData?.previousClose ||
    stockData?.PreviousClose ||
    stockData?.regularMarketPreviousClose ||
    stockData?.RegularMarketPreviousClose ||
    0
  );
  const previousCloseFallback = Number(
    result?.previousClose ||
    result?.marketData?.previousClose ||
    result?.marketData?.regularMarketPreviousClose ||
    result?.technical?.previousClose ||
    result?.technical?.regularMarketPreviousClose ||
    0
  );
  const technicalPriceFallback = Number(
    result?.technical?.currentPrice ||
    result?.technical?.close ||
    0
  );
  const livePrice = Number(
    result.currentPrice ||
    entryTiming.currentPrice ||
    technicalPriceFallback ||
    0
  );
  const previousClose = Number(
    previousCloseFallback ||
    stockDataPrice ||
    0
  );
  const marketOpen = Boolean(result.isMarketOpen || istMarket.open);
  // Always fall back to previous close if live price is unavailable.
  // This prevents "price missing" regressions while still labeling data quality via marketStatusLabel.
  const price = livePrice || previousClose;
  const priceChange = Number(technical.priceChangePercent || technical.changePercent || 0);
  const hasVerifiedPrice = price > 0;
  const executionLive = Boolean(
    result.isLive ||
    (hasVerifiedPrice && (
      result.isMarketOpen ||
      marketStatusLabel.includes("Open (Live Data)") ||
      priceField === "regularMarketPrice" ||
      priceField === "currentPrice"
    ))
  );
  if (!marketOpen) {
    marketStatusLabel = "Closed (Last Close Data)";
  } else if (marketOpen && livePrice <= 0 && previousClose > 0) {
    marketStatusLabel = "Open (Last Close Fallback — Live Feed Delayed)";
  } else if (istMarket.open && !hasVerifiedPrice) {
    marketStatusLabel = "Open (Feed Degraded — Live Price Unavailable)";
  }
  const priceText = hasVerifiedPrice ? `₹${price}` : "Unavailable (no verified market price)";

  const referencePrice = price > 0 ? price : stockDataPrice;
  const normalized = {
    verdict: safeString(result.direction || result.action || result?.decision?.finalDecision || "HOLD"),
    asset: safeString(symbol || "UNKNOWN"),
    currentPrice: price,
    marketStatus: marketStatusLabel,
    trend: safeString(technical.trend || "Neutral"),
    support: smartFallback("support", technical.supportLevel, { price }),
    resistance: smartFallback("resistance", technical.resistanceLevel, { price }),
    momentum: smartFallback("momentum", safeString(technical.momentum || technical.signal), { priceChange }),
    volume: safeString(technical.volumeTrend || (technical.isVolumeSpike ? "Spike" : "Normal")),
    entryZone: safeString(entryTiming.idealEntryZone || "Watch opening range"),
    stopLoss: safeString(entryTiming.stopLoss || (referencePrice ? `₹${Math.round(referencePrice * 0.96)}` : "Unavailable pending verified price")),
    target: safeString(entryTiming.initialTarget || (referencePrice ? `₹${Math.round(referencePrice * 1.06)}` : "Unavailable pending verified price")),
    tradeAction: sanitizeInstitutionalAction(entryTiming.finalExecutionAdvice),
    pe: stockData.PERatio ?? null,
    roe: stockData.ReturnOnEquityTTM ?? null,
    profitMargin: stockData.ProfitMargin ?? null,
    debtEquity: stockData.DebtToEquityRatio ?? null,
    revenueGrowth: stockData.QuarterlyRevenueGrowthYOY ?? null,
    earningsGrowth: stockData.QuarterlyEarningsGrowthYOY ?? null,
    sectorName: safeString(stockData.Sector || "Unknown Sector"),
    sectorBias: safeString(sector.bias || "NEUTRAL"),
    relStrength: safeString(relStrength.status || "Neutral"),
    sentiment: safeString(news.sentiment || "NEUTRAL"),
    riskLevel: safeString(result.riskLevel || risk.riskLevel || "MEDIUM"),
    exitAction: safeString(exitSignal.action || "Risk-governance hold"),
    bullishScenario: smartFallback("trigger_up", safeString(nextSessionPlan.entryTrigger), { price }),
    bearishScenario: smartFallback("trigger_down", safeString(nextSessionPlan.stopLoss), { price }),
    keyTrigger: safeString(nextSessionPlan.note || "Opening gap + volume confirmation"),
    confidenceEvidence,
    institutionalEvidence
  };

  const adaptiveScore = Number(normalized.confidenceEvidence?.adaptiveConfidenceScore);
  const warnings = Array.isArray(normalized.confidenceEvidence?.warnings) ? normalized.confidenceEvidence.warnings : [];
  const penalties = {
    partialDataPenalty: 0,
    degradedExecutionPenalty: 0,
    eventRiskPenalty: 0,
    ...safeObject(normalized.confidenceEvidence?.penalties)
  };
  const contributions = {
    technicalTrend: 0,
    technicalMomentum: 0,
    volumeConfirmation: 0,
    sectorAlignment: 0,
    relativeStrength: 0,
    fundamentalQuality: 0,
    dataQuality: 0,
    ...safeObject(normalized.confidenceEvidence?.contributionMap)
  };
  const noTrade = normalized.verdict.toUpperCase().includes("HOLD") || safeString(normalized.tradeAction).toUpperCase().includes("WAIT");
  const replayStatus = safeString(normalized.institutionalEvidence?.replay?.status || "INSUFFICIENT_REPLAY_DEPTH");
  const calibrationStatus = safeString(normalized.institutionalEvidence?.calibration?.status || "INSUFFICIENT_DATA");
  const driftStatus = safeString(normalized.institutionalEvidence?.drift?.status || "NOT_AVAILABLE_IN_THIS_PATH");
  const benchmarkStatus = safeString(normalized.institutionalEvidence?.benchmark?.status || "NOT_AVAILABLE_IN_THIS_PATH");
  const marketRegime = safeObject(normalized.institutionalEvidence?.marketRegime);

  // Conviction class
  let confidenceDisplay = Number.isFinite(adaptiveScore)
    ? `${Math.round(adaptiveScore)}/100 — ${classifyInstitutionalConfidence(adaptiveScore).label}`
    : "N/A — CONDITIONAL (confidence evidence unavailable)";

  // Institutional fundamental narrative
  const fundNarrative = buildInstitutionalFundamentalNarrative({
    rawMetrics: {
      pe: normalized.pe, roe: normalized.roe, profitMargin: normalized.profitMargin,
      debtEquity: normalized.debtEquity, revenueGrowth: normalized.revenueGrowth, earningsGrowth: normalized.earningsGrowth
    },
    adaptiveScore, technicalRegime: normalized.trend, sector: normalized.sectorName
  });

  // Factor model
  const factorModel = computeInstitutionalFactorWeights({
    roe: normalized.roe, profitMargin: normalized.profitMargin, debtEquity: normalized.debtEquity,
    revenueGrowth: normalized.revenueGrowth, earningsGrowth: normalized.earningsGrowth,
    technicalTrend: contributions.technicalTrend ?? 0, technicalMomentum: contributions.technicalMomentum ?? 0,
    volumeConfirmation: contributions.volumeConfirmation ?? 0, sectorAlignment: contributions.sectorAlignment ?? 0,
    relativeStrength: contributions.relativeStrength ?? 0,
    adaptiveScore, replayStatus, calibrationStatus, driftStatus,
    trendLabel: normalized.trend,
    momentumLabel: normalized.momentum,
    volumeLabel: normalized.volume,
    relativeStrengthLabel: normalized.relStrength,
    entryStrategy: entryTiming.strategy
  });

  // Evidence constraint — ONE compressed paragraph, no repeated spam
  const evidenceConstraint = buildEvidenceConstraintSummary({ replayStatus, calibrationStatus, driftStatus, benchmarkStatus });

  // Governance gate
  let governance = buildGovernanceExplanation({
    replayStatus, adaptiveScore, isLive: executionLive,
    tradabilityHold: warnings.includes("TRADABILITY_HOLD_BIAS"),
    eventRisk: warnings.includes("EVENT_RISK_OVERRIDE") ? "HIGH" : "LOW",
    calibrationStatus
  });

  // Decision trace — every conclusion traced to an engine
  let decisionTrace = buildDecisionTrace({
    replayStatus, adaptiveScore, technicalTrend: normalized.trend,
    fundamentalScore: fundNarrative.quality_summary.score,
    calibrationStatus, isLive: executionLive,
    tradabilityHold: warnings.includes("TRADABILITY_HOLD_BIAS")
  });

  const activationIf = [
    normalized.bullishScenario !== "-" ? normalized.bullishScenario : null,
    normalized.keyTrigger !== "-" ? normalized.keyTrigger : null,
    Number.isFinite(adaptiveScore) ? `Raw signal confidence observed at ${Math.round(adaptiveScore)}/100` : "Statistical evidence becomes sufficient"
  ].filter(Boolean).slice(0, 3);

  const qs = fundNarrative.quality_summary;
  const qualityLines = [...qs.drivers.slice(0, 3), ...qs.risks.slice(0, 2)]
    .map((l) => `  • ${l}`).join("\n") || "  • Insufficient fundamental data for quality layer";

  const bs = fundNarrative.balance_sheet_summary;
  const balanceLines = [
    `  • ${bs.institutional_interpretation}`,
    String(bs.leverage_quality || "").toUpperCase() === "UNKNOWN"
      ? "  • Leverage stress: Not assessed due to unavailable balance sheet data"
      : (bs.stress ? "  • Leverage stress indicators active" : "  • No leverage stress detected")
  ].join("\n");

  const gr = fundNarrative.growth_summary;
  const growthLines = gr.lines && gr.lines.length
    ? gr.lines.map((l) => `  • ${l}`).join("\n")
    : "  • Growth data unavailable for this period";

  const vs = fundNarrative.valuation_summary;
  const fb = factorModel.factor_breakdown;
  const governanceBlocked = Boolean(governance?.blocked);
  const growthDataUnavailable = !Number.isFinite(Number(normalized.revenueGrowth)) && !Number.isFinite(Number(normalized.earningsGrowth));
  const fundamentalCoverage = Number(factorModel?.data_coverage?.fundamentals || 0);
  const hasFundamentalCoverage = fundamentalCoverage >= 50;
  const composite = computeCompositeScores({
    factorBreakdown: fb,
    marketOpen,
    marketRegimeState: marketRegime.state,
    replayStatus,
    governanceBlocked
  });
  const technicalSetupScore = composite.technicalSetupScore;
  const analyticalScore = composite.analyticalScore;
  const executionReadiness = composite.executionReadiness;
  const deploymentBlocked = composite.deploymentBlocked;
  const confidenceClass =
    analyticalScore >= 75
      ? "HIGH"
      : analyticalScore >= 55
      ? "MODERATE"
      : "LOW";
  const deploymentState = deploymentBlocked ? "BLOCKED" : "READY";
  const conviction = classifyInstitutionalConfidence(analyticalScore);
  const convictionLabel = conviction.label === "NON-DEPLOYABLE"
    ? "CONDITIONAL — DEPLOYMENT RESTRICTED"
    : conviction.label;
  confidenceDisplay = `${Math.round(analyticalScore)}/100 — ${convictionLabel}`;

  // Rebuild user-facing governance/trace with final public conviction, not raw signal confidence.
  governance = buildGovernanceExplanation({
    replayStatus,
    adaptiveScore: analyticalScore,
    isLive: executionLive,
    tradabilityHold: warnings.includes("TRADABILITY_HOLD_BIAS"),
    eventRisk: warnings.includes("EVENT_RISK_OVERRIDE") ? "HIGH" : "LOW",
    calibrationStatus
  });

  decisionTrace = buildDecisionTrace({
    replayStatus,
    adaptiveScore: analyticalScore,
    technicalTrend: normalized.trend,
    fundamentalScore: fundNarrative.quality_summary.score,
    calibrationStatus,
    isLive: executionLive,
    tradabilityHold: warnings.includes("TRADABILITY_HOLD_BIAS")
  });
  const renderNoZero = false;
  const fmtScore = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "N/A";
    if (renderNoZero && n <= 0) return "N/A";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };
  const fmtContribution = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "N/A";
    if (renderNoZero && n <= 0) return "N/A";
    return String(n);
  };
  const rawVerdict = safeString(normalized.verdict).toUpperCase();
  const longTermLanguage = rawVerdict.includes("LONG-TERM") || rawVerdict.includes("LONG TERM") || rawVerdict.includes("INVEST");
  const weakFundamentalWeight = fb.fundamentals < 10;
  let governedVerdict = deploymentBlocked
    ? "WAIT"
    : (longTermLanguage && weakFundamentalWeight
      ? "CONDITIONAL LONG BIAS — WAIT FOR CONFIRMATION"
      : normalized.verdict);
  if (growthDataUnavailable && /REVENUE GROWTH TURNAROUND/i.test(governedVerdict)) {
    governedVerdict = "WATCHLIST ONLY — WAIT FOR FUNDAMENTAL AND EXECUTION CONFIRMATION";
  }
  const decisionBasis = deploymentBlocked
    ? (analyticalScore < 55
      ? "Accumulation requires final conviction recovery above 55, plus trigger and volume confirmation."
      : `Accumulation requires trigger confirmation above ${normalized.resistance} with volume; reliability/calibration gates still prevent full deployment.`)
    : normalized.tradeAction;
  const deploymentStatus = deploymentBlocked ? "Blocked for full deployment" : "Ready for conditional deployment";
  const confidenceGatePassed = analyticalScore >= 55;
  const reliabilityGatePassed = replayStatus === "AVAILABLE";
  const calibrationGatePassed = calibrationStatus === "AVAILABLE";
  // Default to full dossier unless a caller explicitly requests short mode.
  console.log("[DOSSIER MODE DEBUG]", {
    symbol,
    optionsMode: options?.mode,
    shortModeCandidate: options?.mode === "short"
  });
  const shortMode = options?.mode === "short";
  const blockers = [
    ...(safeArray(governance?.reasons)),
    ...factorModel.negative_drivers
  ].slice(0, 4);
  const primaryReason = blockers[0] || "No material blockers identified";

  if (shortMode) {
    return `
*FINSIGHT AI — SHORT DOSSIER*
━━━━━━━━━━━━━━━━━━
• Renderer: v2.1
• Asset: ${normalized.asset}
• Verdict: ${governedVerdict}
• Conviction: ${confidenceDisplay}
• Watchlist Positioning: Allowed | Capital Deployment: ${deploymentBlocked ? "Blocked" : "Ready"}
• Reason: ${primaryReason}
• Trigger: ${normalized.keyTrigger}
• Stop Loss / Target: ${normalized.stopLoss} / ${normalized.target}
• Main Blockers:
${blockers.length ? blockers.map((b) => `  • ${b}`).join("\n") : "  • None"}
━━━━━━━━━━━━━━━━━━
⚠️ Educational use only. Not financial advice.`.trim();
  }
  const plainEnglishSummary = deploymentBlocked
    ? `${normalized.asset} is showing a possible setup, but full deployment is blocked until execution and reliability gates pass.${hasVerifiedPrice ? "" : " Verified price feed is currently unavailable."}`
    : (noTrade
    ? `${normalized.asset} is not an active trade yet. Execution is blocked until live confirmation conditions are met.`
    : `${normalized.asset} has a tradable setup, but deployment remains conditional on risk and execution checks.`);

  return `
*FINSIGHT AI — INSTITUTIONAL DECISION DOSSIER*
━━━━━━━━━━━━━━━━━━
• Renderer: v2.1
*1) Executive Decision*
• Asset: ${normalized.asset}
• Current Price: ${priceText}
• Market State: ${normalized.marketStatus}
  • System Verdict: ${governedVerdict}
  • Conviction Class: ${confidenceDisplay}
  • Watchlist Positioning: Allowed | Capital Deployment: ${deploymentBlocked ? "Blocked" : "Ready"}
  • Plain-English Summary: ${plainEnglishSummary}
  • Decision Basis: ${decisionBasis}
━━━━━━━━━━━━━━━━━━
*2) Evidence Reliability*
${evidenceConstraint}
• Regime: ${marketRegime.state || "UNKNOWN"} | Sector Bias: ${marketRegime.sectorBias || normalized.sectorBias} | Rel. Strength: ${marketRegime.relativeStrength || normalized.relStrength}
━━━━━━━━━━━━━━━━━━
*3) Trade Activation Conditions*
• Watchlist Positioning: Allowed
• Capital Deployment: ${deploymentBlocked ? "Blocked for full deployment" : "Ready"}
• Final Conviction Gate: ${confidenceGatePassed ? `Passed — ${analyticalScore}/100 above 55` : `Failed — ${analyticalScore}/100 below 55`}
• Reliability Gate: ${reliabilityGatePassed ? "Passed" : "Failed"}
• Calibration Gate: ${calibrationGatePassed ? "Passed" : "Failed"}
• Activation Triggers:
${activationIf.map((x) => `  • ${x}`).join("\n")}
• Stop Loss: ${normalized.stopLoss} | Target: ${normalized.target}
━━━━━━━━━━━━━━━━━━
*4) Weighted Factor Model*
  • Fundamental Weighted Contribution: ${fmtScore(fb.fundamentals)}/35 | Technical Weighted Contribution: ${fmtScore(fb.technicals)}/30
  • Execution: ${fmtScore(fb.execution)}/20 | Reliability/Backtest Layer: ${fmtScore(fb.intelligence)}/15
  • Institutional Completeness Score: ${fmtScore(fb.total)}/100
  • Technical Setup Score: ${fmtScore(technicalSetupScore)}/100
  • Execution Readiness: ${fmtScore(executionReadiness)}/100 | Final Conviction: ${fmtScore(analyticalScore)}/100 — ${confidenceClass} Confidence
  • Confidence Class: ${confidenceClass} | Deployment State: ${deploymentState}
${factorModel.positive_drivers.length ? factorModel.positive_drivers.map((d) => `  ✓ ${d}`).join("\n") : "  ✓ No dominant positive factors"}
${factorModel.negative_drivers.length ? factorModel.negative_drivers.map((d) => `  ✗ ${d}`).join("\n") : "  ✗ No material constraint factors"}
━━━━━━━━━━━━━━━━━━
*5) Signal Attribution*
• Contribution — Technical Trend: ${fmtContribution(contributions.technicalTrend)} | Momentum: ${fmtContribution(contributions.technicalMomentum)}
• Contribution — Sector Alignment: ${fmtContribution(contributions.sectorAlignment)} | Rel. Strength: ${fmtContribution(contributions.relativeStrength)}
• Contribution — Fundamental Quality: ${hasFundamentalCoverage ? fmtContribution(contributions.fundamentalQuality) : "Excluded — insufficient validated data"} | Data Quality: ${hasFundamentalCoverage ? fmtContribution(contributions.dataQuality) : `${fmtContribution(contributions.dataQuality)} — technical/live data only`}
• Penalty — Partial Data: ${fmtContribution(penalties.partialDataPenalty)} | Degraded Exec: ${fmtContribution(penalties.degradedExecutionPenalty)} | Event Risk: ${fmtContribution(penalties.eventRiskPenalty)}
━━━━━━━━━━━━━━━━━━
*6) Institutional Fundamental Intelligence*
• Fundamental Data Coverage: ${fundamentalCoverage}%
${!hasFundamentalCoverage
  ? "• Fundamental Score: Excluded from conviction due to insufficient validated data"
  : `• Fundamental Quality Score: ${qs.score}/100 — ${qs.bias}\n• Institutional Bias: ${qs.class}`}
Quality Layer
${!hasFundamentalCoverage ? "  • Fundamental metrics unavailable or stale for this session window" : qualityLines}
Balance Sheet Layer
${String(bs.leverage_quality || "").toUpperCase() === "UNKNOWN"
  ? "  • Leverage stress: Not assessed due to unavailable balance sheet data"
  : (!hasFundamentalCoverage ? "  • Debt and leverage interpretation deferred until validated data refresh" : balanceLines)}
Growth Layer
${!hasFundamentalCoverage ? "  • Growth interpretation deferred until validated data refresh" : growthLines}
Valuation Layer
  • ${!hasFundamentalCoverage ? "Valuation interpretation deferred due to incomplete data coverage" : (vs.label || "Valuation data unavailable")}
Net Institutional Interpretation
  ${!hasFundamentalCoverage
    ? "Fundamental layer excluded from conviction scoring for this run to prevent misleading inferences from missing data."
    : fundNarrative.institutional_conclusion}
━━━━━━━━━━━━━━━━━━
*7) Decision Trace*
${decisionTrace.map((t) => `• ${t}`).join("\n") || "• Trace data unavailable"}
━━━━━━━━━━━━━━━━━━
*8) Governance & Deployment Gate*
${governance ? governance.formatted : "• No active deployment blocks — conditions conditionally satisfied"}
• Deployment Status: ${deploymentStatus}
• Risk Controls: Stop Loss ${normalized.stopLoss} | Target ${normalized.target}
• Capital Protection State: ${deploymentBlocked ? "DEFENSIVE / WATCHLIST_ONLY" : "CONDITIONAL_DEPLOYMENT"}
━━━━━━━━━━━━━━━━━━
*9) Technical Regime*
• Trend: ${normalized.trend} | Momentum: ${normalized.momentum} | Volume: ${normalized.volume}
• Support: ${normalized.support} | Resistance: ${normalized.resistance}
• Entry Zone: ${normalized.entryZone}
━━━━━━━━━━━━━━━━━━
*10) Final Institutional Verdict*
• Recommendation: ${governedVerdict}
• Conviction: ${confidenceDisplay}
• News Sentiment: ${normalized.sentiment}
━━━━━━━━━━━━━━━━━━
⚠️ Educational use only. Not financial advice.`.trim();
}

// ─────────────────────────────────────────────
// ANALYSIS HELPERS
// ─────────────────────────────────────────────


async function sendTelegramLongMessage(chatId, text, options = {}) {
  const maxLen = 3800;
  const raw = String(text || "");

  if (raw.length <= maxLen) {
    await bot.telegram.sendMessage(chatId, raw, options);
    return;
  }

  const parts = [];
  let remaining = raw;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n━━━━━━━━━━━━━━━━━━", maxLen);
    if (cut < 1000) cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut < 1000) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < 1000) cut = maxLen;

    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) parts.push(remaining);

  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.length > 1 ? `Part ${i + 1}/${parts.length}\n` : "";
    await bot.telegram.sendMessage(chatId, prefix + parts[i], options);
  }
}

async function analyzeSymbolForTelegram(symbol, options = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) {
    throw new Error("SYMBOL_REQUIRED");
  }

  const { stockData } = await buildAnalysisContext(normalizedSymbol);
  console.log("MASTER AGENT CALLED");
  console.log("MESSAGE:", normalizedSymbol);
  const analysisData = await masterAgent(stockData, { strictValidation: true });
  if (!analysisData) {
    console.log("[GLOBAL GUARD] No data at all for", normalizedSymbol);
    throw new Error("DATA_UNAVAILABLE");
  }

  return {
    symbol: normalizedSymbol,
    stockData,
    analysisData,
    formattedText: formatAnalysis(analysisData, normalizedSymbol, stockData, options)
  };
}

function normalizePortfolioAction(action) {
  const upper = safeString(action).trim().toUpperCase();
  if (!upper) return null;
  if (["SELL", "AVOID"].includes(upper)) return "AVOID";
  if (["WAIT", "HOLD", "PENDING_EXECUTION", "WATCH", "BLOCKED"].includes(upper)) return "WAIT";
  if (upper === "BUY") return "BUY";
  return upper;
}

function isDeploymentBlockedFromText(value = "") {
  const text = String(value || "").toUpperCase();
  return (
    text.includes("RECOMMENDATION: WAIT") ||
    text.includes("SYSTEM VERDICT: WAIT") ||
    text.includes("DEPLOYMENT BLOCKED") ||
    text.includes("CAPITAL DEPLOYMENT: BLOCKED") ||
    text.includes("DEPLOYMENT STATUS: BLOCKED") ||
    text.includes("DEPLOYMENT STATE: BLOCKED") ||
    text.includes("WATCHLIST_ONLY") ||
    text.includes("WATCHLIST ONLY") ||
    text.includes("DEFENSIVE / WATCHLIST_ONLY") ||
    text.includes("DEFENSIVE / WATCHLIST ONLY") ||
    text.includes("PENDING_EXECUTION") ||
    text.includes("LOW CONFIDENCE")
  );
}

function normalizeStandaloneActionFromAnalysis(analysisResult = {}) {
  const result = safeObject(analysisResult);
  const decision = safeObject(result.decision);
  const entryTiming = safeObject(result.entryTiming);
  const confidenceEvidence = safeObject(result.confidenceEvidence);
  const warnings = safeArray(confidenceEvidence.warnings).map((item) => safeString(item).toUpperCase());
  const serialized = JSON.stringify(result || {}).toUpperCase();

  const explicitCandidates = [
    result.systemVerdict,
    result.finalVerdict,
    result.verdict,
    decision.finalDecision,
    decision.recommendation,
    result.recommendation,
    result.action,
    result.decision,
    entryTiming.finalExecutionAdvice,
    result?.result?.systemVerdict,
    result?.result?.verdict,
    result?.result?.recommendation
  ].map((value) => safeString(value).trim()).filter(Boolean);

  const explicit = explicitCandidates[0] || "";
  const action = explicit.toUpperCase();
  const executionAdvice = safeString(entryTiming.finalExecutionAdvice).toUpperCase();
  const reasonText = safeString(decision.reason || result.reason || "").toUpperCase();
  const nextStep = safeString(result.nextStep).toUpperCase();

  const deploymentBlocked =
    isDeploymentBlockedFromText(serialized) ||
    action.includes("DEPLOYMENT BLOCKED") ||
    action.includes("WATCHLIST_ONLY") ||
    action.includes("WATCHLIST ONLY") ||
    action.includes("PENDING_EXECUTION") ||
    action.includes("WAIT") ||
    action.includes("HOLD") ||
    executionAdvice.includes("WAIT") ||
    executionAdvice.includes("DEFER") ||
    executionAdvice.includes("GATED") ||
    executionAdvice.includes("NO-TRADE") ||
    executionAdvice.includes("NO TRADE") ||
    reasonText.includes("TRADABILITY_HOLD_BIAS") ||
    warnings.includes("TRADABILITY_HOLD_BIAS") ||
    warnings.includes("NON_EXECUTABLE_LIVE_PRICE") ||
    nextStep.includes("WAIT FOR PRICE CONFIRMATION") ||
    nextStep.includes("WAIT FOR MARKET OPEN");

  if (action.includes("SELL")) {
    return { action: "SELL", deploymentBlocked: false };
  }

  if (action.includes("AVOID")) {
    return { action: "AVOID", deploymentBlocked: false };
  }

  if (deploymentBlocked || action.includes("WAIT") || action.includes("HOLD") || action.includes("PENDING")) {
    return { action: "WAIT", deploymentBlocked: true };
  }

  if (action.includes("BUY")) {
    return { action: "BUY", deploymentBlocked: false };
  }

  return {
    action: normalizePortfolioAction(action),
    deploymentBlocked
  };
}

function extractStandaloneRecommendation(analysisResult, symbol) {
  const result = safeObject(analysisResult);
  const decision = safeObject(result.decision);
  const entryTiming = safeObject(result.entryTiming);
  const risk = safeObject(result.risk);
  const sector = safeObject(result.intelligence?.sector);
  const normalizedVerdict = normalizeStandaloneActionFromAnalysis(result);

  return {
    symbol: String(symbol || "").trim().toUpperCase(),
    action: normalizedVerdict.action,
    deploymentBlocked: normalizedVerdict.deploymentBlocked,
    confidence: Number(
      decision.finalConfidenceScore ||
      decision.confidenceScore ||
      result.confidence ||
      result.finalConviction ||
      result.conviction ||
      0
    ) || null,
    currentPrice: Number(
      result.currentPrice ||
      entryTiming.currentPrice ||
      result.price ||
      0
    ) || null,
    sector: safeString(result.sector || sector.bias || result.sectorBias || "").toUpperCase() || null,
    riskScore: Number(result.riskScore || risk.riskScore || 0) || null
  };
}

function applyStandalonePortfolioGovernance(optimizerResult, standaloneRecommendation, candidateSymbol) {
  const fit = safeObject(optimizerResult);
  const recommendation = safeObject(standaloneRecommendation);
  const action = safeString(recommendation.action).toUpperCase();
  const deploymentBlocked = Boolean(recommendation.deploymentBlocked);
  const symbol = safeString(candidateSymbol || recommendation.symbol || "This stock").toUpperCase();

  if (action === "SELL" || action === "AVOID") {
    return {
      ...fit,
      portfolioFit: "BAD",
      portfolioAction: "AVOID",
      suggestedAllocationPct: null,
      shouldBuySeparately: false,
      shouldBuyForPortfolio: false,
      reason: `${symbol} is not strong enough on standalone analysis, so portfolio action remains defensive.`,
      positives: []
    };
  }

  if (deploymentBlocked || action === "WAIT" || action === "HOLD" || action === "PENDING_EXECUTION" || action === "WATCH") {
    return {
      ...fit,
      portfolioFit: "NEUTRAL",
      portfolioAction: "WATCH",
      suggestedAllocationPct: null,
      shouldBuySeparately: false,
      shouldBuyForPortfolio: false,
      reason: `${symbol} has strong fundamentals, but standalone deployment is currently blocked until activation gates pass.`,
      positives: []
    };
  }

  return fit;
}

function formatSuggestedAllocation(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct <= 0) return "N/A";
  const high = Number((pct + 1).toFixed(0));
  return `${pct.toFixed(0)}-${high}%`;
}

function formatBooleanFlag(value) {
  return value ? "Yes" : "No";
}

function formatPortfolioFitSection({ candidateSymbol, portfolioSymbols = [], optimizerResult, standaloneRecommendation = {} }) {
  const fit = safeObject(optimizerResult);
  const standalone = safeObject(standaloneRecommendation);
  const standaloneAction = safeString(standalone.action).toUpperCase();
  const finalAction = safeString(fit.portfolioAction || fit.portfolioFit || "WATCH").toUpperCase();
  const blockedStandalone = standaloneAction !== "BUY";
  const buySeparately =
    standaloneAction === "BUY" &&
    !["WATCH", "AVOID"].includes(finalAction) &&
    fit.shouldBuySeparately === true;
  const buyForPortfolio =
    standaloneAction === "BUY" &&
    ["ADD", "ADD_SMALL"].includes(finalAction) &&
    fit.shouldBuyForPortfolio === true;
  const suggestedAllocation = blockedStandalone ? "N/A" : formatSuggestedAllocation(fit.suggestedAllocationPct);
  const reason = standaloneAction === "WAIT"
    ? "The standalone dossier is currently WAIT / deployment blocked, so portfolio addition should wait until activation gates pass."
    : safeString(fit.reason || "Portfolio fit could not be calculated safely.");
  const risks = safeArray(fit.risks).slice(0, 2);
  const positives = blockedStandalone ? [] : safeArray(fit.positives).slice(0, 2);
  const lines = [
    "━━━━━━━━━━━━━━━━━━",
    "📌 Portfolio Fit",
    `• Candidate: ${candidateSymbol || "N/A"}`,
    `• Portfolio holdings detected: ${portfolioSymbols.length ? portfolioSymbols.join(", ") : "None"}`,
    `• Portfolio Fit: ${safeString(fit.portfolioFit || "N/A")}`,
    `• Portfolio Action: ${safeString(finalAction || "N/A")}`,
    `• Suggested Allocation: ${suggestedAllocation}`,
    `• Buy separately: ${formatBooleanFlag(buySeparately)}`,
    `• Buy for this portfolio: ${formatBooleanFlag(buyForPortfolio)}`,
    `• Reason: ${reason}`
  ];

  if (risks.length) {
    lines.push(`• Key risks: ${risks.join(" | ")}`);
  }

  if (positives.length) {
    lines.push(`• Positives: ${positives.join(" | ")}`);
  }

  lines.push(`• Final action: ${safeString(finalAction || "WATCH")}`);

  return lines.join("\n");
}

function getCasualReply(text = "") {
  const lower = safeString(text).trim().toLowerCase();
  if (lower.includes("thanks") || lower.includes("thank you")) {
    return "Anytime. Ask about a stock or use /analyze TCS when you're ready.";
  }
  if (lower.includes("good morning") || lower.includes("good evening") || lower.includes("good afternoon")) {
    return "Hello. I can help with stocks, portfolios, and market questions when you need me.";
  }
  return "Hi. Send a stock like TCS or ask something like \"Should I buy TCS?\"";
}


async function performAnalysis(chatId, symbol, footer = "", options = {}) {
  await bot.telegram.sendMessage(chatId, `🔍 Analyzing ${symbol}...\nPulling fundamentals, technicals, and risk profile.`);
  console.log("[ANALYZE]", { symbol });

  const result = await runAnalysisSafe(symbol, async (sym) => {
    const analysis = await analyzeSymbolForTelegram(sym, options);
    return analysis.formattedText;
  });

  if (!result.ok) {
    await bot.telegram.sendMessage(chatId, result.message);
    return;
  }

  // We only get here if result.ok is true and result.text is the formatted analysis.
  // We apply the footer. Because we don't have the full `user` object here,
  // we just append the footer if it's truthy (since the handler already decided if the user gets a footer or not).
  let finalMessage = result.text;
  if (footer) finalMessage += `\n\n${footer}`;

  await sendTelegramLongMessage(chatId, finalMessage);
}

async function sendSubscriptionLink(chatId) {
  const { url, alreadyActive } = await createPaymentLink(chatId.toString());
  if (alreadyActive) {
    await bot.telegram.sendMessage(
      chatId,
      "💎 Your FinSight Pro subscription is already active. Use /status to view renewal details or /cancel to manage it."
    );
    return;
  }
  await bot.telegram.sendMessage(
    chatId,
    `💎 Unlock FinSight Pro
• Unlimited chats
• Full analysis access
• Priority insights
👉 Pay here: ${url}`
  );
}

// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// FREE COMMANDS (no gate)
// ─────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    `👋 Welcome to *FinSight AI*!\n\n` +
    `I'm your institutional-grade stock analysis assistant.\n\n` +
    `🆓 Free Plan: 10 requests / 12h\n` +
    `💎 Upgrade for unlimited:\n` +
    `👉 /subscribe\n\n` +
    `Type /help to see all commands.`,
    { parse_mode: 'Markdown' }
  );
});


bot.command('subscribe', async (ctx) => {
  try {
    await sendSubscriptionLink(ctx.chat.id);
    return;
  } catch (err) {
    console.error('Payment link error:', err.message, err);
    await ctx.reply(`⚠️ Could not generate payment link.\nCheck server logs for details.`);
  }
});

// ─────────────────────────────────────────────
// /cancel COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const activeSession = await getState("portfolio_add_session", chatId);
  console.log("[CANCEL ROUTE]", activeSession?.mode);

  if (activeSession?.mode === "portfolio_add") {
    await deleteState("portfolio_add_session", chatId);
    console.log("[SESSION CANCELLED]", chatId);
    await ctx.reply("Portfolio add session cancelled.");
    return;
  }

  const { data } = await supabase
    .from('subscribers')
    .select('expires_at')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (!data) {
    return ctx.reply('❌ No active subscription found.');
  }

  const expiryDate = data.expires_at
    ? formatIST(data.expires_at)
    : 'Not set';

  return ctx.reply(
    `⚙️ *Cancel Subscription*\n\n` +
    `Your plan is active until: *${expiryDate}*\n\n` +
    `Choose an option:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel Now', 'cancel_now')],
        [Markup.button.callback('⏳ Cancel Later', 'cancel_later')]
      ])
    }
  );
});

// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// /status COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('status, expires_at, cancel_at_period_end, plan, is_pro, subscription_end, razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  const reconciledData = await reconcileSubscriberEntitlement(chatId, data);

  const now = new Date();
  const isActive =
    (reconciledData?.status === 'active' || reconciledData?.status === 'grace') &&
    (reconciledData.expires_at && new Date(reconciledData.expires_at) > now);

  if (!reconciledData || !isActive) {
    return ctx.reply(
      `🆓 *Free Plan*\n\n` +
      `You don't have an active Pro subscription.\n\n` +
      `👉 Type /subscribe to unlock FinSight Pro for ₹599/month.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (reconciledData.status === 'grace') {
    return ctx.reply(
      `⚠️ *Payment Failed*\n\n` +
      `Your subscription is in a 48-hour grace period.\n` +
      `We'll retry the payment automatically.\n` +
      `Update your payment method to avoid interruption.`,
      { parse_mode: 'Markdown' }
    );
  }

  const expiryDate = reconciledData.expires_at
    ? formatIST(reconciledData.expires_at)
    : 'Not set';

  let expiryText = `Expires: ${expiryDate}`;
  let autoRenewText = `Auto-renew: ${reconciledData.cancel_at_period_end ? '❌ Off (cancels at expiry)' : '✅ On'}`;
  
  if (reconciledData.razorpay_subscription_id && !reconciledData.cancel_at_period_end) {
    expiryText = `Renews on: ${expiryDate}`;
    autoRenewText = `Auto-renew: ✅ On`;
  } else if (reconciledData.razorpay_subscription_id) {
    expiryText = `Expires on: ${expiryDate}`;
    autoRenewText = `Auto-renew: ❌ Off`;
  }

  const subIdText = reconciledData.razorpay_subscription_id ? `Sub ID: \`${reconciledData.razorpay_subscription_id}\`\n` : '';

  return ctx.reply(
    `💎 *Pro Active*\n\n` +
    `Plan: ${reconciledData.plan || 'Pro'}\n` +
    `${expiryText}\n` +
    `${autoRenewText}\n` +
    `${subIdText}\n` +
    `Type /cancel to manage your subscription.`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// BUTTON HANDLERS
// ─────────────────────────────────────────────

bot.action('cancel_now', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (data?.razorpay_subscription_id) {
    try {
      await cancelSubscriptionNow(data.razorpay_subscription_id);
    } catch (err) {
      console.error('Razorpay cancel error:', err.message);
    }
  }

  const { error: cancelUpdateError } = await supabase
    .from('subscribers')
    .update({
      is_pro: false,
      status: 'cancelled',
      plan: 'FREE',
      expires_at: null,
      subscription_end: null,
      cancel_at_period_end: false
    })
    .eq('telegram_chat_id', chatId);

  if (cancelUpdateError) {
    console.error('Supabase cancel update error:', cancelUpdateError.message);
    await ctx.answerCbQuery('Cancellation could not be saved.');
    return ctx.reply('⚠️ Cancellation was requested, but we could not update your subscription state. Please try again.');
  }
  
  await ctx.answerCbQuery('Subscription cancelled immediately.');
  return ctx.reply('❌ *Subscription Cancelled*\n\nYou are now on the free plan.', { parse_mode: 'Markdown' });
});

bot.action('cancel_later', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (data?.razorpay_subscription_id) {
    try {
      await cancelSubscriptionLater(data.razorpay_subscription_id);
    } catch (err) {
      console.error('Razorpay update error:', err.message);
    }
  }

  await supabase
    .from('subscribers')
    .update({
      cancel_at_period_end: true
    })
    .eq('telegram_chat_id', chatId);
  
  await ctx.answerCbQuery('Cancellation scheduled for end of billing period.');
  return ctx.reply('✅ Your subscription will continue until expiry and then stop automatically.');
});

// ─────────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ─────────────────────────────────────────────

bot.on("text", async (ctx) => {
  try {
    const chatId = ctx.chat.id.toString();

    const traceId = createTraceId("tg");
    logEvent("telegram.message.received", { traceId, chatId });

    if (!(await canCall(ctx.chat.id))) return;

    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    // ── Single DB fetch ─────────────────────────────────────────────
    let { data: user } = await supabase
      .from("subscribers")
      .select("plan, is_pro, subscription_end, status, expires_at, cancel_at_period_end, razorpay_subscription_id, last_payment_at")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    user = await reconcileSubscriberEntitlement(chatId, user);

    const effectiveExpiry = user?.expires_at || user?.subscription_end || null;
    // Add a 5-minute buffer to expiry checks to prevent race conditions
    // where the webhook is renewing the user at the exact moment they message the bot.
    if (
      user?.plan === "PRO" &&
      effectiveExpiry &&
      new Date(effectiveExpiry).getTime() < Date.now() - (5 * 60 * 1000)
    ) {
      console.log("⚠️ Auto downgrade triggered:", chatId);
      await supabase
        .from("subscribers")
        .update({
          plan: "FREE",
          is_pro: false,
          status: "expired",
          expires_at: null,
          subscription_end: null,
          free_usage_count: 0,
          usage_started_at: new Date()
        })
        .eq("telegram_chat_id", chatId);
      user.plan = "FREE";
      user.is_pro = false;
      user.free_usage_count = 0;
      
      await bot.telegram.sendMessage(
        chatId, 
        "⚠️ *Subscription Expired*\nYour FinSight Pro access has ended. You are now on the Free plan.\n\n👉 /subscribe to renew.",
        { parse_mode: "Markdown" }
      );
    }

    const proUser = isPro(user);

    // ── Usage gate (FREE only) ──────────────────────────────────────
    let usage = { allowed: true, count: 0, reset_time: null };
    if (!proUser) {
      usage = await handleUsage(chatId);
      if (!usage.allowed) {
        if (usage.reason === "USAGE_UNAVAILABLE") {
          await ctx.reply("⚠️ Usage control is temporarily unavailable. Please try again shortly.");
          return;
        }
        const resetIST = new Date(usage.reset_time).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit"
        });
        await ctx.reply(`⛔ Limit reached (10/10)\nYou can chat again at ${resetIST}\n💎 Want unlimited access?\n👉 /subscribe`);
        return; // HARD STOP
      }
    }

    const footer = proUser ? "" : `\n\n📈 Requests: ${usage.count}/10`;

    // Single send helper — all messages pass through buildMessage
    const send = (msg, opts) =>
      bot.telegram.sendMessage(chatId, buildMessage(msg, user, footer), opts);

    const lowerText = text.toLowerCase();

    // ── STRICT COMMAND-FIRST ROUTING (NO AI FALLTHROUGH) ───────────
    const activePortfolioAddSession = await getState("portfolio_add_session", chatId);
    if (text.trim() === "/cancel" && activePortfolioAddSession?.mode === "portfolio_add") {
      console.log("[CANCEL ROUTE]", activePortfolioAddSession?.mode);
      await deleteState("portfolio_add_session", chatId);
      console.log("[SESSION CANCELLED]", chatId);
      await send("Portfolio add session cancelled.");
      return;
    }

    if (activePortfolioAddSession?.mode === "portfolio_add") {
      if (!isValidPositiveInteger(text)) {
        const targetSymbol = activePortfolioAddSession.missingSymbols?.[activePortfolioAddSession.currentIndex] || "current symbol";
        await send(`Please enter a valid positive quantity for ${targetSymbol}.`);
        return;
      }

      const qty = Number(String(text).trim());
      console.log("[PORTFOLIO QTY RECEIVED]", qty);

      const missingSymbols = activePortfolioAddSession.missingSymbols || [];
      const currentIndex = Number(activePortfolioAddSession.currentIndex || 0);
      const currentSymbol = missingSymbols[currentIndex];
      const collected = Array.isArray(activePortfolioAddSession.collected) ? [...activePortfolioAddSession.collected] : [];
      collected.push({ symbol: currentSymbol, quantity: qty });

      const nextIndex = currentIndex + 1;
      if (nextIndex < missingSymbols.length) {
        const nextSession = {
          ...activePortfolioAddSession,
          currentIndex: nextIndex,
          collected
        };
        await putState("portfolio_add_session", chatId, nextSession, 15 * 60);
        await send(`Enter quantity for ${missingSymbols[nextIndex]}:`);
        return;
      }

      const result = await executePortfolioBatchAdd(chatId, collected);
      await deleteState("portfolio_add_session", chatId);
      console.log("[PORTFOLIO SESSION COMPLETE]");

      if (result.successes.length && !result.failures.length) {
        const lines = result.successes.map((s) => `• ${s.symbol} — Qty ${s.quantity}`).join("\n");
        await send(`✅ Added to portfolio:\n${lines}\nPortfolio updated successfully.`);
        return;
      }

      const okBlock = result.successes.length
        ? `✅ Added:\n${result.successes.map((s) => `• ${s.symbol} — Qty ${s.quantity}`).join("\n")}`
        : "";
      const failBlock = result.failures.length
        ? `⚠ Failed:\n${result.failures.map((f) => `• ${f.symbol} — ${f.reason}`).join("\n")}`
        : "";
      await send([okBlock, failBlock].filter(Boolean).join("\n"));
      return;
    }

    if (text.trim().startsWith("/add")) {
      console.log("[PORTFOLIO COMMAND ROUTED]", "add");
      const parsed = parseAddCommand(text);
      console.log("[PORTFOLIO PARSED]", parsed);

      if (!parsed.entries.length && !parsed.errors.length) {
        await send("Usage:\n/add RELIANCE 10\nor\n/add\\nRELIANCE 10\\nTCS 5\\nINFY");
        return;
      }

      const uniqueEntries = [];
      const seen = new Set();
      for (const entry of parsed.entries) {
        if (seen.has(entry.symbol)) continue;
        seen.add(entry.symbol);
        uniqueEntries.push(entry);
      }

      const preset = uniqueEntries.filter((e) => Number.isInteger(e.quantity) && e.quantity > 0);
      const missing = uniqueEntries.filter((e) => !Number.isInteger(e.quantity) || e.quantity <= 0).map((e) => e.symbol);

      if (missing.length > 0) {
        const session = {
          userId: String(chatId),
          mode: "portfolio_add",
          symbols: uniqueEntries.map((e) => e.symbol),
          missingSymbols: missing,
          currentIndex: 0,
          collected: preset
        };
        console.log("[PORTFOLIO SESSION START]", session);
        await putState("portfolio_add_session", chatId, session, 15 * 60);
        await send(`Enter quantity for ${missing[0]}:`);
        return;
      }

      const result = await executePortfolioBatchAdd(chatId, preset);
      const failures = [...parsed.errors.map((e) => ({ symbol: e.symbol || e.input, reason: e.reason })), ...result.failures];

      if (result.successes.length && !failures.length) {
        const lines = result.successes.map((s) => `• ${s.symbol} — Qty ${s.quantity}`).join("\n");
        await send(`✅ Added to portfolio:\n${lines}\nPortfolio updated successfully.`);
        return;
      }

      const okBlock = result.successes.length
        ? `✅ Added:\n${result.successes.map((s) => `• ${s.symbol} — Qty ${s.quantity}`).join("\n")}`
        : "";
      const failBlock = failures.length
        ? `⚠ Failed:\n${failures.map((f) => `• ${f.symbol} — ${f.reason}`).join("\n")}`
        : "";
      await send([okBlock, failBlock].filter(Boolean).join("\n"));
      return;
    }

    if (text.trim().startsWith("/remove")) {
      console.log("[PORTFOLIO COMMAND ROUTED]", "remove");
      const parsed = parseRemoveCommand(text);
      console.log("[PORTFOLIO PARSED]", parsed);

      if (!parsed.symbols.length && !parsed.errors.length) {
        await send("Usage:\n/remove RELIANCE\nor\n/remove\\nRELIANCE\\nTCS\\nINFY");
        return;
      }

      const uniqueSymbols = [...new Set(parsed.symbols)];
      const symbols = uniqueSymbols;
      const { data: existingRows, error: existingErr } = symbols.length
        ? await supabase
            .from("holdings")
            .select("symbol")
            .eq("chat_id", String(chatId))
            .in("symbol", symbols)
        : { data: [], error: null };

      if (existingErr) {
        await send("⚠️ Could not validate holdings right now. Please retry.");
        return;
      }

      const existing = new Set((existingRows || []).map((r) => String(r.symbol || "").toUpperCase()));
      const removed = [];
      const failures = [...parsed.errors.map((e) => ({ symbol: e.symbol || e.input, reason: e.reason }))];

      for (const symbol of uniqueSymbols) {
        if (!existing.has(symbol)) {
          failures.push({ symbol, reason: "Not found" });
          continue;
        }
        try {
          await removeHolding(chatId, symbol);
          removed.push(symbol);
        } catch (err) {
          failures.push({ symbol, reason: err?.message || "Remove failed" });
        }
      }

      const okBlock = removed.length ? `✅ Removed:\n${removed.map((s) => `• ${s}`).join("\n")}` : "";
      const failBlock = failures.length ? `⚠ Failed:\n${failures.map((f) => `• ${f.symbol} — ${f.reason}`).join("\n")}` : "";
      await send([okBlock, failBlock].filter(Boolean).join("\n") || "No symbols processed.");
      return;
    }

    if (text.trim().startsWith("/portfolio")) {
      console.log("[PORTFOLIO COMMAND ROUTED]", "portfolio");
      try {
        const isDetailed = /\/portfolio\s+detailed/i.test(text.trim());
        const dbHoldings = await getPortfolio(chatId);
        if (!dbHoldings?.length) {
          await bot.telegram.sendMessage(chatId, "Your portfolio is empty.\nUse /add to add holdings.");
          return;
        }
        const review = await buildPortfolioReview(dbHoldings);
        const msg = formatPortfolioReview(review, { detailed: isDetailed });
        await bot.telegram.sendMessage(chatId, msg);
      } catch (err) {
        console.error("[PORTFOLIO ERROR]", err);
        await bot.telegram.sendMessage(chatId, "⚠️ Unable to fetch portfolio right now.");
      }
      return;
    }

    if (text.trim().startsWith("/systems")) {
      try {
        const runtime = await getInstitutionalRuntimeSnapshot();
        const lines = [];
        lines.push("🛰 FINSIGHT — INSTITUTIONAL OPERATIONS COMMAND CENTER");
        lines.push("━━━━━━━━━━━━━━━━━━");
        lines.push(`⚙ Infrastructure Status: ${runtime?.queue?.runtimeState || "UNKNOWN"}`);
        lines.push(`📡 Market State: ${runtime?.marketInfra?.marketState || "UNKNOWN"}`);
        lines.push(`🧭 Data Reliability: ${runtime?.marketInfra?.dataReliability || "UNKNOWN"}`);
        lines.push(`🩺 Provider Health Score: ${Number(runtime?.marketInfra?.providerHealthScore || 0)}/100`);
        lines.push(`🧠 Scheduler State: ${runtime?.surveillance?.schedulerState || "UNKNOWN"}`);
        lines.push(`⏱ Last Portfolio Scan: ${runtime?.surveillance?.lastPortfolioScanAgo ?? "NA"}${typeof runtime?.surveillance?.lastPortfolioScanAgo === "number" ? "s ago" : ""}`);
        lines.push("━━━━━━━━━━━━━━━━━━");
        lines.push("🔌 Provider Health");
        (runtime.providers || []).forEach((p) => {
          lines.push(`• ${p.label}: ${p.state} | SR ${Math.round((Number(p.successRate || 0) * 100))}% | ${Number(p.latencyMs || 0)}ms`);
        });
        lines.push("━━━━━━━━━━━━━━━━━━");
        lines.push("🛡 Protection Systems");
        (runtime.systems || []).forEach((s) => {
          lines.push(`• ${s.name}: ${s.state}`);
        });
        lines.push("━━━━━━━━━━━━━━━━━━");
        lines.push(`🗂 Cache Health: ${runtime?.marketInfra?.cacheState || "UNKNOWN"}`);
        lines.push(`🧵 Queue Runtime: ${runtime?.queue?.runtimeState || "UNKNOWN"}`);
        await bot.telegram.sendMessage(chatId, lines.join("\n"));
      } catch (err) {
        console.error("[SYSTEMS ERROR]", err);
        await bot.telegram.sendMessage(chatId, "⚠️ Unable to fetch systems telemetry right now.");
      }
      return;
    }

    if (text.trim().startsWith("/watchlist")) {
      console.log("[PORTFOLIO COMMAND ROUTED]", "watchlist");
      await send("Watchlist command routed. Use /top or /scanner for current opportunities.");
      return;
    }

    // ── /subscribe ─────────────────────────────────────────────────
    if (lowerText === "/subscribe") {
      await sendSubscriptionLink(chatId);
      return;
    }

    // ── /help ──────────────────────────────────────────────────────
    if (lowerText === "/help") {
      await bot.telegram.sendMessage(chatId,
        `🏦 *Finsight AI — Command Menu*\n━━━━━━━━━━━━━━━━━━\n\n` +
        `• /analyze <TICKER> — Full deep-dive report (default)\n• /dossier <TICKER> — Full deep-dive report\n• /quick <TICKER> — Quick trend check\n` +
        `• /compare <T1> <T2> — Side-by-side comparison\n• /top — 🚀 Top market opportunities\n` +
        `• /sector — 📊 Sector rotation report\n• /portfolio — 🏥 Portfolio health\n` +
        `• /systems — 🛰 Infra + telemetry status\n` +
        `• /add <T> <Q> <P> — Add holding\n• /update <T> <Q> <P> — Update holding\n• /remove <T> — Remove holding\n\n` +
        `━━━━━━━━━━━━━━━━━━\n⚠️ Educational purposes only. Not SEBI registered advice.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // ── /dossier ───────────────────────────────────────────────────
    if (lowerText.startsWith("/dossier")) {
      const ticker = text.replace(/^\/dossier\s*/i, "").trim().toUpperCase();
      if (!isValidSymbol(ticker)) { await send("Please enter a valid ticker like TCS, RELIANCE, INFY"); return; }
      await performAnalysis(chatId, ticker, footer, { mode: "full" });
      return;
    }

    // ── /quick ─────────────────────────────────────────────────────
    if (lowerText.startsWith("/quick")) {
      const ticker = text.replace(/^\/quick\s*/i, "").trim().toUpperCase();
      if (!isValidSymbol(ticker)) { await send("Please enter a valid ticker like TCS, RELIANCE, INFY"); return; }
      await bot.telegram.sendMessage(chatId, `⚡ Quick scan: ${ticker}...`);
      try {
        const { stockData } = await buildAnalysisContext(ticker);
        const result = await masterAgent(stockData);
        const quickConfidence = clampPublicConfidence(result.decision?.finalConfidenceScore || 0);
        const msg =
          `⚡ *QUICK VERDICT — ${ticker}*\n\n` +
          `📊 Verdict: ${result.decision?.finalDecision || "HOLD"}\n` +
          `🎯 Confidence: ${quickConfidence}/10\n` +
          `⚠ Risk Level: ${result.risk?.riskLevel || "MEDIUM"}\n\n` +
          `📝 Summary:\n${result.decision?.reason || "No summary available"}`;
        await send(msg, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("[QUICK ERROR]", err);
        await bot.telegram.sendMessage(chatId, "⚠️ Temporary issue. Try again in a moment.");
      }
      return;
    }

    // ── /compare ───────────────────────────────────────────────────
    if (lowerText.startsWith("/compare ")) {
      const parts = text.split(" ");
      if (parts.length < 3) { await send("Example: /compare TCS INFY"); return; }
      const t1 = parts[1].trim().toUpperCase();
      const t2 = parts[2].trim().toUpperCase();
      await bot.telegram.sendMessage(chatId, `⚖ Comparing ${t1} vs ${t2}...`);
      try {
        const [{ stockData: s1 }, { stockData: s2 }] = await Promise.all([
          buildAnalysisContext(t1),
          buildAnalysisContext(t2)
        ]);
        const [r1, r2] = await Promise.all([masterAgent(s1), masterAgent(s2)]);
        const sc1 = clampPublicConfidence(r1.decision?.finalConfidenceScore || 0);
        const sc2 = clampPublicConfidence(r2.decision?.finalConfidenceScore || 0);
        const winner = sc1 >= sc2 ? t1 : t2;
        const msg =
          `⚖ *STOCK COMPARISON*\n\n` +
          `📈 *${t1}*\nVerdict: ${r1.decision?.finalDecision || "HOLD"}\nConfidence: ${sc1}/10\nRisk: ${r1.risk?.riskLevel || "MEDIUM"}\n\n` +
          `📈 *${t2}*\nVerdict: ${r2.decision?.finalDecision || "HOLD"}\nConfidence: ${sc2}/10\nRisk: ${r2.risk?.riskLevel || "MEDIUM"}\n\n` +
          `🏆 Better Opportunity: *${winner}*\n\n⚠️ Educational only. Not SEBI advice.`;
        await send(msg, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("[COMPARE ERROR]", err);
        await bot.telegram.sendMessage(chatId, "❌ Comparison failed. Please check ticker symbols.");
      }
      return;
    }

    // ── /top /scanner ───────────────────────────────────────────────
    if (["/scanner", "/top", "/opportunities"].includes(lowerText)) {
      await bot.telegram.sendMessage(chatId, "🔍 Running Institutional Scanner...\nPlease wait.");
      try {
        const marketState = getMarketStateIST();
        
        // If market is closed, send the long status notice first
        if (!marketState.open) {
          const disclaimer = 
            `⚠️ *MARKET STATUS NOTICE*\n\n` +
            `Indian markets are currently closed.\n` +
            `All prices, institutional flows, volatility models, and scanner outputs are based on the latest available closing-session data and post-close processing.\n\n` +
            `Intraday confirmations, liquidity shifts, breakout validations, and institutional participation strength can materially change after the next market open.\n\n` +
            `Finsight AI does not execute trades automatically. All signals, watchlists, and institutional intelligence outputs are probabilistic decision-support insights and should be independently validated before taking any trading or investment action.`;
          await bot.telegram.sendMessage(chatId, disclaimer, { parse_mode: "Markdown" });
        }

        const opportunities = await scannerAgent();
        const safeOpportunities = Array.isArray(opportunities)
          ? opportunities
          : (opportunities?.recommendations || []);
        const approvedSignals = safeOpportunities.filter((signal) => {
          if (signal?.approved !== true) return false;
          return validateSignal(signal).approved;
        });
        
        let confidenceTag = marketState.tag;
        const noValidSetups = safeOpportunities.length === 1 && safeOpportunities[0]?.status === "NO_VALID_SETUPS";

        // Post-market fallback: show last signal from DB
        const isPostMarket = opportunities?.status === "POST_MARKET_CONTEXT";
        const lastSignal = opportunities?.lastSignal;

        if (isPostMarket && lastSignal) {
          const now = new Date();

          const istNow = new Date(
            now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
          );

          const marketClose = new Date(istNow);
          marketClose.setHours(15, 30, 0, 0);

          const signalAge = Math.max(
            1,
            Math.round((istNow - marketClose) / (1000 * 60 * 60))
          );

          const msg =
            `🏛 *FINSIGHT ELITE FLOW TERMINAL*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Confidence State: ${confidenceTag}\n\n` +
            `📌 *Last Signal — ${signalAge}h ago*\n\n` +
            `*${lastSignal.symbol}* — ${lastSignal.action}\n` +
            `Confidence: ${lastSignal.confidence}%\n` +
            `R/R: ${lastSignal.rr_ratio}\n` +
            `Entry: ₹${lastSignal.entry_price}\n` +
            `Stop Loss: ₹${lastSignal.stop_loss}\n` +
            `Target: ₹${lastSignal.target_price}\n\n` +
            `_${lastSignal.ai_summary || ""}_\n\n` +
            `⚠️ Market closed. Signal from last trading session.\n` +
            `Not SEBI registered investment advice.`;

          await send(msg, { parse_mode: "Markdown" });
          return;
        }

        if (!safeOpportunities || !safeOpportunities.length || noValidSetups || approvedSignals.length === 0) {
          confidenceTag = marketState.tag;
          let msg =
            `🏛 *FINSIGHT ELITE FLOW TERMINAL*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Confidence State: ${confidenceTag}\n\n` +
            `No institutional-grade opportunities available right now.\n` +
            `All scanned setups failed elite guardrails (R/R, momentum, participation, or risk structure).\n` +
            `Capital preservation mode active.`;
          await send(msg, { parse_mode: "Markdown" });
          return;
        }
        let msg = formatInstitutionalScannerReport(approvedSignals);
        msg += "\n\n⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
        await send(msg, { parse_mode: "Markdown" });
      } catch (err) { 
        console.error("[SCANNER ERROR]", err); 
        await bot.telegram.sendMessage(chatId, "⚠️ Scanner temporarily unavailable."); 
      }
      return;
    }

    // ── /sector ────────────────────────────────────────────────────
    if (["/sector", "/sectors", "/rotation"].includes(lowerText)) {
      await bot.telegram.sendMessage(chatId, "📊 Running Sector Rotation Scanner...");
      try {
        const marketState = getMarketStateIST();
        const sectors = await sectorScannerAgent();
        if (!sectors?.length) { await bot.telegram.sendMessage(chatId, "No sector data available right now."); return; }
        let msg = "";
        if (!marketState.open) {
          msg += `*Market Closed • Signals generated using latest available market data. Final trade confirmation requires live market validation after open.*\n\n`;
        }
        msg += `📊 *SECTOR ROTATION REPORT*\n🛡️ *Confidence State: ${marketState.tag}*\n\n`;
        sectors.slice(0, 5).forEach((item, i) => { msg += `#${i+1} *${item.sector}*\n🏆 Strength Score: ${item.avgScore}/10\n\n`; });
        msg += "⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
        await send(msg, { parse_mode: "Markdown" });
      } catch (err) { console.error("[SECTOR ERROR]", err); await bot.telegram.sendMessage(chatId, "⚠️ Sector scanner temporarily unavailable."); }
      return;
    }

    // ── Portfolio update command (non-batch) ───────────────────────
    if (lowerText.startsWith("/update ")) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await send("Usage: /update TICKER QUANTITY PRICE"); return; }
      const symbol = parts[1].toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);
      if (isNaN(quantity) || isNaN(avgPrice)) { await send("❌ Invalid quantity or price."); return; }
      try {
        await updateHolding(chatId, symbol, { quantity, avg_price: avgPrice, updated_at: new Date() });
        await send(`🔄 Holding Updated\n📈 Stock: ${symbol}\n📦 New Qty: ${quantity}\n💰 New Avg Price: ₹${avgPrice}`);
      } catch (err) { await bot.telegram.sendMessage(chatId, `❌ Error: ${err.message}`); }
      return;
    }

    // ── AWAITING_STOCK state ────────────────────────────────────────
    const pendingAnalyzeState = await consumeState("telegram_flow", chatId);
    if (pendingAnalyzeState?.state === "AWAITING_STOCK") {
      const rawTicker = text.trim().toUpperCase();
      const syntaxCheck = validateTickerSyntax(rawTicker);
      if (!syntaxCheck.valid) {
        await send("Please enter a valid NSE ticker like TCS, RELIANCE, or INFY.");
        return;
      }
      await performAnalysis(chatId, syntaxCheck.cleanTicker, footer, { mode: "full" });
      return;
    }

    // ── Core intent routing via parseInput ──────────────────────────
    const intent = parseInput(text);

    if (intent.type === "analyze") {
      if (!intent.symbol) {
        await putState("telegram_flow", chatId, { state: "AWAITING_STOCK" }, ANALYZE_STATE_TTL_SECONDS);
        await bot.telegram.sendMessage(chatId, "Please enter the stock ticker (e.g. TCS, RELIANCE)");
        return;
      }

      // ── LAYER 1: Syntax validation (regex only, zero I/O) ──────────────────
      const syntaxResult = validateTickerSyntax(intent.symbol);
      if (!syntaxResult.valid) {
        await send(
          `⚠️ *${intent.symbol}* is not a valid NSE ticker format.\n` +
          `Please enter a ticker like *TCS*, *RELIANCE*, or *INFY*.`
        );
        return;
      }

      const cleanTicker = normalizeTickerAlias(syntaxResult.cleanTicker);

      // ── LAYER 2: Symbol existence (overview/registry, NO live price needed) ─
      const existenceResult = await checkSymbolExistence(cleanTicker, { getCompanyOverview });

      if (existenceResult.state === EXISTENCE_STATE.UNKNOWN) {
        // We could not confirm existence (either due to provider outage or truly invalid).
        // FAIL-OPEN: Let it proceed. Layer 3 and Layer 4 will catch it if there's no price.
        console.warn(`[VALIDATION] Symbol ${cleanTicker} returned UNKNOWN existence. Allowing to proceed to Layer 3.`);
      } else if (existenceResult.state === EXISTENCE_STATE.REGISTRY_ERROR) {
        // System error during lookup. Fail open to prevent blocking.
        console.warn(`[VALIDATION] Registry error for ${cleanTicker}. Allowing to proceed.`);
      }

      // If REGISTRY_ERROR — we cannot confirm non-existence, so allow through
      // with a note. Do NOT block valid tickers due to registry lookup failures.

      // ── LAYER 3: Market availability (provider health, separate from existence) ─
      const availabilityResult = await checkMarketAvailability(cleanTicker, { getLiveMarketData });

      if (availabilityResult.availability === MARKET_AVAILABILITY.PROVIDER_UNAVAILABLE) {
        // Try stale cache data from the live result before hard-failing
        const liveData = availabilityResult.liveData || {};
        const cacheTs = Number(liveData.timestamp || 0);
        const ageSeconds = cacheTs > 0 ? Math.floor((Date.now() - cacheTs) / 1000) : Infinity;
        const isMarketOpen = liveData.marketStatus?.isMarketOpen ?? false;
        const stalePriceExists = Number(liveData.currentPrice || liveData.price || 0) > 0;

        if (stalePriceExists && ageSeconds < Infinity) {
          // Stale data exists — evaluate if it's acceptable under governance
          const { buildStaleCachePolicy, buildDataStateMessage } = await import("./dataAvailability.service.js");
          const policy = buildStaleCachePolicy({ cacheAgeSeconds: ageSeconds, isMarketOpen });
          if (policy.acceptable) {
            const stateMsg = buildDataStateMessage(policy.state, {
              symbol: cleanTicker,
              cacheAgeMinutes: Math.round(ageSeconds / 60)
            });
            if (stateMsg) await send(stateMsg);
            // Proceed with degraded analysis using stale data
            await performAnalysis(chatId, cleanTicker, footer, { mode: "full" });
            return;
          }
        }

        // No usable data at all — show institutional unavailability message
        await send(
          `*FINSIGHT DATA NOTICE*\n` +
          `${cleanTicker} could not be analyzed right now because live market data could not be validated.\n` +
          `Reason:\n` +
          `• Yahoo provider cooling down\n` +
          `• Alpha/Finnhub/TwelveData returned unusable quote data\n` +
          `• No valid price confirmed\n` +
          `Action:\n` +
          `Try again shortly or use another ticker.\n` +
          `No trade verdict generated because price validation failed.`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // ── LAYER 4 is enforced inside performAnalysis via validateAnalysisReadiness() ─
      // Proceed to analysis — availability is LIVE or DEGRADED (acceptable).
      await performAnalysis(chatId, cleanTicker, footer, { mode: "full" });
      return;
    }

    // ── Natural-language routing for non-command messages ───────────
    if (!text.startsWith("/")) {
      const routed = classifyUserIntent(text);
      logEvent("telegram.intent_routed", {
        intent: routed.intent,
        candidateSymbol: routed.candidateSymbol,
        portfolioSymbols: routed.portfolioSymbols,
        requiresFinancialData: routed.requiresFinancialData
      });

      if (routed.intent === "CASUAL_CHAT") {
        await send(getCasualReply(text));
        return;
      }

      if (routed.intent === "STOCK_ANALYSIS" && routed.candidateSymbol) {
        const symbol = normalizeTickerAlias(routed.candidateSymbol);
        await bot.telegram.sendMessage(chatId, `🔍 Analyzing ${symbol}...\nPulling fundamentals, technicals, and risk profile.`);

        const analysisResult = await runAnalysisSafe(symbol, async (sym) => {
          const analysis = await analyzeSymbolForTelegram(sym);
          return analysis.formattedText;
        });

        if (!analysisResult.ok) {
          await send(`I could not complete live analysis for ${symbol} right now. Please try /analyze ${symbol}.`);
          return;
        }

        let finalMessage = analysisResult.text;
        if (footer) finalMessage += `\n\n${footer}`;
        await sendTelegramLongMessage(chatId, finalMessage);
        return;
      }

      if (routed.intent === "PORTFOLIO_OPTIMIZATION" && routed.candidateSymbol) {
        const symbol = normalizeTickerAlias(routed.candidateSymbol);
        const portfolio = safeArray(routed.extractedPortfolio)
          .map((holding) => ({
            symbol: safeString(holding?.symbol).toUpperCase()
          }))
          .filter((holding) => holding.symbol);

        await bot.telegram.sendMessage(chatId, `🔍 Analyzing ${symbol}...\nPulling fundamentals, technicals, and risk profile.`);

        const analysisResult = await runAnalysisSafe(symbol, async (sym) => analyzeSymbolForTelegram(sym));

        if (!analysisResult.ok) {
          await send(`I could not complete live analysis for ${symbol} right now. Please try /analyze ${symbol}.`);
          return;
        }

        const analysisPayload = analysisResult.text;
        let finalMessage = analysisPayload.formattedText;

        try {
          const standaloneRecommendation = extractStandaloneRecommendation(analysisPayload.analysisData, symbol);
          const optimizerResult = await optimizePortfolioCandidate({
            candidateSymbol: symbol,
            portfolio,
            standaloneRecommendation
          });
          const governedOptimizerResult = applyStandalonePortfolioGovernance(
            optimizerResult,
            standaloneRecommendation,
            symbol
          );

          finalMessage += `\n\n${formatPortfolioFitSection({
            candidateSymbol: symbol,
            portfolioSymbols: routed.portfolioSymbols,
            optimizerResult: governedOptimizerResult,
            standaloneRecommendation
          })}`;
        } catch (optimizerError) {
          logError("telegram.portfolio_optimizer.error", optimizerError, {
            chatId,
            candidateSymbol: symbol
          });
          finalMessage += "\n\n━━━━━━━━━━━━━━━━━━\n📌 Portfolio Fit\nPortfolio fit could not be calculated safely.";
        }

        if (footer) finalMessage += `\n\n${footer}`;
        await sendTelegramLongMessage(chatId, finalMessage);
        return;
      }

      if (routed.intent === "PORTFOLIO_REVIEW") {
        await send("Portfolio review is available through /portfolio while natural-language portfolio review is being connected.");
        return;
      }

      if (routed.intent === "MARKET_OVERVIEW") {
        const overviewText = await buildMarketOverviewText();
        await send(overviewText, { parse_mode: "Markdown" });
        return;
      }

      if (routed.intent === "MACRO_QUERY") {
        const lowerText = text.toLowerCase();
        const isIndexQuery =
          lowerText.includes("nifty") ||
          lowerText.includes("sensex") ||
          lowerText.includes("banknifty") ||
          lowerText.includes("bank nifty") ||
          lowerText.includes("market") ||
          routed.symbols.includes("NIFTY") ||
          routed.symbols.includes("SENSEX") ||
          routed.symbols.includes("BANKNIFTY");

        if (isIndexQuery) {
          const overviewText = await buildMarketOverviewText();
          await send(overviewText, { parse_mode: "Markdown" });
          return;
        }

        await send("Market overview is available through /sector, /scanner, or your existing macro flow while natural-language market routing is being connected.");
        return;
      }
    }

    // ── Chat fallback ───────────────────────────────────────────────
    const financeIntent =
      /(portfolio|invest|allocation|allocate|stock|shares|price|buy|sell|market|nifty|sensex|₹\d+|rsi|scanner|news|holdings)/i.test(text);
    if (financeIntent) {
      const orchestrated = await processNaturalLanguage(text, chatId, []);
      const nlResponse = safeString(orchestrated?.response || "").trim();
      if (nlResponse) {
        await send(nlResponse);
        return;
      }
      const result = await masterAgent({
        mode: "conversation",
        userQuery: text,
        chatId
      });
      await send(result?.response || "Unable to process finance query right now.");
      return;
    }

    let reply = "";
    try {
      reply = await generateChatReply(chatId, text);
    } catch (err) {
      console.error("[CHAT FAIL]", err);
      reply = "Ask me about any stock or market — I'll break it down.";
    }
    await send(reply, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("Telegram Bot Error:", error);
    await ctx.reply("⚠️ Temporary issue processing your request. Please try again in a moment.");
  }
});

// ─────────────────────────────────────────────
// START BOT
// ─────────────────────────────────────────────

export const startBot = () => {
  if (botSupervisorStarted) {
    console.log("⚠️ Bot supervisor already initialized. Skipping...");
    return;
  }
  botSupervisorStarted = true;

  const ensureLease = async () => {
    if (botLaunchInFlight) return;

    try {
      const claimed = await claimSchedulerLease(BOT_LEASE_NAME, BOT_LEASE_TTL_SECONDS);
      if (!claimed) {
        if (botLeaseOwner) {
          logEvent("telegram.bot.lease.lost", { ownerId: BOT_INSTANCE_ID });
          stopBot();
        }
        botLeaseOwner = false;
        return;
      }

      if (!botLeaseOwner) {
        logEvent("telegram.bot.lease.claimed", { ownerId: BOT_INSTANCE_ID });
      }
      botLeaseOwner = true;

      await launchBotIfNeeded("lease");

      if (!botHeartbeatTimer) {
        botHeartbeatTimer = setInterval(async () => {
          try {
            const renewed = await renewSchedulerLease(BOT_LEASE_NAME, BOT_LEASE_TTL_SECONDS);
            if (!renewed) {
              logEvent("telegram.bot.lease.renew_failed", { ownerId: BOT_INSTANCE_ID });
              stopBot();
              botLeaseOwner = false;
            }
          } catch (error) {
            logError("telegram.bot.lease.heartbeat_error", error, { ownerId: BOT_INSTANCE_ID });
            stopBot();
            botLeaseOwner = false;
          }
        }, BOT_LEASE_HEARTBEAT_MS);
      }
    } catch (error) {
      logError("telegram.bot.lease.claim_error", error, { ownerId: BOT_INSTANCE_ID });
      setTelegramDegraded("lease_claim_error");
      scheduleBotLaunchRetry("lease_claim_error");
      if (!TELEGRAM_LEASE_REQUIRED) {
        await launchBotIfNeeded("fallback");
      }
    }
  };

  ensureLease();
  botSupervisorTimer = setInterval(ensureLease, BOT_LEASE_RETRY_MS);
  console.log("✅ Telegram Bot Supervisor Started");
};

export const stopBot = () => {
  if (botLaunchRetryTimer) {
    clearTimeout(botLaunchRetryTimer);
    botLaunchRetryTimer = null;
  }
  if (botHeartbeatTimer) {
    clearInterval(botHeartbeatTimer);
    botHeartbeatTimer = null;
  }

  if (botStarted) {
    bot.stop("LEASE_LOST");
    botStarted = false;
    logEvent("telegram.bot.stopped", {
      ownerId: BOT_INSTANCE_ID,
      mode: botStartedInFallbackMode ? "fallback" : "lease"
    });
  }
  telegramRuntimeState.connected = false;
  telegramRuntimeState.degradedMode = true;
  botStartedInFallbackMode = false;
};

export const shutdownBotSupervisor = async () => {
  if (botSupervisorTimer) {
    clearInterval(botSupervisorTimer);
    botSupervisorTimer = null;
  }
  botSupervisorStarted = false;
  stopBot();
  if (botLeaseOwner) {
    try {
      await releaseSchedulerLease(BOT_LEASE_NAME);
    } catch (error) {
      logError("telegram.bot.lease.release_error", error, { ownerId: BOT_INSTANCE_ID });
    }
  }
  botLeaseOwner = false;
};

process.once("SIGINT", () => {
  shutdownBotSupervisor().finally(() => {
    try { bot.stop("SIGINT"); } catch (_) {}
  });
});
process.once("SIGTERM", () => {
  shutdownBotSupervisor().finally(() => {
    try { bot.stop("SIGTERM"); } catch (_) {}
  });
});

export default bot;
export function getTelegramRuntimeState() {
  return { ...telegramRuntimeState };
}
