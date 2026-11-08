const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// In-memory OTP store: { phone: { otp, expiresAt, attempts } }
// For production use Redis, but this works fine for small stores
const otpStore = {};

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP via Fast2SMS (free Indian SMS gateway)
async function sendSMS(phone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;

  // If no SMS API key, log OTP for testing
  if (!apiKey) {
    console.log(`[OTP] Phone: ${phone}, OTP: ${otp} (no SMS key set)`);
    return { success: true, mock: true };
  }

  try {
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        route: 'otp',
        variables_values: otp,
        numbers: phone,
        flash: 0
      })
    });

    const data = await response.json();
    if (data.return) {
      return { success: true };
    } else {
      console.error('Fast2SMS error:', data);
      return { success: false, error: data.message };
    }
  } catch (err) {
    console.error('SMS send error:', err);
    return { success: false, error: 'SMS service unavailable' };
  }
}

// POST /api/otp/send
// Body: { phone: "9876543210" }
router.post('/send', async (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number' });
  }

  // Rate limit: max 3 OTPs per phone per 10 minutes
  const existing = otpStore[phone];
  if (existing && existing.expiresAt > Date.now() && existing.sendCount >= 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
  }

  const otp = generateOTP();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  otpStore[phone] = {
    otp,
    expiresAt,
    attempts: 0,
    sendCount: (existing && existing.expiresAt > Date.now()) ? (existing.sendCount || 0) + 1 : 1
  };

  const result = await sendSMS(phone, otp);

  if (!result.success) {
    return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }

  // In development/no SMS key: return OTP in response for testing
  if (result.mock) {
    return res.json({
      success: true,
      message: 'OTP sent (dev mode)',
      dev_otp: otp  // Remove this in production after SMS is set up
    });
  }

  res.json({ success: true, message: `OTP sent to +91 ${phone}` });
});

// POST /api/otp/verify
// Body: { phone: "9876543210", otp: "123456", name: "optional" }
router.post('/verify', async (req, res) => {
  const { phone, otp, name } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required' });
  }

  const record = otpStore[phone];

  if (!record) {
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[phone];
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }

  if (record.attempts >= 5) {
    delete otpStore[phone];
    return res.status(400).json({ error: 'Too many wrong attempts. Please request a new OTP.' });
  }

  if (record.otp !== otp.toString()) {
    record.attempts++;
    const remaining = 5 - record.attempts;
    return res.status(400).json({
      error: `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
    });
  }

  // OTP correct — delete it
  delete otpStore[phone];

  try {
    // Check if customer exists
    let customer = await pool.query(
      'SELECT id, name, phone, address FROM customers WHERE phone = $1', [phone]
    );

    if (customer.rows.length === 0) {
      // New customer — create account
      const newName = name || `Customer ${phone.slice(-4)}`;
      const result = await pool.query(
        `INSERT INTO customers (name, phone, email, password, address)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, phone, address`,
        [newName, phone, `${phone}@phone.sitarammedical.in`, '', '']
      );
      customer = result;
    }

    const c = customer.rows[0];

    // Create JWT token
    const token = jwt.sign(
      { id: c.id, phone: c.phone, name: c.name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      customer: {
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address || ''
      },
      isNew: customer.rows.length === 0
    });

  } catch (err) {
    console.error('OTP verify DB error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

module.exports = router;
