/**
 * INSTITUTIONAL DATA DEGRADATION GOVERNANCE
 * Replaces binary hard-fail with a 7-state degradation hierarchy.
 * The system must NEVER silently fabricate, silently corrupt, or silently
 * fall back incorrectly — but ALSO must NOT immediately hard-fail when
 * one provider degrades.
 */

import { logEvent } from "./telemetry.service.js";

// ─── DATA AVAILABILITY STATES ────────────────────────────────────────────────

export const DATA_AVAILABILITY_STATES = Object.freeze({
  LIVE:             "LIVE",              // Primary provider live, ≤5 min old, market open
  DELAYED_LIVE:     "DELAYED_LIVE",      // Live failed, stale cache <15 min
  STALE_CACHE:      "STALE_CACHE",       // Stale cache <2 h
  PARTIAL_DATA:     "PARTIAL_DATA",      // Price available, some components missing
  DEGRADED_PROVIDER:"DEGRADED_PROVIDER", // All providers cooling down; serving best effort
  READ_ONLY_SNAPSHOT:"READ_ONLY_SNAPSHOT",// Historical snapshot only; no live price
  UNAVAILABLE:      "UNAVAILABLE"        // Total outage; nothing usable at all
});

// Usability matrix for each state
export const GOVERNANCE_CLASS = Object.freeze({
  LIVE:              { usable: true,  degraded: false, technicalOk: true,  fundamentalOk: true  },
  DELAYED_LIVE:      { usable: true,  degraded: true,  technicalOk: true,  fundamentalOk: true  },
  STALE_CACHE:       { usable: true,  degraded: true,  technicalOk: true,  fundamentalOk: true  },
  PARTIAL_DATA:      { usable: true,  degraded: true,  technicalOk: true,  fundamentalOk: false },
  DEGRADED_PROVIDER: { usable: true,  degraded: true,  technicalOk: false, fundamentalOk: false },
  READ_ONLY_SNAPSHOT:{ usable: true,  degraded: true,  technicalOk: false, fundamentalOk: true  },
  UNAVAILABLE:       { usable: false, degraded: true,  technicalOk: false, fundamentalOk: false }
});

// ─── STALE CACHE POLICY ───────────────────────────────────────────────────────

/**
 * buildStaleCachePolicy — market-aware stale cache acceptance rules.
 * Market OPEN: aggressive TTL enforcement.
 * Market CLOSED: much more lenient (last session price is acceptable).
 */
export function buildStaleCachePolicy({ cacheAgeSeconds, isMarketOpen }) {
  const ageMin = cacheAgeSeconds / 60;

  if (isMarketOpen) {
    if (ageMin <= 15) {
      return {
        acceptable: true,
        state: DATA_AVAILABILITY_STATES.DELAYED_LIVE,
        warning: `Live provider unavailable. Serving data from ${Math.round(ageMin)} min ago.`,
        governance_reason: "STALE_WITHIN_DELAY_THRESHOLD"
      };
    }
    if (ageMin <= 120) {
      return {
        acceptable: true,
        state: DATA_AVAILABILITY_STATES.STALE_CACHE,
        warning: `Market is open but data is ${Math.round(ageMin)} min old. Degraded reliability.`,
        governance_reason: "STALE_BEYOND_DELAY_THRESHOLD"
      };
    }
    if (ageMin <= 1440) {
      return {
        acceptable: true,
        state: DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT,
        warning: `Data is ${Math.round(ageMin / 60)} h old during market hours. Read-only snapshot mode.`,
        governance_reason: "STALE_APPROACHING_SESSION_BOUNDARY"
      };
    }
    return {
      acceptable: false,
      state: DATA_AVAILABILITY_STATES.UNAVAILABLE,
      warning: "Cache is older than 24 h during market hours. Data rejected.",
      governance_reason: "STALE_BEYOND_SAFE_THRESHOLD"
    };
  }

  // Market CLOSED — much more lenient
  if (ageMin <= 1440) {
    // <24h after close: last session price is valid
    return {
      acceptable: true,
      state: DATA_AVAILABILITY_STATES.STALE_CACHE,
      warning: null,
      governance_reason: "MARKET_CLOSED_WITHIN_SESSION_WINDOW"
    };
  }
  if (ageMin <= 4320) {
    // 24–72 h: read-only (weekend / holiday)
    return {
      acceptable: true,
      state: DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT,
      warning: `Data is ${Math.round(ageMin / 60)} h old (market closed). Read-only snapshot.`,
      governance_reason: "MARKET_CLOSED_EXTENDED_WINDOW"
    };
  }
  return {
    acceptable: false,
    state: DATA_AVAILABILITY_STATES.UNAVAILABLE,
    warning: "Cache is older than 72 h. Data rejected even for closed market.",
    governance_reason: "STALE_BEYOND_EXTENDED_THRESHOLD"
  };
}

