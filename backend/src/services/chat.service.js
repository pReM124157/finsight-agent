import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function generateChatReply(message) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192", // best balance (fast + smart)
      messages: [
        {
          role: "system",
          content: `
You are FinSight — a sharp, confident financial assistant.
Rules:
- Speak like a smart human, not a bot
- Keep replies short and clear
- Handle casual conversation naturally (hi, ok, thanks, etc.)
- If user is vague → guide them toward stocks/markets
- NEVER say "I don't understand"
- No emojis overload, keep it premium
          `
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.7,
      max_tokens: 200
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error("GROQ ERROR:", err);
    return "Something went wrong. Try again.";
  }
}
