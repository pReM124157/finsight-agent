import fs from "node:fs";
import path from "node:path";
import {
  isMongoDualWriteEnabled,
  saveNoSideShadowReportMongo,
} from "../storage/mongoPersistence.js";

const NO_SIDE_SHADOW_REPORT_PATH =
  process.env.KALSHI_NO_SIDE_SHADOW_REPORT_PATH ||
  path.resolve("data/kalshi-no-side-shadow-reports.json");

function ensureDir() {
  const dir = path.dirname(NO_SIDE_SHADOW_REPORT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readNoSideShadowReports() {
  ensureDir();

  if (!fs.existsSync(NO_SIDE_SHADOW_REPORT_PATH)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(NO_SIDE_SHADOW_REPORT_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeNoSideShadowReports(reports = []) {
  ensureDir();
  fs.writeFileSync(
    NO_SIDE_SHADOW_REPORT_PATH,
    JSON.stringify(reports, null, 2) + "\n",
    "utf8"
  );
}

export function saveNoSideShadowReport(report) {
  const reports = readNoSideShadowReports();
  const key = `${report?.reportDate || "UNKNOWN"}::${report?.generatedAt || ""}`;
  const index = reports.findIndex((row) => `${row?.reportDate || "UNKNOWN"}::${row?.generatedAt || ""}` === key);

  if (index >= 0) {
    reports[index] = {
      ...reports[index],
      ...report,
    };
  } else {
    reports.push(report);
  }

  reports.sort((a, b) => String(a?.generatedAt || "").localeCompare(String(b?.generatedAt || "")));
  writeNoSideShadowReports(reports);

  if (isMongoDualWriteEnabled()) {
    saveNoSideShadowReportMongo(report).catch((error) => {
      console.warn("[mongo] NO-side shadow report dual-write failed:", error.message);
    });
  }

  return report;
}

export function getLatestNoSideShadowReport() {
  return readNoSideShadowReports().at(-1) || null;
}

export function getNoSideShadowReportPath() {
  return NO_SIDE_SHADOW_REPORT_PATH;
}