// ─── PARTIAL PAYLOAD GOVERNANCE ───────────────────────────────────────────────

/**
 * classifyPartialPayload — identifies what is available and what is blocked.
 * CRITICAL: if price is available but fundamentals are not, we MUST NOT fail
 * the entire request. Technical analysis can still proceed.
 */
export function classifyPartialPayload({ liveData, overview }) {
  const price = Number(liveData?.currentPrice || liveData?.price || 0);
  const missing = [];
  const usableFor = [];
  const blockedFor = [];

  if (price <= 0) missing.push("currentPrice");
  if (!overview?.PERatio && overview?.PERatio !== 0) missing.push("peRatio");
  if (!overview?.ReturnOnEquityTTM) missing.push("roe");
  if (!overview?.ProfitMargin) missing.push("profitMargin");
  if (!overview?.DebtToEquityRatio) missing.push("debtEquity");
  if (!overview?.Sector || String(overview.Sector).toLowerCase() === "fallback") missing.push("sector");

  const hasPrice = !missing.includes("currentPrice");
  const hasFundamentals = !missing.includes("peRatio") && !missing.includes("roe");

  if (hasPrice) {
    usableFor.push("technical_analysis", "price_discovery", "momentum_analysis");
  }
  if (hasFundamentals) {
    usableFor.push("fundamental_analysis", "valuation_analysis", "quality_scoring");
  }
  if (!hasPrice) {
    blockedFor.push("technical_analysis", "price_discovery", "entry_timing", "stop_loss_calculation");
  }
  if (!hasFundamentals) {
    blockedFor.push("fundamental_analysis", "valuation_classification", "quality_scoring");
  }

  const state = !hasPrice
    ? DATA_AVAILABILITY_STATES.UNAVAILABLE
    : missing.length > 0
      ? DATA_AVAILABILITY_STATES.PARTIAL_DATA
      : DATA_AVAILABILITY_STATES.LIVE;

  return {
    state,
    missing_components: missing,
    usable_for: usableFor,
    blocked_for: blockedFor,
    hasPrice,
    hasFundamentals
  };
}

// ─── GOVERNED DEGRADATION ENGINE ─────────────────────────────────────────────

/**
 * determineDataAvailabilityState — master degradation resolver.
 * Evaluates all inputs and returns the BEST POSSIBLE governed state.
 * NEVER returns UNAVAILABLE if any usable data exists.
 *
 * @param {object} opts
 * @param {number}  opts.providerSuccessCount
 * @param {number}  opts.providerFailureCount
 * @param {boolean} opts.staleCacheAvailable
 * @param {number}  opts.cacheAgeSeconds
 * @param {boolean} opts.isMarketOpen
 * @param {boolean} opts.partialPayload        - price available but some fields missing
 * @param {boolean} opts.allProvidersCoolingDown
 * @param {boolean} opts.snapshotAvailable     - read-only historical snapshot exists
 * @param {string}  opts.symbol
 * @param {string}  opts.provider
 * @returns {{ state, usable, degraded, explanation, governance_class }}
 */
