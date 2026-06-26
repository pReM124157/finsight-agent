import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import {
  savePaperTradeMongo,
  saveMarketSnapshotMongo,
  saveFeatureSnapshotMongo,
  saveLabeledSnapshotMongo,
  saveStrategyGuardReportMongo,
  saveNoSideShadowAuditMongo,
  saveNoSideShadowReportMongo,
  getMongoStats,
} from "../src/kalshi/storage/mongoPersistence.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

function buildSummaryRow() {
  return {
    migrated: 0,
    errors: 0,
    skipped: false,
  };
}

function extractRecords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.trades)) return payload.trades;
  if (Array.isArray(payload.reports)) return payload.reports;
  if (Array.isArray(payload.snapshots)) return payload.snapshots;

  return Object.values(payload).filter((value) => value && typeof value === "object" && !Array.isArray(value));
}

function readJsonRecords(relativePath) {
  const absolutePath = path.resolve(backendRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      missing: true,
      records: [],
      path: absolutePath,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    return {
      ok: true,
      records: extractRecords(parsed),
      path: absolutePath,
    };
  } catch (error) {
    return {
      ok: false,
      missing: false,
      records: [],
      path: absolutePath,
      error: error.message,
    };
  }
}

function readJsonlRecords(relativePath) {
  const absolutePath = path.resolve(backendRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      missing: true,
      records: [],
      parseErrors: 0,
      path: absolutePath,
    };
  }

  const lines = fs.readFileSync(absolutePath, "utf8").split("\n");
  const records = [];
  let parseErrors = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      records.push(JSON.parse(line));
    } catch {
      parseErrors += 1;
    }
  }

  return {
    ok: true,
    records,
    parseErrors,
    path: absolutePath,
  };
}

async function migrateCollection({
  label,
  relativePath,
  reader,
  writer,
  summary,
}) {
  const bucket = summary[label];
  const result = reader(relativePath);

  if (result.missing) {
    bucket.skipped = true;
    summary.skippedFiles.push(relativePath);
    console.log(`[migrate] skipped missing file: ${relativePath}`);
    return;
  }

  if (!result.ok) {
    bucket.errors += 1;
    summary.errors.push(`${relativePath}: ${result.error || "READ_FAILED"}`);
    console.log(`[migrate] failed reading ${relativePath}: ${result.error || "READ_FAILED"}`);
    return;
  }

  if (result.parseErrors) {
    bucket.errors += result.parseErrors;
    summary.errors.push(`${relativePath}: ${result.parseErrors} JSONL parse error(s)`);
  }

  console.log(`[migrate] migrating ${label} from ${relativePath}`);

  for (const record of result.records) {
    try {
      const saved = await writer(record);
      if (saved.ok) {
        bucket.migrated += 1;
      } else {
        bucket.errors += 1;
        summary.errors.push(`${relativePath}: ${saved.error || saved.reason || "WRITE_FAILED"}`);
      }
    } catch (error) {
      bucket.errors += 1;
      summary.errors.push(`${relativePath}: ${error.message}`);
    }
  }

  console.log(`[migrate] ${label} migrated: ${bucket.migrated}`);
}

async function main() {
  const summary = {
    paperTrades: buildSummaryRow(),
    marketSnapshots: buildSummaryRow(),
    featureSnapshots: buildSummaryRow(),
    labeledSnapshots: buildSummaryRow(),
    strategyGuardReports: buildSummaryRow(),
    noSideShadowAudits: buildSummaryRow(),
    noSideShadowReports: buildSummaryRow(),
    skippedFiles: [],
    errors: [],
  };

  const connection = await connectMongo();
  console.log("[migrate] mongo connect", JSON.stringify(connection, null, 2));

  await migrateCollection({
    label: "paperTrades",
    relativePath: "data/kalshi-paper-trades.json",
    reader: readJsonRecords,
    writer: savePaperTradeMongo,
    summary,
  });
  await migrateCollection({
    label: "marketSnapshots",
    relativePath: "data/kalshi-market-snapshots.json",
    reader: readJsonRecords,
    writer: saveMarketSnapshotMongo,
    summary,
  });
  await migrateCollection({
    label: "featureSnapshots",
    relativePath: "data/kalshi-feature-snapshots.jsonl",
    reader: readJsonlRecords,
    writer: saveFeatureSnapshotMongo,
    summary,
  });
  await migrateCollection({
    label: "labeledSnapshots",
    relativePath: "data/kalshi-labeled-snapshots.json",
    reader: readJsonRecords,
    writer: saveLabeledSnapshotMongo,
    summary,
  });
  await migrateCollection({
    label: "strategyGuardReports",
    relativePath: "data/kalshi-strategy-guard-daily-results.json",
    reader: readJsonRecords,
    writer: saveStrategyGuardReportMongo,
    summary,
  });
  await migrateCollection({
    label: "noSideShadowAudits",
    relativePath: "data/kalshi-no-side-shadow-audit.jsonl",
    reader: readJsonlRecords,
    writer: saveNoSideShadowAuditMongo,
    summary,
  });
  await migrateCollection({
    label: "noSideShadowReports",
    relativePath: "data/kalshi-no-side-shadow-reports.json",
    reader: readJsonRecords,
    writer: saveNoSideShadowReportMongo,
    summary,
  });

  const stats = await getMongoStats();
  console.log("[migrate] summary", JSON.stringify(summary, null, 2));
  console.log("[migrate] mongo stats", JSON.stringify(stats, null, 2));

  const disconnected = await disconnectMongo();
  console.log("[migrate] disconnect", JSON.stringify(disconnected, null, 2));
}

main().catch(async (error) => {
  console.error("[migrate] fatal", error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
