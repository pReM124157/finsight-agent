import TelegramBot from "node-telegram-bot-api";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false,
});

const chatId = process.env.TELEGRAM_CHAT_ID;

export const sendTelegramAlert = async (message) => {
  try {
    if (!chatId) {
      console.log("TELEGRAM_CHAT_ID missing");
      return;
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
    });

    console.log("✅ Alert sent to Telegram");
  } catch (error) {
    console.error("Telegram alert error:", error.message);
  }
};