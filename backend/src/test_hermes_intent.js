import dotenv from "dotenv";
import { classifyIntentWithHermes } from "./services/hermesIntent.service.js";

dotenv.config();

const samples = [
  "analyze reliance",
  "should i buy tcs tomorrow",
  "what is the price of infy",
  "alert me if axisbank crosses 1300",
  "tcs vs infosys which is better",
  "why did hdfc bank fall today",
  "review my portfolio",
  "what is pe ratio"
];

for (const sample of samples) {
  const result = await classifyIntentWithHermes(sample);
  console.log("\nUSER:", sample);
  console.log(JSON.stringify(result, null, 2));
}
