import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Backward compatibility wrapper
 */
export async function sendEmailAlert(subject, text) {
  return sendEmail({ subject, text });
}

/**
 * Sends an email using the Resend API to avoid SMTP network issues.
 */
export async function sendEmail({ subject, text, html }) {
  try {
    console.log("📨 RESEND EMAIL SEND STARTED TO:", process.env.TARGET_EMAIL);
    
    // NOTE: If using the free tier of Resend without a verified domain, 
    // the 'from' address MUST be 'onboarding@resend.dev' and 
    // the 'to' address MUST be your account's registered email.
    const { data, error } = await resend.emails.send({
      from: "FinSight AI <onboarding@resend.dev>",
      to: process.env.TARGET_EMAIL,
      subject,
      text,
      ...(html ? { html } : {})
    });

    if (error) {
      console.error("❌ RESEND API ERROR:", error);
      return;
    }

    console.log("✅ EMAIL SENT SUCCESSFULLY VIA RESEND. ID:", data.id);
  } catch (error) {
    console.error("❌ RESEND SERVICE ERROR:", error);
  }
}
