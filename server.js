const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const medicinesRouter = require('./routes/medicines');
const ordersRouter = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve your HTML/CSS/JS files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/medicines', medicinesRouter);
app.use('/api/orders', ordersRouter);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});