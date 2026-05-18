/**
 * PROVIDER FAILOVER + DATA DEGRADATION INTEGRATION TESTS
 * Tests the full institutional degradation hierarchy.
 */

import {
  DATA_AVAILABILITY_STATES,
  buildStaleCachePolicy,
  classifyPartialPayload,
  determineDataAvailabilityState,
  buildDataStateMessage
} from "../../src/services/dataAvailability.service.js";

import { describe, test, expect } from "vitest";
import { isProviderAuthFailure } from "../../src/services/providerHealth.service.js";

describe("Legacy Provider Failover Integration", () => {
  test("Runs all assertions", () => {
    let p = 0, f = 0;
    const ok = (label, cond, extra = "") => {
      expect(cond, `FAIL: ${label} ${extra}`).toBe(true);
    };

// ─── isProviderAuthFailure ────────────────────────────────────────────────────
console.log("\n── isProviderAuthFailure ──");
ok("401 = auth failure", isProviderAuthFailure({ message: "401 Unauthorized" }));
ok("crumb = auth failure", isProviderAuthFailure({ message: "crumb mismatch" }));
ok("CSRF = auth failure", isProviderAuthFailure({ message: "CSRF token invalid" }));
ok("403 = auth failure", isProviderAuthFailure({ message: "403 Forbidden" }));
ok("timeout ≠ auth failure", !isProviderAuthFailure({ message: "Institutional Timeout" }));
ok("network error ≠ auth failure", !isProviderAuthFailure({ message: "ECONNRESET" }));
ok("null safe", !isProviderAuthFailure(null));

// ─── buildStaleCachePolicy — Market Open ─────────────────────────────────────
console.log("\n── buildStaleCachePolicy (market OPEN) ──");

const openFresh = buildStaleCachePolicy({ cacheAgeSeconds: 600, isMarketOpen: true }); // 10 min
ok("Open 10min → DELAYED_LIVE", openFresh.state === DATA_AVAILABILITY_STATES.DELAYED_LIVE);
ok("Open 10min → acceptable", openFresh.acceptable === true);

const openStale = buildStaleCachePolicy({ cacheAgeSeconds: 3600, isMarketOpen: true }); // 1h
ok("Open 1h → STALE_CACHE", openStale.state === DATA_AVAILABILITY_STATES.STALE_CACHE);
ok("Open 1h → acceptable", openStale.acceptable === true);

const openReadOnly = buildStaleCachePolicy({ cacheAgeSeconds: 3 * 3600, isMarketOpen: true }); // 3h
ok("Open 3h → READ_ONLY_SNAPSHOT", openReadOnly.state === DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT);

const openReject = buildStaleCachePolicy({ cacheAgeSeconds: 25 * 3600, isMarketOpen: true }); // 25h
ok("Open 25h → UNAVAILABLE, rejected", openReject.acceptable === false && openReject.state === DATA_AVAILABILITY_STATES.UNAVAILABLE);

// ─── buildStaleCachePolicy — Market Closed ───────────────────────────────────
console.log("\n── buildStaleCachePolicy (market CLOSED) ──");

const closedRecent = buildStaleCachePolicy({ cacheAgeSeconds: 12 * 3600, isMarketOpen: false }); // 12h
ok("Closed 12h → STALE_CACHE (acceptable)", closedRecent.acceptable === true, `state=${closedRecent.state}`);

const closedWeekend = buildStaleCachePolicy({ cacheAgeSeconds: 48 * 3600, isMarketOpen: false }); // 48h
ok("Closed 48h → READ_ONLY_SNAPSHOT", closedWeekend.state === DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT);

const closedTooOld = buildStaleCachePolicy({ cacheAgeSeconds: 80 * 3600, isMarketOpen: false }); // 80h
ok("Closed 80h → UNAVAILABLE, rejected", closedTooOld.acceptable === false);

// ─── classifyPartialPayload ───────────────────────────────────────────────────
console.log("\n── classifyPartialPayload ──");

// Price only — fundamentals missing
const partial = classifyPartialPayload({
  liveData: { currentPrice: 3450.5 },
  overview: { Sector: "fallback" }
});
ok("Price only → PARTIAL_DATA", partial.state === DATA_AVAILABILITY_STATES.PARTIAL_DATA);
ok("Price only → hasPrice=true", partial.hasPrice === true);
ok("Price only → hasFundamentals=false", partial.hasFundamentals === false);
ok("Price only → technical in usable_for", partial.usable_for.includes("technical_analysis"));
ok("Price only → fundamental_analysis in blocked_for", partial.blocked_for.includes("fundamental_analysis"));

// Both missing
const fullMissing = classifyPartialPayload({ liveData: { currentPrice: 0 }, overview: {} });
ok("No price → UNAVAILABLE", fullMissing.state === DATA_AVAILABILITY_STATES.UNAVAILABLE);
ok("No price → hasPrice=false", fullMissing.hasPrice === false);

// Full data
const full = classifyPartialPayload({
  liveData: { currentPrice: 3450 },
  overview: { PERatio: 24, ReturnOnEquityTTM: 48, ProfitMargin: 18, DebtToEquityRatio: 0.08, Sector: "Information Technology" }
});
ok("Full data → LIVE state", full.state === DATA_AVAILABILITY_STATES.LIVE);
ok("Full data → hasFundamentals=true", full.hasFundamentals === true);

// ─── determineDataAvailabilityState ──────────────────────────────────────────
console.log("\n── determineDataAvailabilityState ──");

// TEST 1: Yahoo success → LIVE
const live = determineDataAvailabilityState({ providerSuccessCount: 1, providerFailureCount: 0, symbol: "TCS", provider: "YAHOO" });
ok("Yahoo success → LIVE", live.state === DATA_AVAILABILITY_STATES.LIVE);
ok("LIVE → usable=true", live.usable === true);
ok("LIVE → degraded=false", live.degraded === false);

// TEST 2: Yahoo fails + stale cache <15m → DELAYED_LIVE
const delayed = determineDataAvailabilityState({
  providerSuccessCount: 0, providerFailureCount: 1,
  staleCacheAvailable: true, cacheAgeSeconds: 600, isMarketOpen: true,
  symbol: "TCS", provider: "YAHOO"
});
ok("Yahoo fail + 10min cache + open → DELAYED_LIVE", delayed.state === DATA_AVAILABILITY_STATES.DELAYED_LIVE);
ok("DELAYED_LIVE → usable", delayed.usable === true);

// TEST 3: All providers fail, market open, stale >2h → DEGRADED_PROVIDER
const degraded = determineDataAvailabilityState({
  providerSuccessCount: 0, providerFailureCount: 4,
  staleCacheAvailable: false, cacheAgeSeconds: Infinity, isMarketOpen: true,
  allProvidersCoolingDown: true, symbol: "TCS", provider: "NONE"
});
ok("All cooling down → DEGRADED_PROVIDER", degraded.state === DATA_AVAILABILITY_STATES.DEGRADED_PROVIDER);

// TEST 4: Market closed + 12h stale → STALE_CACHE (acceptable)
const closedStale = determineDataAvailabilityState({
  providerSuccessCount: 0, providerFailureCount: 1,
  staleCacheAvailable: true, cacheAgeSeconds: 12 * 3600, isMarketOpen: false,
  symbol: "TCS", provider: "YAHOO"
});
ok("Market closed + 12h → STALE_CACHE", closedStale.state === DATA_AVAILABILITY_STATES.STALE_CACHE);
ok("Market closed + 12h → usable", closedStale.usable === true);

// TEST 5: Partial payload → PARTIAL_DATA
const partialState = determineDataAvailabilityState({
  providerSuccessCount: 1, providerFailureCount: 0,
  partialPayload: true, symbol: "TCS", provider: "ALPHA_VANTAGE"
});
ok("Partial success → PARTIAL_DATA (provider succeeded but missing fields)", partialState.state === DATA_AVAILABILITY_STATES.PARTIAL_DATA);

// Partial with no provider success
const partialDegraded = determineDataAvailabilityState({
  providerSuccessCount: 0, providerFailureCount: 1,
  partialPayload: true, staleCacheAvailable: false, symbol: "TCS", provider: "YAHOO"
});
ok("No provider + partial → PARTIAL_DATA", partialDegraded.state === DATA_AVAILABILITY_STATES.PARTIAL_DATA);

// TEST 6: Snapshot available → READ_ONLY_SNAPSHOT
const snapshot = determineDataAvailabilityState({
  providerSuccessCount: 0, providerFailureCount: 4,
  staleCacheAvailable: false, snapshotAvailable: true,
  symbol: "TCS", provider: "NONE"
});
ok("Snapshot → READ_ONLY_SNAPSHOT", snapshot.state === DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT);

// TEST 7: Nothing usable → UNAVAILABLE (only catastrophic case)
const unavailable = determineDataAvailabilityState({
  providerSuccessCount: 0, providerFailureCount: 4,
  staleCacheAvailable: false, snapshotAvailable: false, partialPayload: false,
  symbol: "TCS", provider: "NONE"
});
ok("Nothing usable → UNAVAILABLE", unavailable.state === DATA_AVAILABILITY_STATES.UNAVAILABLE);
ok("UNAVAILABLE → usable=false", unavailable.usable === false);

// ─── buildDataStateMessage ────────────────────────────────────────────────────
console.log("\n── buildDataStateMessage ──");

ok("LIVE → null (no message needed)", buildDataStateMessage(DATA_AVAILABILITY_STATES.LIVE) === null);

const delayedMsg = buildDataStateMessage(DATA_AVAILABILITY_STATES.DELAYED_LIVE, { symbol: "TCS", cacheAgeMinutes: 10 });
ok("DELAYED_LIVE → non-null message", typeof delayedMsg === "string" && delayedMsg.length > 0);
ok("DELAYED_LIVE → contains DELAYED LIVE DATA", delayedMsg.includes("DELAYED LIVE DATA"));
ok("DELAYED_LIVE → contains using delayed snapshot", delayedMsg.includes("Using delayed institutional market snapshot"));

const staleMsg = buildDataStateMessage(DATA_AVAILABILITY_STATES.STALE_CACHE, { symbol: "TCS", cacheAgeMinutes: 45 });
ok("STALE_CACHE → contains DELAYED LIVE DATA (shared UI)", staleMsg.includes("DELAYED LIVE DATA"));

const partialMsg = buildDataStateMessage(DATA_AVAILABILITY_STATES.PARTIAL_DATA, { symbol: "TCS", missingComponents: ["roe", "peRatio"] });
ok("PARTIAL_DATA → mentions fundamentals unavailable", partialMsg.includes("Fundamental intelligence temporarily unavailable"));
ok("PARTIAL_DATA → Technical analysis operational", partialMsg.includes("Technical and adaptive systems remain operational"));

const degradedMsg = buildDataStateMessage(DATA_AVAILABILITY_STATES.DEGRADED_PROVIDER, { symbol: "TCS" });
ok("DEGRADED_PROVIDER → mentions infrastructure unavailable", degradedMsg.includes("Institutional market infrastructure temporarily unavailable"));

const unavailMsg = buildDataStateMessage(DATA_AVAILABILITY_STATES.UNAVAILABLE, { symbol: "TCS" });
ok("UNAVAILABLE → mentions infrastructure unavailable", unavailMsg.includes("Institutional market infrastructure temporarily unavailable"));

const readOnlyMsg = buildDataStateMessage(DATA_AVAILABILITY_STATES.READ_ONLY_SNAPSHOT, { symbol: "TCS" });
ok("READ_ONLY_SNAPSHOT → READ-ONLY SNAPSHOT MODE", readOnlyMsg.includes("READ-ONLY SNAPSHOT MODE"));
ok("READ_ONLY_SNAPSHOT → mentions replay reliability", readOnlyMsg.includes("Replay reliability temporarily constrained"));

// ─── RESULTS ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`PROVIDER FAILOVER TESTS: executed via vitest`);
  });
});
