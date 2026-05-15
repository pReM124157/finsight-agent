import supabase, { isSupabaseSchemaMissing, logInfraFallbackOnce } from "./supabase.service.js";
import { claimEphemeralKey } from "./distributedState.service.js";

const DEFAULT_WAIT_MS = 1500;
const DEFAULT_POLL_MS = 150;
const localSharedCache = new Map();

function getLocalCacheEntry(cacheKey) {
  const entry = localSharedCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    localSharedCache.delete(cacheKey);
    return null;
  }
  return entry;
}

export async function getSharedCache(cacheKey) {
  try {
    const { data, error } = await supabase
      .from("shared_cache")
      .select("payload, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (new Date(data.expires_at) <= new Date()) return null;
    return data.payload;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("shared_cache_get", "[infra] shared_cache table missing, using local cache fallback");
    return getLocalCacheEntry(cacheKey)?.payload || null;
  }
}

export async function setSharedCache(cacheKey, cacheGroup, payload, ttlSeconds) {
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  try {
    const { error } = await supabase
      .from("shared_cache")
      .upsert({
        cache_key: cacheKey,
        cache_group: cacheGroup,
        payload,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "cache_key"
      });
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    localSharedCache.set(cacheKey, {
      cacheGroup,
      payload,
      expiresAt: expiresAtMs
    });
  }
}

export async function deleteSharedCache(cacheKey) {
  try {
    const { error } = await supabase
      .from("shared_cache")
      .delete()
      .eq("cache_key", cacheKey);
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    localSharedCache.delete(cacheKey);
  }
}

export async function invalidateCacheGroup(cacheGroup) {
  try {
    const { error } = await supabase
      .from("shared_cache")
      .delete()
      .eq("cache_group", cacheGroup);
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    for (const [cacheKey, entry] of localSharedCache.entries()) {
      if (entry.cacheGroup === cacheGroup) {
        localSharedCache.delete(cacheKey);
      }
    }
  }
}

async function waitForSharedCache(cacheKey, maxWaitMs = DEFAULT_WAIT_MS, pollMs = DEFAULT_POLL_MS) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const payload = await getSharedCache(cacheKey);
    if (payload) return payload;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

export async function getOrPopulateSharedCache(
  cacheKey,
  cacheGroup,
  ttlSeconds,
  producer,
  options = {}
) {
  const existing = await getSharedCache(cacheKey);
  if (existing) return existing;

  const fillLockKey = `cache_fill:${cacheKey}`;
  const lockOwner = options.lockOwner || cacheGroup;
  const fillLockTtlSeconds = options.fillLockTtlSeconds || Math.max(5, Math.min(ttlSeconds, 30));
  const waitMs = options.waitMs || DEFAULT_WAIT_MS;
  const pollMs = options.pollMs || DEFAULT_POLL_MS;

  const claimed = await claimEphemeralKey("shared_cache_fill", fillLockKey, lockOwner, fillLockTtlSeconds);
  if (!claimed) {
    const waited = await waitForSharedCache(cacheKey, waitMs, pollMs);
    if (waited) return waited;
    return producer();
  }

  const fresh = await producer();
  if (fresh !== undefined && fresh !== null) {
    await setSharedCache(cacheKey, cacheGroup, fresh, ttlSeconds);
  }
  return fresh;
}
