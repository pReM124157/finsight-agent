import bot from "../services/telegram.service.js";

export async function sendPortfolioAlert(message) {
  try {
    await bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      message
    );

    console.log("✅ Alert sent");
  } catch (error) {
    console.error("Alert failed:", error.message);
  }
}