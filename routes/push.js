// routes/push.js — Web Push notification routes
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const webpush = require('web-push');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// VAPID keys — set these in env vars
// Generate once with: npx web-push generate-vapid-keys
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:admin@sitarammedical.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── CREATE TABLE if needed ──
pool.query(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    keys JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(console.error);

// ══════════════════════════════════════
//  GET /api/push/vapid-public-key
//  Returns the public VAPID key for the browser to subscribe
// ══════════════════════════════════════
router.get('/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: VAPID_PUBLIC });
});

// ══════════════════════════════════════
//  POST /api/push/subscribe
//  Save a push subscription for a customer
// ══════════════════════════════════════
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription, customerId } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

    await pool.query(
      `INSERT INTO push_subscriptions (customer_id, endpoint, keys)
       VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET customer_id = $1, keys = $3`,
      [customerId || null, subscription.endpoint, JSON.stringify(subscription.keys)]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  POST /api/push/unsubscribe
//  Remove a push subscription
// ══════════════════════════════════════
router.post('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  sendOrderNotification(orderId, status)
//  Called internally when order status changes
// ══════════════════════════════════════
async function sendOrderNotification(orderId, status, customerName) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  // Get order details
  const orderRes = await pool.query(
    `SELECT o.id, o.customer_name, o.phone, o.customer_id
     FROM orders o
     WHERE o.id = $1`, [orderId]
  );
  if (!orderRes.rows.length) return;
  const order = orderRes.rows[0];

  // Status messages
  const messages = {
    confirmed:  { title: '✅ Order Confirmed!',   body: `Your order #${orderId} has been confirmed by Sitaram Medical Store.`, icon: '✅' },
    dispatched: { title: '🚚 Order Dispatched!',  body: `Your order #${orderId} is on the way! Track it now.`, icon: '🚚' },
    delivered:  { title: '🏠 Order Delivered!',   body: `Your order #${orderId} has been delivered. Thank you!`, icon: '🏠' },
    cancelled:  { title: '❌ Order Cancelled',    body: `Your order #${orderId} has been cancelled. Contact us for help.`, icon: '❌' },
  };
  const msg = messages[status];
  if (!msg) return;

  const payload = JSON.stringify({
    title: msg.title,
    body: msg.body,
    tag: `order-${orderId}`,
    url: `/track.html?id=${orderId}`
  });

  // Find subscriptions for this customer
  // Try customer_id first, then fall back to phone match
  let subs;
  if (order.customer_id) {
    subs = await pool.query(
      `SELECT ps.endpoint, ps.keys FROM push_subscriptions ps WHERE ps.customer_id = $1`,
      [order.customer_id]
    );
  }

  // If no results via customer_id, try matching by phone
  if (!subs || !subs.rows.length) {
    subs = await pool.query(
      `SELECT ps.endpoint, ps.keys FROM push_subscriptions ps
       JOIN customers c ON c.id = ps.customer_id
       WHERE c.phone = $1`,
      [order.phone]
    );
  }

  // Last resort: try all subscriptions for customer_id from customers table by phone
  if (!subs || !subs.rows.length) {
    const custRes = await pool.query(`SELECT id FROM customers WHERE phone = $1`, [order.phone]);
    if (custRes.rows.length) {
      subs = await pool.query(
        `SELECT endpoint, keys FROM push_subscriptions WHERE customer_id = $1`,
        [custRes.rows[0].id]
      );
    }
  }

  if (!subs || !subs.rows.length) {
    console.log(`[Push] No subscription found for order ${orderId}, phone: ${order.phone}`);
    return;
  }

  console.log(`[Push] Sending to ${subs.rows.length} subscription(s) for order ${orderId}`);

  // Send to all their subscriptions
  const sends = subs.rows.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload
      );
    } catch (err) {
      // Subscription expired — remove it
      if (err.statusCode === 410 || err.statusCode === 404) {
        await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
      }
    }
  });
  await Promise.allSettled(sends);
}

module.exports = router;
module.exports.sendOrderNotification = sendOrderNotification;