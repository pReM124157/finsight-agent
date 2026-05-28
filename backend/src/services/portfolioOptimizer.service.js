const SECTOR_MAP = {
  RELIANCE: "ENERGY",
  INFY: "TECHNOLOGY",
  TCS: "TECHNOLOGY",
  HDFCBANK: "FINANCIALS",
  ICICIBANK: "FINANCIALS",
  SBIN: "FINANCIALS",
  SUNPHARMA: "HEALTHCARE",
  APOLLOHOSP: "HEALTHCARE",
  NESTLEIND: "CONSUMER_DEFENSIVE",
  TITAN: "CONSUMER_CYCLICAL",
  BAJFINANCE: "FINANCIALS",
  ADANIPORTS: "INDUSTRIALS",
  POWERGRID: "UTILITIES",
  COALINDIA: "ENERGY",
  TATASTEEL: "MATERIALS",
  JSWSTEEL: "MATERIALS",
  AXISBANK: "FINANCIALS"
};

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\.NS$/i, "")
    .replace(/[^A-Z0-9]/g, "");
}

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function inferHoldingValue(holding = {}) {
  const quantity = toNumber(holding.quantity, null);
  const avgPrice = toNumber(holding.avgPrice, null);
  if (quantity === null || avgPrice === null) return null;
  const inferredValue = quantity * avgPrice;
  return inferredValue > 0 ? Number(inferredValue.toFixed(2)) : null;
}

function inferSector(symbol, fallback = null) {
  const normalized = normalizeSymbol(symbol);
  const fallbackSector = typeof fallback === "string" ? fallback.trim().toUpperCase() : null;
  return SECTOR_MAP[normalized] || fallbackSector || null;
}

function buildWeightedHoldings(portfolio = []) {
  const holdings = portfolio.map((holding, index) => {
    const symbol = normalizeSymbol(holding?.symbol);
    const value = inferHoldingValue(holding);
    return {
      index,
      symbol,
      value,
      sector: inferSector(symbol, holding?.sector)
    };
  }).filter((holding) => holding.symbol);

  const valuedHoldings = holdings.filter((holding) => holding.value !== null);
  const hasCompleteValues = valuedHoldings.length === holdings.length && holdings.length > 0;
  const weights = new Map();

  if (hasCompleteValues) {
    const totalValue = valuedHoldings.reduce((sum, holding) => sum + holding.value, 0);
    for (const holding of holdings) {
      weights.set(holding.index, totalValue > 0 ? holding.value / totalValue : 0);
    }
  } else {
    const equalWeight = holdings.length > 0 ? 1 / holdings.length : 0;
    for (const holding of holdings) {
      weights.set(holding.index, equalWeight);
    }
  }

  return {
    holdings,
    totalValue: hasCompleteValues ? Number(valuedHoldings.reduce((sum, holding) => sum + holding.value, 0).toFixed(2)) : null,
    usesEqualWeightApproximation: !hasCompleteValues && holdings.length > 0,
    weights
  };
}

function calculateSectorExposure(portfolio = []) {
  const { holdings, weights } = buildWeightedHoldings(portfolio);
  const rawExposure = {};

  for (const holding of holdings) {
    const sector = holding.sector || "UNKNOWN";
    rawExposure[sector] = (rawExposure[sector] || 0) + (weights.get(holding.index) || 0);
  }

  return Object.fromEntries(
    Object.entries(rawExposure).map(([sector, weight]) => [sector, Number((weight * 100).toFixed(2))])
  );
}

function summarizePortfolio(portfolio = []) {
  const { holdings, totalValue, weights } = buildWeightedHoldings(portfolio);
  const sectorExposure = calculateSectorExposure(portfolio);

  let topHolding = null;
  let topHoldingWeight = -1;

  for (const holding of holdings) {
    const weight = weights.get(holding.index) || 0;
    if (weight > topHoldingWeight) {
      topHolding = holding.symbol;
      topHoldingWeight = weight;
    }
  }

  return {
    holdingsCount: holdings.length,
    totalValue,
    topHolding: topHolding || null,
    topHoldingWeightPct: topHoldingWeight >= 0 ? Number((topHoldingWeight * 100).toFixed(2)) : null,
    sectorExposure
  };
}

