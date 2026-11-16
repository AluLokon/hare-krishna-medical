// push-client.js — Browser push notification subscription
(async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // Register service worker
  let swReg;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.warn('SW registration failed:', e);
    return;
  }

  // Subscribe function — MUST be called from a user click
  window.subscribeToPush = async function(customerId) {
    try {
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) return;
      const { publicKey } = await keyRes.json();
      if (!publicKey) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        hideNotifBanner();
        return;
      }

      const sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), customerId })
      });

      hideNotifBanner();
      console.log('Push notifications enabled ✅');
    } catch (e) {
      console.warn('Push subscribe failed:', e);
    }
  };

  // Check if already subscribed
  const existing = await swReg.pushManager.getSubscription();
  if (existing) return; // already subscribed, no banner needed

  // Show banner only if logged in and permission not yet decided
  if (Notification.permission === 'default') {
    const token = localStorage.getItem('customerToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        showNotifBanner(payload.id);
      } catch(e) {}
    }
  }

  // Also hook into login event — show banner after login
  window._pushOnLogin = function(customerId) {
    if (Notification.permission === 'default') {
      showNotifBanner(customerId);
    }
  };
})();

// ── Banner UI ──
function showNotifBanner(customerId) {
  if (document.getElementById('notifBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'notifBanner';
  banner.innerHTML = `
    <div style="
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:#09421f; color:white; padding:13px 18px;
      border-radius:14px; display:flex; align-items:center; gap:12px;
      box-shadow:0 4px 20px rgba(0,0,0,0.25); z-index:999;
      font-family:'Nunito',sans-serif; font-size:13.5px; font-weight:700;
      max-width:340px; width:calc(100% - 32px);
    ">
      <span style="font-size:22px">🔔</span>
      <span style="flex:1">Get notified when your order is dispatched!</span>
      <button onclick="window.subscribeToPush(${customerId})" style="
        background:#0f6b3a; color:white; border:none; border-radius:9px;
        padding:8px 14px; font-size:12.5px; font-weight:900;
        cursor:pointer; font-family:inherit; white-space:nowrap;
      ">Allow</button>
      <button onclick="hideNotifBanner()" style="
        background:rgba(255,255,255,0.15); color:white; border:none;
        border-radius:9px; padding:8px 10px; font-size:13px;
        cursor:pointer; font-family:inherit;
      ">✕</button>
    </div>
  `;
  document.body.appendChild(banner);

  // Auto-hide after 10 seconds
  setTimeout(hideNotifBanner, 10000);
}

function hideNotifBanner() {
  const b = document.getElementById('notifBanner');
  if (b) b.remove();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}