import {
  inferBtcMarketDirectionWithFallback,
  inferBtcYesContractDirection,
} from "../utils/btcMarketDirection.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalCdfApprox(x) {
  // Abramowitz-Stegun approximation
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);

  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const erf =
    1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-absX * absX);

  return 0.5 * (1 + sign * erf);
}

export function estimateBtcReachability({
  currentPrice,
  targetPrice,
  minutesRemaining = 15,
  annualizedVolatility = 0.55,
  momentumBps = 0,
  marketProbability = null,
  marketTicker = null,
  marketTitle = null,
  contractDirection = null,
} = {}) {
  const current = safeNumber(currentPrice);
  const target = safeNumber(targetPrice);
  const minutes = safeNumber(minutesRemaining, 15);
  const vol = safeNumber(annualizedVolatility, 0.55);
  const momentum = safeNumber(momentumBps, 0);

  if (!current || !target || current <= 0 || target <= 0) {
    return {
      ok: false,
      reason: "INVALID_PRICE_INPUT",
      modelProbability: null,
    };
  }

  if (minutes <= 0) {
    return {
      ok: false,
      reason: "INVALID_TIME_INPUT",
      modelProbability: null,
    };
  }

  const distance = target - current;
  const contractSide =
    String(contractDirection || "").trim().toUpperCase() ||
    inferBtcYesContractDirection({
      marketTicker,
      marketTitle,
    }) ||
    inferBtcMarketDirectionWithFallback({
      marketTicker,
      marketTitle,
      btcPrice: current,
      targetPrice: target,
    });
  const direction = distance >= 0 ? "UP" : "DOWN";
  const absDistance = Math.abs(distance);
  const distanceBps = (absDistance / current) * 10000;

  // Convert annualized volatility to short-window standard deviation.
  // Crypto trades continuously: 365 days * 24 hours * 60 minutes.
  const minutesPerYear = 365 * 24 * 60;
  const timeFraction = minutes / minutesPerYear;
  const expectedStdPct = vol * Math.sqrt(timeFraction);
  const expectedStdPrice = current * expectedStdPct;

  if (!expectedStdPrice || expectedStdPrice <= 0) {
    return {
      ok: false,
      reason: "INVALID_VOLATILITY_INPUT",
      modelProbability: null,
    };
  }

  // Momentum shifts the target distance slightly.
  // Positive momentum helps UP targets and hurts DOWN targets.
  const momentumPriceImpact = current * (momentum / 10000);
  const adjustedDistance =
    contractSide === "DOWN"
      ? absDistance + momentumPriceImpact
      : distance - momentumPriceImpact;

  const zScore = adjustedDistance / expectedStdPrice;

  // Estimate the probability that the contract settles YES.
  const rawProbability =
    contractSide === "DOWN"
      ? normalCdfApprox(-zScore)
      : 1 - normalCdfApprox(zScore);

  const modelProbability = clamp(rawProbability, 0.001, 0.999);
  const resolvedDirection = contractSide || direction;

  const marketProb = marketProbability === null ? null : safeNumber(marketProbability);
  const edge =
    marketProb === null
      ? null
      : Number(((modelProbability * 100) - marketProb).toFixed(2));

  let reachabilityGrade = "LOW";
  if (modelProbability >= 0.65) {
    reachabilityGrade = "HIGH";
  } else if (modelProbability >= 0.4) {
    reachabilityGrade = "MEDIUM";
  }

  return {
    ok: true,
    currentPrice: current,
    targetPrice: target,
    direction: resolvedDirection,
    minutesRemaining: minutes,
    annualizedVolatility: vol,
    momentumBps: momentum,
    distance: Number(distance.toFixed(2)),
    distanceBps: Number(distanceBps.toFixed(2)),
    expectedStdPrice: Number(expectedStdPrice.toFixed(2)),
    zScore: Number(zScore.toFixed(3)),
    modelProbability: Number((modelProbability * 100).toFixed(2)),
    marketProbability: marketProb,
    edge,
    reachabilityGrade,
    explanation:
      `BTC needs to settle ${resolvedDirection === "DOWN" ? "at or below" : "at or above"} the target in ${minutes} minutes. ` +
      `Model YES probability is ${Number((modelProbability * 100).toFixed(2))}%.`,
  };
}