function buildSectorImpact({ portfolio = [], candidateSector = null, candidateAllocationPct = null } = {}) {
  const { holdings, weights } = buildWeightedHoldings(portfolio);
  const currentSectorExposure = calculateSectorExposure(portfolio);
  const normalizedCandidateSector = candidateSector || "UNKNOWN";
  const candidateWeight = toNumber(candidateAllocationPct, null) === null ? null : candidateAllocationPct / 100;

  const currentSectorExposurePct = candidateSector ? (currentSectorExposure[candidateSector] ?? 0) : null;
  const candidateAddsNewSector = Boolean(candidateSector) && !Object.prototype.hasOwnProperty.call(currentSectorExposure, candidateSector);

  let afterAddingSectorExposurePct = currentSectorExposurePct;
  if (candidateSector && candidateWeight !== null) {
    const scaledCurrent = holdings.length > 0
      ? holdings.reduce((sum, holding) => {
          const weight = weights.get(holding.index) || 0;
          return sum + ((holding.sector || "UNKNOWN") === normalizedCandidateSector ? weight * (1 - candidateWeight) : 0);
        }, 0)
      : 0;
    afterAddingSectorExposurePct = Number(((scaledCurrent + candidateWeight) * 100).toFixed(2));
  }

  const concentrationBase = afterAddingSectorExposurePct ?? currentSectorExposurePct ?? 0;

  return {
    currentSectorExposurePct,
    afterAddingSectorExposurePct,
    candidateAddsNewSector,
    concentrationWarning: concentrationBase > 35
  };
}

function decidePortfolioFit({
  portfolio = [],
  candidateSymbol,
  candidateSector = null,
  standaloneAction = null
} = {}) {
  const action = typeof standaloneAction === "string" ? standaloneAction.trim().toUpperCase() : null;
  const summary = summarizePortfolio(portfolio);
  const currentSectorExposurePct = candidateSector ? (summary.sectorExposure[candidateSector] ?? 0) : null;
  const topHoldingConcentrated = (summary.topHoldingWeightPct ?? 0) > 45;
  const risks = [];
  const positives = [];

  if (topHoldingConcentrated && summary.topHolding) {
    risks.push(`Portfolio is concentrated in ${summary.topHolding}.`);
  }

  if (!candidateSector) {
    return {
      portfolioFit: "NEUTRAL",
      portfolioAction: "WATCH",
      suggestedAllocationPct: null,
      shouldBuySeparately: action === "BUY",
      shouldBuyForPortfolio: false,
      reason: `Sector for ${normalizeSymbol(candidateSymbol)} could not be inferred safely, so portfolio guidance is conservative.`,
      risks,
      positives
    };
  }

  const addsNewSector = !Object.prototype.hasOwnProperty.call(summary.sectorExposure, candidateSector);

  if (action === "SELL" || action === "AVOID") {
    risks.push(`${normalizeSymbol(candidateSymbol)} is not strong enough on standalone analysis.`);
    return {
      portfolioFit: "BAD",
      portfolioAction: "AVOID",
      suggestedAllocationPct: null,
      shouldBuySeparately: false,
      shouldBuyForPortfolio: false,
      reason: "Standalone analysis is negative, so the stock should not be added for portfolio reasons.",
      risks,
      positives
    };
  }

  if (action !== "BUY") {
    risks.push("Standalone conviction is not strong enough to justify a portfolio allocation.");
    return {
      portfolioFit: "NEUTRAL",
      portfolioAction: "WATCH",
      suggestedAllocationPct: null,
      shouldBuySeparately: false,
      shouldBuyForPortfolio: false,
      reason: "The stock is not a clear standalone buy, so portfolio guidance stays conservative.",
      risks,
      positives
    };
  }

  if ((currentSectorExposurePct ?? 0) > 50) {
    risks.push(`${candidateSector} exposure is already above 50% of the portfolio.`);
    return {
      portfolioFit: "BAD",
      portfolioAction: "WATCH",
      suggestedAllocationPct: null,
      shouldBuySeparately: true,
      shouldBuyForPortfolio: false,
      reason: `The stock may be acceptable on its own, but adding more ${candidateSector} would worsen concentration risk.`,
      risks,
      positives
    };
  }

  if ((currentSectorExposurePct ?? 0) > 35) {
    risks.push(`${candidateSector} exposure is already elevated in the portfolio.`);
    positives.push(`${normalizeSymbol(candidateSymbol)} remains a standalone buy.`);
    return {
      portfolioFit: "NEUTRAL",
      portfolioAction: "ADD_SMALL",
      suggestedAllocationPct: 4,
      shouldBuySeparately: true,
      shouldBuyForPortfolio: true,
      reason: `The stock is attractive, but existing ${candidateSector} exposure calls for a smaller allocation.`,
      risks,
      positives
    };
  }

  if (addsNewSector) {
    positives.push(`${normalizeSymbol(candidateSymbol)} adds a new sector to the portfolio.`);
  } else {
    positives.push(`${normalizeSymbol(candidateSymbol)} increases an underweight sector without creating high concentration.`);
  }

  if (topHoldingConcentrated) {
    positives.push("The candidate helps diversify away from the portfolio's largest position.");
  }

  return {
    portfolioFit: "GOOD",
    portfolioAction: "ADD",
    suggestedAllocationPct: 6,
    shouldBuySeparately: true,
    shouldBuyForPortfolio: true,
    reason: addsNewSector
      ? `The stock improves diversification by adding ${candidateSector} exposure.`
      : `The stock fits the portfolio without pushing ${candidateSector} exposure into a risky range.`,
    risks,
    positives
  };
}

