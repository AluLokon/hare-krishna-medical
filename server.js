const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const medicinesRouter = require('./routes/medicines');
const ordersRouter = require('./routes/orders');
const authRouter = require('./routes/auth');
const verifyToken = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Fix 1: Helmet — security headers ──
app.use(helmet({
  contentSecurityPolicy: false // we disable this so our HTML pages still work
}));

// ── Fix 2: CORS — only allow your website ──
const allowedOrigins = [
  'http://localhost:3000',
  'https://hare-krishna-medical-sshf.onrender.com'
];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// ── Fix 3: Limit request size ──
app.use(express.json({ limit: '10mb' }));

// ── Fix 4: Rate limiting on login ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 login attempts per 15 min
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── Fix 5: General rate limiting on all API routes ──
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // 200 requests per 15 min per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Serve public files
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiters
app.use('/api/auth/login', loginLimiter);
app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/medicines', medicinesRouter);
app.use('/api/orders', ordersRouter);

// ── Fix 6: Global error handler — hide stack traces ──
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ERROR:`, err.stack);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});