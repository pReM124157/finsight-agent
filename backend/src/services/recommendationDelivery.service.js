import supabase from "./supabase.service.js";
import bot, { getTelegramRuntimeState } from "./telegram.service.js";
import { logError, logEvent } from "./telemetry.service.js";
import { formatRecommendation } from "./telegramFormatter.service.js";

const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 15;
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 120000];

export const DELIVERY_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  FAILED: "FAILED",
  RETRY_SCHEDULED: "RETRY_SCHEDULED",
  SUPPRESSED: "SUPPRESSED"
};

const CLAIMABLE_DELIVERY_STATUSES = [
  DELIVERY_STATUS.PENDING,
  DELIVERY_STATUS.RETRY_SCHEDULED,
  DELIVERY_STATUS.FAILED
];

function nextRetryDelayMs(attempts) {
  const idx = Math.max(0, Math.min(Number(attempts || 0), RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[idx];
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function isValidTelegramToken(value) {
  return typeof value === "string" && /^\d+:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

function isValidTelegramChatId(value) {
  if (value === null || value === undefined) return false;
  return /^-?\d+$/.test(String(value).trim());
}

function buildNoTradeReason(action, confidence) {
  return `Verdict ${action || "HOLD"} at confidence ${Number.isFinite(confidence) ? confidence : "NA"}/100`; 
}

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Market price pending";
  return `₹${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.00$/, "")}`;
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "NA";
  return `${Math.round(n)}%`;
}

function formatRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "NA";
  return n.toFixed(2).replace(/\.00$/, "");
}

function inferExchange(row) {
  if (row.exchange && String(row.exchange).trim()) return String(row.exchange).trim().toUpperCase();
  const symbol = String(row.symbol || "").trim().toUpperCase();
  if (symbol.endsWith(".NS")) return "NSE";
  if (symbol.endsWith(".BO")) return "BSE";
  return "NSE";
}

function inferTrend(row) {
  return row?.reasoning_snapshot?.technical?.trend
    || row?.indicator_snapshot?.trend
    || row?.market_snapshot?.trend
    || (String(row.action || row.recommendation_type || "HOLD").toUpperCase() === "BUY" ? "Bullish" : "Neutral");
}

function inferMomentum(row) {
  return row?.reasoning_snapshot?.technical?.momentum
    || row?.indicator_snapshot?.momentum
    || row?.market_snapshot?.momentum
    || (String(row.action || row.recommendation_type || "HOLD").toUpperCase() === "BUY" ? "Strong" : "Measured");
}

function inferVolume(row) {
  return row?.reasoning_snapshot?.technical?.volume
    || row?.indicator_snapshot?.volumeTrend
    || row?.market_snapshot?.volumeTrend
    || "Above Average";
}

function parseDeliveredSubscriberMap(value) {
  if (!value || typeof value !== "string") return new Map();
  if (!value.includes(":")) return new Map();

  return new Map(
    value
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf(":");
        if (separator <= 0) return null;
        const chatId = entry.slice(0, separator).trim();
        const messageId = entry.slice(separator + 1).trim();
        if (!chatId) return null;
        return [chatId, messageId || "ACK"];
      })
      .filter(Boolean)
  );
}

function serializeDeliveredSubscriberMap(map) {
  return Array.from(map.entries())
    .map(([chatId, messageId]) => `${chatId}:${messageId || "ACK"}`)
    .join("|");
}

function toIsoOrNull(value) {
  const ts = value ? new Date(value) : null;
  if (!ts || Number.isNaN(ts.getTime())) return null;
  return ts.toISOString();
}

function computeLatencyMs(from, to = Date.now()) {
  const start = from ? new Date(from).getTime() : NaN;
  return Number.isFinite(start) ? Math.max(0, to - start) : null;
}

