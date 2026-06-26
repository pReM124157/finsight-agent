import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

let supabaseClient = null;
export const hasSupabaseConfig = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase env is missing. Expected SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env."
    );
  }

  supabaseClient = createClient(supabaseUrl, serviceRoleKey);
  return supabaseClient;
}

// Use service role key to bypass RLS for all server-side DB operations
const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getSupabaseClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    }
  }
);

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

export function isSupabaseUnavailable(error) {
  if (!error) return false;
  if (isSupabaseSchemaMissing(error)) return true;

  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("networkerror") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("failed to fetch")
  );
}

export function logInfraFallbackOnce(key, message, extra = {}) {
  if (degradedInfraWarnings.has(key)) return;
  degradedInfraWarnings.add(key);
  console.warn(message, extra);
}

export { getSupabaseClient };
export default supabase;
