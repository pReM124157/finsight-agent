import { generateInvestmentAnalysis } from "../services/claude.service.js";

export async function runRiskAgent(stockData) {
  const prompt = `
You are a risk management expert.

Analyze:

${JSON.stringify(stockData, null, 2)}

Return ONLY a JSON object with:
{
  "majorRisks": [],
  "riskScore": 0,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH"
}
`;

  const response = await generateInvestmentAnalysis(prompt);
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : response);
  } catch (e) {
    return { riskLevel: "MEDIUM", riskScore: 5, details: response };
  }
}

export async function riskAgent(stockData) {
  return await runRiskAgent(stockData);
}