async function fetchActiveSubscriberChatIds(row = null) {
  console.log("=== FETCHING SUBSCRIBERS ===");
  const { data: subscribers, error } = await supabase
    .from("subscribers")
    .select("telegram_chat_id,status,preferred_risk,preferred_sectors")
    .eq("status", "active");

  if (error) throw error;

  const filteredSubscribers = (subscribers || []).filter(sub => {
    // 1. Risk filtering
    if (sub.preferred_risk && row) {
      const prefRisk = sub.preferred_risk.toUpperCase();
      const recRiskScore = row.risk_score != null ? Number(row.risk_score) : null;
      if (recRiskScore !== null) {
        if (prefRisk === "LOW" && recRiskScore > 3) return false;
        if (prefRisk === "MEDIUM" && recRiskScore > 6) return false;
      }
    }
    
    // 2. Sector filtering
    if (sub.preferred_sectors && Array.isArray(sub.preferred_sectors) && sub.preferred_sectors.length > 0 && row) {
      const recSector = String(row.sector || "").toLowerCase().trim();
      const match = sub.preferred_sectors.some(sec => String(sec || "").toLowerCase().trim() === recSector);
      if (!match) return false;
    }
    
    return true;
  });

  const chatIds = Array.from(new Set(
    filteredSubscribers
      .map((subscriber) => String(subscriber?.telegram_chat_id || "").trim())
      .filter((chatId) => isValidTelegramChatId(chatId))
  ));

  console.log("=== SUBSCRIBERS FETCHED ===");
  console.log("Subscribers found:", chatIds.length);
  console.log("=== ACTIVE SUBSCRIBERS ===");
  console.log(chatIds.length);

  return chatIds;
}

export async function fetchPendingRecommendations({ batchSize = DEFAULT_BATCH_SIZE } = {}) {
  const { data, error } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,symbol,exchange,recommendation_type,action,confidence,conviction,entry_price,stop_loss,target_price,rr_ratio,horizon,sector,risk_score,ai_summary,reasoning_snapshot,indicator_snapshot,market_snapshot,telegram_chat_id,created_at,telegram_delivery_status,telegram_delivery_attempts,telegram_delivery_last_attempt,telegram_delivery_error,telegram_delivery_message_id")
    .in("telegram_delivery_status", CLAIMABLE_DELIVERY_STATUSES)
    .lte("telegram_delivery_attempts", MAX_ATTEMPTS - 1)
    .order("created_at", { ascending: false })
    .limit(Math.max(batchSize * 3, 30));

  if (error) throw error;

  const now = Date.now();
  const filtered = (data || []).filter((row) => {
    if (
      row.telegram_delivery_status === DELIVERY_STATUS.SENT ||
      row.telegram_delivery_status === "SENT"
    ) {
      return false;
    }

    if (
      row.telegram_delivery_status === DELIVERY_STATUS.PENDING ||
      row.telegram_delivery_status === "PENDING" ||
      row.telegram_delivery_status === undefined
    ) {
      return true;
    }
    const attempts = Number(row.telegram_delivery_attempts || 0);
    const lastAttemptTs = row.telegram_delivery_last_attempt ? new Date(row.telegram_delivery_last_attempt).getTime() : 0;
    const dueAt = lastAttemptTs + nextRetryDelayMs(attempts);
    return now >= dueAt;
  });

  const batch = filtered.slice(0, batchSize);
  for (const row of batch) {
    console.log("=== DELIVERY ELIGIBILITY ===");
    console.log({
      recommendationId: row.recommendation_id,
      telegram_delivery_status: row.telegram_delivery_status,
      telegram_delivery_attempts: row.telegram_delivery_attempts
    });
  }
  logEvent("recommendation.delivery.stage", {
    stage: "FETCHED",
    fetched: batch.length,
    total_candidates: filtered.length
  });
  return batch;
}

async function claimRecommendationForDelivery(row) {
  const attempts = Number(row.telegram_delivery_attempts || 0);
  const claimedAt = new Date().toISOString();
  const nextAttempts = Math.min(attempts + 1, MAX_ATTEMPTS);
  const currentStatus = row.telegram_delivery_status || DELIVERY_STATUS.PENDING;

  let query = supabase
    .from("recommendation_audit")
    .update({
      telegram_delivery_status: DELIVERY_STATUS.RETRY_SCHEDULED,
      telegram_delivery_attempts: nextAttempts,
      telegram_delivery_last_attempt: claimedAt,
      telegram_delivery_error: null,
      updated_at: claimedAt
    })
    .eq("recommendation_id", row.recommendation_id)
    .eq("telegram_delivery_attempts", attempts);

  if (currentStatus) {
    query = query.eq("telegram_delivery_status", currentStatus);
  }

  const { data, error } = await query.select();
  if (error) throw error;

  if (!Array.isArray(data) || data.length === 0) {
    console.log("=== DUPLICATE DELIVERY SUPPRESSED ===");
    console.log({
      recommendationId: row.recommendation_id,
      telegram_delivery_status: row.telegram_delivery_status,
      telegram_delivery_attempts: attempts
    });
    return null;
  }

  return {
    ...row,
    telegram_delivery_status: DELIVERY_STATUS.RETRY_SCHEDULED,
    telegram_delivery_attempts: nextAttempts,
    telegram_delivery_last_attempt: claimedAt,
    telegram_delivery_error: null
  };
}

