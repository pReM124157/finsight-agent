import supabase from './supabase.service.js';

const FREE_LIMIT = 10;

export async function getUsage(chatId) {
  const { data } = await supabase
    .from('usage_limits')
    .select('free_used')
    .eq('telegram_chat_id', chatId.toString())
    .maybeSingle();
  return data?.free_used || 0;
}

export async function incrementUsage(chatId) {
  const { error } = await supabase.rpc('increment_usage', {
    chat_id_input: chatId.toString()
  });
  if (error) {
    console.error('Usage increment failed:', error.message);
  }
}

export async function isFreeLimitReached(chatId) {
  const used = await getUsage(chatId);
  return used >= FREE_LIMIT;
}

export async function getRemainingUsage(chatId) {
  const used = await getUsage(chatId);
  return Math.max(0, FREE_LIMIT - used);
}

export { FREE_LIMIT };
