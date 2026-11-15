// routes/reports.js — Sales Report generation
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { adminAuth } = require('./admin');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ══════════════════════════════════════
//  GET /api/reports/sales?period=weekly|monthly|custom&from=&to=
//  Returns JSON data for the report
// ══════════════════════════════════════
router.get('/sales', adminAuth, async (req, res) => {
  try {
    const { period = 'monthly', from, to } = req.query;

    let startDate, endDate, label;
    const now = new Date();

    if (period === 'weekly') {
      const day = now.getDay();
      startDate = new Date(now);
      startDate.setDate(now.getDate() - day);
      startDate.setHours(0,0,0,0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23,59,59,999);
      label = `Week of ${startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      label = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    } else if (period === 'custom' && from && to) {
      startDate = new Date(from + 'T00:00:00');
      endDate = new Date(to + 'T23:59:59');
      label = `${new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    } else {
      return res.status(400).json({ error: 'Invalid period' });
    }

    const [summary, daily, topMeds, byStatus, newCustomers] = await Promise.all([
      // Overall summary
      pool.query(`
        SELECT
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE status='delivered') as delivered,
          COUNT(*) FILTER (WHERE status='cancelled') as cancelled,
          COUNT(*) FILTER (WHERE status='pending')   as pending,
          COALESCE(SUM(total) FILTER (WHERE status != 'cancelled'), 0) as revenue,
          COALESCE(AVG(total) FILTER (WHERE status != 'cancelled'), 0) as avg_order,
          COALESCE(SUM(total) FILTER (WHERE payment_method='online' AND status != 'cancelled'), 0) as online_revenue,
          COALESCE(SUM(total) FILTER (WHERE payment_method='cod' AND status != 'cancelled'), 0) as cod_revenue
        FROM orders
        WHERE created_at BETWEEN $1 AND $2
      `, [startDate, endDate]),

      // Daily breakdown
      pool.query(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as orders,
          COALESCE(SUM(total) FILTER (WHERE status != 'cancelled'), 0) as revenue
        FROM orders
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `, [startDate, endDate]),

      // Top medicines sold
      pool.query(`
        SELECT
          item->>'name' as name,
          SUM((item->>'qty')::int) as qty_sold,
          SUM((item->>'qty')::int * (item->>'price')::float) as revenue
        FROM orders,
        jsonb_array_elements(items::jsonb) as item
        WHERE created_at BETWEEN $1 AND $2
          AND status != 'cancelled'
        GROUP BY item->>'name'
        ORDER BY qty_sold DESC
        LIMIT 10
      `, [startDate, endDate]),

      // Orders by status
      pool.query(`
        SELECT status, COUNT(*) as count
        FROM orders
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY status
        ORDER BY count DESC
      `, [startDate, endDate]),

      // New customers
      pool.query(`
        SELECT COUNT(*) as count FROM customers
        WHERE created_at BETWEEN $1 AND $2
      `, [startDate, endDate])
    ]);

    res.json({
      label,
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      summary: summary.rows[0],
      daily: daily.rows,
      topMedicines: topMeds.rows,
      byStatus: byStatus.rows,
      newCustomers: newCustomers.rows[0].count
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
