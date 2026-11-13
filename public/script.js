let allMedicines = []; 
let currentDisplayed = []; // tracks what's currently shown on screen     // featured medicines (home page)
let medicineCache = {};     // ALL medicines ever loaded (for cart price lookup)
let cart = {};
let currentCat = 'all';
let searchMode = false;
let searchTimeout = null;


// ── Razorpay Online Payment ──
async function placeOrderOnline(hasRx) {
  const name    = document.getElementById('custName').value.trim();
  const phone   = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const notes   = document.getElementById('custNotes').value.trim();
  const email   = document.getElementById('custEmail').value.trim();

  if (!name || !phone) {
    alert('Please enter your name and phone number.');
    return;
  }

  if (hasRx) {
    const fileInput = document.getElementById('prescriptionFile');
    if (!fileInput || !fileInput.files.length) {
      alert('Please upload your prescription for Rx medicines.');
      return;
    }
  }

  const ids = Object.keys(cart).filter(k => cart[k] > 0);
  const items = ids.map(k => {
    const med = medicineCache[k];
    return { id: parseInt(k), name: med.name, qty: cart[k], price: med.price };
  });

  // Handle prescription
  let prescriptionData = null;
  if (hasRx) {
    const fileInput = document.getElementById('prescriptionFile');
    if (fileInput && fileInput.files.length) {
      prescriptionData = await toBase64(fileInput.files[0]);
    }
  }

  try {
    // Step 1 — Create Razorpay order from backend
    const createRes = await fetch('/api/payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      alert(createData.error || 'Failed to initiate payment.');
      return;
    }

    // Step 2 — Open Razorpay checkout
    const options = {
      key: createData.key_id,
      amount: createData.amount,
      currency: 'INR',
      name: 'Sitaram Medical Store',
      description: 'Medicine Order',
      order_id: createData.razorpay_order_id,
      prefill: {
        name: name,
        contact: phone,
        email: email || ''
      },
      theme: { color: '#3B6D11' },

      handler: async function(response) {
        // Step 3 — Verify payment on backend
        const customerToken = localStorage.getItem('customerToken');
        const headers = { 'Content-Type': 'application/json' };
        if (customerToken) headers['Authorization'] = `Bearer ${customerToken}`;

        const verifyRes = await fetch('/api/payment/verify', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            order_data: {
              customer_name: name,
              phone: phone,
              email: email,
              address: address + (notes ? '\nNotes: ' + notes : ''),
              items: createData.verified_items,
              prescription: prescriptionData
            }
          })
        });

        const verifyData = await verifyRes.json();

        if (!verifyRes.ok || !verifyData.success) {
          alert(verifyData.error || 'Payment verification failed. Please contact the store.');
          return;
        }

        // Step 4 — Show success
        const orderId = verifyData.order_id;
        cart = {};
        updateCartBar();
        document.getElementById('cartContent').innerHTML = `
          <div class="order-success">
            <div class="tick">✅</div>
            <h3>Payment Successful!</h3>
            <p style="font-size:13px;color:#777;margin-bottom:8px">Order ID</p>
            <div style="font-size:28px;font-weight:600;color:#3B6D11;margin-bottom:12px">#${orderId}</div>
            <p>Thank you ${name}!<br>
            Payment received. Sitaram Medical Store will deliver your order soon.</p>
            <p style="font-size:12px;color:#2563EB;margin-top:8px">💳 Paid Online</p>
            <a href="/track.html?id=${orderId}" style="display:inline-block;margin-top:10px;padding:8px 20px;background:#e8f5ee;color:#0f6b3a;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">📦 Track My Order</a>
            <button class="continue-btn" onclick="closeCart()">Continue Shopping</button>
          </div>`;
      },

      modal: {
        ondismiss: function() {
          alert('Payment cancelled. Your order was not placed.');
        }
      }
    };

    const rzp = new Razorpay(options);
    rzp.open();

  } catch (err) {
    console.error('Payment error:', err);
    alert('Something went wrong. Please try again or use Cash on Delivery.');
  }
}

