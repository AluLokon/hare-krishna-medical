// email-order.js — Send order notification email to admin
// Uses existing Brevo SMTP credentials from env vars

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS
  }
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lokonallu444@gmail.com';
const FROM_EMAIL  = process.env.BREVO_SENDER_EMAIL || 'noreply@sitarammedical.com';

// ══════════════════════════════════════
//  sendNewOrderEmail(order)
//  Call this after a new order is placed
// ══════════════════════════════════════
async function sendNewOrderEmail(order) {
  try {
    const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
    const itemsHtml = items.map(i => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e3f4eb;font-size:14px">${i.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e3f4eb;font-size:14px;text-align:center">${i.qty}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e3f4eb;font-size:14px;text-align:right">₹${(i.qty * i.price).toFixed(2)}</td>
      </tr>
    `).join('');

    const orderDate = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f9f5;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:580px;margin:24px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(15,107,58,0.1)">

    <!-- Header -->
    <div style="background:linear-gradient(110deg,#09421f,#0f6b3a);padding:24px 28px;color:white">
      <div style="font-size:28px;margin-bottom:8px">💊</div>
      <h1 style="margin:0;font-size:20px;font-weight:900">New Order Received!</h1>
      <p style="margin:4px 0 0;opacity:0.8;font-size:14px">Sitaram Medical Store · Order #${order.id}</p>
    </div>

    <!-- Order info -->
    <div style="padding:24px 28px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7c72;font-weight:600;width:40%">Customer</td>
          <td style="padding:8px 0;font-size:14px;font-weight:800;color:#192b20">${order.customer_name}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7c72;font-weight:600">Phone</td>
          <td style="padding:8px 0;font-size:14px;font-weight:700"><a href="tel:${order.phone}" style="color:#0f6b3a">${order.phone}</a></td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7c72;font-weight:600">Address</td>
          <td style="padding:8px 0;font-size:14px;font-weight:600;color:#192b20">${order.address || '—'}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7c72;font-weight:600">Payment</td>
          <td style="padding:8px 0;font-size:14px;font-weight:700">${order.payment_method === 'online' ? '💳 Online (Paid)' : '💵 Cash on Delivery'}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7c72;font-weight:600">Time</td>
          <td style="padding:8px 0;font-size:14px;font-weight:600;color:#192b20">${orderDate}</td>
        </tr>
        ${order.prescription_url ? `
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7c72;font-weight:600">Prescription</td>
          <td style="padding:8px 0"><a href="${order.prescription_url}" style="color:#0f6b3a;font-weight:700">View Prescription →</a></td>
        </tr>` : ''}
      </table>

      <!-- Items table -->
      <h3 style="margin:0 0 12px;font-size:15px;color:#192b20">Order Items</h3>
      <table style="width:100%;border-collapse:collapse;border:1.5px solid #ddeae2;border-radius:10px;overflow:hidden">
        <thead>
          <tr style="background:#f1faf5">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7c72;font-weight:800;text-transform:uppercase">Medicine</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7c72;font-weight:800;text-transform:uppercase">Qty</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7c72;font-weight:800;text-transform:uppercase">Amount</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot>
          <tr style="background:#f1faf5">
            <td colspan="2" style="padding:12px;font-size:15px;font-weight:900;color:#192b20">Total</td>
            <td style="padding:12px;font-size:18px;font-weight:900;color:#0f6b3a;text-align:right">₹${parseFloat(order.total).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- Action button -->
      <div style="text-align:center;margin-top:24px">
        <a href="https://hare-krishna-medical-sshf.onrender.com/admin.html"
           style="display:inline-block;background:linear-gradient(110deg,#09421f,#0f6b3a);color:white;padding:14px 32px;border-radius:11px;text-decoration:none;font-size:15px;font-weight:900">
          Open Admin Dashboard →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f1faf5;padding:16px 28px;text-align:center;border-top:1.5px solid #ddeae2">
      <p style="margin:0;font-size:12px;color:#6b7c72">Sitaram Medical Store · Old Bus Stand, Digapahandi-761012, Ganjam, Odisha</p>
    </div>
  </div>
</body>
</html>`;

    await transporter.sendMail({
      from: `"Sitaram Medical Store" <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `🛒 New Order #${order.id} — ₹${parseFloat(order.total).toFixed(0)} from ${order.customer_name}`,
      html
    });

    console.log(`[Email] Order #${order.id} notification sent to ${ADMIN_EMAIL}`);
  } catch (e) {
    console.error('[Email] Failed to send order notification:', e.message);
  }
}

module.exports = { sendNewOrderEmail };
