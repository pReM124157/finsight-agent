import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export async function sendEmailAlert(subject, text) {
  return sendEmail({ subject, text });
}

export async function sendEmail({ subject, text }) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.TARGET_EMAIL,
      subject,
      text
    });
    console.log("✅ EMAIL SENT SUCCESSFULLY TO:", process.env.TARGET_EMAIL);
  } catch (error) {
    console.error("❌ EMAIL ERROR:", error);
    console.error("Check if EMAIL_USER and EMAIL_PASS (App Password) are correct.");
  }
}
