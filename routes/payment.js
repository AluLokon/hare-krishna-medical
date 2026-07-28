const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../db');
const verifyToken = require('../middleware');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// POST /api/payment/create
// Creates a Razorpay order — amount calculated from DATABASE not frontend
router.post('/create', async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items provided' });
  }

  try {
    // Get medicine IDs from cart
    const medicineIds = items.map(i => parseInt(i.id));

    // Fetch real prices from DATABASE — never trust frontend prices
    const result = await pool.query(
      'SELECT id, name, price FROM medicines WHERE id = ANY($1)',
      [medicineIds]
    );

    const medicines = result.rows;

    // Calculate total using DB prices
    let totalPaise = 0;
    const verifiedItems = [];

    for (const item of items) {
      const medicine = medicines.find(m => m.id == item.id);
      if (!medicine) {
        return res.status(400).json({ error: `Medicine not found: ${item.id}` });
      }
      const amount = parseFloat(medicine.price) * item.qty;
      totalPaise += Math.round(amount * 100); // Razorpay uses paise
      verifiedItems.push({
        id: medicine.id,
        name: medicine.name,
        qty: item.qty,
        price: parseFloat(medicine.price)
      });
    }

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: totalPaise,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: {
        source: 'Sitaram Medical Store'
      }
    });

    res.json({
      success: true,
      razorpay_order_id: razorpayOrder.id,
      amount: totalPaise,
      amount_inr: totalPaise / 100,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
      verified_items: verifiedItems
    });

  } catch (err) {
    console.error('Razorpay order creation failed:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// POST /api/payment/verify
// Verifies Razorpay signature and saves payment to database
router.post('/verify', async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    order_data  // full order details from frontend
  } = req.body;

  // ── Step 1: Verify signature ──
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({
      success: false,
      error: 'Payment verification failed. Invalid signature.'
    });
  }

  // ── Step 2: Signature valid — now save order to database ──
  const {
    customer_name, phone, email, address,
    items, prescription
  } = order_data;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Recalculate total from DB again (never trust frontend)
    const medicineIds = items.map(i => parseInt(i.id));
    const medResult = await client.query(
      'SELECT id, name, price, requires_rx FROM medicines WHERE id = ANY($1)',
      [medicineIds]
    );
    const medicines = medResult.rows;

    let total = 0;
    const rxMedicines = [];

    for (const item of items) {
      const med = medicines.find(m => m.id == item.id);
      if (!med) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Medicine not found: ${item.id}` });
      }
      total += parseFloat(med.price) * item.qty;
      if (med.requires_rx) rxMedicines.push(med.name);
    }

    // Check stock and decrement
    for (const item of items) {
      const stockResult = await client.query(
        'SELECT stock, name FROM medicines WHERE id = $1 FOR UPDATE',
        [item.id]
      );
      const currentStock = stockResult.rows[0].stock;
      const medicineName = stockResult.rows[0].name;

      if (currentStock < item.qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Only ${currentStock} units of "${medicineName}" available.`
        });
      }

      await client.query(
        'UPDATE medicines SET stock = stock - $1 WHERE id = $2',
        [item.qty, item.id]
      );
    }

    // Get customer_id if logged in
    let customer_id = null;
    try {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        customer_id = decoded.id;
      }
    } catch (e) {}

    // Set prescription status
    const hasRx = rxMedicines.length > 0;
    const prescription_status = hasRx ? 'pending_approval' : null;

    // Save order with payment details
    const orderResult = await client.query(
      `INSERT INTO orders
        (customer_name, phone, address, items, total, prescription,
         status, customer_id, prescription_status,
         payment_method, payment_status,
         razorpay_order_id, razorpay_payment_id, razorpay_signature)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,'online','paid',$9,$10,$11)
       RETURNING id`,
      [
        customer_name,
        phone,
        address || '',
        JSON.stringify(items),
        total.toFixed(2),
        prescription || null,
        customer_id,
        prescription_status,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      ]
    );

    await client.query('COMMIT');
                          
    const orderId = orderResult.rows[0].id;

    // Send emails
    const { sendOrderConfirmation, sendAdminNotification } = require('../email');
    if (email) sendOrderConfirmation(email, customer_name, orderId, items, total);
    sendAdminNotification(orderId, customer_name, phone, items, total);

    res.json({
      success: true,
      order_id: orderId,
      payment_status: 'paid',
      has_rx: hasRx
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Order save after payment failed:', err);
    res.status(500).json({ error: 'Payment verified but order save failed. Call store immediately.' });
  } finally {
    client.release();
  }
});

module.exports = router;