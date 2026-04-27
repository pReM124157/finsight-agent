import { generateInvestmentAnalysis } from "../services/claude.service.js";

export async function runFinancialAgent(stockData) {
  const prompt = `
You are a financial statement expert.

Analyze:

${JSON.stringify(stockData, null, 2)}

Return:
1. Revenue Strength
2. Profitability
3. Debt Analysis
4. Cash Flow Quality
5. Financial Health Score (/10)
`;

  return await generateInvestmentAnalysis(prompt);
}