// When page loads — show only featured medicines
async function loadMedicines() {
  try {
    const response = await fetch('/api/medicines/featured');
    allMedicines = await response.json();
    // Cache all featured medicines by id for cart lookup
    allMedicines.forEach(m => medicineCache[m.id] = m);
    document.getElementById('sectionLabel').textContent = '⭐ Top Selling Medicines';
    renderProducts(allMedicines);
  } catch (err) {
    document.getElementById('productsGrid').innerHTML =
      '<p style="color:red">Failed to load medicines. Is the server running?</p>';
  }
}

// Search medicines from server as user types
async function filterProducts() {
  const q = document.getElementById('searchInput').value.trim();

  // Clear previous timeout
  clearTimeout(searchTimeout);

  if (!q && currentCat === 'all') {
    // No search, no filter — show featured
    searchMode = false;
    document.getElementById('sectionLabel').textContent = '⭐ Top Selling Medicines';
    renderProducts(allMedicines);
    return;
  }

  // Wait 300ms after user stops typing before searching
  searchTimeout = setTimeout(async () => {
    try {
      let url = '/api/medicines/search?';
      if (q) url += `q=${encodeURIComponent(q)}&`;
      if (currentCat !== 'all') url += `category=${currentCat}`;

      const response = await fetch(url);
      const results = await response.json();
      // Cache search results for cart price lookup
      results.forEach(m => medicineCache[m.id] = m);
      searchMode = true;

      if (q) {
        document.getElementById('sectionLabel').textContent =
          `🔍 Search results for "${q}" (${results.length} found)`;
      } else {
        document.getElementById('sectionLabel').textContent =
          `📂 ${currentCat.charAt(0).toUpperCase() + currentCat.slice(1)} medicines (${results.length} found)`;
      }

      renderProducts(results);
    } catch (err) {
      console.error('Search failed', err);
    }
  }, 300);
}

// Filter by category
async function filterCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (cat === 'all' && !document.getElementById('searchInput').value.trim()) {
    // Back to featured
    searchMode = false;
    document.getElementById('sectionLabel').textContent = '⭐ Top Selling Medicines';
    renderProducts(allMedicines);
    return;
  }

  filterProducts();
}

