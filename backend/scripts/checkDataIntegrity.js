import fs from "node:fs";
import path from "node:path";

const FEATURE_SNAPSHOT_PATH = path.resolve("backend/data/kalshi-feature-snapshots.jsonl");

function readJsonl(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function pct(count, total) {
  return total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
}

function isTestRecord(row = {}) {
  return row?.pipeline_version === "mongo-test-v1" ||
    String(row?.market_ticker || "").startsWith("MONGO_TEST");
}

function main() {
  const allRows = readJsonl(FEATURE_SNAPSHOT_PATH);
  const skippedTestRecords = allRows.filter(isTestRecord).length;
  const rows = allRows.filter((row) => !isTestRecord(row));
  const total = rows.length;
  const hasModelProbYes = rows.filter((row) => row?.model_prob_yes !== null && row?.model_prob_yes !== undefined).length;
  const hasAdjustedEdge = rows.filter((row) => row?.best_adjusted_edge !== null && row?.best_adjusted_edge !== undefined).length;
  const hasSettlementOutcome = rows.filter((row) => row?.settlement_outcome !== null && row?.settlement_outcome !== undefined).length;
  const lockedMarkets = rows.filter((row) => Number(row?.yes_bid) <= 1 && Number(row?.yes_ask) >= 99).length;
  const openArtifacts = rows.filter((row) => Number(row?.minutes_remaining) >= 15).length;
  const nullAskBid = rows.filter((row) => row?.yes_ask === null || row?.yes_ask === undefined || row?.yes_bid === null || row?.yes_bid === undefined).length;
  const pipelineCounts = rows.reduce((acc, row) => {
    const key = row?.pipeline_version || "UNKNOWN";
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  const verdict = hasModelProbYes / Math.max(total, 1) > 0.8
    ? "DATA_LOOKS_OK"
    : "PIPELINE_OUTPUT_MISSING";

  console.log("=== DATA INTEGRITY CHECK ===");
  console.log(`Total snapshots: ${total}`);
  console.log(`Skipped test records: ${skippedTestRecords}`);
  console.log(`Has model_prob_yes: ${hasModelProbYes} (${pct(hasModelProbYes, total)}%)`);
  console.log(`Has best_adjusted_edge: ${hasAdjustedEdge} (${pct(hasAdjustedEdge, total)}%)`);
  console.log(`Has settlement outcome:  ${hasSettlementOutcome} (${pct(hasSettlementOutcome, total)}%)`);
  console.log(`Locked markets (bid=0/ask=100): ${lockedMarkets} (${pct(lockedMarkets, total)}%)`);
  console.log(`Snapshots at mins=15 (open artifacts): ${openArtifacts} (${pct(openArtifacts, total)}%) -- these are now filtered`);
  console.log(`Snapshots with null ask/bid: ${nullAskBid} (${pct(nullAskBid, total)}%) -- these are now filtered`);
  console.log(
    `Pipeline: ${Array.from(pipelineCounts.entries()).map(([key, count]) => `${key}: ${count}`).join(", ")}`
  );
  console.log(`VERDICT: ${verdict}`);
}

main();
