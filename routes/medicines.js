const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all medicines
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM medicines ORDER BY name ASC');
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
      query += ` AND (name ILIKE $${params.length} OR brand ILIKE $${params.length} OR category ILIKE $${params.length})`;    }
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

// POST — add new medicine
router.post('/', async (req, res) => {
  const { name, brand, price, category, icon, requires_rx, stock } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO medicines (name, brand, price, category, icon, requires_rx, stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, brand, price, category, icon || '💊', requires_rx || false, stock || 100]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add medicine' });
  }
});

// PATCH — update medicine stock or price
router.patch('/:id', async (req, res) => {
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

// DELETE — remove a medicine
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM medicines WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete medicine' });
  }
});

module.exports = router;