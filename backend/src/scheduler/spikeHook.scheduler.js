import cron from "node-cron";
import supabase from "../services/supabase.service.js";
import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

export function startSpikeHook() {
  console.log("⏰ Random Spike Hook Scheduler Started");

  // Run at 14:00 IST (which is 08:30 UTC) every day, targeting the afternoon session
  cron.schedule("30 8 * * *", async () => {
    // Only send this on random days (about 30% chance) to make it unpredictable
    if (Math.random() > 0.3) {
      console.log("Random Spike Hook skipped today to maintain unpredictability.");
      return;
    }

    console.log("Running scheduled random spike hook...");
    try {
      const { data: users, error } = await supabase
        .from("subscribers")
        .select("telegram_chat_id");

      if (error) throw error;
      if (!users) return;

      const message = `
⚠️ Quick signal:
A setup is forming in banking stocks.
This doesn't stay clean for long.
Want a quick look?
`.trim();

      // Send to a random subset of users (50%) to keep it exclusive
      const selectedUsers = users.filter(() => Math.random() > 0.5);

      for (const user of selectedUsers) {
        if (user.telegram_chat_id) {
          try {
            await bot.telegram.sendMessage(user.telegram_chat_id, message);
          } catch (err) {
            console.error("Failed to send spike hook to:", user.telegram_chat_id);
          }
        }
      }
    } catch (err) {
      console.error("Spike Hook Error:", err.message);
    }
  });
}
