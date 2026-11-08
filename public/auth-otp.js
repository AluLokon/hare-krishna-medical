// ── OTP Auth System ──
// Handles: send OTP, verify OTP, profile sidebar, orders panel

(function() {

let currentPhone = '';
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
    btn.innerHTML = `<span>👤</span><span>${customer.name.split(' ')[0]}</span>`;
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
  showStep('step-phone');
  document.getElementById('authPhone').focus();
}

function closeAuthModal() {
  document.getElementById('authOverlay').classList.remove('open');
  clearError();
  if (resendTimer) clearInterval(resendTimer);
}

function showStep(stepId) {
  document.querySelectorAll('.auth-step').forEach(s => s.classList.remove('active'));
  document.getElementById(stepId).classList.add('active');
  clearError();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

function clearError() {
  const el = document.getElementById('authError');
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}

// Step 1: Send OTP
async function sendOTP() {
  const phone = document.getElementById('authPhone').value.trim();

  if (!/^[6-9]\d{9}$/.test(phone)) {
    showAuthError('Please enter a valid 10-digit mobile number');
    return;
  }

  currentPhone = phone;
  const btn = document.getElementById('sendOtpBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch('/api/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || 'Failed to send OTP');
      btn.disabled = false;
      btn.textContent = 'Get OTP';
      return;
    }

    // Dev mode: auto-fill OTP
    if (data.dev_otp) {
      console.log('Dev OTP:', data.dev_otp);
      // Auto-fill for testing
      setTimeout(() => {
        const boxes = document.querySelectorAll('.otp-box');
        data.dev_otp.split('').forEach((d, i) => {
          if (boxes[i]) { boxes[i].value = d; boxes[i].classList.add('filled'); }
        });
      }, 300);
    }

    document.getElementById('otpPhoneDisplay').textContent = `+91 ${phone}`;
    showStep('step-otp');
    document.querySelector('.otp-box').focus();
    startResendTimer();

  } catch (err) {
    showAuthError('Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get OTP';
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
        else verifyOTP(); // auto-submit when last box filled
      } else {
        this.classList.remove('filled');
      }
    });
    box.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !this.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].classList.remove('filled');
      }
    });
    box.addEventListener('paste', function(e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      text.split('').forEach((d, j) => {
        if (boxes[j]) { boxes[j].value = d; boxes[j].classList.add('filled'); }
      });
      if (text.length >= 6) verifyOTP();
    });
  });
}

// Step 2: Verify OTP
async function verifyOTP() {
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
    const res = await fetch('/api/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: currentPhone, otp })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError(data.error || 'Incorrect OTP');
      btn.disabled = false;
      btn.textContent = 'Verify & Login';
      // Clear OTP boxes on wrong OTP
      boxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
      boxes[0].focus();
      return;
    }

    // Success
    localStorage.setItem('customerToken', data.token);
    localStorage.setItem('customerData', JSON.stringify(data.customer));

    // If new user, ask for name
    if (data.isNew || data.customer.name.startsWith('Customer ')) {
      showStep('step-name');
      document.getElementById('authName').focus();
    } else {
      onLoginSuccess(data.customer);
    }

  } catch (err) {
    showAuthError('Network error. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Verify & Login';
  }
}

// Step 3: Save name (new users)
async function saveName() {
  const name = document.getElementById('authName').value.trim();
  if (!name || name.length < 2) {
    showAuthError('Please enter your name');
    return;
  }

  const token = localStorage.getItem('customerToken');
  const customer = getStoredCustomer();

  try {
    // Update name via API
    await fetch('/api/customers/me/name', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name })
    });

    customer.name = name;
    localStorage.setItem('customerData', JSON.stringify(customer));
    onLoginSuccess(customer);
  } catch (err) {
    // Even if API fails, update locally
    customer.name = name;
    localStorage.setItem('customerData', JSON.stringify(customer));
    onLoginSuccess(customer);
  }
}

