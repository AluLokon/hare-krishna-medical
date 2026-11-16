// routes/addresses.js — Customer address book
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'sitaram_secret';

// Create addresses table if needed
pool.query(`
  CREATE TABLE IF NOT EXISTS customer_addresses (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label VARCHAR(50) DEFAULT 'Home',
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    address TEXT NOT NULL,
    pincode VARCHAR(10),
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(console.error);

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /api/addresses — list all addresses for customer
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/addresses — add new address
router.post('/', auth, async (req, res) => {
  try {
    const { label, name, phone, address, pincode, is_default } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Name and address are required' });

    // If setting as default, unset others
    if (is_default) {
      await pool.query(
        `UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`,
        [req.user.id]
      );
    }

    const result = await pool.query(
      `INSERT INTO customer_addresses (customer_id, label, name, phone, address, pincode, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, label || 'Home', name, phone || '', address, pincode || '', is_default || false]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/addresses/:id — update address
router.patch('/:id', auth, async (req, res) => {
  try {
    const { label, name, phone, address, pincode, is_default } = req.body;

    if (is_default) {
      await pool.query(
        `UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`,
        [req.user.id]
      );
    }

    const result = await pool.query(
      `UPDATE customer_addresses SET
        label = COALESCE($1, label),
        name = COALESCE($2, name),
        phone = COALESCE($3, phone),
        address = COALESCE($4, address),
        pincode = COALESCE($5, pincode),
        is_default = COALESCE($6, is_default)
       WHERE id = $7 AND customer_id = $8 RETURNING *`,
      [label, name, phone, address, pincode, is_default, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Address not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/addresses/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/addresses/:id/default — set as default
router.patch('/:id/default', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`,
      [req.user.id]
    );
    const result = await pool.query(
      `UPDATE customer_addresses SET is_default = true WHERE id = $1 AND customer_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
