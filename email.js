const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter using Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Send order confirmation to customer
async function sendOrderConfirmation(customerEmail, customerName, orderId, items, total) {
  const itemsHtml = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">₹${(i.qty * i.price).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#085041,#1D9E75);padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">🏥 Sitaram Medical Store</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Chemist & Druggiest · Digapahandi, Ganjam</p>
      </div>

      <!-- Body -->
      <div style="background:#f9f9f7;padding:24px">
        
        <!-- Thank you message -->
        <div style="background:white;border-radius:10px;padding:20px;margin-bottom:16px">
          <h2 style="color:#1a1a1a;margin:0 0 8px;font-size:18px">✅ Order Confirmed!</h2>
          <p style="color:#555;margin:0;font-size:14px">
            Hi <strong>${customerName}</strong>, your order has been received successfully.
            We will call you shortly to confirm delivery.
          </p>
        </div>

        <!-- Order ID -->
        <div style="background:#EAF3DE;border:1px solid #C0DD97;border-radius:10px;padding:16px;margin-bottom:16px;text-align:center">
          <p style="color:#555;margin:0 0 4px;font-size:12px">Your Order ID</p>
          <p style="color:#3B6D11;margin:0;font-size:28px;font-weight:700">#${orderId}</p>
          <p style="color:#777;margin:6px 0 0;font-size:12px">Save this ID to track your order</p>
        </div>

        <!-- Order items -->
        <div style="background:white;border-radius:10px;padding:20px;margin-bottom:16px">
          <h3 style="color:#1a1a1a;margin:0 0 12px;font-size:15px">Order Items</h3>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#f5f5f0">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#777">Medicine</th>
                <th style="padding:8px 12px;text-align:center;font-size:12px;color:#777">Qty</th>
                <th style="padding:8px 12px;text-align:right;font-size:12px;color:#777">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding:12px;font-weight:700;font-size:15px">Total</td>
                <td style="padding:12px;font-weight:700;font-size:15px;text-align:right;color:#3B6D11">₹${parseFloat(total).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Store contact -->
        <div style="background:white;border-radius:10px;padding:16px;text-align:center">
          <p style="color:#777;margin:0 0 8px;font-size:13px">Questions? Contact us</p>
          <p style="color:#1a1a1a;margin:0;font-size:14px">📞 78468 70485 | 88988 70485</p>
          <p style="color:#777;margin:6px 0 0;font-size:12px">📍 Old Bus Stand, Opp. of Jio Mart, Digapahandi-761012, Ganjam</p>
        </div>

      </div>

      <!-- Footer -->
      <div style="background:#3B6D11;padding:16px;border-radius:0 0 12px 12px;text-align:center">
        <p style="color:rgba(255,255,255,0.8);margin:0;font-size:12px">
          Thank you for choosing Sitaram Medical Store 🙏
        </p>
      </div>

    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Sitaram Medical Store" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `Order #${orderId} Confirmed — Sitaram Medical Store`,
      html: html,
      headers: {
        'X-Priority': '1',
        'X-Mailer': 'Sitaram Medical Store',
        'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}>`
      }
    });
    console.log(`Order confirmation email sent to ${customerEmail}`);
  } catch (err) {
    // Don't crash the order if email fails — just log it
    console.error('Email send failed:', err.message);
  }
}

// Send notification to admin when new order arrives
async function sendAdminNotification(orderId, customerName, phone, items, total) {
  const itemsText = items.map(i => `• ${i.name} x${i.qty} = ₹${(i.qty * i.price).toFixed(2)}`).join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#085041;padding:20px;border-radius:12px 12px 0 0">
        <h2 style="color:white;margin:0;font-size:18px">🛎️ New Order Received!</h2>
      </div>
      <div style="background:#f9f9f7;padding:20px;border-radius:0 0 12px 12px">
        <p style="margin:0 0 8px"><strong>Order ID:</strong> #${orderId}</p>
        <p style="margin:0 0 8px"><strong>Customer:</strong> ${customerName}</p>
        <p style="margin:0 0 16px"><strong>Phone:</strong> ${phone}</p>
        <div style="background:white;padding:12px;border-radius:8px;margin-bottom:12px">
          <p style="margin:0 0 8px;font-weight:600">Items:</p>
          <pre style="margin:0;font-size:13px;font-family:Arial">${itemsText}</pre>
        </div>
        <p style="font-size:18px;font-weight:700;color:#3B6D11;margin:0">Total: ₹${parseFloat(total).toFixed(2)}</p>
        <a href="https://hare-krishna-medical-sshf.onrender.com/admin.html"
          style="display:block;margin-top:16px;background:#3B6D11;color:white;padding:10px;border-radius:8px;text-align:center;text-decoration:none;font-size:14px">
          View in Admin Dashboard →
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Sitaram Medical Store" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `🛎️ New Order #${orderId} from ${customerName}`,
      html: html
    });
  } catch (err) {
    console.error('Admin notification email failed:', err.message);
  }
}

module.exports = { sendOrderConfirmation, sendAdminNotification };