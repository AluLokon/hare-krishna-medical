// routes/admin.js — Admin API routes (password protected)
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
let sendOrderNotification;
try { ({ sendOrderNotification } = require('./push')); } catch(e) {}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Simple admin auth middleware ──
// Checks header: X-Admin-Key: <ADMIN_SECRET>
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  const secret = process.env.ADMIN_SECRET || 'sitaram_admin_2024';
  if (key !== secret) {
    return res.status(401).json({ error: 'Unauthorised. Wrong admin key.' });
  }
  next();
}

// ══════════════════════════════════════
//  DASHBOARD STATS
// ══════════════════════════════════════
// GET /api/admin/stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [orders, revenue, customers, lowStock] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE status='pending')    as pending,
        COUNT(*) FILTER (WHERE status='confirmed')  as confirmed,
        COUNT(*) FILTER (WHERE status='dispatched') as dispatched,
        COUNT(*) FILTER (WHERE status='delivered')  as delivered,
        COUNT(*) FILTER (WHERE status='cancelled')  as cancelled
        FROM orders`),
      pool.query(`SELECT COALESCE(SUM(total),0) as total_revenue,
        COALESCE(SUM(total) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'),0) as week_revenue,
        COALESCE(SUM(total) FILTER (WHERE DATE(created_at) = CURRENT_DATE),0) as today_revenue
        FROM orders WHERE status != 'cancelled'`),
      pool.query(`SELECT COUNT(*) as total FROM customers`),
      pool.query(`SELECT COUNT(*) as total FROM medicines WHERE stock <= 5`)
    ]);
    res.json({
      orders: orders.rows[0],
      revenue: revenue.rows[0],
      customers: customers.rows[0],
      lowStock: lowStock.rows[0]
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  ORDERS
// ══════════════════════════════════════
// GET /api/admin/orders?status=pending&page=1
router.get('/orders', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '';
    const params = [limit, offset];
    if (status && status !== 'all') {
      where = `WHERE status = $3`;
      params.push(status);
    }
    const result = await pool.query(
      `SELECT id, customer_name, phone, address, items, total, status,
        payment_method, created_at, prescription_status
       FROM orders
       ${where}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM orders ${status && status !== 'all' ? `WHERE status = $1` : ''}`,
      status && status !== 'all' ? [status] : []
    );
    res.json({ orders: result.rows, total: parseInt(countRes.rows[0].total) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/orders/:id/status
router.patch('/orders/:id/status', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['pending', 'confirmed', 'dispatched', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    // Set timestamp column based on status
    const tsCol = { confirmed: 'confirmed_at', dispatched: 'dispatched_at', delivered: 'delivered_at' }[status];
    const tsUpdate = tsCol ? `, ${tsCol} = NOW()` : '';

    const result = await pool.query(
      `UPDATE orders SET status = $1 ${tsUpdate} WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    // Send push notification to customer
    if (sendOrderNotification) {
      sendOrderNotification(id, status).catch(console.error);
    }
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/orders/:id/prescription
router.patch('/orders/:id/prescription', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { prescription_status } = req.body;
    const result = await pool.query(
      `UPDATE orders SET prescription_status = $1 WHERE id = $2 RETURNING id, prescription_status`,
      [prescription_status, id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  MEDICINES
// ══════════════════════════════════════
// GET /api/admin/medicines?search=parac&page=1
router.get('/medicines', adminAuth, async (req, res) => {
  try {
    const { search, page = 1, limit = 30, lowstock } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $${params.length} OR brand ILIKE $${params.length})`;
    }
    if (lowstock === '1') {
      where += ` AND stock <= 5`;
    }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM medicines ${where} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM medicines ${where}`,
      params.slice(0, params.length - 2)
    );
    res.json({ medicines: result.rows, total: parseInt(countRes.rows[0].total) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/medicines/:id — update price/stock/name etc
router.patch('/medicines/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, brand, price, stock, uses, requires_prescription } = req.body;
    const result = await pool.query(
      `UPDATE medicines SET
        name = COALESCE($1, name),
        brand = COALESCE($2, brand),
        price = COALESCE($3, price),
        stock = COALESCE($4, stock),
        uses = COALESCE($5, uses),
        requires_prescription = COALESCE($6, requires_prescription)
       WHERE id = $7 RETURNING *`,
      [name, brand, price, stock, uses, requires_prescription, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Medicine not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/medicines — add new medicine
router.post('/medicines', adminAuth, async (req, res) => {
  try {
    const { name, brand, price, stock, uses, category, icon, requires_prescription } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name and price required' });
    const result = await pool.query(
      `INSERT INTO medicines (name, brand, price, stock, uses, category, icon, requires_prescription)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, brand || '', price, stock || 0, uses || '', category || 'General', icon || '💊', requires_prescription || false]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/medicines/:id
router.delete('/medicines/:id', adminAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM medicines WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  CUSTOMERS
// ══════════════════════════════════════
// GET /api/admin/customers
router.get('/customers', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.created_at,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total) FILTER (WHERE o.status != 'cancelled'), 0) as total_spent
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id
       GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  RECENT ACTIVITY (for dashboard feed)
// ══════════════════════════════════════
router.get('/recent', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_name, phone, total, status, created_at, items
       FROM orders ORDER BY created_at DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.adminAuth = adminAuth;
