import dotenv from "dotenv";
import path from "node:path";

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import {
  generateVigAuditReport,
  printVigAuditReport,
  writeVigAuditReport,
} from "../src/kalshi/reporting/vigAuditReport.js";

dotenv.config({ path: path.resolve("backend/.env") });
dotenv.config();

async function main() {
  const connection = await connectMongo();
  console.log("[vig-audit] mongo", JSON.stringify(connection, null, 2));

  const report = await generateVigAuditReport();
  printVigAuditReport(report);

  const savedPath = writeVigAuditReport(report);
  console.log("");
  console.log(`[vig-audit] saved file: ${savedPath}`);

  await disconnectMongo();
}

main().catch(async (error) => {
  console.error("[vig-audit] fatal", error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
