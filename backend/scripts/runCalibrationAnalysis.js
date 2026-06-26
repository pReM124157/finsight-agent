import dotenv from "dotenv";
import path from "node:path";

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import {
  generateCalibrationReport,
  printCalibrationReport,
} from "../src/kalshi/reporting/calibrationReport.js";
import {
  getCalibrationReportPath,
  saveCalibrationReport,
} from "../src/kalshi/reporting/calibrationReportStore.js";

dotenv.config({ path: path.resolve("backend/.env") });
dotenv.config();

async function main() {
  const connection = await connectMongo();
  console.log("[calibration] mongo", JSON.stringify(connection, null, 2));

  const report = await generateCalibrationReport();
  printCalibrationReport(report);

  const saved = await saveCalibrationReport(report);
  console.log("");
  console.log(`[calibration] saved file: ${getCalibrationReportPath()}`);
  console.log(`[calibration] mongo save: ${JSON.stringify(saved.mongo, null, 2)}`);

  await disconnectMongo();
}

main().catch(async (error) => {
  console.error("[calibration] fatal", error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
