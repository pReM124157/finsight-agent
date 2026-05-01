import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Use service role key to bypass RLS for all server-side DB operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("USING SUPABASE KEY TYPE: SERVICE_ROLE");

export default supabase;