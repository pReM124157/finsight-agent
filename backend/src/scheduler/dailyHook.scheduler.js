import cron from "node-cron";
import supabase from "../services/supabase.service.js";
import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

export function startDailyHook() {
  console.log("⏰ Daily Hook Scheduler Started");

  // Run at 8:30 AM IST (which is 03:00 UTC) every day
  cron.schedule("0 3 * * *", async () => {
    console.log("Running scheduled daily hook...");
    try {
      const { data: users, error } = await supabase
        .from("subscribers")
        .select("telegram_chat_id");

      if (error) throw error;
      if (!users) return;

      const message = `
📊 Something moved today:
TCS just showed unusual strength in IT.
This is where smart money is rotating.
Want to see if it's a real opportunity or noise?
`.trim();

      for (const user of users) {
        if (user.telegram_chat_id) {
          try {
            await bot.telegram.sendMessage(user.telegram_chat_id, message);
          } catch (err) {
            console.error("Failed to send daily hook to:", user.telegram_chat_id);
          }
        }
      }
    } catch (err) {
      console.error("Daily Hook Error:", err.message);
    }
  });
}
