import dotenv from "dotenv";
dotenv.config();

import {
  evaluateKalshiTradeRisk,
  summarizePaperRiskState,
  defaultKalshiRiskLimits,
} from "../src/kalshi/risk/kalshiRiskEngine.js";

function runScenario(label, tradeCandidate, currentState, limits = {}) {
  const result = evaluateKalshiTradeRisk({
    tradeCandidate,
    currentState,
    limits: {
      ...defaultKalshiRiskLimits,
      ...limits,
    },
  });

  console.log(`\n[SCENARIO] ${label}`);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  console.log("=== Probability OS Kalshi Risk Engine Test ===");

  const baseTrade = {
    mode: "PAPER",
    side: "YES",
    sizeUsd: 50,
    adjustedEdge: 12,
    confidenceScore: 72,
  };

  runScenario("Approved paper trade", baseTrade, {
    openExposureUsd: 100,
    dailyLossUsd: 0,
    tradesToday: 2,
  }, {
    killSwitchEnabled: false,
  });

  runScenario("Reject low edge", {
    ...baseTrade,
    adjustedEdge: 2,
  }, {
    openExposureUsd: 100,
    dailyLossUsd: 0,
    tradesToday: 2,
  }, {
    killSwitchEnabled: false,
  });

  runScenario("Reject max exposure", baseTrade, {
    openExposureUsd: 980,
    dailyLossUsd: 0,
    tradesToday: 2,
  }, {
    killSwitchEnabled: false,
  });

  runScenario("Reject kill switch", baseTrade, {
    openExposureUsd: 100,
    dailyLossUsd: 0,
    tradesToday: 2,
  }, {
    killSwitchEnabled: true,
  });

  runScenario("Reject live execution disabled", {
    ...baseTrade,
    mode: "LIVE",
  }, {
    openExposureUsd: 100,
    dailyLossUsd: 0,
    tradesToday: 2,
  }, {
    killSwitchEnabled: false,
  });

  const demoTrades = [
    {
      status: "OPEN",
      costUsd: 16,
      openedAt: new Date().toISOString(),
    },
    {
      status: "WON",
      costUsd: 20,
      pnlUsd: 80,
      openedAt: new Date().toISOString(),
    },
    {
      status: "LOST",
      costUsd: 25,
      pnlUsd: -25,
      openedAt: new Date().toISOString(),
    },
  ];

  console.log("\n[PAPER RISK STATE]");
  console.log(JSON.stringify(summarizePaperRiskState(demoTrades), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
