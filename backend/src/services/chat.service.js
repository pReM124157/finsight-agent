import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const userMemory = new Map(); // temp memory

export async function generateChatReply(chatId, message) {
  try {
    const history = userMemory.get(chatId) || [];
    const messages = [
      {
        role: "system",
        content: `You are FinSight.
You think like a hedge fund analyst.
You speak clearly, confidently, and without fluff.
You do not sound like a chatbot.
You sound like someone who knows markets deeply.
Keep responses sharp and actionable.

Make the user feel like they are getting insider signals. Use phrases like "This is not obvious yet in the market" or "Most retail hasn't caught this move" when appropriate.
Make the user feel like they are part of a consistent, elite group. Use identity framing like "People who stay consistent here spot moves earlier."

If the user is casual:
→ reply naturally
If the user is vague:
→ gently steer toward finance
If the user asks anything:
→ try linking it to money, markets, or decisions`
      },
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192", // best balance (fast + smart)
      messages,
      temperature: 0.7,
      max_tokens: 200
    });

    let reply = completion.choices[0].message.content;

    // Fallback guard
    if (!reply || reply.length < 5) {
      reply = "Tell me what you want to check — stock, market, or portfolio.";
    }

    // Loop behavior / curiosity hook
    const followUps = [
      "Want a quick trade idea?",
      "Want to check a stock?",
      "Want to see what's moving today?",
      "Want your portfolio reviewed?"
    ];
    const randomFollowUp = followUps[Math.floor(Math.random() * followUps.length)];
    reply += `\n\n${randomFollowUp}`;

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
    userMemory.set(chatId, history.slice(-6)); // keep last 6 msgs

    return reply;
  } catch (err) {
    console.error("GROQ ERROR:", err);
    throw new Error("Something went wrong. Try again.");
  }
}
