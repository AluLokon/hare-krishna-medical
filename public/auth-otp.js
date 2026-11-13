// ── Email+Password Auth System ──
// Flow: Login (email+password) | Signup (name,email,phone,password → email OTP → account created)

(function() {

let currentEmail = '';
let resendTimer = null;
let resendSeconds = 0;

// ── Init: check if already logged in ──
function initAuth() {
  const token = localStorage.getItem('customerToken');
  const customer = getStoredCustomer();
  if (token && customer) {
    showLoggedInState(customer);
  } else {
    showLoggedOutState();
  }
}

function getStoredCustomer() {
  try {
    const d = localStorage.getItem('customerData');
    return d ? JSON.parse(d) : null;
  } catch { return null; }
}

function showLoggedInState(customer) {
  const btn = document.getElementById('accountBtn');
  if (btn) {
    btn.innerHTML = `<span>👤</span><span>${(customer.name || 'Account').split(' ')[0]}</span>`;
    btn.onclick = openProfileSidebar;
  }
}

function showLoggedOutState() {
  const btn = document.getElementById('accountBtn');
  if (btn) {
    btn.innerHTML = `<span>👤</span><span>My Account</span>`;
    btn.onclick = openAuthModal;
  }
}

// ── AUTH MODAL ──
function openAuthModal(e) {
  if (e) e.preventDefault();
  document.getElementById('authOverlay').classList.add('open');
  showStep('step-login');
  setTimeout(() => {
    const el = document.getElementById('loginEmail');
    if (el) el.focus();
  }, 100);
}

function closeAuthModal() {
  document.getElementById('authOverlay').classList.remove('open');
  clearError();
  if (resendTimer) clearInterval(resendTimer);
}

function showStep(stepId) {
  document.querySelectorAll('.auth-step').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(stepId);
  if (el) el.classList.add('active');
  clearError();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg; el.classList.add('show'); }
}

function clearError() {
  const el = document.getElementById('authError');
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}

// ── LOGIN ──
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAuthError('Please enter a valid email address');
    return;
  }
  if (!password) {
    showAuthError('Please enter your password');
    return;
  }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const res = await fetch('/api/customers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || 'Invalid email or password');
      btn.disabled = false;
      btn.textContent = 'Login';
      return;
    }

    localStorage.setItem('customerToken', data.token);
    localStorage.setItem('customerData', JSON.stringify(data.customer));
    onLoginSuccess(data.customer);

  } catch (err) {
    showAuthError('Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

// ── SIGNUP: Step 1 — Collect user details ──
async function sendSignupOTP() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const phone = document.getElementById('signupPhone').value.trim().replace(/\D/g, '');
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;

  if (!name || name.length < 2) { showAuthError('Please enter your full name'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('Please enter a valid email address'); return; }
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) { showAuthError('Please enter a valid 10-digit mobile number'); return; }
  if (!password || password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
  if (password !== confirm) { showAuthError('Passwords do not match'); return; }

  currentEmail = email;

  const btn = document.getElementById('signupBtn');
  btn.disabled = true;
  btn.textContent = 'Sending OTP...';

  try {
    const res = await fetch('/api/email-otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || 'Failed to send OTP');
      btn.disabled = false;
      btn.textContent = 'Create Account';
      return;
    }

    // Show OTP step
    document.getElementById('otpEmailDisplay').textContent = email;
    showStep('step-otp');
    document.querySelector('.otp-box') && document.querySelector('.otp-box').focus();
    startResendTimer();

    // Dev mode: auto-fill OTP
    if (data.dev_otp) {
      console.log('[Dev] OTP:', data.dev_otp);
      setTimeout(() => {
        const boxes = document.querySelectorAll('.otp-box');
        data.dev_otp.split('').forEach((d, i) => {
          if (boxes[i]) { boxes[i].value = d; boxes[i].classList.add('filled'); }
        });
      }, 300);
    }

  } catch (err) {
    showAuthError('Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

// ── SIGNUP: Step 2 — Verify OTP ──
async function verifySignupOTP() {
  const boxes = document.querySelectorAll('.otp-box');
  const otp = Array.from(boxes).map(b => b.value).join('');

  if (otp.length < 6) {
    showAuthError('Please enter all 6 digits');
    return;
  }

  const btn = document.getElementById('verifyOtpBtn');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/email-otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, otp })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || 'Incorrect OTP. Please try again.');
      boxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
      boxes[0] && boxes[0].focus();
      btn.disabled = false;
      btn.textContent = 'Verify OTP';
      return;
    }

    // Success — account created
    localStorage.setItem('customerToken', data.token);
    localStorage.setItem('customerData', JSON.stringify(data.customer));
    onLoginSuccess(data.customer);

  } catch (err) {
    showAuthError('Network error. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Verify OTP';
  }
}

// OTP box keyboard navigation
function setupOtpBoxes() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '').slice(-1);
      if (this.value) {
        this.classList.add('filled');
        if (i < boxes.length - 1) boxes[i + 1].focus();
        else verifySignupOTP();
      } else {
        this.classList.remove('filled');
      }
    });
    box.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !this.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].classList.remove('filled');
      }
      if (e.key === 'Enter') verifySignupOTP();
    });
    box.addEventListener('paste', function(e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      text.split('').forEach((d, j) => {
        if (boxes[j]) { boxes[j].value = d; boxes[j].classList.add('filled'); }
      });
      if (text.length >= 6) verifySignupOTP();
    });
  });
}

