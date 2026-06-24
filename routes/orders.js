const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../middleware');
const { body, validationResult } = require('express-validator');

// Validation rules
const orderValidation = [
  body('customer_name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ max: 100 }).withMessage('Name too long'),
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone is required')
    .isLength({ min: 10, max: 15 }).withMessage('Invalid phone number'),
  body('total')
    .isFloat({ min: 0 }).withMessage('Total must be positive'),
  body('items')
    .isArray({ min: 1 }).withMessage('Order must have at least one item'),
];

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

// POST — place order with stock check and decrement
router.post('/', orderValidation, async (req, res) => {
  if (!validate(req, res)) return;

  const { customer_name, phone, address, items, total, prescription } = req.body;

  // Use a database transaction so everything happens together
  // If anything fails, everything rolls back — no partial orders
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check and decrement stock for each item
    for (const item of items) {
      // Lock the row so two customers can't order same item simultaneously
      const stockResult = await client.query(
        'SELECT stock, name FROM medicines WHERE id = $1 FOR UPDATE',
        [item.id]
      );

      if (stockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Medicine not found`
        });
      }

      const currentStock = stockResult.rows[0].stock;
      const medicineName = stockResult.rows[0].name;

      // Check if enough stock available
      if (currentStock < item.qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Sorry! Only ${currentStock} units of "${medicineName}" available. Please reduce quantity.`
        });
      }

      // Reduce stock
      await client.query(
        'UPDATE medicines SET stock = stock - $1 WHERE id = $2',
        [item.qty, item.id]
      );
    }

    // Save the order
    const result = await client.query(
      `INSERT INTO orders
        (customer_name, phone, address, items, total, prescription, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [
        customer_name,
        phone,
        address || '',
        JSON.stringify(items),
        total,
        prescription || null
      ]
    );

    // All good — commit everything
    await client.query('COMMIT');

    res.json({ success: true, order_id: result.rows[0].id });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to place order. Please try again.' });
  } finally {
    // Always release the connection back to pool
    client.release();
  }
});

// GET all orders (admin only)
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// PATCH — mark as delivered (admin only)
router.patch('/:id/deliver', verifyToken, async (req, res) => {
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