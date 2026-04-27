export function generateRebalanceAdvice(portfolio) {
  if (!portfolio || portfolio.length === 0) {
    return {
      alert: "No portfolio data available",
      recommendation: "Add holdings first"
    };
  }

  let total = portfolio.reduce((sum, stock) => sum + stock.investedAmount, 0);

  let sectorMap = {};
  let biggestStock = null;

  for (const stock of portfolio) {
    const sector = stock.sector || "Unknown";

    if (!sectorMap[sector]) {
      sectorMap[sector] = 0;
    }

    sectorMap[sector] += stock.investedAmount;

    if (
      !biggestStock ||
      stock.investedAmount > biggestStock.investedAmount
    ) {
      biggestStock = stock;
    }
  }

  let dominantSector = "";
  let dominantValue = 0;

  for (const sector in sectorMap) {
    if (sectorMap[sector] > dominantValue) {
      dominantValue = sectorMap[sector];
      dominantSector = sector;
    }
  }

  const sectorPercent = ((dominantValue / total) * 100).toFixed(2);
  const stockPercent = (
    (biggestStock.investedAmount / total) * 100
  ).toFixed(2);

  let recommendation = [];

  if (sectorPercent > 50) {
    recommendation.push(
      `Reduce ${dominantSector} exposure (${sectorPercent}%)`
    );
  }

  if (stockPercent > 30) {
    recommendation.push(
      `Trim ${biggestStock.symbol} allocation (${stockPercent}%)`
    );
  }

  if (recommendation.length === 0) {
    recommendation.push("Portfolio looks balanced");
  }

  return {
    dominantSector,
    sectorPercent,
    biggestStock: biggestStock.symbol,
    stockPercent,
    recommendation: recommendation.join(". ")
  };
}