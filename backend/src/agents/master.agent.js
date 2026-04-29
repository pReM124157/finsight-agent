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
              if (data && data.currentPrice > 0) {
                  liveDataSnippet = `
[LIVE MARKET DATA FOR ${ticker}]
Current Price: ₹${data.currentPrice}
Day Range: ₹${data.dayLow} - ₹${data.dayHigh}
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

    // PHASE 1: Core Analysis (Risk, Fundamentals, Technicals, Valuation)
    console.log(`[Phase 1] Starting Core Analysis for ${ticker}...`);
    const [risk, decision, liveMarketData, technical, valuation] = await Promise.all([
      riskAgent(stockData),
      decisionAgent(stockData),
      getLiveMarketData(ticker),
      technicalAgent(ticker),
      valuationAgent(stockData)
    ]);
    console.log(`[Phase 1] Completed. Live Price: ₹${liveMarketData.currentPrice}`);

    // PHASE 2: Execution Intelligence (Entry Timing)
    const activePrice = Number(liveMarketData?.currentPrice || technical?.currentPrice || 0);
    console.log(`[Phase 2] Pre-flight Price Check for ${ticker}: ₹${activePrice}`);

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
    
    if (entryTiming.strategy === "CAUTIOUS ENTRY") {
      adjustedConfidence = Math.min(adjustedConfidence, 6);
    } else if (entryTiming.strategy === "AVOID ENTRY") {
      adjustedConfidence = Math.min(adjustedConfidence, 4);
    } else if (entryTiming.strategy === "STRONG ENTRY") {
      adjustedConfidence = Math.min(adjustedConfidence, 10);
    }
    
    // Ensure score stays within 1-10 range
    adjustedConfidence = Math.min(Math.max(adjustedConfidence, 1), 10);

    const finalDecision = {
      ...decision,
      finalConfidenceScore: adjustedConfidence
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
      eventRisk
    };
  } catch (error) {
    console.error("Master Agent Error:", error.message);

    return {
      error: true,
      message: error.message
    };
  }
}