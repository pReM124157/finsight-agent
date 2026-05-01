import Razorpay from 'razorpay';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

export async function createPaymentLink(chatId, firstName) {
  const link = await razorpay.paymentLink.create({
    amount: 29900,
    currency: 'INR',
    description: 'FinSight Pro Monthly',
    customer: {
      name: firstName || 'User'
    },
    notify: { sms: false, email: false },
    notes: {
      telegram_chat_id: chatId
    }
  });

  return link.short_url;
}