async function resendOTP() {
  const btn = document.getElementById('resendOtpBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  try {
    const res = await fetch('/api/email-otp/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || 'Failed to resend OTP');
      return;
    }

    document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.classList.remove('filled'); });
    document.querySelector('.otp-box') && document.querySelector('.otp-box').focus();
    startResendTimer();

    if (data.dev_otp) {
      setTimeout(() => {
        const boxes = document.querySelectorAll('.otp-box');
        data.dev_otp.split('').forEach((d, i) => {
          if (boxes[i]) { boxes[i].value = d; boxes[i].classList.add('filled'); }
        });
      }, 300);
    }
  } catch (err) {
    showAuthError('Network error. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Resend OTP'; }
  }
}

// Resend timer
function startResendTimer() {
  resendSeconds = 30;
  updateResendUI();
  if (resendTimer) clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    resendSeconds--;
    updateResendUI();
    if (resendSeconds <= 0) { clearInterval(resendTimer); resendTimer = null; }
  }, 1000);
}

function updateResendUI() {
  const el = document.getElementById('resendTimerText');
  const btn = document.getElementById('resendOtpBtn');
  if (!el || !btn) return;
  if (resendSeconds > 0) {
    el.textContent = `Resend OTP in ${resendSeconds}s`;
    btn.style.display = 'none';
  } else {
    el.textContent = '';
    btn.style.display = 'inline';
  }
}

// Switch between login and signup views
function switchToSignup() {
  document.getElementById('authModalTitle').textContent = 'Create Account';
  showStep('step-signup');
}

function switchToLogin() {
  document.getElementById('authModalTitle').textContent = 'Welcome Back';
  showStep('step-login');
}

function onLoginSuccess(customer) {
  closeAuthModal();
  showLoggedInState(customer);
  const addrField = document.getElementById('custAddress');
  if (addrField && customer.address) addrField.value = customer.address;
}

// ── PROFILE SIDEBAR ──
function openProfileSidebar() {
  document.getElementById('profileOverlay').classList.add('open');
  document.getElementById('profileSidebar').classList.add('open');
  const customer = getStoredCustomer();
  if (customer) {
    document.getElementById('profileName').textContent = customer.name;
    document.getElementById('profilePhone').textContent = customer.email || '';
  }
}

function closeProfileSidebar() {
  document.getElementById('profileOverlay').classList.remove('open');
  document.getElementById('profileSidebar').classList.remove('open');
  closeOrdersPanel();
}

function logout() {
  localStorage.removeItem('customerToken');
  localStorage.removeItem('customerData');
  closeProfileSidebar();
  showLoggedOutState();
}

