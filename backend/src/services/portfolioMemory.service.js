import supabase from "./supabase.service.js";

/**
 * Adds or updates a holding for a user.
 */
export async function addHolding(chatId, { symbol, quantity, avgPrice }) {
  try {
    // Check if stock already exists in portfolio for this user
    const { data: existing } = await supabase
      .from("holdings")
      .select("*")
      .eq("chat_id", chatId)
      .eq("symbol", symbol.toUpperCase())
      .single();

    if (existing) {
      // Update existing holding (Weighted average or simple replace - user requested /add usually means set)
      // We will do a replacement/update here for simplicity
      const { data, error } = await supabase
        .from("holdings")
        .update({
          quantity,
          avg_price: avgPrice,
          updated_at: new Date()
        })
        .eq("id", existing.id);

      if (error) throw error;
      return data;
    } else {
      // Insert new holding
      const { data, error } = await supabase
        .from("holdings")
        .insert([
          {
            chat_id: chatId,
            symbol: symbol.toUpperCase(),
            quantity,
            avg_price: avgPrice
          }
        ]);

      if (error) throw error;
      return data;
    }
  } catch (error) {
    console.error("Error adding holding:", error.message);
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
      .eq("symbol", symbol.toUpperCase());

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
      .eq("symbol", symbol.toUpperCase());

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating holding:", error.message);
    throw error;
  }
}
