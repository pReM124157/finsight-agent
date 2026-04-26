import TelegramBot from "node-telegram-bot-api";

const bot = new TelegramBot(
  process.env.TELEGRAM_BOT_TOKEN,
  { polling: false }
);

export async function sendPortfolioAlert(message) {
  try {
    await bot.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      message
    );
    console.log("✅ Alert sent");
  } catch (error) {
    console.error("Alert failed:", error.message);
  }
}