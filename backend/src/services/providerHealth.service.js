import supabase, { isSupabaseSchemaMissing, logInfraFallbackOnce } from "./supabase.service.js";
import { logEvent } from "./telemetry.service.js";

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_SKIP_ERROR_CODE = "PROVIDER_COOLDOWN_ACTIVE";
const localProviderHealth = new Map();

export async function canUseProvider(provider) {
  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("cooldown_until")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    if (!data?.cooldown_until) return true;
    return new Date(data.cooldown_until) <= new Date();
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("provider_health_can_use", "[infra] provider_health table missing, using local provider health fallback");
    const local = localProviderHealth.get(provider);
    if (!local?.cooldownUntil) return true;
    return new Date(local.cooldownUntil) <= new Date();
  }
}

export async function recordProviderSuccess(provider) {
  try {
    const { error } = await supabase
      .from("provider_health")
      .upsert({
        provider,
        consecutive_failures: 0,
        cooldown_until: null,
        last_success_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "provider"
      });
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    localProviderHealth.set(provider, {
      consecutiveFailures: 0,
      cooldownUntil: null,
      lastSuccessAt: new Date().toISOString(),
      lastError: null
    });
  }
  logEvent("provider.success", { provider });
}

export async function recordProviderFailure(provider, errorMessage, threshold = DEFAULT_THRESHOLD, cooldownSeconds = DEFAULT_COOLDOWN_SECONDS) {
  let failures = 1;
  let shouldCooldown = false;
  let cooldownUntil = null;

  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("consecutive_failures")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;

    failures = Number(data?.consecutive_failures || 0) + 1;
    shouldCooldown = failures >= threshold;
    cooldownUntil = shouldCooldown
      ? new Date(Date.now() + cooldownSeconds * 1000).toISOString()
      : null;

    const { error: upsertError } = await supabase
      .from("provider_health")
      .upsert({
        provider,
        consecutive_failures: failures,
        cooldown_until: cooldownUntil,
        last_failure_at: new Date().toISOString(),
        last_error: errorMessage || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "provider"
      });
    if (upsertError) throw upsertError;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    const current = localProviderHealth.get(provider) || { consecutiveFailures: 0 };
    failures = Number(current.consecutiveFailures || 0) + 1;
    shouldCooldown = failures >= threshold;
    cooldownUntil = shouldCooldown
      ? new Date(Date.now() + cooldownSeconds * 1000).toISOString()
      : null;
    localProviderHealth.set(provider, {
      consecutiveFailures: failures,
      cooldownUntil,
      lastFailureAt: new Date().toISOString(),
      lastError: errorMessage || null
    });
  }
  logEvent("provider.failure", {
    provider,
    failures,
    shouldCooldown,
    cooldownUntil,
    errorMessage: errorMessage || null
  });
}

export async function withProviderGuard(provider, operation, options = {}) {
  const threshold = options.threshold || DEFAULT_THRESHOLD;
  const cooldownSeconds = options.cooldownSeconds || DEFAULT_COOLDOWN_SECONDS;
  const skipWhenCoolingDown = options.skipWhenCoolingDown !== false;

  if (skipWhenCoolingDown) {
    const available = await canUseProvider(provider);
    if (!available) {
      const cooldownError = new Error(`${provider} is cooling down`);
      cooldownError.code = DEFAULT_SKIP_ERROR_CODE;
      throw cooldownError;
    }
  }

  const startedAt = Date.now();
  try {
    const result = await operation();
    await recordProviderSuccess(provider);
    logEvent("provider.latency", {
      provider,
      durationMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    await recordProviderFailure(provider, error?.message || "Unknown provider error", threshold, cooldownSeconds);
    throw error;
  }
}
