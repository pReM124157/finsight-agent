import supabase from "./supabase.service.js";
import { safeString } from "../core/safety.js";

export async function shouldSendAlert(chatId, symbol, alertType) {
  const { data, error } = await supabase
    .from("alert_memory")
    .select("*")
    .eq("chat_id", String(chatId))
    .eq("symbol", safeString(symbol).toUpperCase())
    .eq("alert_type", alertType)
    .order("last_sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Alert check error:", error.message);
    return true;
  }

  if (!data) return true;

  const lastSent = new Date(data.last_sent_at);
  const now = new Date();

  const diffHours =
    (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);

  return diffHours >= 48;
}

export async function saveAlert(chatId, symbol, alertType) {
  const { error } = await supabase
    .from("alert_memory")
    .upsert({
      chat_id: String(chatId),
      symbol: safeString(symbol).toUpperCase(),
      alert_type: alertType,
      last_sent_at: new Date().toISOString()
    });

  if (error) {
    console.error("Save alert error:", error.message);
  }
}
