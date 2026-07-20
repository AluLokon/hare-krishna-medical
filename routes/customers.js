const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

// Validation rules
const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().isLength({ min: 10, max: 15 }).withMessage('Valid phone required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

// Middleware to verify customer token
function verifyCustomer(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Please login to continue' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.customer = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Session expired. Please login again.' });
  }
}

// POST /api/customers/register
router.post('/register', registerValidation, async (req, res) => {
  if (!validate(req, res)) return;

  const { name, phone, email, password, address } = req.body;

  try {
    // Check if email already exists
    const existing = await pool.query(
      'SELECT id FROM customers WHERE email = $1', [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered. Please login.' });
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Save customer
    const result = await pool.query(
      `INSERT INTO customers (name, phone, email, password, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, phone`,
      [name, phone, email, hashed, address || '']
    );

    // Create token
    const token = jwt.sign(
      { id: result.rows[0].id, email, name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, customer: result.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/customers/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM customers WHERE email = $1', [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const customer = result.rows[0];
    const isMatch = await bcrypt.compare(password, customer.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: customer.id, email: customer.email, name: customer.name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/customers/me — get own profile
router.get('/me', verifyCustomer, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, address, created_at FROM customers WHERE id = $1',
      [req.customer.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// GET /api/customers/orders — get own order history
router.get('/orders', verifyCustomer, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_name, items, total, status, prescription_status,
              created_at, confirmed_at, dispatched_at, delivered_at
       FROM orders
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [req.customer.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// PATCH /api/customers/address — update saved address
router.patch('/address', verifyCustomer, async (req, res) => {
  const { address } = req.body;
  try {
    await pool.query(
      'UPDATE customers SET address = $1 WHERE id = $2',
      [address, req.customer.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update address' });
  }
});

module.exports = { router, verifyCustomer };