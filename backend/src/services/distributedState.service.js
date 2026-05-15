import supabase, { isSupabaseSchemaMissing, logInfraFallbackOnce } from "./supabase.service.js";
import { safeString } from "../core/safety.js";

const localStateStore = new Map();

function stateKey(namespace, id) {
  return `${namespace}:${safeString(id)}`;
}

function getLocalEntry(key) {
  const entry = localStateStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    localStateStore.delete(key);
    return null;
  }
  return entry;
}

function setLocalEntry(key, value, ttlSeconds = null) {
  localStateStore.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  });
}

export async function putState(namespace, id, value, ttlSeconds = null) {
  const key = stateKey(namespace, id);
  try {
    const { error } = await supabase.rpc("put_distributed_state", {
      p_state_key: key,
      p_state_value: value,
      p_ttl_seconds: ttlSeconds
    });
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("distributed_state_put", "[infra] distributed_state RPC missing, using local state fallback");
    setLocalEntry(key, value, ttlSeconds);
  }
}

export async function getState(namespace, id) {
  const key = stateKey(namespace, id);
  try {
    const { data, error } = await supabase
      .from("distributed_state")
      .select("state_value, expires_at")
      .eq("state_key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;
    return data.state_value;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("distributed_state_get", "[infra] distributed_state table missing, reading from local state fallback");
    return getLocalEntry(key)?.value || null;
  }
}

export async function deleteState(namespace, id) {
  const key = stateKey(namespace, id);
  try {
    const { error } = await supabase
      .from("distributed_state")
      .delete()
      .eq("state_key", key);
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    localStateStore.delete(key);
  }
}

export async function consumeState(namespace, id) {
  const key = stateKey(namespace, id);
  try {
    const { data, error } = await supabase.rpc("consume_distributed_state", {
      p_state_key: key
    });
    if (error) throw error;
    return data || null;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("distributed_state_consume", "[infra] consume_distributed_state RPC missing, consuming local state fallback");
    const entry = getLocalEntry(key);
    localStateStore.delete(key);
    return entry?.value || null;
  }
}

export async function claimEphemeralKey(namespace, id, ownerId, ttlSeconds) {
  const key = stateKey(namespace, id);
  try {
    const { data, error } = await supabase.rpc("claim_ephemeral_key", {
      p_state_key: key,
      p_owner_id: ownerId,
      p_ttl_seconds: ttlSeconds
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("distributed_state_claim", "[infra] claim_ephemeral_key RPC missing, using local ephemeral claims");
    const existing = getLocalEntry(key);
    if (existing && existing.value?.owner_id !== ownerId) return false;
    setLocalEntry(key, {
      owner_id: ownerId,
      claimed_at: new Date().toISOString()
    }, ttlSeconds);
    return true;
  }
}

export async function appendChatMemory(chatId, userMessage, assistantMessage, ttlSeconds = 86400, limit = 4) {
  const key = stateKey("chat_memory", chatId);
  try {
    const { data, error } = await supabase.rpc("append_chat_memory", {
      p_state_key: key,
      p_user_message: userMessage,
      p_assistant_message: assistantMessage,
      p_ttl_seconds: ttlSeconds,
      p_limit: limit
    });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("distributed_state_chat_memory", "[infra] append_chat_memory RPC missing, using local chat memory");
    const existing = getLocalEntry(key)?.value?.messages || [];
    const next = [
      ...existing,
      { role: "user", content: userMessage },
      { role: "assistant", content: assistantMessage }
    ].slice(-Math.max(limit * 2, 2));
    setLocalEntry(key, { messages: next }, ttlSeconds);
    return next;
  }
}
