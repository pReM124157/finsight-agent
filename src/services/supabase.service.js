import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
console.log("USING KEY STARTING WITH:", process.env.SUPABASE_ANON_KEY.substring(0, 100));

export default supabase;