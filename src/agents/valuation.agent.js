import { generateInvestmentAnalysis } from "../services/claude.service.js";

export async function valuationAgent(stockData) {
  const prompt = `
You are a valuation specialist. 

Analyze this market and financial data:
${JSON.stringify(stockData, null, 2)}

Provide a deep valuation analysis.
Consider PE ratio vs Sector, Price to Book, and Growth rates.

Return ONLY a JSON object:
{
  "score": number (1-10, where 10 is deeply undervalued/attractive),
  "status": "UNDERVALUED" | "FAIR" | "OVERVALUED",
  "fairPrice": number,
  "marginOfSafety": "percentage string",
  "reason": "concise explanation"
}
`;

  const response = await generateInvestmentAnalysis(prompt);
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : response);
    return {
      score: result.score || 5,
      status: result.status || "FAIR",
      fairPrice: result.fairPrice || 0,
      marginOfSafety: result.marginOfSafety || "0%",
      reason: result.reason || "Analysis completed"
    };
  } catch (e) {
    console.error("Valuation Agent parsing error:", e.message);
    return { 
      score: 5, 
      status: "FAIR", 
      reason: "Fallback valuation due to analysis error" 
    };
  }
}
