import { runMasterAgent } from "./agents/master.agent.js";
import dotenv from "dotenv";
dotenv.config();

const test = async () => {
  try {
    const result = await runMasterAgent("GOOGL");
    console.log("RESULT:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("TEST FAILED:", err);
  }
};

test();
