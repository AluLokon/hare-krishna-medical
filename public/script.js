let allMedicines = []; 
let currentDisplayed = []; // tracks what's currently shown on screen     // featured medicines (home page)
let medicineCache = {};     // ALL medicines ever loaded (for cart price lookup)
let cart = {};
let currentCat = 'all';
let searchMode = false;
let searchTimeout = null;

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

  grid.innerHTML = medicines.map(p => `
    <div class="product-card ${p.stock === 0 ? 'no-stock' : ''}">
      <div class="product-icon">${p.icon}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-brand">${p.brand}</div>
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
    </div>
  `).join('');
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
      <label>Delivery address</label>
      <textarea id="custAddress" placeholder="House no., street, landmark..."></textarea>
      <label>Extra notes</label>
      <textarea id="custNotes" placeholder="Any other instructions?" rows="2"></textarea>
      <button class="place-order-btn" onclick="placeOrder(${hasRx})">Place Order →</button>
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
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: name,
        phone: phone,
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

  } catch (err) {
    console.error('Order save failed', err);
    alert('Something went wrong. Please try again.');
    return;
  }

  cart = {};
  updateCartBar();
  document.getElementById('cartContent').innerHTML = `
    <div class="order-success">
      <div class="tick">✅</div>
      <h3>Order Placed!</h3>
      <p>Thank you ${name}!<br>
      Sitaram Medical Store will call you on <strong>${phone}</strong> to confirm.</p>
      <button class="continue-btn" onclick="closeCart()">Continue Shopping</button>
    </div>`;
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