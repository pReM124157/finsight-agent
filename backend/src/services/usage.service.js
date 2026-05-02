import supabase from './supabase.service.js';

const FREE_LIMIT = 10;

export async function checkUsage(chatId) {
  const { data } = await supabase
    .from('subscribers')
    .select('plan, free_usage_count, free_usage_reset_at')
    .eq('telegram_chat_id', chatId.toString())
    .maybeSingle();

  let count = data?.free_usage_count || 0;
  let resetAt = data?.free_usage_reset_at;
  const now = new Date();

  if (!resetAt || now > new Date(resetAt)) {
    count = 0;
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);
    const nextReset = new Date(istNow);
    nextReset.setHours(istNow.getHours() + 12, 0, 0, 0);
    resetAt = new Date(nextReset.getTime() - IST_OFFSET).toISOString();
    
    await supabase.from('subscribers').upsert({
      telegram_chat_id: chatId.toString(),
      free_usage_count: 0,
      free_usage_reset_at: resetAt
    });
  }

  if (count >= FREE_LIMIT) {
    return { allowed: false, remaining: 0, count };
  }

  return { allowed: true, remaining: FREE_LIMIT - count, count };
}

export async function incrementUsage(chatId, currentCount) {
  await supabase.from('subscribers').update({
    free_usage_count: (currentCount || 0) + 1
  }).eq('telegram_chat_id', chatId.toString());
}

export async function getRemainingUsage(chatId) {
  const { data, error } = await supabase
    .from("subscribers")
    .select("free_usage_count, free_usage_reset_at")
    .eq("telegram_chat_id", chatId.toString())
    .single();
  if (error || !data) return null;
  const remaining = 10 - (data.free_usage_count || 0);
  return {
    remaining,
    resetAt: data.free_usage_reset_at
  };
}

export { FREE_LIMIT };
