const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const medicinesRouter = require('./routes/medicines');
const ordersRouter = require('./routes/orders');
const authRouter = require('./routes/auth');
const verifyToken = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve public files
app.use(express.static(path.join(__dirname, 'public')));

// Public routes (no login needed)
app.use('/api/auth', authRouter);
app.use('/api/medicines', medicinesRouter);

// Protected routes (login required)
app.use('/api/orders', verifyToken, ordersRouter);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});