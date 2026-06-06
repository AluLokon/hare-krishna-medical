const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/orders — saves a new order
router.post('/', async (req, res) => {
  const { customer_name, phone, address, items, total } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO orders (customer_name, phone, address, items, total)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [customer_name, phone, address, JSON.stringify(items), total]
    );
    res.json({ success: true, order_id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// GET /api/orders — your brother can see all orders
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});


// PATCH /api/orders/:id/deliver — mark order as delivered
router.patch('/:id/deliver', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      ['delivered', id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

module.exports = router;