export async function optimizePortfolioCandidate({
  candidateSymbol,
  portfolio = [],
  standaloneRecommendation = null,
  userId = null,
  options = {}
} = {}) {
  void userId;
  void options;

  const normalizedPortfolio = Array.isArray(portfolio)
    ? portfolio.map((holding) => ({
        ...holding,
        symbol: normalizeSymbol(holding?.symbol)
      })).filter((holding) => holding.symbol)
    : [];

  const normalizedCandidate = normalizeSymbol(candidateSymbol);
  const standaloneAction = typeof standaloneRecommendation?.action === "string"
    ? standaloneRecommendation.action.trim().toUpperCase()
    : null;
  const standaloneConfidence = toNumber(standaloneRecommendation?.confidence, null);
  const candidateSector = inferSector(normalizedCandidate, standaloneRecommendation?.sector);
  const portfolioProvided = normalizedPortfolio.length > 0;

  if (!portfolioProvided) {
    return {
      portfolioProvided: false,
      candidate: normalizedCandidate,
      candidateSector,
      standaloneAction,
      standaloneConfidence,
      portfolioFit: "NOT_APPLICABLE",
      portfolioAction: "STANDALONE_ONLY",
      suggestedAllocationPct: null,
      shouldBuySeparately: standaloneAction === "BUY",
      shouldBuyForPortfolio: false,
      reason: "No portfolio was provided, so only standalone analysis applies.",
      risks: [],
      positives: [],
      currentPortfolioSummary: {
        holdingsCount: 0,
        totalValue: null,
        topHolding: null,
        topHoldingWeightPct: null,
        sectorExposure: {}
      },
      sectorImpact: {
        currentSectorExposurePct: null,
        afterAddingSectorExposurePct: null,
        candidateAddsNewSector: false,
        concentrationWarning: false
      },
      version: "portfolio-optimizer-v1"
    };
  }

  const decision = decidePortfolioFit({
    portfolio: normalizedPortfolio,
    candidateSymbol: normalizedCandidate,
    candidateSector,
    standaloneAction
  });
  const currentPortfolioSummary = summarizePortfolio(normalizedPortfolio);
  const sectorImpact = buildSectorImpact({
    portfolio: normalizedPortfolio,
    candidateSector,
    candidateAllocationPct: decision.suggestedAllocationPct
  });

  return {
    portfolioProvided: true,
    candidate: normalizedCandidate,
    candidateSector,
    standaloneAction,
    standaloneConfidence,
    portfolioFit: decision.portfolioFit,
    portfolioAction: decision.portfolioAction,
    suggestedAllocationPct: decision.suggestedAllocationPct,
    shouldBuySeparately: decision.shouldBuySeparately,
    shouldBuyForPortfolio: decision.shouldBuyForPortfolio,
    reason: decision.reason,
    risks: decision.risks,
    positives: decision.positives,
    currentPortfolioSummary,
    sectorImpact,
    version: "portfolio-optimizer-v1"
  };
}
