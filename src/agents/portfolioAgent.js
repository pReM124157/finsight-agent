export async function analyzePortfolio(stocks) {
  if (!stocks || stocks.length === 0) {
    return {
      healthScore: 0,
      dominantSector: "No holdings",
      highestStock: { symbol: "None", normalizedAllocation: 0 },
      dominantSectorWeight: "0",
      topAllocation: 0,
      suggestion: "Add portfolio holdings first"
    };
  }
  try {
    let portfolio = [];
    let sectorMap = {};
    let totalWeight = 0;

    for (const item of stocks) {
      const symbol = item.symbol?.toLowerCase() || "unknown";
      const allocation = Number(item.allocation || 100);

      const sectorLookup = {
        tcs: "IT",
        infosys: "IT",
        wipro: "IT",
        hdfcbank: "Banking",
        icicibank: "Banking",
        reliance: "Energy",
        asianpaints: "FMCG",
        hul: "FMCG",
        sunpharma: "Pharma",
        cipla: "Pharma",
        titan: "Consumer",
      };
      const sector = sectorLookup[symbol] || "Unknown";

      portfolio.push({
        symbol,
        allocation,
        sector,
      });

      totalWeight += allocation;

      if (!sectorMap[sector]) {
        sectorMap[sector] = 0;
      }

      sectorMap[sector] += allocation;
    }

    // Normalize allocations if not 100
    portfolio = portfolio.map((stock) => ({
      ...stock,
      normalizedAllocation: (
        (stock.allocation / totalWeight) *
        100
      ).toFixed(2),
    }));

    // Find highest concentration
    const highestStock = (portfolio || []).length > 0 ? portfolio.reduce((prev, curr) =>
      Number(curr.normalizedAllocation) >
      Number(prev.normalizedAllocation)
        ? curr
        : prev
    ) : { symbol: "None", normalizedAllocation: 0 };

    // Find dominant sector
    let dominantSector = "";
    let dominantSectorWeight = 0;

    for (const sector in sectorMap) {
      const normalized =
        (sectorMap[sector] / totalWeight) * 100;

      if (normalized > dominantSectorWeight) {
        dominantSectorWeight = normalized;
        dominantSector = sector;
      }
    }

    // Health score logic
    let healthScore = 10;

    if (dominantSectorWeight > 50) healthScore -= 3;
    if (Number(highestStock.normalizedAllocation) > 35) healthScore -= 3;
    if (portfolio.length < 4) healthScore -= 2;

    let suggestion = "";

    if (dominantSectorWeight > 50) {
      suggestion += `Reduce ${dominantSector} exposure. `;
    }

    if (Number(highestStock.normalizedAllocation) > 35) {
      suggestion += `Trim ${highestStock.symbol.toUpperCase()} allocation. `;
    }

    if (portfolio.length < 4) {
      suggestion += `Add more diversification across sectors.`;
    }

    return {
      portfolio,
      healthScore: Math.max(healthScore, 1),
      highestStock,
      dominantSector,
      dominantSectorWeight: dominantSectorWeight.toFixed(2),
      topAllocation: Number(highestStock.normalizedAllocation),
      suggestion,
      performanceScore: healthScore // Added to support decision agent
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function portfolioAgent(data) {
  return await analyzePortfolio([data]);
}