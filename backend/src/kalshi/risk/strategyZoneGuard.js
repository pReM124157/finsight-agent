function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

function parseEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).trim().toLowerCase() === "true";
}

export function getStrategyZoneConfig(overrides = {}) {
  return {
    enabled: parseEnabled(overrides.enabled ?? process.env.KALSHI_STRATEGY_ZONE_ENABLED, true),
    allowedSide: normalizeSide(
      overrides.allowedSide ??
      process.env.KALSHI_STRATEGY_ALLOWED_SIDE ??
      "YES"
    ),
    minEdgePct: safeNumber(
      overrides.minEdgePct ?? process.env.KALSHI_STRATEGY_MIN_EDGE_PCT,
      10
    ),
    maxEdgePct: safeNumber(
      overrides.maxEdgePct ?? process.env.KALSHI_STRATEGY_MAX_EDGE_PCT,
      20
    ),
    minMinutesRemaining: safeNumber(
      overrides.minMinutesRemaining ?? process.env.KALSHI_STRATEGY_MIN_MINUTES_REMAINING,
      8
    ),
    maxMinutesRemaining: safeNumber(
      overrides.maxMinutesRemaining ?? process.env.KALSHI_STRATEGY_MAX_MINUTES_REMAINING,
      12
    ),
    maxEntryPrice: safeNumber(
      overrides.maxEntryPrice ?? process.env.KALSHI_STRATEGY_MAX_ENTRY_PRICE,
      94
    ),
    blockHighEdgeAbovePct: safeNumber(
      overrides.blockHighEdgeAbovePct ?? process.env.KALSHI_STRATEGY_BLOCK_HIGH_EDGE_ABOVE_PCT,
      20
    ),
  };
}

export function evaluateStrategyZoneGuard({
  side,
  adjustedEdge,
  minutesRemaining,
  entryProbability,
  config = getStrategyZoneConfig(),
} = {}) {
  if (!config.enabled) {
    return {
      ok: true,
      status: "ALLOWED",
      reason: "STRATEGY_ZONE_DISABLED",
      tags: [],
      config,
    };
  }

  const normalizedSide = normalizeSide(side);
  const edge = safeNumber(adjustedEdge);
  const minutes = safeNumber(minutesRemaining);
  const entry = safeNumber(entryProbability);
  const tags = [];

  if (!normalizedSide) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_SIDE",
      tags,
      config,
    };
  }

  if (normalizedSide !== config.allowedSide) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_SIDE_BLOCKED",
      tags: ["blocked_side"],
      config,
    };
  }

  if (edge === null) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_EDGE",
      tags,
      config,
    };
  }

  if (edge > config.blockHighEdgeAbovePct) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_HIGH_EDGE_DANGER",
      tags: ["high_edge_danger"],
      config,
    };
  }

  if (edge < config.minEdgePct || edge > config.maxEdgePct) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_EDGE_OUT_OF_RANGE",
      tags: ["edge_out_of_range"],
      config,
    };
  }

  if (minutes === null) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_MINUTES_REMAINING",
      tags,
      config,
    };
  }

  if (minutes < config.minMinutesRemaining || minutes > config.maxMinutesRemaining) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_TIME_BUCKET_BLOCKED",
      tags: ["time_bucket_blocked"],
      config,
    };
  }

  if (entry === null) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_MISSING_ENTRY_PRICE",
      tags,
      config,
    };
  }

  if (entry >= 95) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_CROSSED_TARGET_OVERPRICED",
      tags: ["crossed_target_overpriced"],
      config,
    };
  }

  if (entry > config.maxEntryPrice) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "STRATEGY_ZONE_ENTRY_TOO_EXPENSIVE",
      tags: ["entry_too_expensive"],
      config,
    };
  }

  return {
    ok: true,
    status: "ALLOWED",
    reason: "STRATEGY_ZONE_APPROVED",
    tags: ["zone_candidate"],
    config,
  };
}
