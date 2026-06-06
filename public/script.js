let allMedicines = [];
let cart = {};
let currentCat = 'all';
let searchQuery = '';

// When page loads, fetch medicines from our backend API
async function loadMedicines() {
  try {
    const response = await fetch('/api/medicines');
    allMedicines = await response.json();
    renderProducts();
  } catch (err) {
    document.getElementById('productsGrid').innerHTML =
      '<p style="color:red">Failed to load medicines. Is the server running?</p>';
  }
}

// Show products on screen
function renderProducts() {
  const grid = document.getElementById('productsGrid');

  const filtered = allMedicines.filter(p => {
    const matchCat = currentCat === 'all' || p.category === currentCat;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  if (!filtered.length) {
    grid.innerHTML = '<p style="color:#888;font-size:14px;">No medicines found.</p>';
    return;
  }

  grid.innerHTML = filtered.map(p => `
    <div class="product-card">
      <div class="product-icon">${p.icon}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-brand">${p.brand}</div>
      <div class="product-price">₹${p.price}</div>
      <div class="product-footer">
        ${p.requires_rx ? '<span class="rx-badge">Rx</span>' : '<span></span>'}
        <button
          class="add-btn ${cart[p.id] ? 'added' : ''}"
          onclick="addToCart(${p.id})">
          ${cart[p.id] ? `In cart (${cart[p.id]})` : '+ Add'}
        </button>
      </div>
    </div>
  `).join('');
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  renderProducts();
  updateCartBar();
}

function updateCartBar() {
  const bar = document.getElementById('cartBar');
  const ids = Object.keys(cart).filter(k => cart[k] > 0);
  if (!ids.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const count = ids.reduce((sum, k) => sum + cart[k], 0);
  const total = ids.reduce((sum, k) => {
    const med = allMedicines.find(m => m.id == k);
    return sum + cart[k] * med.price;
  }, 0);
  document.getElementById('cartCount').textContent = count + ' item' + (count > 1 ? 's' : '');
  document.getElementById('cartTotal').textContent = '₹' + parseFloat(total).toFixed(2);
}

function filterCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts();
}

function filterProducts() {
  searchQuery = document.getElementById('searchInput').value;
  renderProducts();
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
    const med = allMedicines.find(m => m.id == k);
    return sum + cart[k] * med.price;
  }, 0);

  const itemsHtml = ids.map(k => {
    const p = allMedicines.find(m => m.id == k);
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

  document.getElementById('cartContent').innerHTML = `
    <button class="modal-close" onclick="closeCart()">✕</button>
    <h2>Your Order</h2>
    ${itemsHtml}
    <div class="total-row">
      <span>Total</span>
      <span style="color:#3B6D11">₹${parseFloat(total).toFixed(2)}</span>
    </div>
    <div class="order-form">
      <label>Your name *</label>
      <input type="text" id="custName" placeholder="e.g. Ramesh Kumar">
      <label>Phone number *</label>
      <input type="tel" id="custPhone" placeholder="WhatsApp number">
      <label>Delivery address</label>
      <textarea id="custAddress" placeholder="House no., street, landmark..."></textarea>
      <label>Extra notes</label>
      <textarea id="custNotes" placeholder="Any other instructions?" rows="2"></textarea>
      <button class="place-order-btn" onclick="placeOrder()">Place Order →</button>
    </div>`;
}

function changeQty(id, delta) {
  cart[id] = Math.max(0, (cart[id] || 0) + delta);
  if (cart[id] === 0) delete cart[id];
  renderCartContent();
  renderProducts();
  updateCartBar();
}

async function placeOrder() {
  const name    = document.getElementById('custName').value.trim();
  const phone   = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const notes   = document.getElementById('custNotes').value.trim();

  if (!name || !phone) {
    alert('Please enter your name and phone number.');
    return;
  }

  const ids = Object.keys(cart).filter(k => cart[k] > 0);
  const items = ids.map(k => {
    const med = allMedicines.find(m => m.id == k);
    return { id: k, name: med.name, qty: cart[k], price: med.price };
  });
  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);

  // Save order to database
  try {
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: name,
        phone: phone,
        address: address + (notes ? '\nNotes: ' + notes : ''),
        items: items,
        total: total
      })
    });
  } catch (err) {
    console.error('Order save failed', err);
  }

  // Clear cart and show success
  cart = {};
  renderProducts();
  updateCartBar();
  document.getElementById('cartContent').innerHTML = `
    <div class="order-success">
      <div class="tick">✅</div>
      <h3>Order Placed!</h3>
      <p>Thank you ${name}!<br>
      Hare Krishna Medical Store will call you on <strong>${phone}</strong> to confirm your order.</p>
      <button class="continue-btn" onclick="closeCart()">Continue Shopping</button>
    </div>`;
}

// Close modal when clicking outside
document.getElementById('cartModal').addEventListener('click', function(e) {
  if (e.target === this) closeCart();
});

// Load medicines when page opens
loadMedicines();