export function determineDataAvailabilityState({
  providerSuccessCount = 0,
  providerFailureCount = 0,
  staleCacheAvailable = false,
  cacheAgeSeconds = Infinity,
  isMarketOpen = false,
  partialPayload = false,
  allProvidersCoolingDown = false,
  snapshotAvailable = false,
  symbol = "UNKNOWN",
  provider = "unknown"
}) {
  let state;
  let explanation;

  // ── 1. Live provider success ─────────────────────────────────────────────
  if (providerSuccessCount > 0 && providerFailureCount === 0) {
    state = DATA_AVAILABILITY_STATES.LIVE;
    explanation = "Primary provider delivered live data. Full institutional reliability.";
  }

  // ── 2. Live failed + stale cache ────────────────────────────────────────
  else if (providerSuccessCount === 0 && staleCacheAvailable) {
    const policy = buildStaleCachePolicy({ cacheAgeSeconds, isMarketOpen });
    if (policy.acceptable) {
      state = policy.state;
      explanation = policy.warning || `Serving from ${policy.governance_reason}.`;
    } else {
      // Cache too stale — fall through to lower states
      staleCacheAvailable = false;
    }
  }

  // ── 3. Partial payload (price available, fundamentals missing) ───────────
  if (!state && partialPayload) {
    state = DATA_AVAILABILITY_STATES.PARTIAL_DATA;
    explanation = "Live price available. Fundamental data layer temporarily degraded. Technical analysis proceeds.";
  }

  // ── 4. All providers in cooldown ─────────────────────────────────────────
  if (!state && allProvidersCoolingDown) {
    state = DATA_AVAILABILITY_STATES.DEGRADED_PROVIDER;
    explanation = "All data providers are currently in cooldown recovery. System will auto-retry on cooldown expiry.";
  }

  // ── 5. Read-only historical snapshot ─────────────────────────────────────
  if (!state && snapshotAvailable) {
    state = DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT;
    explanation = "Live data unavailable. Serving read-only historical snapshot. Price is last known session close.";
  }

  // ── 6. UNAVAILABLE — only when nothing usable exists ─────────────────────
  if (!state) {
    state = DATA_AVAILABILITY_STATES.UNAVAILABLE;
    explanation = "No usable data available across all providers and cache layers. Total outage detected.";
  }

  const gc = GOVERNANCE_CLASS[state];

  logEvent(`data.availability.${state.toLowerCase()}`, {
    symbol,
    provider,
    state,
    cacheAgeSeconds,
    isMarketOpen,
    providerSuccessCount,
    providerFailureCount,
    explanation
  });

  return {
    state,
    usable: gc.usable,
    degraded: gc.degraded,
    technicalOk: gc.technicalOk,
    fundamentalOk: gc.fundamentalOk,
    explanation,
    governance_class: gc
  };
}

// ─── TELEGRAM MESSAGE BUILDER ─────────────────────────────────────────────────

/**
 * buildDataStateMessage — generates the correct Telegram message for each state.
 * Replaces the binary "all providers unreachable" hard-fail.
 */
export function buildDataStateMessage(state, { symbol, cacheAgeMinutes, lastUpdated, missingComponents = [] } = {}) {
  const sym = symbol || "this symbol";
  const ageStr = cacheAgeMinutes != null ? `${Math.round(cacheAgeMinutes)} min ago` : "recently";
  const lastStr = lastUpdated ? `Last verified: ${lastUpdated}` : "";

  switch (state) {
    case DATA_AVAILABILITY_STATES.LIVE:
      return null; // No message needed — analysis proceeds normally

    case DATA_AVAILABILITY_STATES.DELAYED_LIVE:
      return (
        `⚠️ *Market State: DELAYED LIVE DATA*\n` +
        `Data delayed due to provider instability. Last update: ${ageStr}.\n` +
        `Analysis proceeds with reduced confidence.`
      );

    case DATA_AVAILABILITY_STATES.STALE_CACHE:
      return (
        `⚠️ *Market State: STALE CACHE SNAPSHOT*\n` +
        `Live provider temporarily unreachable. Serving cached data from ${ageStr}.\n` +
        `${lastStr}\n` +
        `Fundamental analysis intact. Technical signals may lag current price action.`
      );

    case DATA_AVAILABILITY_STATES.PARTIAL_DATA: {
      const missing = missingComponents.length ? missingComponents.join(", ") : "fundamental metrics";
      return (
        `⚠️ *Market State: PARTIAL MARKET DATA*\n` +
        `Live price confirmed. Fundamental layer temporarily degraded (missing: ${missing}).\n` +
        `Technical analysis available. Fundamental scoring uses available data only.`
      );
    }

    case DATA_AVAILABILITY_STATES.DEGRADED_PROVIDER:
      return (
        `⚠️ *Market State: DEGRADED PROVIDER*\n` +
        `All data providers are in cooldown recovery for *${sym}*.\n` +
        `System will auto-retry. Last known data is being used where available.\n` +
        `No active trading recommendation should be executed in this state.`
      );

    case DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT:
      return (
        `⚠️ *Market State: READ-ONLY SNAPSHOT MODE*\n` +
        `Live data unavailable for *${sym}*. Serving last known session close.\n` +
        `Analysis is indicative only. ${lastStr}\n` +
        `Do not execute trades based on snapshot data.`
      );

    case DATA_AVAILABILITY_STATES.UNAVAILABLE:
      return (
        `❌ *Market Data Unavailable*\n` +
        `*${sym}* is a valid symbol — but all data providers are temporarily unreachable and no cached data exists.\n` +
        `This is a provider outage, not a symbol error.\n` +
        `Please retry in a few minutes.`
      );

    default:
      return `⚠️ Unknown data state for ${sym}. Please retry.`;
  }
}
