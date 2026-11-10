// email-otp.js — Email OTP via Brevo for customer signup verification

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

// Send OTP email via Brevo SMTP (nodemailer)
async function sendOTPEmail(email, otp, name) {
  const smtpUser = process.env.BREVO_SMTP_USER;
  const smtpPass = process.env.BREVO_SMTP_PASS;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'lokonallu444@gmail.com';

  if (!smtpUser || !smtpPass) {
    console.log(`[DEV] Email OTP for ${email}: ${otp}`);
    return { dev: true };
  }

  console.log(`Sending OTP email to ${email} via SMTP user ${smtpUser}`);

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: smtpUser, pass: smtpPass }
  });

  await transporter.sendMail({
    from: `"Sitaram Medical Store" <${senderEmail}>`,
    to: email,
    subject: `${otp} is your Sitaram Medical OTP`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f9f9f9;padding:30px;border-radius:12px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="background:#0f6b3a;display:inline-block;padding:12px 24px;border-radius:8px">
            <span style="color:white;font-size:20px;font-weight:800">Sitaram Medical Store</span>
          </div>
        </div>
        <h2 style="color:#1a1a2e;text-align:center;margin-bottom:8px">Verify Your Email</h2>
        <p style="color:#555;text-align:center;margin-bottom:28px">Use the OTP below to complete your registration</p>
        <div style="background:white;border:2px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center">
          <div style="letter-spacing:12px;font-size:36px;font-weight:800;color:#0f6b3a;font-family:monospace">${otp}</div>
        </div>
        <p style="color:#888;text-align:center;font-size:13px;margin-top:16px">This OTP expires in <strong>10 minutes</strong>.</p>
        <p style="color:#aaa;text-align:center;font-size:12px;margin-top:24px">If you didn't request this, please ignore this email.</p>
      </div>
    `
  });

  return { sent: true };
}

// POST /api/email-otp/send
// Body: { email, name, phone, password }
// Saves user data, sends OTP, waits for verify before inserting to DB
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

  // Check email already registered
  try {
    const existing = await pool.query('SELECT id FROM customers WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered. Please login instead.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  // Rate limit: max 3 OTPs per email per 10 min
  const existing = otpStore[email];
  if (existing && existing.expires > Date.now() && (existing.sendCount || 0) >= 3) {
    return res.status(429).json({ error: 'Too many attempts. Please try again in 10 minutes.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedPassword = await bcrypt.hash(password, 10);

  otpStore[email] = {
    otp,
    expires: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    sendCount: (existing?.sendCount || 0) + 1,
    userData: { name: name.trim(), phone: phone.replace(/\D/g, ''), email: email.toLowerCase(), password: hashedPassword }
  };

  try {
    const result = await sendOTPEmail(email, otp, name);
    const response = { success: true, message: `OTP sent to ${email}` };
    // Dev mode: return OTP in response
    if (result.dev) response.dev_otp = otp;
    res.json(response);
  } catch (err) {
    console.error('Email send failed:', err.message);
    res.status(500).json({ error: 'Failed to send OTP email. Please check your email address.' });
  }
});

// POST /api/email-otp/verify
// Body: { email, otp }
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

  // OTP correct — create customer account
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

// GET /api/email-otp/test — debug endpoint (remove after testing)
router.get('/test', async (req, res) => {
  const sender = process.env.BREVO_SENDER_EMAIL || 'lokonallu444@gmail.com';
  const smtpUser = process.env.BREVO_SMTP_USER;
  try {
    await sendOTPEmail(sender, '123456', 'Test');
    res.json({ success: true, sender, smtpUser });
  } catch (err) {
    res.json({ error: err.message, sender, smtpUser });
  }
});

module.exports = router;