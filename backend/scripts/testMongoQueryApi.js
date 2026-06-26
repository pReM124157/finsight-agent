import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import {
  getMongoHealth,
  listPaperTradesMongo,
  listMarketSnapshotsMongo,
  listFeatureSnapshotsMongo,
  listNoSideShadowAuditsMongo,
  getLatestMongoRecords,
} from "../src/kalshi/storage/mongoQueryService.js";

async function main() {
  const connection = await connectMongo();
  console.log("[mongo:query] connect", JSON.stringify(connection, null, 2));

  const health = await getMongoHealth();
  const paperTrades = await listPaperTradesMongo({ limit: 5 });
  const marketSnapshots = await listMarketSnapshotsMongo({ limit: 5 });
  const featureSnapshots = await listFeatureSnapshotsMongo({ limit: 5 });
  const noShadowAudits = await listNoSideShadowAuditsMongo({ limit: 5 });
  const latest = await getLatestMongoRecords();

  console.log("[mongo:query] health", JSON.stringify(health, null, 2));
  console.log("[mongo:query] paperTrades", JSON.stringify(paperTrades, null, 2));
  console.log("[mongo:query] marketSnapshots", JSON.stringify(marketSnapshots, null, 2));
  console.log("[mongo:query] featureSnapshots", JSON.stringify(featureSnapshots, null, 2));
  console.log("[mongo:query] noShadowAudits", JSON.stringify(noShadowAudits, null, 2));
  console.log("[mongo:query] latest", JSON.stringify(latest, null, 2));

  const disconnected = await disconnectMongo();
  console.log("[mongo:query] disconnect", JSON.stringify(disconnected, null, 2));
}

main().catch(async (error) => {
  console.error("[mongo:query] fatal", error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
