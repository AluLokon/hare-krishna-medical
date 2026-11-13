// reviews.js — Medicine Reviews & Ratings
const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// Middleware to verify customer token
function verifyCustomer(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Login required' });
  }
  try {
    const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    req.customer = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Ensure reviews table exists
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      medicine_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      customer_name VARCHAR(100),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(medicine_id, customer_id)
    )
  `);
}
ensureTable().catch(console.error);

// GET /api/reviews/:medicineId — get reviews for a medicine (public)
router.get('/:medicineId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_name, rating, comment, created_at
       FROM reviews WHERE medicine_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.params.medicineId]
    );
    // Also get average rating
    const avg = await pool.query(
      `SELECT ROUND(AVG(rating)::numeric, 1) as avg_rating, COUNT(*) as total
       FROM reviews WHERE medicine_id = $1`,
      [req.params.medicineId]
    );
    res.json({
      reviews: result.rows,
      avg_rating: parseFloat(avg.rows[0].avg_rating) || 0,
      total: parseInt(avg.rows[0].total) || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// POST /api/reviews/:medicineId — submit a review (must be logged in + must have ordered this medicine)
router.post('/:medicineId', verifyCustomer, async (req, res) => {
  const { rating, comment } = req.body;
  const medicineId = parseInt(req.params.medicineId);

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  try {
    // Check if customer has ordered this medicine
    const ordered = await pool.query(
      `SELECT id FROM orders
       WHERE customer_id = $1 AND status IN ('delivered', 'confirmed', 'dispatched')
       AND items::text LIKE $2`,
      [req.customer.id, `%"id":${medicineId}%`]
    );

    if (ordered.rows.length === 0) {
      return res.status(403).json({ error: 'You can only review medicines you have ordered.' });
    }

    // Upsert review (update if already reviewed)
    await pool.query(
      `INSERT INTO reviews (medicine_id, customer_id, customer_name, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (medicine_id, customer_id)
       DO UPDATE SET rating = $4, comment = $5, created_at = NOW()`,
      [medicineId, req.customer.id, req.customer.name, rating, comment?.trim() || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// GET /api/reviews/:medicineId/my — check if current user reviewed this medicine
router.get('/:medicineId/my', verifyCustomer, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rating, comment FROM reviews WHERE medicine_id = $1 AND customer_id = $2`,
      [req.params.medicineId, req.customer.id]
    );
    res.json(result.rows[0] || null);
  } catch {
    res.json(null);
  }
});

module.exports = router;
