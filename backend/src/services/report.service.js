import { masterAgent } from "../agents/master.agent.js";
import { buildAnalysisContext } from "../core/analysisContext.js";
import { getLatestAnalyticsReport } from "./publicAnalytics.service.js";

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

export async function buildStockReportPayload(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) {
    throw new Error("SYMBOL_REQUIRED");
  }

  const { stockData } = await buildAnalysisContext(normalizedSymbol);
  const analysisData = await masterAgent(stockData, { strictValidation: true });

  if (!analysisData) {
    throw new Error("ANALYSIS_UNAVAILABLE");
  }

  let performanceStats = null;
  try {
    performanceStats = await getLatestAnalyticsReport();
  } catch {
    performanceStats = null;
  }

  return {
    symbol: normalizedSymbol,
    stockData,
    analysisData,
    performanceStats
  };
}
