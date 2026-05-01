import express from 'express';
import crypto from 'crypto';
import bot from '../services/telegram.service.js';
import supabase from '../services/supabase.service.js';

const router = express.Router();

router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('🔥 Webhook endpoint HIT');

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];

  if (!signature) {
    console.log('No signature found');
    return res.status(400).send('No signature');
  }

  const shasum = crypto.createHmac('sha256', secret);
  shasum.update(req.body);
  const digest = shasum.digest('hex');

  if (digest !== signature) {
    console.error('Invalid signature');
    return res.status(400).send('Invalid signature');
  }

  const data = JSON.parse(req.body);
  const event = data.event;
  console.log('Webhook received:', event);

  if (event === 'payment.captured' || event === 'payment_link.paid') {
    console.log('📦 FULL PAYLOAD:', JSON.stringify(data.payload, null, 2));

    // Extract payment entity — present in both events
    const paymentEntity = data.payload?.payment?.entity;
    const paymentId = paymentEntity?.id;
    const notes = paymentEntity?.notes || {};

    // For payment_link.paid, notes may also be on the payment_link entity
    const linkNotes = data.payload?.payment_link?.entity?.notes || {};

    const chatId = notes?.telegram_chat_id || linkNotes?.telegram_chat_id || null;

    console.log('📦 Payment notes:', JSON.stringify(notes));
    console.log('🔗 Link notes:', JSON.stringify(linkNotes));
    console.log('🧠 Extracted chatId:', chatId);
    console.log('💳 Payment ID:', paymentId);

    if (!chatId) {
      console.log('❌ No chatId found — skipping DB insert');
      return res.status(200).json({ status: 'ok' });
    }

    // Idempotency check — only if we have a paymentId to check against
    if (paymentId) {
      const { data: existing } = await supabase
        .from('subscribers')
        .select('payment_id')
        .eq('payment_id', paymentId)
        .maybeSingle();

      if (existing) {
        console.log('⚠️ Duplicate payment ignored:', paymentId);
        return res.json({ status: 'duplicate' });
      }
    }

    // Save subscriber to database
    try {
      const { data: dbResult, error: dbError } = await supabase
        .from('subscribers')
        .upsert({
          telegram_chat_id: chatId.toString(),
          payment_id: paymentId || null,
          status: 'active',
          plan: 'pro',
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date()
        });

      console.log('✅ DB Insert result:', JSON.stringify(dbResult));
      console.log('❌ DB Error:', JSON.stringify(dbError));
    } catch (err) {
      console.error('🚨 Supabase crash:', err);
    }

    // Send Telegram confirmation
    try {
      await bot.telegram.sendMessage(
        chatId,
        `🎉 Payment Successful! Welcome to FinSight Pro. Your premium access is now active.`
      );
      console.log(`✅ Confirmation sent to ${chatId} for payment ${paymentId}`);
    } catch (err) {
      console.error('Telegram send failed:', err.message);
    }
  }

  res.json({ status: 'ok' });
});

export default router;