// Show products on screen
function renderProducts(medicines) {
  currentDisplayed = medicines;
  const grid = document.getElementById('productsGrid');

  if (!medicines.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:2rem;color:#888">
        <div style="font-size:32px;margin-bottom:0.5rem">🔍</div>
        <p style="font-size:14px">No medicines found.<br>Try a different search term.</p>
      </div>`;
    return;
  }

  grid.innerHTML = medicines.map(p => {
    // Format uses: take first 2 conditions only
    let usesHtml = '';
    if (p.uses) {
      const usesList = p.uses.replace(/Treatment of /gi, '').split(/\n|,/).map(u => u.trim()).filter(Boolean);
      const topUses = usesList.slice(0, 2).join(' · ');
      if (topUses) usesHtml = `<div class="product-uses">For: ${topUses}</div>`;
    }
    return `
    <div class="product-card ${p.stock === 0 ? 'no-stock' : ''}">
      <div class="product-icon">${p.icon}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-brand">${p.brand}</div>
      ${usesHtml}
      <div class="product-price">₹${p.price}</div>
      <div class="product-footer">
        ${p.requires_rx ? '<span class="rx-badge">Rx</span>' : '<span></span>'}
        ${p.stock === 0
          ? '<button class="add-btn out-of-stock" disabled>Out of Stock</button>'
          : cart[p.id]
            ? `<div class="qty-control">
                 <button class="qty-minus" onclick="removeFromCart(${p.id})">−</button>
                 <span class="qty-display">${cart[p.id]}</span>
                 <button class="qty-plus" onclick="addToCart(${p.id})">+</button>
               </div>`
            : `<button class="add-btn" onclick="addToCart(${p.id})">+ Add</button>`
        }
      </div>
    </div>`;
  }).join('');
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  renderProducts(currentDisplayed);
  updateCartBar();
}

function removeFromCart(id) {
  if (!cart[id]) return;
  cart[id]--;
  if (cart[id] === 0) delete cart[id];
  renderProducts(currentDisplayed);
  updateCartBar();
}

function getCurrentMedicines() {
  // Return whatever is currently displayed
  const grid = document.getElementById('productsGrid');
  const cards = grid.querySelectorAll('.product-card');
  const ids = Array.from(cards).map(c => {
    const btn = c.querySelector('[onclick*="addToCart"], [onclick*="removeFromCart"]');
    if (btn) {
      const match = btn.getAttribute('onclick').match(/\d+/);
      return match ? parseInt(match[0]) : null;
    }
    return null;
  }).filter(Boolean);
  return allMedicines.filter(m => ids.includes(m.id));
}

function updateCartBar() {
  const bar = document.getElementById('cartBar');
  const ids = Object.keys(cart).filter(k => cart[k] > 0);
  if (!ids.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const count = ids.reduce((sum, k) => sum + cart[k], 0);
  const total = ids.reduce((sum, k) => {
    const med = medicineCache[k];
    return sum + (med ? cart[k] * med.price : 0);
  }, 0);
  document.getElementById('cartCount').textContent = count + ' item' + (count > 1 ? 's' : '');
  document.getElementById('cartTotal').textContent = '₹' + parseFloat(total).toFixed(2);

  const banner = document.getElementById('deliveryBanner');
  if (total >= 299) {
    banner.innerHTML = '🚚 <strong>Free home delivery</strong> applied on your order!';
    banner.style.background = '#EAF3DE';
    banner.style.borderColor = '#C0DD97';
    banner.style.color = '#27500A';
  } else {
    const remaining = (299 - total).toFixed(0);
    banner.innerHTML = `🚚 Add <strong>₹${remaining} more</strong> for free home delivery!`;
    banner.style.background = '#FAEEDA';
    banner.style.borderColor = '#FAC775';
    banner.style.color = '#633806';
  }
}

function openCart() {
  document.getElementById('cartModal').classList.add('open');
  renderCartContent();
}

function closeCart() {
  document.getElementById('cartModal').classList.remove('open');
}

function renderCartContent() {
  const ids = Object.keys(cart).filter(k => cart[k] > 0);

  if (!ids.length) {
    document.getElementById('cartContent').innerHTML = `
      <button class="modal-close" onclick="closeCart()">✕</button>
      <h2>Your Order</h2>
      <p style="color:#888;font-size:14px;margin-top:1rem;">Your cart is empty.</p>`;
    return;
  }

const total = ids.reduce((sum, k) => {
    const med = medicineCache[k];
    return sum + (med ? cart[k] * med.price : 0);
  }, 0);

const itemsHtml = ids.map(k => {
    const p = medicineCache[k];
    if (!p) return '';
    return `
      <div class="cart-item">
        <div>
          <div class="cart-item-name">${p.name}</div>
          <div style="font-size:12px;color:#888">${p.brand}</div>
        </div>
        <div style="display:flex;align-items:center">
          <div class="qty-controls">
            <button class="qty-btn" onclick="changeQty(${p.id}, -1)">−</button>
            <span class="qty-num">${cart[p.id]}</span>
            <button class="qty-btn" onclick="changeQty(${p.id}, 1)">+</button>
          </div>
          <div class="cart-item-price">₹${(cart[p.id] * p.price).toFixed(2)}</div>
        </div>
      </div>`;
  }).join('');

const hasRx = ids.some(k => {
    const med = medicineCache[k];
    return med && med.requires_rx;
  });

  document.getElementById('cartContent').innerHTML = `
    <button class="modal-close" onclick="closeCart()">✕</button>
    <h2>Your Order</h2>
    ${itemsHtml}
    <div class="total-row">
      <span>Total</span>
      <span style="color:#3B6D11">₹${parseFloat(total).toFixed(2)}</span>
    </div>
    ${hasRx ? `
    <div style="background:#FAEEDA;border:1px solid #FAC775;border-radius:8px;padding:10px 12px;margin:10px 0;font-size:13px;color:#633806">
      ⚠️ Your order contains <strong>prescription medicines</strong>. Please upload your prescription below.
    </div>
    <label class="form-label" style="font-size:13px;color:#555">Upload Prescription *</label>
    <input type="file" id="prescriptionFile" accept="image/*,.pdf"
      style="width:100%;padding:8px;border:1px dashed #ddd;border-radius:8px;font-size:13px;margin-bottom:8px">
    ` : ''}
    <div class="order-form">
      <label>Your name *</label>
      <input type="text" id="custName" placeholder="e.g. Ramesh Kumar">
      <label>Phone number *</label>
      <input type="tel" id="custPhone" placeholder="WhatsApp number">
      <label>Email (optional — for order confirmation)</label>
      <input type="email" id="custEmail" placeholder="yourname@gmail.com">
      <label>Delivery address <button type="button" onclick="useMyLocation()" id="locationBtn" style="margin-left:8px;background:#e8f5ee;color:#0f6b3a;border:1px solid #0f6b3a;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">📍 Use My Location</button></label>
      <textarea id="custAddress" placeholder="House no., street, landmark...">${getCustomerAddress()}</textarea>
      <label>Extra notes</label>
      <textarea id="custNotes" placeholder="Any other instructions?" rows="2"></textarea>
      
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="place-order-btn"
          onclick="placeOrderOnline(${hasRx})"
          style="background:#2563EB">
          💳 Pay Online (UPI / Card / NetBanking)
        </button>
        <button class="place-order-btn"
          onclick="placeOrder(${hasRx})"
          style="background:#3B6D11">
          🏠 Cash on Delivery
        </button>
      </div>
    </div>`;
}

function changeQty(id, delta) {
  cart[id] = Math.max(0, (cart[id] || 0) + delta);
  if (cart[id] === 0) delete cart[id];
  renderCartContent();
  updateCartBar();
}

async function placeOrder(hasRx) {
  const name    = document.getElementById('custName').value.trim();
  const phone   = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const notes   = document.getElementById('custNotes').value.trim();
  const email   = document.getElementById('custEmail').value.trim();

  if (!name || !phone) {
    alert('Please enter your name and phone number.');
    return;
  }

  if (hasRx) {
    const fileInput = document.getElementById('prescriptionFile');
    if (!fileInput || !fileInput.files.length) {
      alert('Please upload your prescription for Rx medicines.');
      return;
    }
  }

  const ids = Object.keys(cart).filter(k => cart[k] > 0);
const items = ids.map(k => {
    const med = medicineCache[k];
    return {
      id: parseInt(k),        // make sure id is a number not a string
      name: med.name,
      qty: cart[k],
      price: med.price
    };
  });
  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);

  // Handle prescription upload
  let prescriptionData = null;
  if (hasRx) {
    const fileInput = document.getElementById('prescriptionFile');
    if (fileInput && fileInput.files.length) {
      prescriptionData = await toBase64(fileInput.files[0]);
    }
  }

try {
    // Get customer token if logged in
    const customerToken = localStorage.getItem('customerToken');

    const headers = { 'Content-Type': 'application/json' };
    if (customerToken) {
      headers['Authorization'] = `Bearer ${customerToken}`;
    }

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        customer_name: name,
        phone: phone,
        email: email,
        address: address + (notes ? '\nNotes: ' + notes : ''),
        items: items,
        total: total,
        prescription: prescriptionData
      })
    });

    const data = await res.json();

    // If stock ran out — show error to customer
    if (!res.ok) {
      alert(data.error || 'Failed to place order. Please try again.');
      return;
    }

  const orderId = data.order_id;
    cart = {};
    updateCartBar();
    document.getElementById('cartContent').innerHTML = `
      <div class="order-success">
        <div class="tick">✅</div>
        <h3>Order Placed!</h3>
        <p style="font-size:13px;color:#777;margin-bottom:8px">Order ID</p>
        <div style="font-size:28px;font-weight:600;color:#3B6D11;margin-bottom:12px">#${orderId}</div>
        <p>Thank you ${name}!<br>
        Sitaram Medical Store will call you on <strong>${phone}</strong> to confirm.</p>
        <p style="font-size:12px;color:#888;margin-top:8px">Save your Order ID to track your order status.</p>
        <p style="font-size:12px;color:#e07b00;margin-top:6px">📧 Check your spam/junk folder if you don't see the confirmation email.</p>
        <a href="/track.html?id=${orderId}" style="display:inline-block;margin-top:10px;padding:8px 20px;background:#e8f5ee;color:#0f6b3a;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">📦 Track My Order</a>
        <button class="continue-btn" onclick="closeCart()">Continue Shopping</button>
      </div>`;

  } catch (err) {
    console.error('Order save failed', err);
    alert('Something went wrong. Please try again.');
  }
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('cartModal').addEventListener('click', function(e) {
  if (e.target === this) closeCart();
});

// Also update search input to trigger on every keystroke
document.getElementById('searchInput').addEventListener('input', filterProducts);

loadCategories();
loadMedicines();



// Load categories dynamically from database
async function loadCategories() {
  try {
    const res = await fetch('/api/medicines/categories');
    const categories = await res.json();

    // Pretty names for categories
    const labels = {
      fever: 'Fever & Cold',
      vitamins: 'Vitamins',
      pain: 'Pain Relief',
      stomach: 'Stomach',
      diabetes: 'Diabetes',
      skincare: 'Skin Care',
      antibiotics: 'Antibiotics',
      heart: 'Heart & BP',
      respiratory: 'Respiratory',
      eye: 'Eye Care',
      ear: 'Ear Care',
      thyroid: 'Thyroid',
      neuro: 'Neuro',
      skin: 'Skin Care',
      womens: "Women's Health",
      ent: 'ENT',
      general: 'General'
    };

    const nav = document.getElementById('catNav');
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'nav-btn';
      btn.textContent = labels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
      btn.onclick = function() { filterCat(cat, this); };
      nav.appendChild(btn);
    });
  } catch (err) {
    console.error('Failed to load categories', err);
  }
}


function getCustomerAddress() {
  const data = localStorage.getItem('customerData');
  if (data) {
    const customer = JSON.parse(data);
    return customer.address || '';
  }
  return '';
}

async function useMyLocation() {
  const btn = document.getElementById('locationBtn');
  const addrField = document.getElementById('custAddress');
  if (!btn || !addrField) return;

  if (!navigator.geolocation) {
    alert('Location not supported by your browser.');
    return;
  }

  btn.textContent = '⏳ Detecting...';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      const addr = data.address;
      const parts = [
        addr.road || addr.pedestrian || addr.footway,
        addr.suburb || addr.neighbourhood || addr.village,
        addr.city || addr.town || addr.county,
        addr.state_district,
        addr.state,
        addr.postcode
      ].filter(Boolean);
      addrField.value = parts.join(', ');
    } catch (err) {
      addrField.value = `Lat: ${latitude.toFixed(5)}, Lon: ${longitude.toFixed(5)}`;
    }
    btn.textContent = '✅ Location Set';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = '📍 Use My Location'; }, 3000);
  }, (err) => {
    btn.textContent = '📍 Use My Location';
    btn.disabled = false;
    if (err.code === 1) alert('Location access denied. Please allow location in your browser settings.');
    else alert('Could not get your location. Please enter manually.');
  }, { timeout: 10000 });
}
// ── REVIEWS ──────────────────────────────────────────────────────
// Cache: { medicineId: { avg_rating, total } }
const reviewCache = {};

async function loadReviewsForVisible() {
  const cards = document.querySelectorAll('.product-card[data-id]');
  const ids = [...cards].map(c => c.dataset.id).filter(id => !reviewCache[id]);
  if (!ids.length) return;
  // Load in parallel (batch up to 10)
  await Promise.all(ids.slice(0, 10).map(async id => {
    try {
      const res = await fetch(`/api/reviews/${id}`);
      const data = await res.json();
      reviewCache[id] = { avg: data.avg_rating || 0, total: data.total || 0 };
    } catch { reviewCache[id] = { avg: 0, total: 0 }; }
  }));
  // Inject stars into cards
  cards.forEach(card => {
    const id = card.dataset.id;
    const r = reviewCache[id];
    if (!r) return;
    let el = card.querySelector('.product-stars');
    if (!el) {
      el = document.createElement('div');
      el.className = 'product-stars';
      el.style.cssText = 'font-size:12px;color:#f59e0b;margin:2px 0 4px;cursor:pointer';
      const nameEl = card.querySelector('.product-brand');
      if (nameEl) nameEl.after(el);
    }
    if (r.total > 0) {
      const full = Math.floor(r.avg);
      const stars = '★'.repeat(full) + '☆'.repeat(5 - full);
      el.innerHTML = `<span onclick="openReviewModal(${id})">${stars} <span style="color:#6b7280">(${r.total})</span></span>`;
    } else {
      el.innerHTML = `<span onclick="openReviewModal(${id})" style="color:#9ca3af">☆☆☆☆☆ <span style="font-size:11px">Be first to review</span></span>`;
    }
  });
}

// Patch renderProducts to add data-id and load reviews after render
const _origRenderProducts = renderProducts;
window.renderProducts = function(medicines) {
  _origRenderProducts(medicines);
  // Add data-id to each card
  const grid = document.getElementById('productsGrid');
  const cards = grid.querySelectorAll('.product-card');
  medicines.forEach((m, i) => {
    if (cards[i]) cards[i].dataset.id = m.id;
  });
  loadReviewsForVisible();
};

// ── REVIEW MODAL ──
function openReviewModal(medicineId) {
  const med = allMedicines.find(m => m.id === medicineId);
  const token = localStorage.getItem('customerToken');

  // Create modal if not exists
  let overlay = document.getElementById('reviewOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reviewOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
    overlay.onclick = e => { if (e.target === overlay) closeReviewModal(); };
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div style="background:white;border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="font-size:16px;color:#1a1a2e">Reviews — ${med ? med.name : 'Medicine'}</h3>
        <button onclick="closeReviewModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280">✕</button>
      </div>
      <div id="reviewsList"><div style="text-align:center;padding:20px;color:#9ca3af">⏳ Loading...</div></div>
      ${token ? `
      <div id="writeReview" style="margin-top:16px;border-top:1px solid #f3f4f6;padding-top:16px">
        <p style="font-size:13px;font-weight:700;color:#374151;margin-bottom:10px">Write a Review</p>
        <div id="starPicker" style="font-size:28px;margin-bottom:12px;cursor:pointer">
          <span onclick="setReviewStar(1,${medicineId})" class="rstar" data-v="1">☆</span>
          <span onclick="setReviewStar(2,${medicineId})" class="rstar" data-v="2">☆</span>
          <span onclick="setReviewStar(3,${medicineId})" class="rstar" data-v="3">☆</span>
          <span onclick="setReviewStar(4,${medicineId})" class="rstar" data-v="4">☆</span>
          <span onclick="setReviewStar(5,${medicineId})" class="rstar" data-v="5">☆</span>
        </div>
        <textarea id="reviewComment" placeholder="Share your experience (optional)..." style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;min-height:70px;outline:none" onfocus="this.style.borderColor='#0f6b3a'" onblur="this.style.borderColor='#e5e7eb'"></textarea>
        <button onclick="submitReview(${medicineId})" id="submitReviewBtn"
          style="margin-top:10px;width:100%;padding:11px;background:#0f6b3a;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
          Submit Review
        </button>
        <div id="reviewMsg" style="margin-top:8px;font-size:13px;text-align:center"></div>
      </div>` : `
      <p style="text-align:center;font-size:13px;color:#6b7280;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6">
        <a href="#" onclick="closeReviewModal();openAuthModal(event)" style="color:#0f6b3a;font-weight:700">Login</a> to write a review
      </p>`}
    </div>`;

  overlay.style.display = 'flex';
  window._reviewMedId = medicineId;
  window._reviewRating = 0;
  fetchAndShowReviews(medicineId);
}

function closeReviewModal() {
  const o = document.getElementById('reviewOverlay');
  if (o) o.style.display = 'none';
}

async function fetchAndShowReviews(medicineId) {
  const list = document.getElementById('reviewsList');
  if (!list) return;
  try {
    const res = await fetch(`/api/reviews/${medicineId}`);
    const data = await res.json();
    if (!data.reviews.length) {
      list.innerHTML = '<div style="text-align:center;padding:16px;color:#9ca3af;font-size:13px">No reviews yet. Be the first!</div>';
      return;
    }
    const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
    list.innerHTML = `
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:32px;font-weight:800;color:#1a1a2e">${data.avg_rating}</div>
        <div style="color:#f59e0b;font-size:18px">${stars(Math.round(data.avg_rating))}</div>
        <div style="font-size:12px;color:#9ca3af">${data.total} review${data.total !== 1 ? 's' : ''}</div>
      </div>
      ${data.reviews.map(r => `
        <div style="padding:12px 0;border-bottom:1px solid #f3f4f6">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:13px;font-weight:700;color:#374151">${r.customer_name}</span>
            <span style="color:#f59e0b;font-size:14px">${stars(r.rating)}</span>
          </div>
          ${r.comment ? `<div style="font-size:13px;color:#4b5563">${r.comment}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:3px">${new Date(r.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
        </div>`).join('')}`;
  } catch {
    list.innerHTML = '<div style="color:#ef4444;font-size:13px;text-align:center">Failed to load reviews.</div>';
  }
}

function setReviewStar(val, medicineId) {
  window._reviewRating = val;
  document.querySelectorAll('.rstar').forEach(s => {
    s.textContent = parseInt(s.dataset.v) <= val ? '★' : '☆';
    s.style.color = parseInt(s.dataset.v) <= val ? '#f59e0b' : '#d1d5db';
  });
}

async function submitReview(medicineId) {
  const rating = window._reviewRating;
  const comment = document.getElementById('reviewComment')?.value?.trim();
  const btn = document.getElementById('submitReviewBtn');
  const msg = document.getElementById('reviewMsg');
  const token = localStorage.getItem('customerToken');

  if (!rating) { msg.style.color = '#ef4444'; msg.textContent = 'Please select a star rating.'; return; }

  btn.disabled = true;
  btn.textContent = 'Submitting...';
  msg.textContent = '';

  try {
    const res = await fetch(`/api/reviews/${medicineId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ rating, comment })
    });
    const data = await res.json();
    if (res.ok) {
      msg.style.color = '#0f6b3a';
      msg.textContent = '✅ Review submitted! Thank you.';
      btn.textContent = 'Submitted ✓';
      delete reviewCache[medicineId]; // clear cache so it refreshes
      setTimeout(() => fetchAndShowReviews(medicineId), 800);
      setTimeout(() => loadReviewsForVisible(), 1000);
    } else {
      msg.style.color = '#ef4444';
      msg.textContent = data.error || 'Failed to submit.';
      btn.disabled = false;
      btn.textContent = 'Submit Review';
    }
  } catch {
    msg.style.color = '#ef4444';
    msg.textContent = 'Network error. Try again.';
    btn.disabled = false;
    btn.textContent = 'Submit Review';
  }
}
