const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../middleware');
const { body, validationResult } = require('express-validator');

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
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const item of items) {
      const stockResult = await client.query(
        'SELECT stock, name FROM medicines WHERE id = $1 FOR UPDATE',
        [item.id]
      );

      if (stockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Medicine not found' });
      }

      const currentStock = stockResult.rows[0].stock;
      const medicineName = stockResult.rows[0].name;

      if (currentStock < item.qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Sorry! Only ${currentStock} units of "${medicineName}" available. Please reduce quantity.`
        });
      }

      await client.query(
        'UPDATE medicines SET stock = stock - $1 WHERE id = $2',
        [item.qty, item.id]
      );
    }

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

    await client.query('COMMIT');
    res.json({ success: true, order_id: result.rows[0].id });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to place order. Please try again.' });
  } finally {
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

// GET single order by id (for customer status tracking)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, customer_name, status, total, created_at, confirmed_at, dispatched_at, delivered_at, items FROM orders WHERE id = $1',
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// PATCH — update order status (admin only)
router.patch('/:id/status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'confirmed', 'dispatched', 'delivered'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  // Set the right timestamp column based on status
  const timestampMap = {
    confirmed: 'confirmed_at',
    dispatched: 'dispatched_at',
    delivered: 'delivered_at'
  };

  try {
    let query = 'UPDATE orders SET status = $1';
    const params = [status, id];

    if (timestampMap[status]) {
      query += `, ${timestampMap[status]} = NOW()`;
    }

    query += ' WHERE id = $2';
    await pool.query(query, params);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Keep old deliver route for backward compatibility
router.patch('/:id/deliver', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE orders SET status = $1, delivered_at = NOW() WHERE id = $2',
      ['delivered', id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});


// GET export orders as CSV (admin only)
router.get('/export/csv', verifyToken, async (req, res) => {
  const { date } = req.query;

  try {
    let query = 'SELECT * FROM orders ORDER BY created_at DESC';
    const params = [];

    if (date) {
      query = `SELECT * FROM orders 
               WHERE DATE(created_at) = $1 
               ORDER BY created_at DESC`;
      params.push(date);
    }

    const result = await pool.query(query, params);
    const orders = result.rows;

    // Build CSV content
    const headers = [
      'Order ID',
      'Customer Name',
      'Phone',
      'Address',
      'Items',
      'Total (₹)',
      'Status',
      'Order Date',
      'Confirmed At',
      'Dispatched At',
      'Delivered At'
    ];

    const rows = orders.map(order => {
      const items = Array.isArray(order.items)
        ? order.items
        : JSON.parse(order.items || '[]');

      const itemsText = items
        .map(i => `${i.name} x${i.qty}`)
        .join(' | ');

      const formatDate = (d) => d
        ? new Date(d).toLocaleString('en-IN')
        : '';

      return [
        order.id,
        order.customer_name,
        order.phone,
        (order.address || '').replace(/,/g, ';'),
        itemsText,
        order.total,
        order.status,
        formatDate(order.created_at),
        formatDate(order.confirmed_at),
        formatDate(order.dispatched_at),
        formatDate(order.delivered_at)
      ].map(val => `"${val}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    // Send as downloadable file
    const filename = date
      ? `orders-${date}.csv`
      : `all-orders-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export orders' });
  }
});

module.exports = router;