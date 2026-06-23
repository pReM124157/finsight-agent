import dotenv from "dotenv";
dotenv.config();

import { getKalshiMarkets } from "../src/kalshi/data/kalshiClient.js";
import {
  explainMarketClassification,
  isBtcMarket,
} from "../src/kalshi/agents/marketScanner.js";

async function main() {
  console.log("=== Kalshi Scanner Classification Test ===");

  const response = await getKalshiMarkets({
    status: "open",
    limit: 25,
  });

  const markets = response.markets || [];
  const sample = markets.slice(0, 10).map((market) => ({
    ticker: market?.ticker || null,
    title: market?.title || null,
  }));
  const classifications = markets.slice(0, 10).map(explainMarketClassification);
  const btcMatches = markets.filter(isBtcMarket);
  const btcMatchSample = btcMatches.slice(0, 5).map(explainMarketClassification);

  console.log("\n[TOTAL COUNT]");
  console.log(markets.length);

  console.log("\n[FIRST 10 MARKETS]");
  console.log(JSON.stringify(sample, null, 2));

  console.log("\n[CLASSIFICATION SAMPLE]");
  console.log(JSON.stringify(classifications, null, 2));

  console.log("\n[BTC MATCHES COUNT]");
  console.log(btcMatches.length);

  console.log("\n[BTC MATCH SAMPLE]");
  console.log(JSON.stringify(btcMatchSample, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
