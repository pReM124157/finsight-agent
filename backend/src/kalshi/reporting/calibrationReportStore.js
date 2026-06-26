import fs from "node:fs";
import path from "node:path";

import { getMongoConnectionState, isMongoEnabled } from "../../db/mongoClient.js";
import { CalibrationReport } from "../models/CalibrationReport.model.js";

const CALIBRATION_REPORT_PATH =
  process.env.KALSHI_CALIBRATION_REPORT_PATH ||
  path.resolve("backend/data/kalshi-calibration-report.json");

function ensureDir() {
  const dir = path.dirname(CALIBRATION_REPORT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getCalibrationReportPath() {
  return CALIBRATION_REPORT_PATH;
}

export function writeCalibrationReport(report) {
  ensureDir();
  fs.writeFileSync(
    CALIBRATION_REPORT_PATH,
    JSON.stringify(report, null, 2) + "\n",
    "utf8"
  );
}

export async function saveCalibrationReportMongo(report) {
  const state = getMongoConnectionState();
  if (!isMongoEnabled() || state.stateLabel !== "connected") {
    return {
      ok: false,
      skipped: true,
      reason: "MONGO_NOT_READY",
      state,
    };
  }

  try {
    const filter = {
      reportType: report?.reportType || "CALIBRATION_ANALYSIS",
      reportDate: report?.reportDate || "UNKNOWN",
    };

    const saved = await CalibrationReport.findOneAndUpdate(
      filter,
      {
        $set: {
          ...report,
          updatedAtMongo: new Date().toISOString(),
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    return {
      ok: true,
      collection: CalibrationReport.collection.name,
      id: saved?.id || saved?._id?.toString() || null,
    };
  } catch (error) {
    return {
      ok: false,
      collection: CalibrationReport.collection.name,
      error: error.message,
    };
  }
}

export async function saveCalibrationReport(report) {
  writeCalibrationReport(report);
  const mongo = await saveCalibrationReportMongo(report);
  return {
    ok: true,
    path: getCalibrationReportPath(),
    mongo,
  };
}
