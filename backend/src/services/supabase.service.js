import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Use service role key to bypass RLS for all server-side DB operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("SUPABASE KEY START:", process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 15) ?? "❌ UNDEFINED — not loaded");
console.log("SUPABASE URL:", process.env.SUPABASE_URL?.slice(0, 30) ?? "❌ UNDEFINED");

const degradedInfraWarnings = new Set();

export function isSupabaseSchemaMissing(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42883" ||
    code === "42P01" ||
    message.includes("schema cache") ||
    message.includes("could not find the function") ||
    message.includes("could not find the table")
  );
}

export function logInfraFallbackOnce(key, message, extra = {}) {
  if (degradedInfraWarnings.has(key)) return;
  degradedInfraWarnings.add(key);
  console.warn(message, extra);
}

export default supabase;
