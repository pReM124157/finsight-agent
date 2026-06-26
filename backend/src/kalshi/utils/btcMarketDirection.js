function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function inferBtcYesContractDirection(snapshot = {}) {
  const normalizedTitle = String(
    snapshot?.market_title || snapshot?.marketTitle || snapshot?.contractTitle || ""
  )
    .trim()
    .toUpperCase();
  const normalizedTicker = String(snapshot?.market_ticker || snapshot?.marketTicker || "")
    .trim()
    .toUpperCase();

  if (normalizedTitle.includes("PRICE UP")) return "UP";
  if (normalizedTitle.includes("PRICE DOWN")) return "DOWN";
  if (normalizedTitle.includes("ABOVE")) return "UP";
  if (normalizedTitle.includes("BELOW")) return "DOWN";

  if (normalizedTicker.startsWith("KXBTC")) {
    return "UP";
  }

  return null;
}

export function inferBtcMarketDirectionWithFallback(snapshot = {}) {
  const contractDirection = inferBtcYesContractDirection(snapshot);
  if (contractDirection) {
    return contractDirection;
  }

  const entryPrice = safeNumber(snapshot?.btc_price ?? snapshot?.btcPrice);
  const targetPrice = safeNumber(snapshot?.target_price ?? snapshot?.targetPrice);

  if (entryPrice === null || targetPrice === null) {
    return null;
  }

  return targetPrice >= entryPrice ? "UP" : "DOWN";
}
