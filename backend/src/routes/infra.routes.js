/**
 * INFRA ROUTES — Operational Health Visibility
 *
 * STEP 8: GET /infra/providers
 * Surfaces the real-time health state of all four market data providers.
 * Consumed by ops dashboards, alerting, and manual diagnostics.
 *
 * Response shape (per provider):
 *   healthy            — boolean: is provider usable right now?
 *   cooldownUntil      — ISO string: when cooldown expires (null if not cooling)
 *   consecutiveFailures— integer: rolling failure count
 *   lastSuccessAt      — ISO string or null
 *   lastError          — last recorded error message or null
 */

import express from "express";
import supabase, { isSupabaseSchemaMissing } from "../services/supabase.service.js";
import { logEvent } from "../services/telemetry.service.js";

const router = express.Router();

// All 4 providers in the fallback cascade
const PROVIDERS = ["yahoo", "alpha_vantage", "twelvedata", "finnhub"];

// Inline key presence check — does NOT call any external API
function getProviderKeyStatus() {
  return {
    yahoo:         true, // yahoo-finance2 uses crumb/cookie, no API key needed
    alpha_vantage: !!process.env.ALPHA_VANTAGE_API_KEY,
    twelvedata:    !!(process.env.TWELVEDATA_API_KEY && process.env.TWELVEDATA_API_KEY !== "YOUR_TWELVEDATA_KEY_HERE"),
    finnhub:       !!(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY !== "YOUR_FINNHUB_KEY_HERE")
  };
}

/**
 * GET /infra/providers
 * Returns health snapshot for all four providers.
 */
router.get("/providers", async (req, res) => {
  const result = {};
  const keyStatus = getProviderKeyStatus();

  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("provider, consecutive_failures, cooldown_until, last_success_at, last_failure_at, last_error, updated_at")
      .in("provider", PROVIDERS);

    if (error && !isSupabaseSchemaMissing(error)) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const rowMap = Object.fromEntries(rows.map((r) => [r.provider, r]));

    for (const provider of PROVIDERS) {
      const row = rowMap[provider] || {};
      const now = new Date();
      const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until) : null;
      const coolingDown = cooldownUntil && cooldownUntil > now;
      const consecutiveFailures = Number(row.consecutive_failures || 0);
      const hasKey = keyStatus[provider];

      result[provider] = {
        healthy: !coolingDown && consecutiveFailures < 5 && hasKey,
        keyConfigured: hasKey,
        coolingDown: !!coolingDown,
        cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
        cooldownRemainingSeconds: coolingDown
          ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
          : 0,
        consecutiveFailures,
        lastSuccessAt: row.last_success_at || null,
        lastFailureAt: row.last_failure_at || null,
        lastError: row.last_error || null,
        updatedAt: row.updated_at || null
      };
    }

    logEvent("infra.providers.health_polled", {
      healthy: Object.values(result).filter((p) => p.healthy).length,
      total: PROVIDERS.length
    });

    return res.json({
      success: true,
      asOf: new Date().toISOString(),
      providers: result
    });
  } catch (err) {
    console.error("[INFRA] provider health fetch failed:", err.message);

    // Return degraded response with key-presence-only data on DB failure
    for (const provider of PROVIDERS) {
      const hasKey = keyStatus[provider];
      result[provider] = {
        healthy: hasKey, // best-effort: if key exists, assume healthy
        keyConfigured: hasKey,
        coolingDown: false,
        cooldownUntil: null,
        cooldownRemainingSeconds: 0,
        consecutiveFailures: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        updatedAt: null,
        _note: "provider_health table unavailable — showing key-status fallback"
      };
    }

    return res.status(200).json({
      success: true,
      asOf: new Date().toISOString(),
      providers: result,
      _warning: "Database health snapshot unavailable. Showing key-presence fallback."
    });
  }
});

/**
 * GET /infra/providers/:provider
 * Returns health for a single named provider.
 */
router.get("/providers/:provider", async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.includes(provider)) {
    return res.status(404).json({
      success: false,
      message: `Unknown provider: ${provider}. Valid providers: ${PROVIDERS.join(", ")}`
    });
  }

  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("*")
      .eq("provider", provider)
      .maybeSingle();

    if (error && !isSupabaseSchemaMissing(error)) throw error;

    const keyStatus = getProviderKeyStatus();
    const row = data || {};
    const now = new Date();
    const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until) : null;
    const coolingDown = cooldownUntil && cooldownUntil > now;
    const consecutiveFailures = Number(row.consecutive_failures || 0);
    const hasKey = keyStatus[provider];

    return res.json({
      success: true,
      provider,
      healthy: !coolingDown && consecutiveFailures < 5 && hasKey,
      keyConfigured: hasKey,
      coolingDown: !!coolingDown,
      cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
      cooldownRemainingSeconds: coolingDown
        ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
        : 0,
      consecutiveFailures,
      lastSuccessAt: row.last_success_at || null,
      lastFailureAt: row.last_failure_at || null,
      lastError: row.last_error || null,
      updatedAt: row.updated_at || null
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
