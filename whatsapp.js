// whatsapp.js — Free WhatsApp notifications via CallMeBot API
// Setup: Send "I allow callmebot to send me messages" to +34 644 59 97 15 on WhatsApp
// Then set WHATSAPP_PHONE and WHATSAPP_APIKEY in Render environment variables

const https = require('https');

function makeRequest(url) {
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

async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.WHATSAPP_APIKEY;

  if (!phone || !apikey) {
    console.log('[WhatsApp] Not configured. Set WHATSAPP_PHONE and WHATSAPP_APIKEY in Render.');
    return;
  }

  try {
    const encoded = encodeURIComponent(message);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apikey}`;
    const result = await makeRequest(url);
    console.log(`[WhatsApp] Sent: ${result.status}`);
  } catch (err) {
    console.error('[WhatsApp] Failed:', err.message);
  }
}

async function sendNewOrderWhatsApp(orderId, customerName, phone, items, total) {
  const itemLines = items.map(i => `  - ${i.name} x${i.qty} = Rs.${(i.qty * i.price).toFixed(2)}`).join('\n');
  const message =
    `🛒 NEW ORDER #${orderId}\n` +
    `👤 ${customerName}\n` +
    `📞 ${phone}\n` +
    `\n${itemLines}\n` +
    `\n💰 Total: Rs.${parseFloat(total).toFixed(2)}\n` +
    `\n🔗 Admin: https://hare-krishna-medical-sshf.onrender.com/admin.html`;

  await sendWhatsApp(message);
}

module.exports = { sendNewOrderWhatsApp };
