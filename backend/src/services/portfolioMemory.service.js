import supabase from "./supabase.service.js";
import { safeString } from "../core/safety.js";

/**
 * Adds or updates a holding for a user.
 */
export async function addHolding(chatId, { symbol, quantity, avgPrice }) {
  try {
    console.log(`💾 Attempting to save holding: ${symbol} for chat ${chatId}`);
    
    const { data, error } = await supabase
      .from("holdings")
      .upsert({
        chat_id: String(chatId),
        symbol: safeString(symbol).toUpperCase(),
        quantity,
        avg_price: avgPrice,
        updated_at: new Date()
      }, {
        onConflict: "chat_id,symbol"
      });

    if (error) {
      console.error("ADD HOLDING ERROR:", error);
      throw new Error(error.message);
    }

    console.log("HOLDING SAVED:", data);
    return data;
  } catch (error) {
    console.error("Detailed Add Holding Error:", error);
    throw error;
  }
}

/**
 * Retrieves all holdings for a specific user.
 */
export async function getPortfolio(chatId) {
  try {
    const { data, error } = await supabase
      .from("holdings")
      .select("*")
      .eq("chat_id", chatId);

    if (error) throw error;
    
    // Map to the format expected by portfolio agents
    return data.map(h => ({
      symbol: h.symbol,
      allocation: h.quantity * h.avg_price, // Value for weight calculation
      quantity: h.quantity,
      avgPrice: h.avg_price
    }));
  } catch (error) {
    console.error("Error fetching portfolio:", error.message);
    return [];
  }
}

/**
 * Removes a holding.
 */
export async function removeHolding(chatId, symbol) {
  try {
    const { data, error } = await supabase
      .from("holdings")
      .delete()
      .eq("chat_id", chatId)
      .eq("symbol", safeString(symbol).toUpperCase());

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error removing holding:", error.message);
    throw error;
  }
}

/**
 * Updates a holding.
 */
export async function updateHolding(chatId, symbol, updates) {
  try {
    const { data, error } = await supabase
      .from("holdings")
      .update(updates)
      .eq("chat_id", chatId)
      .eq("symbol", safeString(symbol).toUpperCase());

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating holding:", error.message);
    throw error;
  }
}