function onLoginSuccess(customer) {
  closeAuthModal();
  showLoggedInState(customer);
  // Reload address in cart if open
  const addrField = document.getElementById('custAddress');
  if (addrField && customer.address) addrField.value = customer.address;
}

// Resend timer
function startResendTimer() {
  resendSeconds = 30;
  updateResendUI();
  if (resendTimer) clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    resendSeconds--;
    updateResendUI();
    if (resendSeconds <= 0) {
      clearInterval(resendTimer);
      resendTimer = null;
    }
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

function resendOTP() {
  document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.classList.remove('filled'); });
  showStep('step-phone');
  document.getElementById('authPhone').value = currentPhone;
}

// ── PROFILE SIDEBAR ──
function openProfileSidebar() {
  document.getElementById('profileOverlay').classList.add('open');
  document.getElementById('profileSidebar').classList.add('open');
  const customer = getStoredCustomer();
  if (customer) {
    document.getElementById('profileName').textContent = customer.name;
    document.getElementById('profilePhone').textContent = `+91 ${customer.phone}`;
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
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <p>No orders yet.<br>Start shopping!</p>
        </div>`;
      return;
    }

    body.innerHTML = orders.map(o => {
      const items = Array.isArray(o.items) ? o.items : JSON.parse(o.items || '[]');
      const itemNames = items.slice(0, 2).map(i => `${i.name} ×${i.qty}`).join(', ');
      const more = items.length > 2 ? ` +${items.length - 2} more` : '';
      const date = new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const statusClass = `status-${(o.status || 'pending').toLowerCase()}`;
      return `
        <div class="order-card">
          <div class="order-card-header">
            <div>
              <div class="order-id">#${o.id}</div>
              <div class="order-date">${date}</div>
            </div>
            <span class="order-status ${statusClass}">${(o.status || 'Pending').charAt(0).toUpperCase() + (o.status || 'pending').slice(1)}</span>
          </div>
          <div class="order-items">${itemNames}${more}</div>
          <div class="order-total">₹${parseFloat(o.total).toFixed(2)}</div>
        </div>`;
    }).join('');

  } catch (err) {
    body.innerHTML = '<div class="empty-state"><p>Failed to load orders.</p></div>';
  }
}

function closeOrdersPanel() {
  document.getElementById('ordersPanel').classList.remove('open');
}

// ── ADDRESS PANEL ──
function openAddressPanel() {
  const customer = getStoredCustomer();
  const addr = customer?.address || '';

  const panel = document.getElementById('ordersPanel');
  panel.classList.add('open');
  document.getElementById('ordersPanelBody').innerHTML = `
    <div style="padding:4px 0">
      <p style="font-size:13px;color:#6b7280;margin-bottom:12px">Your saved delivery address</p>
      <textarea id="savedAddress" rows="4" style="width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;outline:none;color:#1a1a2e"
        placeholder="Enter your full address...">${addr}</textarea>
      <button onclick="saveAddress()" style="margin-top:12px;width:100%;padding:12px;background:#0f6b3a;color:white;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">
        Save Address
      </button>
    </div>`;
  document.getElementById('ordersPanelTitle').textContent = 'Address Book';
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
    // Show success toast
    showToast('Address saved!');
  } catch (err) {
    showToast('Failed to save address');
  }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:white;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:999;animation:fadeIn 0.2s ease';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// Expose to global scope
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.sendOTP = sendOTP;
window.verifyOTP = verifyOTP;
window.saveName = saveName;
window.resendOTP = resendOTP;
window.openProfileSidebar = openProfileSidebar;
window.closeProfileSidebar = closeProfileSidebar;
window.logout = logout;
window.openOrdersPanel = openOrdersPanel;
window.closeOrdersPanel = closeOrdersPanel;
window.openAddressPanel = openAddressPanel;
window.saveAddress = saveAddress;

// Init on load
document.addEventListener('DOMContentLoaded', function() {
  initAuth();
  setupOtpBoxes();
});

})();
