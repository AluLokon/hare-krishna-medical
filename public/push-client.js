// push-client.js — Browser push notification subscription
// Include this in index.html after auth-otp.js

(async function initPush() {
  // Check browser support
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // Register service worker
  let swReg;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.warn('SW registration failed:', e);
    return;
  }

  // Expose subscribe function globally (called after login)
  window.subscribeToPush = async function(customerId) {
    try {
      // Get VAPID public key from server
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) return; // Push not configured on server
      const { publicKey } = await keyRes.json();
      if (!publicKey) return;

      // Check current permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Subscribe
      const sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      // Save to server
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), customerId })
      });

      console.log('Push notifications enabled ✅');
    } catch (e) {
      console.warn('Push subscribe failed:', e);
    }
  };

  // Auto-subscribe if already logged in
  const token = localStorage.getItem('customerToken');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      await window.subscribeToPush(payload.id);
    } catch (e) {}
  }
})();

// Helper: convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
