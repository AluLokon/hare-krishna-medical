// email-otp.js — Email OTP via Google Apps Script (free, sends to any email)

const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// In-memory OTP store: { email: { otp, expires, attempts, userData } }
const otpStore = {};

// Clean up expired OTPs every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const key in otpStore) {
    if (otpStore[key].expires < now) delete otpStore[key];
  }
}, 15 * 60 * 1000);

// Send OTP email via Google Apps Script
async function sendOTPEmail(email, otp, name) {
  const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
  const SECRET = process.env.GOOGLE_SCRIPT_SECRET || 'sitaram2024secret';

  if (!SCRIPT_URL) {
    console.log(`[DEV] Email OTP for ${email}: ${otp}`);
    return { dev: true };
  }

  console.log(`Sending OTP email to ${email} via Google Apps Script`);

  const https = require('https');
  const url = new URL(SCRIPT_URL);
  const body = JSON.stringify({ to: email, otp, name, secret: SECRET });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      // Google Apps Script redirects POST to GET — follow redirect manually
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = new URL(res.headers.location);
        // Re-POST to redirect location
        const req2 = https.request({
          hostname: redirectUrl.hostname,
          path: redirectUrl.pathname + redirectUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        }, (res2) => {
          let data = '';
          res2.on('data', d => data += d);
          res2.on('end', () => {
            console.log(`Apps Script response ${res2.statusCode}:`, data);
            try {
              const parsed = JSON.parse(data);
              if (parsed.success) resolve({ sent: true });
              else reject(new Error(parsed.error || 'Script error'));
            } catch {
              if (res2.statusCode >= 200 && res2.statusCode < 300) resolve({ sent: true });
              else reject(new Error(`Script error ${res2.statusCode}`));
            }
          });
        });
        req2.on('error', reject);
        req2.write(body);
        req2.end();
        return;
      }

      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log(`Apps Script response ${res.statusCode}:`, data);
        try {
          const parsed = JSON.parse(data);
          if (parsed.success) resolve({ sent: true });
          else reject(new Error(parsed.error || 'Script error'));
        } catch {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ sent: true });
          else reject(new Error(`Script error ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// POST /api/email-otp/send
router.post('/send', async (req, res) => {
  const { email, name, phone, password } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Please enter your name' });
  }
  if (!phone || !/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await pool.query('SELECT id FROM customers WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered. Please login instead.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  const existingOtp = otpStore[email];
  if (existingOtp && existingOtp.expires > Date.now() && (existingOtp.sendCount || 0) >= 3) {
    return res.status(429).json({ error: 'Too many attempts. Please try again in 10 minutes.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedPassword = await bcrypt.hash(password, 10);

  otpStore[email] = {
    otp,
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    sendCount: (existingOtp?.sendCount || 0) + 1,
    userData: { name: name.trim(), phone: phone.replace(/\D/g, ''), email: email.toLowerCase(), password: hashedPassword }
  };

  try {
    const result = await sendOTPEmail(email, otp, name);
    const response = { success: true, message: `OTP sent to ${email}` };
    if (result.dev) response.dev_otp = otp;
    res.json(response);
  } catch (err) {
    console.error('Email send failed:', err.message);
    res.status(500).json({ error: 'Failed to send OTP email. Please check your email address.' });
  }
});

// POST /api/email-otp/verify
router.post('/verify', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const record = otpStore[email];
  if (!record || record.expires < Date.now()) {
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  record.attempts = (record.attempts || 0) + 1;
  if (record.attempts > 5) {
    delete otpStore[email];
    return res.status(400).json({ error: 'Too many wrong attempts. Please request a new OTP.' });
  }

  if (record.otp !== otp.toString()) {
    return res.status(400).json({ error: `Incorrect OTP. ${5 - record.attempts} attempts remaining.` });
  }

  const { name, phone, password, email: userEmail } = record.userData;
  delete otpStore[email];

  try {
    const result = await pool.query(
      `INSERT INTO customers (name, phone, email, password, address)
       VALUES ($1, $2, $3, $4, '') RETURNING id, name, email, phone`,
      [name, phone, userEmail, password]
    );

    const customer = result.rows[0];
    const token = jwt.sign(
      { id: customer.id, email: customer.email, name: customer.name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, customer });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already registered. Please login.' });
    }
    res.status(500).json({ error: 'Account creation failed. Please try again.' });
  }
});

// POST /api/email-otp/resend
router.post('/resend', async (req, res) => {
  const { email } = req.body;
  const record = otpStore[email];

  if (!record) {
    return res.status(400).json({ error: 'Session expired. Please start registration again.' });
  }

  if ((record.sendCount || 0) >= 3) {
    return res.status(429).json({ error: 'Too many resend attempts. Please wait 10 minutes.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  record.otp = otp;
  record.expires = Date.now() + 10 * 60 * 1000;
  record.attempts = 0;
  record.sendCount = (record.sendCount || 0) + 1;

  try {
    const result = await sendOTPEmail(email, otp, record.userData.name);
    const response = { success: true };
    if (result.dev) response.dev_otp = otp;
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Failed to resend OTP.' });
  }
});

// GET /api/email-otp/test
router.get('/test', async (req, res) => {
  try {
    await sendOTPEmail('lokonallu444@gmail.com', '123456', 'Test');
    res.json({ success: true, provider: 'Google Apps Script' });
  } catch (err) {
    res.json({ error: err.message });
  }
});
module.exports = router;