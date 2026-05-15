import supabase, { isSupabaseSchemaMissing, logInfraFallbackOnce } from "./supabase.service.js";
import { safeString } from "../core/safety.js";
import { createTraceId, logEvent } from "./telemetry.service.js";

const DEFAULT_ALERT_COOLDOWN_HOURS = 48;
const DEFAULT_ALERT_CLAIM_TTL_SECONDS = 180;
const localAlertClaims = new Map();

function normalizeSymbol(symbol) {
  return safeString(symbol).toUpperCase();
}

export async function shouldSendAlert(chatId, symbol, alertType) {
  const { data, error } = await supabase
    .from("alert_memory")
    .select("*")
    .eq("chat_id", String(chatId))
    .eq("symbol", normalizeSymbol(symbol))
    .eq("alert_type", alertType)
    .order("last_sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Alert check error:", error.message);
    return false;
  }

  if (!data) return true;

  const lastSent = new Date(data.last_sent_at);
  const now = new Date();

  const diffHours =
    (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);

  return diffHours >= 48;
}

export async function saveAlert(chatId, symbol, alertType) {
  const { error } = await supabase
    .from("alert_memory")
    .upsert({
      chat_id: String(chatId),
      symbol: normalizeSymbol(symbol),
      alert_type: alertType,
      last_sent_at: new Date().toISOString()
    }, {
      onConflict: "chat_id,symbol,alert_type"
    });

  if (error) {
    console.error("Save alert error:", error.message);
  }
}

export async function claimAlertDelivery(chatId, symbol, alertType, options = {}) {
  const ownerId = options.ownerId || createTraceId("alert");
  const cooldownHours = options.cooldownHours || DEFAULT_ALERT_COOLDOWN_HOURS;
  const claimTtlSeconds = options.claimTtlSeconds || DEFAULT_ALERT_CLAIM_TTL_SECONDS;
  const traceId = options.traceId || ownerId;
  const normalizedSymbol = normalizeSymbol(symbol);
  const claimKey = `${String(chatId)}:${normalizedSymbol}:${alertType}`;

  let claimed = false;
  try {
    const { data, error } = await supabase.rpc("claim_alert_delivery", {
      p_chat_id: String(chatId),
      p_symbol: normalizedSymbol,
      p_alert_type: alertType,
      p_owner_id: ownerId,
      p_claim_ttl_seconds: claimTtlSeconds,
      p_cooldown_hours: cooldownHours
    });

    if (error) throw error;
    claimed = data === true;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("alert_claim_rpc", "[infra] alert delivery RPCs missing, using local alert claim fallback");
    const current = localAlertClaims.get(claimKey);
    if (current && current.expiresAt > Date.now() && current.ownerId !== ownerId) {
      claimed = false;
    } else {
      localAlertClaims.set(claimKey, {
        ownerId,
        expiresAt: Date.now() + claimTtlSeconds * 1000
      });
      claimed = true;
    }
  }

  logEvent(claimed ? "alert.claimed" : "alert.skipped", {
    traceId,
    ownerId,
    chatId: String(chatId),
    symbol: normalizedSymbol,
    alertType
  });

  return {
    claimed,
    ownerId,
    traceId
  };
}

export async function finalizeAlertDelivery(chatId, symbol, alertType, ownerId, traceId = ownerId) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const claimKey = `${String(chatId)}:${normalizedSymbol}:${alertType}`;
  let finalized = false;
  try {
    const { data, error } = await supabase.rpc("finalize_alert_delivery", {
      p_chat_id: String(chatId),
      p_symbol: normalizedSymbol,
      p_alert_type: alertType,
      p_owner_id: ownerId
    });
    if (error) throw error;
    finalized = data === true;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    const current = localAlertClaims.get(claimKey);
    if (current?.ownerId === ownerId) {
      localAlertClaims.delete(claimKey);
      finalized = true;
    }
  }
  logEvent("alert.finalized", {
    traceId,
    ownerId,
    chatId: String(chatId),
    symbol: normalizedSymbol,
    alertType,
    finalized
  });
  return finalized;
}

export async function releaseAlertDeliveryClaim(chatId, symbol, alertType, ownerId, traceId = ownerId) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const claimKey = `${String(chatId)}:${normalizedSymbol}:${alertType}`;
  let released = false;
  try {
    const { data, error } = await supabase.rpc("release_alert_delivery_claim", {
      p_chat_id: String(chatId),
      p_symbol: normalizedSymbol,
      p_alert_type: alertType,
      p_owner_id: ownerId
    });
    if (error) throw error;
    released = data === true;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    const current = localAlertClaims.get(claimKey);
    if (current?.ownerId === ownerId) {
      localAlertClaims.delete(claimKey);
      released = true;
    }
  }
  logEvent("alert.claim.released", {
    traceId,
    ownerId,
    chatId: String(chatId),
    symbol: normalizedSymbol,
    alertType,
    released
  });
  return released;
}
