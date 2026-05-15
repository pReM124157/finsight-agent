import os from "os";
import process from "process";
import supabase, { isSupabaseSchemaMissing, logInfraFallbackOnce } from "./supabase.service.js";
import { createTraceId, logEvent } from "./telemetry.service.js";

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${createTraceId("instance")}`;
const localLeases = new Map();

export function getInstanceId() {
  return INSTANCE_ID;
}

export async function claimSchedulerLease(name, ttlSeconds = 120) {
  try {
    const { data, error } = await supabase.rpc("claim_scheduler_lease", {
      p_lease_name: name,
      p_owner_id: INSTANCE_ID,
      p_ttl_seconds: ttlSeconds
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("scheduler_lease_claim", "[infra] scheduler lease RPC missing, using local lease fallback");
    const now = Date.now();
    const existing = localLeases.get(name);
    if (existing && existing.leaseUntil > now && existing.ownerId !== INSTANCE_ID) return false;
    localLeases.set(name, {
      ownerId: INSTANCE_ID,
      leaseUntil: now + ttlSeconds * 1000
    });
    return true;
  }
}

export async function renewSchedulerLease(name, ttlSeconds = 120) {
  try {
    const { data, error } = await supabase.rpc("renew_scheduler_lease", {
      p_lease_name: name,
      p_owner_id: INSTANCE_ID,
      p_ttl_seconds: ttlSeconds
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    const existing = localLeases.get(name);
    if (!existing || existing.ownerId !== INSTANCE_ID) return false;
    existing.leaseUntil = Date.now() + ttlSeconds * 1000;
    localLeases.set(name, existing);
    return true;
  }
}

export async function releaseSchedulerLease(name) {
  try {
    const { data, error } = await supabase.rpc("release_scheduler_lease", {
      p_lease_name: name,
      p_owner_id: INSTANCE_ID
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    const existing = localLeases.get(name);
    if (!existing || existing.ownerId !== INSTANCE_ID) return false;
    localLeases.delete(name);
    return true;
  }
}

export async function runWithSchedulerLease(name, task, options = {}) {
  const ttlSeconds = options.ttlSeconds || 180;
  const heartbeatMs = options.heartbeatMs || Math.max(10000, Math.floor((ttlSeconds * 1000) / 3));
  const traceId = options.traceId || createTraceId(name);
  let leaseActive = true;
  const claimed = await claimSchedulerLease(name, ttlSeconds);
  if (!claimed) {
    logEvent("scheduler.lease.skipped", { lease: name, traceId, ownerId: INSTANCE_ID });
    return { ran: false, traceId };
  }

  logEvent("scheduler.lease.claimed", { lease: name, traceId, ownerId: INSTANCE_ID });
  const heartbeat = setInterval(async () => {
    try {
      const renewed = await renewSchedulerLease(name, ttlSeconds);
      if (!renewed) {
        leaseActive = false;
        logEvent("scheduler.lease.lost", { lease: name, traceId, ownerId: INSTANCE_ID });
      }
    } catch (error) {
      leaseActive = false;
      logEvent("scheduler.heartbeat.error", {
        lease: name,
        traceId,
        ownerId: INSTANCE_ID,
        message: error.message
      });
    }
  }, heartbeatMs);

  try {
    const context = {
      traceId,
      ownerId: INSTANCE_ID,
      assertLease() {
        if (!leaseActive) {
          const error = new Error(`Scheduler lease lost for ${name}`);
          error.code = "SCHEDULER_LEASE_LOST";
          throw error;
        }
      }
    };

    context.assertLease();
    await task(context);
    context.assertLease();
    return { ran: true, traceId };
  } finally {
    clearInterval(heartbeat);
    try {
      await releaseSchedulerLease(name);
    } catch (error) {
      logEvent("scheduler.release.error", {
        lease: name,
        traceId,
        ownerId: INSTANCE_ID,
        message: error.message
      });
    }
  }
}
