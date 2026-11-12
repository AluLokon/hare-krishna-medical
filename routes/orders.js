const express = require('express');
const router = express.Router();
const pool = require('../db');

const verifyToken = require('../middleware');
const { body, validationResult } = require('express-validator');
const { sendOrderConfirmation, sendAdminNotification, sendLowStockAlert } = require('../email');
const { sendNewOrderWhatsApp } = require('../whatsapp');

const orderValidation = [
  body('customer_name').trim().notEmpty().withMessage('Name is required')
    .isLength({ max: 100 }).withMessage('Name too long'),
  body('phone').trim().isLength({ min: 10, max: 15 }).withMessage('Invalid phone number'),
  body('total').isFloat({ min: 0 }).withMessage('Total must be positive'),
  body('items').isArray({ min: 1 }).withMessage('Order must have at least one item'),
];

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

// POST — place order
router.post('/', orderValidation, async (req, res) => {
  if (!validate(req, res)) return;

  const { customer_name, phone, address, items, total, prescription, email } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Step 1: Check which medicines need Rx ──
    const medicineIds = items.map(i => parseInt(i.id));
    const rxCheck = await client.query(
      `SELECT id, name, requires_rx FROM medicines WHERE id = ANY($1)`,
      [medicineIds]
    );

    const rxMedicines = rxCheck.rows.filter(m => m.requires_rx);
    const hasRxMedicines = rxMedicines.length > 0;

    // ── Step 2: Server-side Rx enforcement ──
    if (hasRxMedicines) {
      if (!prescription) {
        await client.query('ROLLBACK');
        const rxNames = rxMedicines.map(m => m.name).join(', ');
        return res.status(400).json({
          error: `Prescription required for: ${rxNames}. Please upload a valid prescription to continue.`,
          requires_prescription: true,
          rx_medicines: rxNames
        });
      }

      // Validate prescription is a valid base64 image or PDF
      const isValidFormat = prescription.startsWith('data:image/') ||
                            prescription.startsWith('data:application/pdf');
      if (!isValidFormat) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Invalid prescription format. Please upload an image or PDF file.'
        });
      }
    }

    // ── Step 3: Stock check and decrement ──
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
          error: `Sorry! Only ${currentStock} units of "${medicineName}" available.`
        });
      }

      await client.query(
        'UPDATE medicines SET stock = stock - $1 WHERE id = $2',
        [item.qty, item.id]
      );
    }

    // ── Step 3b: Check for low stock and send alert ──
    try {
      const itemIds = items.map(i => i.id);
      const lowStockResult = await client.query(
        `SELECT id, name, brand, stock, icon FROM medicines WHERE id = ANY($1) AND stock <= 5`,
        [itemIds]
      );
      if (lowStockResult.rows.length > 0) {
        sendLowStockAlert(lowStockResult.rows); // non-blocking
      }
    } catch (e) {
      console.error('Low stock check failed:', e.message);
    }

    // ── Step 4: Get customer_id from token if logged in ──
    let customer_id = null;
    try {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        customer_id = decoded.id;
      }
    } catch (e) {
      // Guest order — fine
    }

    // ── Step 5: Set prescription_status ──
    const prescription_status = hasRxMedicines ? 'pending_approval' : null;

    // ── Step 6: Save order ──
    const result = await client.query(
      `INSERT INTO orders
        (customer_name, phone, address, items, total, prescription,
         status, customer_id, prescription_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
       RETURNING id`,
      [
        customer_name,
        phone,
        address || '',
        JSON.stringify(items),
        total,
        prescription || null,
        customer_id,
        prescription_status
      ]
    );

    await client.query('COMMIT');

    const orderId = result.rows[0].id;

    // ── Step 7: Send emails ──
    if (email) {
      sendOrderConfirmation(email, customer_name, orderId, items, total);
    }
    sendAdminNotification(orderId, customer_name, phone, items, total);
    sendNewOrderWhatsApp(orderId, customer_name, phone, items, total);

    res.json({
      success: true,
      order_id: orderId,
      has_rx: hasRxMedicines,
      prescription_status: prescription_status
    });

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

// GET single order
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, customer_name, status, prescription_status, total,
              created_at, confirmed_at, dispatched_at, delivered_at, items
       FROM orders WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
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
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PATCH — approve prescription (admin only)
router.patch('/:id/prescription/approve', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE orders
       SET prescription_status = 'approved',
           status = 'confirmed',
           confirmed_at = NOW()
       WHERE id = $1`,
      [id]
    );
    res.json({ success: true, message: 'Prescription approved. Order confirmed.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve prescription' });
  }
});

// PATCH — reject prescription (admin only)
router.patch('/:id/prescription/reject', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get order items to restore stock
    const orderResult = await client.query(
      'SELECT items FROM orders WHERE id = $1', [id]
    );

    if (!orderResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = Array.isArray(orderResult.rows[0].items)
      ? orderResult.rows[0].items
      : JSON.parse(orderResult.rows[0].items || '[]');

    // Restore stock for each item
    for (const item of items) {
      await client.query(
        'UPDATE medicines SET stock = stock + $1 WHERE id = $2',
        [item.qty, item.id]
      );
    }

    // Update order status to rejected
    await client.query(
      `UPDATE orders
       SET prescription_status = 'rejected',
           status = 'cancelled'
       WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Prescription rejected. Stock restored.' });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to reject prescription' });
  } finally {
    client.release();
  }
});

// PATCH — old deliver route (backward compatibility)
router.patch('/:id/deliver', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE orders SET status = $1, delivered_at = NOW() WHERE id = $2',
      ['delivered', id]
    );
    res.json({ success: true });
  } catch (err) {
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
      query = `SELECT * FROM orders WHERE DATE(created_at) = $1 ORDER BY created_at DESC`;
      params.push(date);
    }
    const result = await pool.query(query, params);
    const orders = result.rows;

    const headers = [
      'Order ID', 'Customer Name', 'Phone', 'Address', 'Items',
      'Total (₹)', 'Status', 'Prescription Status', 'Order Date'
    ];

    const rows = orders.map(order => {
      const items = Array.isArray(order.items)
        ? order.items : JSON.parse(order.items || '[]');
      const itemsText = items.map(i => `${i.name} x${i.qty}`).join(' | ');
      return [
        order.id, order.customer_name, order.phone,
        (order.address || '').replace(/,/g, ';'),
        itemsText, order.total, order.status,
        order.prescription_status || 'N/A',
        new Date(order.created_at).toLocaleString('en-IN')
      ].map(val => `"${val}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = date ? `orders-${date}.csv` : `all-orders-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export orders' });
  }
});

module.exports = router;