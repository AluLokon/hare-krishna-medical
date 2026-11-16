// address-book.js — Address Book UI for profile sidebar
// Include this in index.html after auth-otp.js

// ══════════════════════════════════════
//  ADDRESS BOOK PANEL (injected into DOM)
// ══════════════════════════════════════
(function() {
  // Inject address panel HTML into body
  const panel = document.createElement('div');
  panel.id = 'addressPanel';
  panel.className = 'profile-orders-panel';
  panel.style.cssText = 'display:none';
  panel.innerHTML = `
    <div class="panel-header">
      <button onclick="closeAddressPanel()">←</button>
      <span>Address Book</span>
      <button onclick="showAddAddressForm()" style="
        background:#0f6b3a;color:white;border:none;border-radius:8px;
        padding:6px 12px;font-size:12.5px;font-weight:800;cursor:pointer;
        font-family:inherit;margin-left:auto
      ">+ Add</button>
    </div>
    <div class="panel-body" id="addressPanelBody" style="padding:14px"></div>
  `;
  document.body.appendChild(panel);

  // Inject address modal HTML
  const modal = document.createElement('div');
  modal.id = 'addressModal';
  modal.style.cssText = `
    display:none;position:fixed;inset:0;z-index:300;
    background:rgba(0,0,0,0.5);align-items:flex-end;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="
      background:white;border-radius:22px 22px 0 0;width:100%;max-width:480px;
      padding:24px 20px 32px;max-height:85vh;overflow-y:auto;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h3 id="addressModalTitle" style="font-size:17px;font-weight:900;color:#192b20">Add Address</h3>
        <button onclick="closeAddressModal()" style="
          background:#f1faf5;border:none;border-radius:50%;width:32px;height:32px;
          font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center
        ">✕</button>
      </div>

      <input type="hidden" id="editAddressId">

      <!-- Label chips -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        ${['Home','Work','Other'].map(l => `
          <button class="addr-label-btn" data-label="${l}" onclick="selectAddrLabel('${l}')" style="
            padding:7px 16px;border-radius:100px;border:2px solid #ddeae2;
            font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;
            background:white;color:#6b7c72;transition:all 0.15s
          ">${l === 'Home' ? '🏠' : l === 'Work' ? '💼' : '📍'} ${l}</button>
        `).join('')}
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="font-size:12px;font-weight:800;color:#6b7c72;display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Full Name *</label>
          <input id="addrName" type="text" placeholder="Recipient's full name" style="${inputStyle}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:800;color:#6b7c72;display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Phone</label>
          <input id="addrPhone" type="tel" placeholder="10-digit mobile number" style="${inputStyle}">
        </div>
        <div>
          <label style="font-size:12px;font-weight:800;color:#6b7c72;display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Full Address *</label>
          <textarea id="addrAddress" placeholder="House no., street, landmark, area..." rows="3" style="${inputStyle}resize:vertical"></textarea>
        </div>
        <div>
          <label style="font-size:12px;font-weight:800;color:#6b7c72;display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Pincode</label>
          <input id="addrPincode" type="text" placeholder="6-digit pincode" maxlength="6" style="${inputStyle}">
        </div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="addrDefault" style="width:16px;height:16px;accent-color:#0f6b3a">
          <span style="font-size:14px;font-weight:700;color:#192b20">Set as default address</span>
        </label>
        <div id="addrError" style="color:#dc2626;font-size:13px;font-weight:700;display:none"></div>
        <button onclick="saveAddress()" style="
          width:100%;padding:14px;background:linear-gradient(110deg,#09421f,#0f6b3a);
          color:white;border:none;border-radius:11px;font-size:15px;font-weight:900;
          cursor:pointer;font-family:inherit
        ">Save Address</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
})();

const inputStyle = `width:100%;padding:11px 14px;border:2px solid #ddeae2;border-radius:10px;font-size:14px;font-family:inherit;font-weight:600;color:#192b20;box-sizing:border-box;outline:none;`;
let _selectedLabel = 'Home';
let _addresses = [];

// ── Open/close address panel ──
window.openAddressPanel = function() {
  document.getElementById('addressPanel').style.display = 'flex';
  document.getElementById('addressPanel').style.flexDirection = 'column';
  loadAddresses();
};
window.closeAddressPanel = function() {
  document.getElementById('addressPanel').style.display = 'none';
};

// ── Load addresses from API ──
async function loadAddresses() {
  const token = localStorage.getItem('customerToken');
  if (!token) return;
  const body = document.getElementById('addressPanelBody');
  body.innerHTML = '<p style="text-align:center;color:#6b7c72;padding:24px">Loading...</p>';
  try {
    const res = await fetch('/api/addresses', {
      headers: { Authorization: 'Bearer ' + token }
    });
    _addresses = await res.json();
    renderAddresses();
  } catch (e) {
    body.innerHTML = '<p style="color:#dc2626;text-align:center;padding:16px">Failed to load addresses</p>';
  }
}

function renderAddresses() {
  const body = document.getElementById('addressPanelBody');
  if (!_addresses.length) {
    body.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#6b7c72">
        <div style="font-size:40px;margin-bottom:12px">📍</div>
        <p style="font-size:14px;font-weight:600">No saved addresses yet</p>
        <p style="font-size:13px;margin-top:4px">Add your first delivery address</p>
      </div>`;
    return;
  }
  body.innerHTML = _addresses.map(a => `
    <div style="
      background:white;border:1.5px solid ${a.is_default ? '#0f6b3a' : '#ddeae2'};
      border-radius:12px;padding:14px;margin-bottom:10px;position:relative
    ">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="
          background:${a.is_default ? '#0f6b3a' : '#f1faf5'};
          color:${a.is_default ? 'white' : '#6b7c72'};
          font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:100px
        ">${a.label === 'Home' ? '🏠' : a.label === 'Work' ? '💼' : '📍'} ${a.label}</span>
        ${a.is_default ? '<span style="font-size:11px;color:#0f6b3a;font-weight:800">✓ Default</span>' : ''}
      </div>
      <div style="font-size:14px;font-weight:800;color:#192b20">${a.name}</div>
      ${a.phone ? `<div style="font-size:13px;color:#6b7c72;margin-top:2px">📞 ${a.phone}</div>` : ''}
      <div style="font-size:13px;color:#6b7c72;margin-top:4px;line-height:1.5">${a.address}${a.pincode ? ' — ' + a.pincode : ''}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        ${!a.is_default ? `<button onclick="setDefaultAddress(${a.id})" style="
          font-size:12px;font-weight:800;color:#0f6b3a;background:#e3f4eb;
          border:none;border-radius:7px;padding:6px 12px;cursor:pointer;font-family:inherit
        ">Set Default</button>` : ''}
        <button onclick="editAddress(${a.id})" style="
          font-size:12px;font-weight:800;color:#192b20;background:#f1faf5;
          border:none;border-radius:7px;padding:6px 12px;cursor:pointer;font-family:inherit
        ">Edit</button>
        <button onclick="deleteAddress(${a.id})" style="
          font-size:12px;font-weight:800;color:#dc2626;background:#fff0f0;
          border:none;border-radius:7px;padding:6px 12px;cursor:pointer;font-family:inherit
        ">Delete</button>
      </div>
    </div>
  `).join('');
}

// ── Add / Edit modal ──
window.showAddAddressForm = function() {
  document.getElementById('addressModalTitle').textContent = 'Add Address';
  document.getElementById('editAddressId').value = '';
  document.getElementById('addrName').value = '';
  document.getElementById('addrPhone').value = '';
  document.getElementById('addrAddress').value = '';
  document.getElementById('addrPincode').value = '';
  document.getElementById('addrDefault').checked = !_addresses.length;
  document.getElementById('addrError').style.display = 'none';
  selectAddrLabel('Home');
  const m = document.getElementById('addressModal');
  m.style.display = 'flex';
};

window.editAddress = function(id) {
  const a = _addresses.find(x => x.id === id);
  if (!a) return;
  document.getElementById('addressModalTitle').textContent = 'Edit Address';
  document.getElementById('editAddressId').value = id;
  document.getElementById('addrName').value = a.name;
  document.getElementById('addrPhone').value = a.phone || '';
  document.getElementById('addrAddress').value = a.address;
  document.getElementById('addrPincode').value = a.pincode || '';
  document.getElementById('addrDefault').checked = a.is_default;
  document.getElementById('addrError').style.display = 'none';
  selectAddrLabel(a.label || 'Home');
  document.getElementById('addressModal').style.display = 'flex';
};

window.closeAddressModal = function() {
  document.getElementById('addressModal').style.display = 'none';
};

window.selectAddrLabel = function(label) {
  _selectedLabel = label;
  document.querySelectorAll('.addr-label-btn').forEach(btn => {
    const active = btn.dataset.label === label;
    btn.style.background = active ? '#0f6b3a' : 'white';
    btn.style.color = active ? 'white' : '#6b7c72';
    btn.style.borderColor = active ? '#0f6b3a' : '#ddeae2';
  });
};

// ── Save address ──
window.saveAddress = async function() {
  const token = localStorage.getItem('customerToken');
  const id = document.getElementById('editAddressId').value;
  const name = document.getElementById('addrName').value.trim();
  const address = document.getElementById('addrAddress').value.trim();
  const errEl = document.getElementById('addrError');

  if (!name || !address) {
    errEl.textContent = 'Name and address are required';
    errEl.style.display = 'block';
    return;
  }

  const body = {
    label: _selectedLabel,
    name,
    phone: document.getElementById('addrPhone').value.trim(),
    address,
    pincode: document.getElementById('addrPincode').value.trim(),
    is_default: document.getElementById('addrDefault').checked
  };

  try {
    const url = id ? `/api/addresses/${id}` : '/api/addresses';
    const method = id ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json()).error);
    closeAddressModal();
    loadAddresses();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
};

// ── Delete address ──
window.deleteAddress = async function(id) {
  if (!confirm('Delete this address?')) return;
  const token = localStorage.getItem('customerToken');
  await fetch(`/api/addresses/${id}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  loadAddresses();
};

// ── Set default ──
window.setDefaultAddress = async function(id) {
  const token = localStorage.getItem('customerToken');
  await fetch(`/api/addresses/${id}/default`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token }
  });
  loadAddresses();
};

// ══════════════════════════════════════
//  CHECKOUT INTEGRATION
//  Call getDefaultAddress() to pre-fill address at checkout
// ══════════════════════════════════════
window.getDefaultAddress = async function() {
  const token = localStorage.getItem('customerToken');
  if (!token) return null;
  try {
    const res = await fetch('/api/addresses', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const addrs = await res.json();
    return addrs.find(a => a.is_default) || addrs[0] || null;
  } catch { return null; }
};

// ══════════════════════════════════════
//  ADDRESS PICKER FOR CHECKOUT
//  Shows a bottom sheet to pick address at checkout
// ══════════════════════════════════════
window.showAddressPicker = async function(onSelect) {
  const token = localStorage.getItem('customerToken');
  if (!token) return;

  let addrs;
  try {
    const res = await fetch('/api/addresses', { headers: { Authorization: 'Bearer ' + token } });
    addrs = await res.json();
  } catch { return; }

  if (!addrs.length) {
    // No saved addresses — show add form
    showAddAddressForm();
    return;
  }

  // Build picker modal
  let picker = document.getElementById('addrPickerModal');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'addrPickerModal';
    picker.style.cssText = 'display:none;position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.5);align-items:flex-end;justify-content:center';
    document.body.appendChild(picker);
  }

  picker.innerHTML = `
    <div style="background:white;border-radius:22px 22px 0 0;width:100%;max-width:480px;padding:20px 20px 32px;max-height:70vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="font-size:17px;font-weight:900;color:#192b20">Choose Delivery Address</h3>
        <button onclick="document.getElementById('addrPickerModal').style.display='none'" style="
          background:#f1faf5;border:none;border-radius:50%;width:32px;height:32px;font-size:16px;cursor:pointer
        ">✕</button>
      </div>
      ${addrs.map(a => `
        <div onclick="window._addrPickerSelect(${a.id})" style="
          background:white;border:2px solid ${a.is_default ? '#0f6b3a' : '#ddeae2'};
          border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;
          transition:border-color 0.15s
        " onmouseover="this.style.borderColor='#0f6b3a'" onmouseout="this.style.borderColor='${a.is_default ? '#0f6b3a' : '#ddeae2'}'">
          <div style="font-size:13px;font-weight:800;color:#0f6b3a;margin-bottom:4px">
            ${a.label === 'Home' ? '🏠' : a.label === 'Work' ? '💼' : '📍'} ${a.label}
            ${a.is_default ? '· Default' : ''}
          </div>
          <div style="font-size:14px;font-weight:800;color:#192b20">${a.name}</div>
          <div style="font-size:13px;color:#6b7c72;margin-top:3px">${a.address}${a.pincode ? ', ' + a.pincode : ''}</div>
        </div>
      `).join('')}
      <button onclick="showAddAddressForm()" style="
        width:100%;padding:12px;background:#f1faf5;color:#0f6b3a;
        border:2px dashed #ddeae2;border-radius:11px;font-size:14px;font-weight:800;
        cursor:pointer;font-family:inherit;margin-top:4px
      ">+ Add New Address</button>
    </div>`;

  window._addrPickerSelect = function(id) {
    const addr = addrs.find(a => a.id === id);
    picker.style.display = 'none';
    if (onSelect && addr) onSelect(addr);
  };

  picker.style.display = 'flex';
};
