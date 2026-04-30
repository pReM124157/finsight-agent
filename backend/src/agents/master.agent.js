import { riskAgent } from "./risk.agent.js";
import { portfolioAgent } from "./portfolioAgent.js";
import { decisionAgent } from "./decision.agent.js";
import { rebalancingAgent } from "./rebalancing.agent.js";
import { rankingAgent } from "./ranking.agent.js";
import { capitalAgent } from "./capital.agent.js";
import { analyzeEntryTiming } from "./entryTiming.agent.js";
import { getLiveMarketData } from "../services/marketData.service.js";
import { technicalAgent } from "./technical.agent.js";
import { valuationAgent } from "./valuation.agent.js";
import { analyzeExitSignal } from "./exitSignal.agent.js";
import { calculatePositionSize } from "./positionSizing.agent.js";
import { analyzeRebalancing } from "./rebalancer.agent.js";
import { logRecommendation, getLearningBoost } from "./performanceTracker.agent.js";
import { analyzeEventRisk } from "./eventRisk.agent.js";

import { generateInvestmentAnalysis } from "../services/claude.service.js";

export async function masterAgent(input) {
  try {
    // Check if it's a conversation mode request
    if (input && input.mode === "conversation") {
      const { userQuery } = input;
      
      // Attempt to extract ticker (uppercase words 3-10 chars, excluding common small words)
      const tickerMatch = userQuery.match(/\b(?!(?:THE|AND|FOR|FOR|BUY|SELL|STOCK|THIS|THAT|WHAT|WITH|YOUR|WORK|FROM|INTO|ONTO)\b)[A-Z]{3,10}\b/);
      let liveDataSnippet = "";
      
      if (tickerMatch) {
          const ticker = tickerMatch[0];
          try {
              const data = await getLiveMarketData(ticker);
              if (data && data.currentPrice > 0 && data.priceSource !== "FAILED") {
                  liveDataSnippet = `
[LIVE MARKET DATA FOR ${ticker}]
Current Price: ₹${data.currentPrice}
52W Range: ₹${data.fiftyTwoWeekLow} - ₹${data.fiftyTwoWeekHigh}
Volume: ${data.volume}
Market Cap: ${data.marketCap}
Previous Close: ₹${data.previousClose}

INSTRUCTION: You MUST use these exact numbers for ${ticker}. Never guess or use stale training data for prices, volume, or ranges.
                  `.trim();
              }
          } catch (err) {
              console.log("Failed to fetch live data for conversation context:", ticker);
          }
      }

      const masterPrompt = `
You are Finsight AI, a sophisticated financial assistant. 
Your goal is to provide intelligent, data-driven financial insights.

${liveDataSnippet}

User Question: ${userQuery}

Guidelines:
1. Be professional, concise, and helpful.
2. If asked about your work, explain that you are a multi-agent AI system designed to analyze stocks, rank opportunities, and provide portfolio insights.
3. If asked for investment advice (e.g., "Should I buy TCS?"), provide a balanced view based on general market principles but emphasize that you are an AI and not a SEBI registered advisor. Mention that users can use /analyze TICKER for a deep dive report.
4. If asked about specific investment amounts (e.g., "Can I invest 50k?"), discuss general asset allocation and risk management principles.
5. If live data is provided above, incorporate it naturally into your response to ensure absolute factual accuracy.
6. Always maintain a neutral but informative tone.
`.trim();

      const response = await generateInvestmentAnalysis(masterPrompt);
      return { response };
    }

    // Otherwise, treat as stock analysis request
    const stockData = input || {};
    console.log("MASTER AGENT INPUT:", JSON.stringify(stockData).substring(0, 200));

    const ticker = 
      stockData.Symbol || 
      stockData.ticker || 
      stockData.symbol || 
      "UNKNOWN";

    console.log("--- MASTER AGENT DEBUG ---");
    console.log("TICKER:", ticker);
    console.log("INPUT DATA KEYS:", Object.keys(stockData));

    // Fix: Pre-declare execution variables for safety overrides
    let entryStrategy = "WAIT";
    let allocation = 0;
    let capitalAction = "Blocked by execution layer";

    // PHASE 1: Data Fetch & Integrity Guard
    console.log(`[Phase 1] Fetching live market data for ${ticker}...`);
    const liveMarketData = await getLiveMarketData(ticker);

    // FINAL GLOBAL GUARD: Data Integrity Check
    if (
        !liveMarketData || 
        !liveMarketData.currentPrice || 
        liveMarketData.currentPrice === 0 || 
        liveMarketData.priceSource === "UNKNOWN" ||
        liveMarketData.priceSource === "FAILED" ||
        liveMarketData.priceSource === "NONE" ||
        liveMarketData.error
    ) {
        console.warn(`[GLOBAL GUARD] Data Unavailable for ${ticker}. Aborting analysis.`);
        return {
            status: "DATA_UNAVAILABLE",
            message: `⚠ Data Unavailable for ${ticker} — Skipping analysis`,
            ticker,
            blockExecution: true
        };
    }

    console.log(`[Phase 1.5] Proceeding with full analysis for ${ticker}...`);
    const [risk, decision, technical, valuation] = await Promise.all([
      riskAgent(stockData),
      decisionAgent(stockData),
      technicalAgent(ticker),
      valuationAgent(stockData)
    ]);
    console.log(`[Phase 1] Completed. Live Price: ₹${liveMarketData.currentPrice}`);
    
    // CRITICAL GUARD: Hard block if price data is missing or invalid
    if (!liveMarketData.currentPrice || liveMarketData.currentPrice === 0) {
      console.warn(`[BLOCK] Market data unavailable for ${ticker}. Skipping full analysis.`);
      return {
        error: true,
        message: "Market data unavailable. Technical execution skipped.",
        ticker: ticker,
        decision: {
          finalDecision: "DATA UNAVAILABLE",
          reason: `Unable to fetch live market price for ${ticker}. Fallback sources exhausted.`
        },
        entryTiming: {
          strategy: "NO TRADE",
          reasoning: "⚠ Data Unavailable — Skipping technical execution",
          stopLoss: null,
          target: null,
          entryZone: null
        }
      };
    }

    // PHASE 2: Execution Intelligence (Entry Timing)
    const activePrice = Number(liveMarketData?.currentPrice || technical?.currentPrice || 0);
    const isDegraded = liveMarketData.isStale || false;

    console.log(`[Phase 2] Pre-flight Price Check for ${ticker}: ₹${activePrice} ${isDegraded ? "(STALE/DEGRADED)" : ""}`);

    const entryTiming = await analyzeEntryTiming({
      stock: ticker,
      currentPrice: activePrice,
      confidenceScore: decision.finalConfidenceScore || 5,
      riskLevel: risk.riskLevel || "MEDIUM",
      valuationScore: valuation.score || 5,
      momentumScore: technical.score || 5,
      technicalData: technical,
      marketData: liveMarketData,
      companyData: stockData
    });

    // PHASE 2.5: Exit Strategy Analysis
    const parseCurrency = (str) => Number(str?.replace(/[^0-9.]/g, "")) || 0;
    
    const exitSignal = await analyzeExitSignal({
      stock: ticker,
      currentPrice: activePrice,
      stopLoss: parseCurrency(entryTiming.stopLoss),
      target: parseCurrency(entryTiming.initialTarget),
      technicalData: technical,
      marketData: liveMarketData,
      companyData: stockData,
      valuationScore: valuation.score
    });

    // PHASE 2.6: Event Risk Analysis
    const eventRisk = await analyzeEventRisk({
      symbol: ticker,
      earningsDate: stockData.EarningsDate
    });

    // PHASE 3: Confidence Alignment & Learning Feedback
    const learningBoost = await getLearningBoost(ticker);
    
    // Adjusting confidence based on execution readiness and historical feedback
    let adjustedConfidence = (decision.finalConfidenceScore || 5) + learningBoost;
    
    // PARTIAL DATA GUARD: Downgrade confidence if key metrics are missing
    const hasMissingFundamentals = !stockData.ReturnOnEquityTTM || !stockData.DebtToEquityRatio || !stockData.QuarterlyRevenueGrowthYOY;
    if (hasMissingFundamentals) {
      console.log(`[PARTIAL DATA] Missing key fundamental metrics for ${ticker}. Capping confidence.`);
      adjustedConfidence = Math.min(adjustedConfidence, 4);
    }

    if (entryTiming.strategy === "CAUTIOUS ENTRY") {
      adjustedConfidence = Math.min(adjustedConfidence, 6);
    } else if (entryTiming.strategy === "AVOID ENTRY") {
      adjustedConfidence = Math.min(adjustedConfidence, 4);
    } else if (entryTiming.strategy === "STRONG ENTRY") {
      adjustedConfidence = Math.min(adjustedConfidence, 10);
    }
    
    // CRITICAL: Downgrade confidence and restrict strategy in Degraded/Blocked Mode
    if (isDegraded || liveMarketData.priceSource !== "LIVE" || liveMarketData.latencyBlocked) {
      console.log(`[EXECUTION BLOCK] Critical state for ${ticker}. Source: ${liveMarketData.priceSource}, Latency Blocked: ${liveMarketData.latencyBlocked}`);
      
      // Normalize degraded confidence [2, 3]
      adjustedConfidence = Math.min(Math.max(adjustedConfidence, 2), 3);
      
      entryStrategy = "WAIT";
      allocation = 0;
      capitalAction = "Blocked by execution layer";

      entryTiming.strategy = "WAIT";
      entryTiming.entryUrgency = "LOW";
      entryTiming.reasoning = `⚠ Critical Data Status: Analysis restricted for safety. Data source is ${liveMarketData.priceSource} and latency is ${liveMarketData.latencyBlocked ? 'BLOCKED' : 'STALE'}.`;
      entryTiming.finalExecutionAdvice = "Wait for live data restoration.";
    }

    // Ensure score stays within 1-10 range
    adjustedConfidence = Math.min(Math.max(adjustedConfidence, 1), 10);

    const finalDecision = {
      ...decision,
      finalConfidenceScore: adjustedConfidence,
      reason: isDegraded ? `[STALE DATA] ${decision.reason}` : (hasMissingFundamentals ? `[PARTIAL DATA] ${decision.reason}` : decision.reason)
    };

    // PHASE 4: Strategic Allocation (Portfolio, Ranking, Capital, Rebalancing)
    const portfolio = await portfolioAgent({
      ...stockData,
      riskLevel: risk.riskLevel
    });

    const ranking = await rankingAgent({
      ...stockData,
      confidenceScore: adjustedConfidence,
      riskScore:
        risk.riskLevel === "LOW"
          ? 2
          : risk.riskLevel === "MEDIUM"
          ? 5
          : 8
    });

    const capital = await capitalAgent({
      ...stockData,
      priority: ranking.priority,
      confidenceScore: adjustedConfidence,
      riskLevel: risk.riskLevel
    });

    const rebalancing = await rebalancingAgent({
      ...stockData,
      finalDecision: finalDecision.finalDecision,
      suggestedAllocation: capital.suggestedAllocation
    });

    // Logical Consistency Check: Entry vs Rebalancing
    if (entryTiming.strategy === "AVOID ENTRY" && rebalancing.action.includes("Accumulate")) {
        console.log(`[Logical Alignment] ${ticker}: Overriding aggressive accumulation because Entry Timing is AVOID.`);
        rebalancing.action = "No action. Monitor closely";
    }

    // PHASE 4.5: Position Sizing
    const positionSizing = await calculatePositionSize({
      stock: ticker,
      confidenceScore: adjustedConfidence,
      riskLevel: risk.riskLevel || "MEDIUM",
      rewardRiskRatio: parseCurrency(entryTiming.rewardRiskRatio),
      entryUrgency: entryTiming.entryUrgency || "MEDIUM",
      volatility: technical.volatility || "MEDIUM",
      sectorExposure: 0, // Placeholder for future portfolio integration
      portfolioRisk: 5   // Placeholder for future portfolio integration
    });

    // Fix 1: Correct Portfolio Scaling Formula
    const suggestedPct = parseCurrency(positionSizing.allocation);
    const existingTotal = portfolio.totalWeight || 0;
    const remainingRoom = Math.max(0, 100 - existingTotal);

    if (suggestedPct > remainingRoom && suggestedPct > 0) {
        console.log(`[RISK] Insufficient portfolio room (${remainingRoom}%). Scaling down ${ticker}.`);
        const finalAllocation = Math.min(suggestedPct, remainingRoom);
        
        positionSizing.allocation = `${finalAllocation.toFixed(2)}%`;
        positionSizing.reason = `Capped at ${finalAllocation.toFixed(2)}% based on remaining portfolio capacity.`;
        
        if (finalAllocation < 1) {
            positionSizing.allocation = "0%";
            positionSizing.capitalAction = "No room in portfolio";
        }
    }

    // PHASE 4.6: Portfolio Rebalancing
    const rebalancer = await analyzeRebalancing({
      stock: ticker,
      targetAllocation: parseCurrency(positionSizing.allocation),
      actualAllocation: portfolio.currentAllocation || 0,
      sectorExposure: portfolio.sectorExposure || 0,
      exitSignal: exitSignal.signal,
      convictionScore: adjustedConfidence,
      riskConcentration: 5 // Placeholder
    });

    // PHASE 4.7: Conflict Resolution Engine (Signal Hierarchy)
    // EXIT SIGNAL overrides ENTRY SIGNAL (Risk Management > Opportunity)
    if (
      exitSignal.signal === "FULL EXIT" ||
      exitSignal.signal === "STOP LOSS EXIT" ||
      exitSignal.signal === "TRIM POSITION"
    ) {
      console.log(`[Conflict Resolution] ${ticker}: Exit signal (${exitSignal.signal}) overriding entry advice.`);
      
      entryTiming.finalExecutionAdvice = 
        `Risk management (${exitSignal.signal}) takes priority. Avoid fresh entry or accumulation until structure improves.`;
      entryTiming.entryUrgency = "LOW";
      entryTiming.strategy = "AVOID ENTRY";
      
      // Override Position Sizing (Risk Management > Capital Deployment)
      positionSizing.capitalAction = "Avoid fresh deployment. Focus on risk reduction.";
      positionSizing.conviction = "LOW";
      positionSizing.allocation = "0%";
      positionSizing.reason = `Risk priority (${exitSignal.signal}) overrides fresh allocation decisions until structure improves.`;

      // Override Rebalancing (Downstream must obey risk)
      rebalancing.rebalancingAction = "Reduce exposure immediately. Avoid maintaining full position size.";
      rebalancing.action = "Trim existing allocation and preserve capital.";
      rebalancer.action = exitSignal.signal;
      rebalancer.reason = `Exit signal (${exitSignal.signal}) takes precedence over allocation maintenance.`;

      // Downgrade conviction to reflect high-risk exit priority
      finalDecision.finalConfidenceScore = Math.min(finalDecision.finalConfidenceScore, 4);
    }

    // EVENT RISK OVERRIDE (Event Risk > All Entry/Sizing Decisions)
    if (eventRisk.eventRisk === "HIGH" || eventRisk.eventRisk === "CRITICAL") {
      console.log(`[Conflict Resolution] ${ticker}: High Event Risk (${eventRisk.eventType}) detected. Overriding analysis.`);
      
      entryTiming.finalExecutionAdvice = `${eventRisk.action}. ${eventRisk.reason}`;
      entryTiming.entryUrgency = "LOW";
      entryTiming.strategy = "AVOID ENTRY";
      
      positionSizing.capitalAction = "Avoid fresh deployment before high-impact events.";
      positionSizing.conviction = "LOW";
      positionSizing.allocation = "0%";
      
      finalDecision.finalConfidenceScore = Math.min(finalDecision.finalConfidenceScore, 3);
    }

    // PHASE 5: Action Alignment
    // Override recommended action based on combined verdict + timing urgency
    function getRecommendedAction(verdict, entryUrgency) {
      const v = verdict.toUpperCase();
      if (v.includes("AVOID")) return "Exit or reduce position";
      if (v.includes("HOLD")) return "No action. Monitor closely";
      
      if (v.includes("BUY")) {
        if (entryUrgency === "VERY HIGH") return "Accumulate aggressively";
        if (entryUrgency === "HIGH") return "Build position gradually";
        if (entryUrgency === "MEDIUM") return "Start partial accumulation";
        if (entryUrgency === "LOW") return "Watchlist. Wait for better entry zone before deploying capital";
      }
      return "Monitor and wait for confirmation";
    }

    rebalancing.action = getRecommendedAction(
      finalDecision.finalDecision,
      entryTiming.entryUrgency
    );

    // PERSISTENCE: Log recommendation for future performance tracking
    await logRecommendation({
      symbol: ticker,
      decision: finalDecision.finalDecision,
      confidence: finalDecision.finalConfidenceScore,
      entryPrice: activePrice,
      stopLoss: parseCurrency(entryTiming.stopLoss),
      target: parseCurrency(entryTiming.initialTarget),
      reasoning: finalDecision.reason
    });

    // FINAL EXECUTION SAFETY CHECK
    // Fix 1: Block non-live or critical latency for execution
    if (liveMarketData.priceSource !== "LIVE" || liveMarketData.latencyBlocked) {
      const blockReason = liveMarketData.latencyBlocked ? "critical execution latency (>4s)" : `non-live data source (${liveMarketData.priceSource})`;
      console.log(`[EXECUTION BLOCK] Nullifying capital deployment for ${ticker} due to ${blockReason}.`);
      positionSizing.allocation = "0%";
      positionSizing.capitalAction = "Blocked by execution layer";
      positionSizing.reason = `Institutional Guard: Capital deployment blocked due to ${blockReason}.`;
      entryTiming.strategy = "WAIT";
      entryTiming.entryUrgency = "LOW";
      entryTiming.finalExecutionAdvice = "Wait for data pipeline stabilization before taking action.";
    }

    return {
      risk,
      portfolio,
      decision: finalDecision,
      ranking,
      capital,
      rebalancing,
      technical,
      valuation,
      entryTiming,
      exitSignal,
      positionSizing,
      rebalancer,
      eventRisk,
      isDegraded,
      priceSource: liveMarketData.priceSource,
      dataAge: liveMarketData.dataAge
    };
  } catch (error) {
    console.error("Master Agent Error:", error.message);

    return {
      error: true,
      message: error.message
    };
  }
}