function isTestRecommendation(row = {}) {
  const haystack = [
    row.ai_summary,
    row.reasoning_snapshot?.reason,
    row.provider_metadata?.source,
    row.generated_by,
    row.analysis_version,
    row.conviction,
    row.recommendation_id
  ]
    .filter(Boolean)
    .map((value) => {
      try {
        return typeof value === "string" ? value : JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ")
    .toUpperCase();

  return (
    haystack.includes("TEST ONLY") ||
    haystack.includes("CONTROLLED RECOMMENDATION DELIVERY VERIFICATION") ||
    haystack.includes("MANUAL:TEST-RECOMMENDATION-DELIVERY-SEND") ||
    haystack.includes("MANUAL.TEST.ROUTE") ||
    haystack.includes("TEST_SIGNAL") ||
    haystack.includes("TEST-REC-") ||
    haystack.includes("COPILOT.DELIVERY") ||
    haystack.includes("PRODUCTION.DELIVERY.VERIFICATION") ||
    haystack.includes("DELIVERY.VERIFY") ||
    haystack.includes("DELIVERY VERIFICATION")
  );
}

export function evaluateRecommendationEligibility(row, { runtimeState } = {}) {
  if (!row || typeof row !== "object") {
    return { eligible: false, suppressionReason: "MALFORMED_RECOMMENDATION" };
  }

  if (
    process.env.ALLOW_TEST_RECOMMENDATION_DELIVERY !== "true" &&
    isTestRecommendation(row)
  ) {
    return { eligible: false, suppressionReason: "TEST_RECOMMENDATION_BLOCKED" };
  }
  if (!row.recommendation_id) {
    return { eligible: false, suppressionReason: "MISSING_RECOMMENDATION_ID" };
  }
  if (!row.symbol || !String(row.symbol).trim()) {
    return { eligible: false, suppressionReason: "MISSING_SYMBOL" };
  }
  const confidence = toSafeNumber(row.confidence);
  const action = String(
    row.action || row.recommendation_type || ""
  ).toUpperCase();

  if (action === "PENDING_EXECUTION" && process.env.ALLOW_PENDING_EXECUTION_DELIVERY !== "true") {
    return { eligible: false, suppressionReason: "PENDING_EXECUTION_DELIVERY_BLOCKED" };
  }

  if (action !== "BUY" && action !== "SELL" && action !== "PENDING_EXECUTION") {
    return { eligible: false, suppressionReason: "NON_ACTIONABLE_RECOMMENDATION" };
  }

  if (!Number.isFinite(confidence)) {
    return { eligible: false, suppressionReason: "INVALID_CONFIDENCE" };
  }
  if (row.telegram_delivery_status === DELIVERY_STATUS.SENT) {
    return { eligible: false, suppressionReason: "DUPLICATE_DELIVERY" };
  }
  if (!isValidTelegramToken(process.env.TELEGRAM_BOT_TOKEN)) {
    return { eligible: false, suppressionReason: "INVALID_TELEGRAM_BOT_TOKEN" };
  }
  if (runtimeState && runtimeState.connected === false && runtimeState.degradedMode !== true) {
    return { eligible: false, suppressionReason: "INVALID_TELEGRAM_STATE" };
  }
  return { eligible: true, suppressionReason: null };
}

export function buildRecommendationTelegramMessage(row) {
  return formatRecommendation(row);
}

async function updateDeliveryState(recommendationId, payload) {
  const { error } = await supabase
    .from("recommendation_audit")
    .update({
      ...payload,
      updated_at: new Date().toISOString()
    })
    .eq("recommendation_id", recommendationId);
  if (error) throw error;
}

async function markSuppressed(row, suppressionReason, attempts) {
  await updateDeliveryState(row.recommendation_id, {
    telegram_delivery_status: DELIVERY_STATUS.SUPPRESSED,
    telegram_delivery_attempts: attempts,
    telegram_delivery_last_attempt: new Date().toISOString(),
    telegram_delivery_error: suppressionReason
  });
  logEvent("recommendation.delivery.suppressed", {
    recommendationId: row.recommendation_id,
    symbol: row.symbol,
    confidence: row.confidence,
    attempts,
    reason: suppressionReason,
    stage: "SUPPRESSED"
  });
}

export async function dispatchRecommendation(row, options = {}) {
  const startedAt = Date.now();
  const runtimeState = options.runtimeState || getTelegramRuntimeState();
  const attempts = Number(row.telegram_delivery_attempts || 0);
  const createdAtIso = toIsoOrNull(row?.created_at);
  const queuePickupAtIso = new Date(startedAt).toISOString();
  const queueLatencyMs = computeLatencyMs(row?.created_at, startedAt);
  console.log("=== STARTING TELEGRAM DELIVERY ===");
  console.log("RECOMMENDATION_CREATED_AT", createdAtIso);
  console.log("QUEUE_PICKUP_AT", queuePickupAtIso);
  console.log("QUEUE_LATENCY_MS", queueLatencyMs);
  console.log("[DELIVERY INPUT]", {
    recommendationId: row?.recommendation_id,
    symbol: row?.symbol,
    action: row?.action,
    confidence: row?.confidence,
    rrRatio: row?.rr_ratio
  });

  const { eligible, suppressionReason } = evaluateRecommendationEligibility(row, { runtimeState });
  if (!eligible) {
    console.log("[DELIVERY SUPPRESSED]", {
      recommendationId: row?.recommendation_id,
      symbol: row?.symbol,
      suppressionReason
    });
    await markSuppressed(row, suppressionReason, attempts);
    return { status: DELIVERY_STATUS.SUPPRESSED, recommendationId: row.recommendation_id };
  }

  console.log("=== ELIGIBLE RECOMMENDATION ===");
  console.log(row.recommendation_id);

  const message = buildRecommendationTelegramMessage(row);
  let subscriberChatIds = [];
  try {
    subscriberChatIds = await fetchActiveSubscriberChatIds(row);
  } catch (subscriberError) {
    console.error("[SUBSCRIBER FETCH ERROR]", subscriberError.message);
    await markSuppressed(row, "SUBSCRIBER_FETCH_FAILED", attempts);
    return { status: DELIVERY_STATUS.SUPPRESSED, recommendationId: row.recommendation_id };
  }

  if (subscriberChatIds.length === 0) {
    await markSuppressed(row, "NO_ACTIVE_SUBSCRIBERS", attempts);
    return { status: DELIVERY_STATUS.SUPPRESSED, recommendationId: row.recommendation_id };
  }

  const claimedRow = await claimRecommendationForDelivery(row);
  if (!claimedRow) {
    logEvent("recommendation.delivery.duplicate_suppressed", {
      recommendationId: row.recommendation_id,
      symbol: row.symbol,
      attempts,
      stage: "CLAIM_SKIPPED"
    });
    return { status: "SKIPPED", recommendationId: row.recommendation_id };
  }

  logEvent("recommendation.delivery.stage", {
    stage: "FORMATTED",
    recommendationId: claimedRow.recommendation_id,
    symbol: claimedRow.symbol,
    confidence: claimedRow.confidence,
    attempts: claimedRow.telegram_delivery_attempts
  });

  const deliveredSubscribers = parseDeliveredSubscriberMap(claimedRow.telegram_delivery_message_id);
  const pendingSubscriberChatIds = subscriberChatIds.filter((chatId) => !deliveredSubscribers.has(chatId));
  if (pendingSubscriberChatIds.length !== subscriberChatIds.length) {
    console.log("=== DUPLICATE SUBSCRIBER SUPPRESSED ===");
    console.log({
      recommendationId: claimedRow.recommendation_id,
      deliveredSubscribers: Array.from(deliveredSubscribers.keys()),
      pendingSubscribers: pendingSubscriberChatIds
    });
  }

  try {
    logEvent("recommendation.delivery.stage", {
      stage: "DISPATCHING",
      recommendationId: claimedRow.recommendation_id,
      symbol: claimedRow.symbol,
      confidence: claimedRow.confidence,
      attempts: claimedRow.telegram_delivery_attempts
    });

    console.log("=== SENDING TELEGRAM SIGNAL ===");
console.log("\n========== TELEGRAM MESSAGE ==========");
console.log(message);
console.log("======================================\n");
  for (const chatId of pendingSubscriberChatIds) {
      console.log("=== SENDING TO SUBSCRIBER ===");
      console.log(chatId);
      console.log("Chat ID:", chatId);
      console.log("TELEGRAM_SEND_START", new Date().toISOString());
      console.log("[TELEGRAM SEND START]", {
        recommendationId: claimedRow.recommendation_id,
        symbol: claimedRow.symbol,
        chatId
      });
      const response = await bot.telegram.sendMessage(chatId, message);
      console.log("TELEGRAM_SEND_SUCCESS", new Date().toISOString());
      console.log("=== TELEGRAM DELIVERY SUCCESS ===");
      console.log("=== TELEGRAM SIGNAL SENT ===");
      console.log("[TELEGRAM SEND SUCCESS]", {
        recommendationId: claimedRow.recommendation_id,
        symbol: claimedRow.symbol,
        messageId: response?.message_id || null,
        chatId
      });
      deliveredSubscribers.set(chatId, response?.message_id ? String(response.message_id) : "ACK");
      await updateDeliveryState(claimedRow.recommendation_id, {
        telegram_delivery_message_id: serializeDeliveredSubscriberMap(deliveredSubscribers),
        telegram_delivery_error: null
      });
    }

    await updateDeliveryState(claimedRow.recommendation_id, {
      telegram_delivery_status: DELIVERY_STATUS.SENT,
      telegram_delivery_sent_at: new Date().toISOString(),
      telegram_delivery_message_id: deliveredSubscribers.size > 0 ? serializeDeliveredSubscriberMap(deliveredSubscribers) : null,
      telegram_delivery_error: null
    });
    console.log("DELIVERY_PERSISTED_AT", new Date().toISOString());

    logEvent("recommendation.delivery.sent", {
      recommendationId: claimedRow.recommendation_id,
      symbol: claimedRow.symbol,
      confidence: claimedRow.confidence,
      attempts: claimedRow.telegram_delivery_attempts,
      queue_latency_ms: queueLatencyMs,
      latency_ms: Date.now() - startedAt,
      stage: "SENT"
    });

    return { status: DELIVERY_STATUS.SENT, recommendationId: claimedRow.recommendation_id };
  } catch (error) {
    const finalStatus = claimedRow.telegram_delivery_attempts >= MAX_ATTEMPTS ? DELIVERY_STATUS.FAILED : DELIVERY_STATUS.RETRY_SCHEDULED;
    await updateDeliveryState(claimedRow.recommendation_id, {
      telegram_delivery_status: finalStatus,
      telegram_delivery_error: String(error?.message || "UNKNOWN_DELIVERY_ERROR").slice(0, 500)
    });

    logError("recommendation.delivery.failed", error, {
      recommendationId: claimedRow.recommendation_id,
      symbol: claimedRow.symbol,
      confidence: claimedRow.confidence,
      attempts: claimedRow.telegram_delivery_attempts,
      latency_ms: Date.now() - startedAt,
      stage: "FAILED",
      error_class: error?.name || "Error"
    });
    console.error("=== TELEGRAM DELIVERY FAILED ===");
    console.error(error?.message || "UNKNOWN_DELIVERY_ERROR");
    console.error("=== TELEGRAM ERROR ===");
    console.error(error?.response?.description || error?.message);

    if (finalStatus === DELIVERY_STATUS.RETRY_SCHEDULED) {
      logEvent("recommendation.delivery.stage", {
        stage: "RETRYING",
        recommendationId: claimedRow.recommendation_id,
        symbol: claimedRow.symbol,
        confidence: claimedRow.confidence,
        attempts: claimedRow.telegram_delivery_attempts,
        latency_ms: Date.now() - startedAt,
        error_class: error?.name || "Error"
      });
    }

    return { status: finalStatus, recommendationId: claimedRow.recommendation_id, error };
  }
}

export async function processRecommendationDeliveryBatch({ batchSize = DEFAULT_BATCH_SIZE } = {}) {
  const startedAt = Date.now();
  const rows = await fetchPendingRecommendations({ batchSize });
  let sent = 0;
  let suppressed = 0;
  let failed = 0;
  let retrying = 0;
  let skipped = 0;

  for (const row of rows) {
    logEvent("recommendation.delivery.stage", {
      stage: "ELIGIBLE",
      recommendationId: row.recommendation_id,
      symbol: row.symbol,
      confidence: row.confidence,
      attempts: row.telegram_delivery_attempts || 0
    });

    const result = await dispatchRecommendation(row);
    if (result.status === DELIVERY_STATUS.SENT) sent += 1;
    else if (result.status === DELIVERY_STATUS.SUPPRESSED) suppressed += 1;
    else if (result.status === DELIVERY_STATUS.RETRY_SCHEDULED) retrying += 1;
    else if (result.status === DELIVERY_STATUS.FAILED) failed += 1;
    else if (result.status === "SKIPPED") skipped += 1;
  }

  return {
    fetched: rows.length,
    sent,
    suppressed,
    retrying,
    failed,
    skipped,
    latencyMs: Date.now() - startedAt
  };
}
