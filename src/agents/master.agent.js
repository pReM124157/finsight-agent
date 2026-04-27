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

import { generateInvestmentAnalysis } from "../services/claude.service.js";

export async function masterAgent(input) {
  try {
    // Check if it's a conversation mode request
    if (input && input.mode === "conversation") {
      const { userQuery } = input;
      const masterPrompt = `
You are Finsight AI, a sophisticated financial assistant. 
Your goal is to provide intelligent, data-driven financial insights.

User Question: ${userQuery}

Guidelines:
1. Be professional, concise, and helpful.
2. If asked about your work, explain that you are a multi-agent AI system designed to analyze stocks, rank opportunities, and provide portfolio insights.
3. If asked for investment advice (e.g., "Should I buy TCS?"), provide a balanced view based on general market principles but emphasize that you are an AI and not a SEBI registered advisor. Mention that users can use /analyze TICKER for a deep dive report.
4. If asked about specific investment amounts (e.g., "Can I invest 50k?"), discuss general asset allocation and risk management principles.
5. Always maintain a neutral but informative tone.
`.trim();

      const response = await generateInvestmentAnalysis(masterPrompt);
      return { response };
    }

    // Otherwise, treat as stock analysis request
    const stockData = input;
    const ticker = stockData.Symbol || stockData.ticker || "UNKNOWN";


    // PHASE 1: Core Analysis (Risk, Fundamentals, Technicals, Valuation)
    const [risk, decision, liveMarketData, technical, valuation] = await Promise.all([
      riskAgent(stockData),
      decisionAgent(stockData),
      getLiveMarketData(ticker),
      technicalAgent(ticker),
      valuationAgent(stockData)
    ]);

    // PHASE 2: Execution Intelligence (Entry Timing)
    const entryTiming = await analyzeEntryTiming({
      stock: ticker,
      currentPrice: liveMarketData.currentPrice || technical.currentPrice || 0,
      confidenceScore: decision.finalConfidenceScore || 5,
      riskLevel: risk.riskLevel || "MEDIUM",
      valuationScore: valuation.score || 5,
      momentumScore: technical.score || 5
    });

    // PHASE 3: Confidence Alignment
    // Adjusting confidence based on execution readiness to ensure internal consistency
    let adjustedConfidence = decision.finalConfidenceScore || 5;
    if (entryTiming.strategy === "WAIT FOR CONFIRMATION") {
      adjustedConfidence = Math.min(adjustedConfidence, 7);
    } else if (entryTiming.strategy === "BUY ON DIP") {
      adjustedConfidence = Math.min(adjustedConfidence, 8);
    } else if (entryTiming.strategy === "AVOID ENTRY") {
      adjustedConfidence = Math.min(adjustedConfidence, 4);
    } else if (entryTiming.strategy === "IMMEDIATE BUY") {
      adjustedConfidence = Math.min(adjustedConfidence, 10);
    }

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
      entryTiming.urgency
    );

    return {
      risk,
      portfolio,
      decision: finalDecision,
      ranking,
      capital,
      rebalancing,
      technical,
      valuation,
      entryTiming
    };
  } catch (error) {
    console.error("Master Agent Error:", error.message);

    return {
      error: true,
      message: error.message
    };
  }
}