// ── ORDERS PANEL ──
async function openOrdersPanel() {
  const panel = document.getElementById('ordersPanel');
  panel.classList.add('open');
  document.getElementById('ordersPanelTitle').textContent = 'My Orders';

  const body = document.getElementById('ordersPanelBody');
  body.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading orders...</p></div>';

  const token = localStorage.getItem('customerToken');
  if (!token) return;

  try {
    const res = await fetch('/api/customers/orders', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const orders = await res.json();

    if (!orders.length) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No orders yet.<br>Start shopping!</p></div>`;
      return;
    }

    const statusConfig = {
      pending:    { label: 'Order Placed',     color: '#f59e0b', bg: '#fef3c7', icon: '📋' },
      confirmed:  { label: 'Confirmed',         color: '#3b82f6', bg: '#dbeafe', icon: '✅' },
      dispatched: { label: 'Out for Delivery',  color: '#8b5cf6', bg: '#ede9fe', icon: '🚚' },
      delivered:  { label: 'Delivered',         color: '#0f6b3a', bg: '#d1fae5', icon: '🏠' },
      cancelled:  { label: 'Cancelled',         color: '#ef4444', bg: '#fee2e2', icon: '❌' }
    };

    body.innerHTML = orders.map(o => {
      const items = Array.isArray(o.items) ? o.items : JSON.parse(o.items || '[]');
      const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const status = (o.status || 'pending').toLowerCase();
      const sc = statusConfig[status] || statusConfig.pending;
      const allItems = items.map(i => `<div style="display:flex;justify-content:space-between;font-size:12px;color:#4b5563;padding:3px 0;border-bottom:1px solid #f3f4f6"><span>${i.name} ×${i.qty}</span><span style="font-weight:600">₹${(i.qty*i.price).toFixed(2)}</span></div>`).join('');

      return `<div style="background:white;border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);border:1px solid #f0f0f0">
        <div style="padding:14px 16px;border-bottom:1px solid #f3f4f6">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:16px;font-weight:800;color:#1a1a2e">#${o.id}</span>
            <span style="font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;background:${sc.bg};color:${sc.color}">${sc.icon} ${sc.label}</span>
          </div>
          <div style="font-size:12px;color:#9ca3af">${date}</div>
        </div>
        <div style="padding:12px 16px;border-bottom:1px solid #f3f4f6">
          ${allItems}
          <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:#1a1a2e;padding-top:8px;margin-top:4px">
            <span>Total</span><span style="color:#0f6b3a">₹${parseFloat(o.total).toFixed(2)}</span>
          </div>
        </div>
        <div style="padding:10px 16px;display:flex;gap:8px">
          <a href="/track.html?id=${o.id}" style="flex:1;text-align:center;padding:9px;background:#0f6b3a;color:white;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">📦 Track</a>
          <a href="/invoice.html?id=${o.id}" style="flex:1;text-align:center;padding:9px;background:#f0faf5;color:#0f6b3a;border:1.5px solid #0f6b3a;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">🧾 Invoice</a>
          <button onclick="reorderItems(${JSON.stringify(JSON.stringify(items))})" style="flex:1;padding:9px;background:#f0faf5;color:#0f6b3a;border:1.5px solid #0f6b3a;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">🔄 Reorder</button>
        </div>
      </div>`;
    }).join('');

  } catch (err) {
    body.innerHTML = '<div class="empty-state"><p>Failed to load orders.</p></div>';
  }
}

function closeOrdersPanel() {
  const panel = document.getElementById('ordersPanel');
  if (panel) panel.classList.remove('open');
}

// ── ADDRESS PANEL ──
function openAddressPanel() {
  const customer = getStoredCustomer();
  const addr = customer?.address || '';
  const panel = document.getElementById('ordersPanel');
  panel.classList.add('open');
  document.getElementById('ordersPanelTitle').textContent = 'Address Book';
  document.getElementById('ordersPanelBody').innerHTML = `
    <div style="padding:4px 0">
      <p style="font-size:13px;color:#6b7280;margin-bottom:12px">Your saved delivery address</p>
      <textarea id="savedAddress" rows="4" style="width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;outline:none;color:#1a1a2e" placeholder="Enter your full address...">${addr}</textarea>
      <button onclick="saveAddress()" style="margin-top:12px;width:100%;padding:12px;background:#0f6b3a;color:white;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Save Address</button>
    </div>`;
}

async function saveAddress() {
  const addr = document.getElementById('savedAddress').value.trim();
  const token = localStorage.getItem('customerToken');
  try {
    await fetch('/api/customers/address', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ address: addr })
    });
    const customer = getStoredCustomer();
    if (customer) { customer.address = addr; localStorage.setItem('customerData', JSON.stringify(customer)); }
    closeOrdersPanel();
    showToast('Address saved!');
  } catch (err) {
    showToast('Failed to save address');
  }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:white;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// Expose globals
window.switchToSignup = switchToSignup;
window.switchToLogin = switchToLogin;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.login = login;
window.sendSignupOTP = sendSignupOTP;
window.verifySignupOTP = verifySignupOTP;
window.resendOTP = resendOTP;
window.openProfileSidebar = openProfileSidebar;
window.closeProfileSidebar = closeProfileSidebar;
window.logout = logout;
window.openOrdersPanel = openOrdersPanel;

// ── REORDER ──
function reorderItems(itemsJson) {
  try {
    const items = JSON.parse(itemsJson);
    // Use cart from script.js
    items.forEach(item => {
      if (window.cart) {
        const existing = window.cart.find(c => c.id === item.id);
        if (existing) existing.qty += item.qty;
        else window.cart.push({ ...item });
      }
    });
    if (window.saveCart) window.saveCart();
    if (window.updateCartBar) window.updateCartBar();
    closeProfileSidebar();
    closeOrdersPanel();
    setTimeout(() => { if (window.openCart) window.openCart(); }, 300);
  } catch(e) { alert('Could not reorder. Please try again.'); }
}
window.reorderItems = reorderItems;
window.closeOrdersPanel = closeOrdersPanel;
window.openAddressPanel = openAddressPanel;
window.saveAddress = saveAddress;

document.addEventListener('DOMContentLoaded', function() {
  initAuth();
  setupOtpBoxes();
});

})();
