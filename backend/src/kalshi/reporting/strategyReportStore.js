import fs from "node:fs";
import path from "node:path";
import {
  isMongoDualWriteEnabled,
  saveStrategyGuardReportMongo,
} from "../storage/mongoPersistence.js";

const STRATEGY_REPORT_PATH =
  process.env.KALSHI_STRATEGY_REPORT_PATH ||
  path.resolve("data/kalshi-strategy-guard-daily-results.json");

function ensureDir() {
  const dir = path.dirname(STRATEGY_REPORT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readStrategyGuardDailyReports() {
  ensureDir();

  if (!fs.existsSync(STRATEGY_REPORT_PATH)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STRATEGY_REPORT_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStrategyGuardDailyReports(reports = []) {
  ensureDir();
  fs.writeFileSync(
    STRATEGY_REPORT_PATH,
    JSON.stringify(reports, null, 2) + "\n",
    "utf8"
  );
}

export function saveStrategyGuardDailyReport(report) {
  const reports = readStrategyGuardDailyReports();
  const index = reports.findIndex((row) => row?.date === report?.date);

  if (index >= 0) {
    reports[index] = {
      ...reports[index],
      ...report,
    };
  } else {
    reports.push(report);
  }

  reports.sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
  writeStrategyGuardDailyReports(reports);

  if (isMongoDualWriteEnabled()) {
    saveStrategyGuardReportMongo(report).catch((error) => {
      console.warn("[mongo] strategy report dual-write failed:", error.message);
    });
  }

  return report;
}

export function getLatestStrategyGuardDailyReport() {
  const reports = readStrategyGuardDailyReports();
  return reports.at(-1) || null;
}

export function getStrategyGuardReportPath() {
  return STRATEGY_REPORT_PATH;
}
