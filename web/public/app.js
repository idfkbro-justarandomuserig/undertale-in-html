(() => {
  'use strict';

  const state = {
    token: localStorage.getItem('resale_token') || null,
    view: 'dashboard',
    inventory: [],
    selected: new Set(),
    stocks: null,
    shipments: [],
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function money(n) {
    if (n == null || Number.isNaN(n)) return '$0.00';
    return `$${Number(n).toFixed(2)}`;
  }

  // ---------------- API ----------------
  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      logout();
      throw new Error('Session expired, please log in again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---------------- Auth ----------------
  function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    loadAll();
  }

  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
  }

  function logout() {
    state.token = null;
    localStorage.removeItem('resale_token');
    showLogin();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('#pin-input').value.trim();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      state.token = data.token;
      localStorage.setItem('resale_token', data.token);
      $('#login-error').classList.add('hidden');
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
      $('#login-error').classList.remove('hidden');
    }
  });

  $('#logout-btn').addEventListener('click', logout);

  // ---------------- Navigation ----------------
  function setView(view) {
    state.view = view;
    $$('.view').forEach((el) => el.classList.add('hidden'));
    $(`#view-${view}`).classList.remove('hidden');
    $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  }

  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

  // ---------------- Modal ----------------
  function openModal(html) {
    $('#modal').innerHTML = html;
    $('#modal-backdrop').classList.remove('hidden');
  }
  function closeModal() {
    $('#modal-backdrop').classList.add('hidden');
    $('#modal').innerHTML = '';
  }
  $('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('#modal-backdrop')) closeModal();
  });

  // ---------------- Dashboard ----------------
  async function loadDashboard() {
    const { items, summary } = await api('/api/inventory');
    const { summary: stockSummary } = await api('/api/stocks');
    const { shipments } = await api('/api/shipping');

    $('#summary-cards').innerHTML = `
      <div class="stat-card"><div class="label">Net profit</div><div class="value ${summary.totalNetProfit >= 0 ? 'good' : 'bad'}">${money(summary.totalNetProfit)}</div></div>
      <div class="stat-card"><div class="label">Active listings</div><div class="value">${summary.activeCount}</div></div>
      <div class="stat-card"><div class="label">Sold</div><div class="value">${summary.soldCount}</div></div>
      <div class="stat-card"><div class="label">Stock portfolio</div><div class="value ${stockSummary.totalGainLoss >= 0 ? 'good' : 'bad'}">${money(stockSummary.totalMarketValue)}</div></div>
    `;

    $('#recent-shipments').innerHTML = shipments.slice(0, 5).map(shipmentRowHtml).join('') || '<p class="muted">No shipments yet.</p>';
  }

  // ---------------- Inventory ----------------
  function itemRowHtml(item) {
    const margin = item.margin;
    const profitHtml = margin
      ? `<div class="profit ${margin.netProfit >= 0 ? 'good' : 'bad'}">${money(margin.netProfit)} profit · ${margin.roiPct}% ROI</div>`
      : '<div class="muted">No listing price set</div>';
    return `
      <div class="item-row" data-id="${item.id}">
        <input type="checkbox" class="item-check" data-id="${item.id}" ${state.selected.has(item.id) ? 'checked' : ''} />
        <div class="body">
          <div class="title">${escapeHtml(item.name)}</div>
          <div class="meta">
            <span class="badge">${item.status}</span>
            ${item.platform ? `<span class="badge">${item.platform}</span>` : ''}
            ${item.category ? `<span class="badge">${item.category}</span>` : ''}
            SKU ${escapeHtml(item.sku)}
          </div>
          ${profitHtml}
        </div>
      </div>
    `;
  }

  function shipmentRowHtml(s) {
    return `
      <div class="item-row">
        <div class="body">
          <div class="title">${s.tracking_number || 'No tracking number'}</div>
          <div class="meta">
            <span class="badge">${s.status}</span>
            ${s.carrier ? `<span class="badge">${s.carrier}</span>` : ''}
            ${s.platform ? `<span class="badge">${s.platform}</span>` : ''}
            ${s.sku ? `SKU ${escapeHtml(s.sku)}` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadInventory() {
    const status = $('#filter-status').value;
    const platform = $('#filter-platform').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (platform) params.set('platform', platform);
    const { items } = await api(`/api/inventory?${params}`);
    state.inventory = items;
    $('#inventory-list').innerHTML = items.map(itemRowHtml).join('') || '<p class="muted">No items yet. Tap "+ Add item" to get started.</p>';
    updateBulkBar();
  }

  $('#filter-status').addEventListener('change', loadInventory);
  $('#filter-platform').addEventListener('change', loadInventory);

  $('#inventory-list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('item-check')) return;
    const id = Number(e.target.dataset.id);
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    updateBulkBar();
  });

  function updateBulkBar() {
    const n = state.selected.size;
    $('#bulk-actions').classList.toggle('hidden', n === 0);
    $('#selected-count').textContent = `${n} selected`;
  }

  $('#bulk-actions').addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    const ids = Array.from(state.selected);
    if (ids.length === 0) return;

    if (action === 'update_price') {
      openModal(`
        <h2>Change price</h2>
        <label class="muted">New listing price for ${ids.length} item(s)</label>
        <input id="bulk-price" type="number" step="0.01" placeholder="e.g. 25.00" />
        <div class="modal-actions">
          <button class="secondary-btn" id="bulk-cancel">Cancel</button>
          <button class="primary-btn" id="bulk-confirm">Apply</button>
        </div>
      `);
      $('#bulk-cancel').addEventListener('click', closeModal);
      $('#bulk-confirm').addEventListener('click', async () => {
        const newPrice = parseFloat($('#bulk-price').value);
        if (Number.isNaN(newPrice)) return;
        await api('/api/inventory/batch', { method: 'POST', body: JSON.stringify({ action: 'update_price', ids, payload: { newPrice } }) });
        closeModal();
        state.selected.clear();
        loadInventory();
      });
      return;
    }

    await api('/api/inventory/batch', { method: 'POST', body: JSON.stringify({ action, ids }) });
    state.selected.clear();
    loadInventory();
  });

  $('#add-item-btn').addEventListener('click', () => {
    openModal(`
      <h2>Add item</h2>
      <input id="f-name" type="text" placeholder="Item name *" />
      <div class="row">
        <input id="f-acq" type="number" step="0.01" placeholder="Acquisition cost *" />
        <input id="f-price" type="number" step="0.01" placeholder="Listing price" />
      </div>
      <div class="row">
        <select id="f-platform">
          <option value="">Platform...</option>
          <option value="ebay">eBay</option>
          <option value="depop">Depop</option>
          <option value="mercari">Mercari</option>
          <option value="facebook_marketplace">Facebook Marketplace</option>
          <option value="poshmark">Poshmark</option>
        </select>
        <input id="f-category" type="text" placeholder="Category" />
      </div>
      <input id="f-shipping" type="number" step="0.01" placeholder="Shipping cost" />
      <div class="modal-actions">
        <button class="secondary-btn" id="f-cancel">Cancel</button>
        <button class="primary-btn" id="f-save">Save</button>
      </div>
    `);
    $('#f-cancel').addEventListener('click', closeModal);
    $('#f-save').addEventListener('click', async () => {
      const name = $('#f-name').value.trim();
      const acquisitionCost = parseFloat($('#f-acq').value);
      if (!name || Number.isNaN(acquisitionCost)) return;
      const item = {
        name,
        acquisitionCost,
        listingPrice: parseFloat($('#f-price').value) || undefined,
        platform: $('#f-platform').value || undefined,
        category: $('#f-category').value.trim() || undefined,
        shippingCost: parseFloat($('#f-shipping').value) || undefined,
      };
      await api('/api/inventory/bulk', { method: 'POST', body: JSON.stringify({ items: [item] }) });
      closeModal();
      loadInventory();
    });
  });

  // ---------------- Stocks ----------------
  async function loadStocks() {
    const { portfolio, summary } = await api('/api/stocks');
    state.stocks = portfolio;
    $('#stock-summary').innerHTML = `
      <div class="stat-card"><div class="label">Market value</div><div class="value">${money(summary.totalMarketValue)}</div></div>
      <div class="stat-card"><div class="label">Gain / loss</div><div class="value ${summary.totalGainLoss >= 0 ? 'good' : 'bad'}">${money(summary.totalGainLoss)}</div></div>
    `;
    $('#stock-list').innerHTML = portfolio.map((s) => `
      <div class="item-row">
        <div class="body">
          <div class="title">${s.ticker} · ${s.quantity} sh</div>
          <div class="meta">Cost basis ${money(s.avg_cost_basis)} · Current ${money(s.current_price)}</div>
          <div class="profit ${s.gainLoss >= 0 ? 'good' : 'bad'}">${money(s.gainLoss)} (${s.gainLossPct}%)</div>
        </div>
      </div>
    `).join('') || '<p class="muted">No holdings yet.</p>';
  }

  $('#add-stock-btn').addEventListener('click', () => {
    openModal(`
      <h2>Add / update holding</h2>
      <input id="s-ticker" type="text" placeholder="Ticker *" style="text-transform:uppercase" />
      <div class="row">
        <input id="s-qty" type="number" step="0.0001" placeholder="Quantity" />
        <input id="s-cost" type="number" step="0.01" placeholder="Avg cost basis" />
      </div>
      <input id="s-price" type="number" step="0.01" placeholder="Current price" />
      <div class="modal-actions">
        <button class="secondary-btn" id="s-cancel">Cancel</button>
        <button class="primary-btn" id="s-save">Save</button>
      </div>
    `);
    $('#s-cancel').addEventListener('click', closeModal);
    $('#s-save').addEventListener('click', async () => {
      const ticker = $('#s-ticker').value.trim();
      if (!ticker) return;
      const update = {
        ticker,
        quantity: parseFloat($('#s-qty').value) || undefined,
        avgCostBasis: parseFloat($('#s-cost').value) || undefined,
        currentPrice: parseFloat($('#s-price').value) || undefined,
      };
      await api('/api/stocks/sync', { method: 'POST', body: JSON.stringify({ updates: [update] }) });
      closeModal();
      loadStocks();
    });
  });

  // ---------------- Shipping ----------------
  async function loadShipping() {
    const { shipments } = await api('/api/shipping');
    state.shipments = shipments;
    $('#shipping-list').innerHTML = shipments.map(shipmentRowHtml).join('') || '<p class="muted">No shipments yet.</p>';

    const status = await api('/api/status');
    renderIntegrationStatus('ebay', status.ebay);
    renderIntegrationStatus('gmail', status.gmail);
  }

  function renderIntegrationStatus(name, s) {
    const statusEl = $(`#${name}-status`);
    const connectBtn = $(`#${name}-connect-btn`);
    const syncBtn = $(`#${name}-sync-btn`);
    if (!s.configured) {
      statusEl.textContent = 'Not configured (add credentials to about-me/integrations.json)';
      connectBtn.classList.add('hidden');
      syncBtn.classList.add('hidden');
    } else if (!s.connected) {
      statusEl.textContent = 'Configured, not connected';
      connectBtn.classList.remove('hidden');
      syncBtn.classList.add('hidden');
    } else {
      statusEl.textContent = 'Connected — auto-syncing';
      connectBtn.classList.add('hidden');
      syncBtn.classList.remove('hidden');
    }
  }

  $('#shipping-ingest-btn').addEventListener('click', async () => {
    const rawText = $('#shipping-text').value.trim();
    if (!rawText) return;
    const sku = $('#shipping-sku').value.trim() || undefined;
    await api('/api/shipping/ingest', { method: 'POST', body: JSON.stringify({ rawText, sku }) });
    $('#shipping-text').value = '';
    $('#shipping-sku').value = '';
    loadShipping();
  });

  $('#ebay-connect-btn').addEventListener('click', async () => {
    const { url } = await api('/api/ebay/connect-url');
    window.location.href = url;
  });
  $('#gmail-connect-btn').addEventListener('click', async () => {
    const { url } = await api('/api/gmail/connect-url');
    window.location.href = url;
  });
  $('#ebay-sync-btn').addEventListener('click', async () => {
    await api('/api/ebay/sync', { method: 'POST' });
    loadShipping();
  });
  $('#gmail-sync-btn').addEventListener('click', async () => {
    await api('/api/gmail/sync', { method: 'POST' });
    loadShipping();
  });

  // ---------------- Boot ----------------
  async function loadAll() {
    try {
      await Promise.all([loadDashboard(), loadInventory(), loadStocks(), loadShipping()]);
    } catch (err) {
      console.error(err);
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (state.token) showApp();
  else showLogin();
})();
