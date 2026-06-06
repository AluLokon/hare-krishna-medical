const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/medicines — returns all medicines
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM medicines ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

module.exports = router;