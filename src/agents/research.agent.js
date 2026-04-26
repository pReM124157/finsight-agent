import { generateInvestmentAnalysis } from "../services/claude.service.js";

export async function runResearchAgent(stockData) {
  const prompt = `
You are a professional equity research analyst.

Analyze this company:

${JSON.stringify(stockData, null, 2)}

Return:
1. Business Summary
2. Financial Strength
3. Valuation Analysis
4. Risk Factors

Keep it concise and investor-focused.
`;

  const result = await generateInvestmentAnalysis(prompt);
  return result;
}