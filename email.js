require('dotenv').config();

const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const SECRET = process.env.GOOGLE_SCRIPT_SECRET || 'sitaram2024secret';

const https = require('https');

function makeGetRequest(url) {
  return new Promise((resolve, reject) => {
    function follow(hostname, path, hops) {
      if (hops > 5) return reject(new Error('Too many redirects'));
      const req = https.request({ hostname, path, method: 'GET' }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = new URL(res.headers.location);
          return follow(loc.hostname, loc.pathname + loc.search, hops + 1);
        }
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.end();
    }
    const u = new URL(url);
    follow(u.hostname, u.pathname + u.search, 0);
  });
}

async function sendViaScript(to, subject, htmlBody, toName) {
  if (!SCRIPT_URL) {
    console.log(`[DEV] Email to ${to}: ${subject}`);
    return;
  }
  const params = new URLSearchParams({
    to,
    toName: toName || '',
    subject,
    html: htmlBody,
    secret: SECRET,
    mode: 'custom'
  });
  const url = SCRIPT_URL + '?' + params.toString();
  try {
    const result = await makeGetRequest(url);
    console.log(`Email sent to ${to}:`, result.data);
  } catch (err) {
    console.error(`Email failed to ${to}:`, err.message);
  }
}

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
      <div style="background:linear-gradient(135deg,#085041,#1D9E75);padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">🏥 Sitaram Medical Store</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Chemist and Druggist - Digapahandi, Ganjam</p>
      </div>
      <div style="background:#f9f9f7;padding:24px">
        <div style="background:white;border-radius:10px;padding:20px;margin-bottom:16px">
          <h2 style="color:#1a1a1a;margin:0 0 8px;font-size:18px">Order Confirmed!</h2>
          <p style="color:#555;margin:0;font-size:14px">Hi <strong>${customerName}</strong>, your order has been received. We will call you shortly to confirm delivery.</p>
        </div>
        <div style="background:#EAF3DE;border:1px solid #C0DD97;border-radius:10px;padding:16px;margin-bottom:16px;text-align:center">
          <p style="color:#555;margin:0 0 4px;font-size:12px">Your Order ID</p>
          <p style="color:#3B6D11;margin:0;font-size:28px;font-weight:700">#${orderId}</p>
          <p style="color:#777;margin:6px 0 0;font-size:12px">Save this ID to track your order</p>
        </div>
        <div style="background:white;border-radius:10px;padding:20px;margin-bottom:16px">
          <h3 style="color:#1a1a1a;margin:0 0 12px;font-size:15px">Order Items</h3>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f5f5f0">
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#777">Medicine</th>
              <th style="padding:8px 12px;text-align:center;font-size:12px;color:#777">Qty</th>
              <th style="padding:8px 12px;text-align:right;font-size:12px;color:#777">Amount</th>
            </tr></thead>
            <tbody>${itemsHtml}</tbody>
            <tfoot><tr>
              <td colspan="2" style="padding:12px;font-weight:700;font-size:15px">Total</td>
              <td style="padding:12px;font-weight:700;font-size:15px;text-align:right;color:#3B6D11">₹${parseFloat(total).toFixed(2)}</td>
            </tr></tfoot>
          </table>
        </div>
        <div style="background:white;border-radius:10px;padding:16px;text-align:center">
          <p style="color:#777;margin:0 0 8px;font-size:13px">Questions? Contact us</p>
          <p style="color:#1a1a1a;margin:0;font-size:14px">78468 70485 | 88988 70485</p>
          <p style="color:#777;margin:6px 0 0;font-size:12px">Old Bus Stand, Opp. of Jio Mart, Digapahandi-761012, Ganjam</p>
        </div>
      </div>
      <div style="background:#3B6D11;padding:16px;border-radius:0 0 12px 12px;text-align:center">
        <p style="color:rgba(255,255,255,0.8);margin:0;font-size:12px">Thank you for choosing Sitaram Medical Store</p>
      </div>
    </div>
  `;

  await sendViaScript(customerEmail, `Order #${orderId} Confirmed - Sitaram Medical Store`, html, customerName);
}

async function sendAdminNotification(orderId, customerName, phone, items, total) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const itemsHtml = items.map(i =>
    `<p style="margin:4px 0">- ${i.name} x${i.qty} = ₹${(i.qty * i.price).toFixed(2)}</p>`
  ).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#085041;padding:20px;border-radius:12px 12px 0 0">
        <h2 style="color:white;margin:0;font-size:18px">New Order Received!</h2>
      </div>
      <div style="background:#f9f9f7;padding:20px;border-radius:0 0 12px 12px">
        <p style="margin:0 0 8px"><strong>Order ID:</strong> #${orderId}</p>
        <p style="margin:0 0 8px"><strong>Customer:</strong> ${customerName}</p>
        <p style="margin:0 0 16px"><strong>Phone:</strong> ${phone}</p>
        <div style="background:white;padding:12px;border-radius:8px;margin-bottom:12px">${itemsHtml}</div>
        <p style="font-size:18px;font-weight:700;color:#3B6D11;margin:0">Total: ₹${parseFloat(total).toFixed(2)}</p>
        <a href="https://hare-krishna-medical-sshf.onrender.com/admin.html"
          style="display:block;margin-top:16px;background:#3B6D11;color:white;padding:10px;border-radius:8px;text-align:center;text-decoration:none;font-size:14px">
          View in Admin Dashboard
        </a>
      </div>
    </div>
  `;

  await sendViaScript(adminEmail, `New Order #${orderId} from ${customerName}`, html, 'Admin');
}

async function sendLowStockAlert(lowStockItems) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !lowStockItems.length) return;

  const rows = lowStockItems.map(m => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee">${m.icon || '💊'} ${m.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;color:#6b7280">${m.brand || '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">
        <span style="background:${m.stock === 0 ? '#fee2e2' : '#fef3c7'};color:${m.stock === 0 ? '#991b1b' : '#92400e'};padding:3px 10px;border-radius:20px;font-weight:700;font-size:13px">
          ${m.stock === 0 ? '❌ Out of Stock' : `⚠️ ${m.stock} left`}
        </span>
      </td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#b45309,#d97706);padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:white;margin:0;font-size:20px">⚠️ Low Stock Alert</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Sitaram Medical Store — Action Required</p>
      </div>
      <div style="background:#fffbeb;padding:24px">
        <p style="color:#92400e;font-size:14px;margin:0 0 16px">The following medicines are running low and need to be restocked:</p>
        <div style="background:white;border-radius:10px;overflow:hidden;border:1px solid #fde68a">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#fef3c7">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#92400e">Medicine</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#92400e">Brand</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;color:#92400e">Stock</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="margin-top:16px;text-align:center">
          <a href="https://hare-krishna-medical-sshf.onrender.com/admin.html"
            style="display:inline-block;background:#d97706;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">
            📦 Update Stock in Admin
          </a>
        </div>
      </div>
      <div style="background:#92400e;padding:14px;border-radius:0 0 12px 12px;text-align:center">
        <p style="color:rgba(255,255,255,0.8);margin:0;font-size:12px">Sitaram Medical Store · Digapahandi, Ganjam</p>
      </div>
    </div>
  `;

  await sendViaScript(adminEmail, `⚠️ Low Stock Alert — ${lowStockItems.length} medicine(s) need restocking`, html, 'Admin');
}

module.exports = { sendOrderConfirmation, sendAdminNotification, sendLowStockAlert };
