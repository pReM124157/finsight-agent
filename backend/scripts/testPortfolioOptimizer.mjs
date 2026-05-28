import { optimizePortfolioCandidate } from "../src/services/portfolioOptimizer.service.js";

const testCases = [
  {
    name: "Test 1 - No portfolio",
    input: {
      candidateSymbol: "TCS",
      standaloneRecommendation: {
        action: "BUY",
        confidence: 72,
        currentPrice: 3800,
        sector: "Technology",
        riskScore: 42
      }
    }
  },
  {
    name: "Test 2 - Adds technology diversification",
    input: {
      candidateSymbol: "TCS",
      portfolio: [
        { symbol: "RELIANCE", quantity: 10, avgPrice: 1200 },
        { symbol: "HDFCBANK", quantity: 5, avgPrice: 1500 }
      ],
      standaloneRecommendation: {
        action: "BUY",
        confidence: 78,
        currentPrice: 3800,
        sector: "Technology",
        riskScore: 39
      }
    }
  },
  {
    name: "Test 3 - Technology concentration already high",
    input: {
      candidateSymbol: "TCS",
      portfolio: [
        { symbol: "INFY", quantity: 10, avgPrice: 1400 },
        { symbol: "TCS", quantity: 5, avgPrice: 3800 }
      ],
      standaloneRecommendation: {
        action: "BUY",
        confidence: 74,
        currentPrice: 3800,
        sector: "Technology",
        riskScore: 41
      }
    }
  },
  {
    name: "Test 4 - Weak standalone stock stays avoid",
    input: {
      candidateSymbol: "TCS",
      portfolio: [
        { symbol: "RELIANCE", quantity: 10, avgPrice: 1200 },
        { symbol: "INFY", quantity: 5, avgPrice: 1400 }
      ],
      standaloneRecommendation: {
        action: "AVOID",
        confidence: 33,
        currentPrice: 3800,
        sector: "Technology",
        riskScore: 67
      }
    }
  }
];

for (const testCase of testCases) {
  const result = await optimizePortfolioCandidate(testCase.input);
  console.log(`\n=== ${testCase.name} ===`);
  console.log(JSON.stringify(result, null, 2));
}
