import supabase from "../services/supabase.service.js";
import { generateRebalanceAdvice } from "./rebalance.engine.js";
import { sendPortfolioAlert } from "./alert.agent.js";

export async function runAutoMonitor() {
  console.log("🔍 Running portfolio monitor...");

  const { data, error } = await supabase
    .from("portfolio")
    .select("*");

  if (error) {
    console.error(error);
    return;
  }

  const result = generateRebalanceAdvice(data);

  const message = `
📊 Portfolio Auto Review

⚠ Dominant Sector: ${result.dominantSector}
📌 Highest Allocation: ${result.biggestStock}

🧠 Recommendation:
${result.recommendation}
`;

  await sendPortfolioAlert(message);
}