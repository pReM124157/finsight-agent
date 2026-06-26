import { evaluateTargetDistanceGuard } from "../src/kalshi/risk/targetDistanceGuard.js";

const scenarios = [
  {
    label: "Normal 100 dollar target",
    currentPrice: 64147,
    targetPrice: 64247,
    minutesRemaining: 15,
  },
  {
    label: "Far 282 dollar target",
    currentPrice: 64147,
    targetPrice: 64429,
    minutesRemaining: 15,
  },
  {
    label: "Very far 400 dollar target",
    currentPrice: 64147,
    targetPrice: 64547,
    minutesRemaining: 15,
  },
];

for (const scenario of scenarios) {
  console.log(`\n[${scenario.label}]`);
  console.log(JSON.stringify(evaluateTargetDistanceGuard(scenario), null, 2));
}
