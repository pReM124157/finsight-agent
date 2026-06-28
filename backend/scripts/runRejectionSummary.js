import fs from "node:fs";
import path from "node:path";

const REJECTION_LOG_PATH = path.resolve("backend/data/kalshi-scan-rejections.jsonl");

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
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "0.0%";
}

function bucketCount(rows, predicate) {
  return rows.filter(predicate).length;
}

function countByReason(rows) {
  const order = [
    "EDGE_TOO_LOW",
    "TIME_OUTSIDE_WINDOW",
    "EDGE_TOO_HIGH",
    "PRICE_BELOW_FLOOR",
    "PRICE_TOO_HIGH",
    "NO_MODEL_OUTPUT",
    "ONE_SIDED_BOOK",
    "WRONG_SIDE",
    "MULTIPLE",
  ];
  return order.map((reason) => ({
    reason,
    count: rows.filter((row) => Array.isArray(row.rejection_reasons) && row.rejection_reasons.includes(reason)).length,
  }));
}

function main() {
  const rows = readJsonl(REJECTION_LOG_PATH);
  const total = rows.length;
  const byReason = countByReason(rows);
  const nearMisses = rows.filter((row) => row.would_have_been_close === true).length;

  console.log("=== SCAN REJECTION SUMMARY ===");
  console.log(`Total rejections: ${total}`);
  console.log("By reason:");
  for (const row of byReason) {
    console.log(`  ${String(`${row.reason}:`).padEnd(22)} ${String(row.count).padStart(4)} (${pct(row.count, total)})`);
  }
  console.log("");
  console.log("Near misses (would_have_been_close = true):");
  console.log(`  ${nearMisses} setups were close — edge 8%+ AND time 6+ min but failed one condition`);
  console.log("");
  console.log("Time window breakdown of rejections:");
  console.log(`  1-5 min:   ${bucketCount(rows, (row) => Number(row.minutes_remaining) >= 1 && Number(row.minutes_remaining) <= 5)}`);
  console.log(`  6-7 min:   ${bucketCount(rows, (row) => Number(row.minutes_remaining) >= 6 && Number(row.minutes_remaining) <= 7)}`);
  console.log(`  8-12 min:  ${bucketCount(rows, (row) => Number(row.minutes_remaining) >= 8 && Number(row.minutes_remaining) <= 12)}`);
  console.log(`  13-14 min: ${bucketCount(rows, (row) => Number(row.minutes_remaining) >= 13 && Number(row.minutes_remaining) <= 14)}`);
  console.log("");
  console.log("Edge breakdown of rejections:");
  console.log(`  0-3%:    ${bucketCount(rows, (row) => Number(row.best_adjusted_edge) >= 0 && Number(row.best_adjusted_edge) < 3)} (too low)`);
  console.log(`  3-6%:    ${bucketCount(rows, (row) => Number(row.best_adjusted_edge) >= 3 && Number(row.best_adjusted_edge) < 6)} (below new floor)`);
  console.log(`  6-10%:   ${bucketCount(rows, (row) => Number(row.best_adjusted_edge) >= 6 && Number(row.best_adjusted_edge) <= 10)} (lower zone)`);
  console.log(`  10-22%:  ${bucketCount(rows, (row) => Number(row.best_adjusted_edge) > 10 && Number(row.best_adjusted_edge) <= 22)} (live strategy zone extension)`);
  console.log(`  22%+:    ${bucketCount(rows, (row) => Number(row.best_adjusted_edge) > 22)} (danger zone)`);
}

main();
