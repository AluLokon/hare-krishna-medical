const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find admin by email
    const result = await pool.query(
      'SELECT * FROM admins WHERE email = $1', [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const admin = result.rows[0];

    // Check password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create token
    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, name: admin.name });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/setup — create first admin (run only once)
router.post('/setup', async (req, res) => {
  const { email, password, name, setupKey } = req.body;

  // Security check — only allow if correct setup key
  if (setupKey !== process.env.SETUP_KEY) {
    return res.status(403).json({ error: 'Invalid setup key' });
  }

  try {
    // Check if admin already exists
    const existing = await pool.query('SELECT id FROM admins WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Admin already exists' });
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Save admin
    await pool.query(
      'INSERT INTO admins (email, password, name) VALUES ($1, $2, $3)',
      [email, hashed, name]
    );

    res.json({ success: true, message: 'Admin created successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Setup failed' });
  }
});



const verifyToken = require('../middleware');

// PATCH /api/auth/change-password — change own password
router.patch('/change-password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const adminId = req.admin.id;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const result = await pool.query('SELECT * FROM admins WHERE id = $1', [adminId]);
    const admin = result.rows[0];

    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admins SET password = $1 WHERE id = $2', [hashed, adminId]);

    res.json({ success: true, message: 'Password changed successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// PATCH /api/auth/change-email — change own email
router.patch('/change-email', verifyToken, async (req, res) => {
  const { password, newEmail } = req.body;
  const adminId = req.admin.id;

  if (!password || !newEmail) {
    return res.status(400).json({ error: 'Password and new email are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM admins WHERE id = $1', [adminId]);
    const admin = result.rows[0];

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    await pool.query('UPDATE admins SET email = $1 WHERE id = $2', [newEmail, adminId]);
    res.json({ success: true, message: 'Email changed successfully. Please login again.' });

  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This email is already in use' });
    }
    res.status(500).json({ error: 'Failed to change email' });
  }
});

module.exports = router;

