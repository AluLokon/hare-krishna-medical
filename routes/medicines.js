const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../middleware');
const { body, validationResult } = require('express-validator');

// ── Validation rules for adding/updating medicine ──
const medicineValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Medicine name is required')
    .isLength({ max: 150 }).withMessage('Name too long'),
  body('price')
    .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('stock')
    .isInt({ min: 0 }).withMessage('Stock must be a positive number'),
  body('category')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Category too long'),
  body('brand')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Brand too long'),
];

// Helper to check validation result
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

// GET all medicines
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM medicines ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

// GET featured medicines only
router.get('/featured', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM medicines WHERE featured = true ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch featured medicines' });
  }
});

// GET search medicines
router.get('/search', async (req, res) => {
  const { q, category } = req.query;
  try {
    let query = 'SELECT * FROM medicines WHERE 1=1';
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      query += ` AND (name ILIKE $${params.length} OR brand ILIKE $${params.length})`;
    }
    if (category && category !== 'all') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    query += ' ORDER BY name ASC LIMIT 50';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET all unique categories
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT category FROM medicines ORDER BY category ASC'
    );
    res.json(result.rows.map(r => r.category));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST — add new medicine (admin only + validation)
router.post('/', verifyToken, medicineValidation, async (req, res) => {
  if (!validate(req, res)) return;

  const { name, brand, price, category, icon, requires_rx, stock, featured } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO medicines
        (name, brand, price, category, icon, requires_rx, stock, featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        brand || '',
        price,
        category || 'general',
        icon || '💊',
        requires_rx || false,
        stock || 100,
        featured || false
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add medicine' });
  }
});

// PATCH — update medicine stock or price (admin only + validation)
router.patch('/:id', verifyToken, [
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be positive'),
  body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be positive'),
], async (req, res) => {
  if (!validate(req, res)) return;

  const { id } = req.params;
  const { stock, price } = req.body;
  try {
    await pool.query(
      'UPDATE medicines SET stock = COALESCE($1, stock), price = COALESCE($2, price) WHERE id = $3',
      [stock, price, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update medicine' });
  }
});

// DELETE — remove a medicine (admin only)
router.delete('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM medicines WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete medicine' });
  }
});

// GET low stock medicines (admin only)
router.get('/low-stock', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, brand, stock, category, icon
       FROM medicines
       WHERE stock <= 10
       ORDER BY stock ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch low stock medicines' });
  }
});

module.exports = router;