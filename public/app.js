// ── State ────────────────────────────────────────────────────────────────────
let uploadedProducts = [];
let apiFetchedProducts = [];
let tasks = {};  // taskId -> { status, label, messages[] }
let profiles = []; // [{ profileId, label }]
let fetchedFolders = []; // stores MLX folders

const socket = io();

// ── Socket listeners ─────────────────────────────────────────────────────────
socket.on('tasks:init', (initTasks) => {
  tasks = {};
  initTasks.forEach(t => {
    tasks[t.taskId] = { ...t, messages: [], status: 'pending' };
  });
  renderTasks();
  updateStats();
  setRunningState(true);
});

socket.on('task:update', ({ taskId, status, message, time }) => {
  if (!tasks[taskId]) return;
  tasks[taskId].status = status;
  tasks[taskId].messages.push({ message, time });
  renderTaskCard(taskId);
  updateStats();
});

socket.on('batch:complete', () => {
  setRunningState(false);
  showToast('✅ Batch completed!', 'success');
  updateStatusBadge('Done', 'emerald');
});

socket.on('batch:error', ({ error }) => {
  setRunningState(false);
  showToast('❌ Batch error: ' + error, 'error');
});

socket.on('batch:stopped', () => {
  setRunningState(false);
  showToast('⏹️ Batch stopped', 'info');
  updateStatusBadge('Stopped', 'yellow');
});

// ── Tabs ─────────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-content-${name}`)?.classList.remove('hidden');
  document.getElementById(`tab-${name}`)?.classList.add('active');
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadFile(input) {
  const file = input.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    uploadedProducts = data.products;
    showToast(`✅ Loaded ${data.count} products`, 'success');
    renderPreview(uploadedProducts);
    document.getElementById('excel-preview').classList.remove('hidden');
  } catch (err) {
    showToast('❌ Upload failed: ' + err.message, 'error');
  }

  input.value = '';
}

function renderPreview(products) {
  const tbody = document.getElementById('preview-body');

  // Group products on the frontend for preview UI
  const batches = {};
  products.forEach(p => {
    // A simple regex just for UI grouping representing phone parsing
    const phoneMatch = p.shipping_address.match(/(\+?\d[\d\s\-\.]{8,}\d)/) || [""];
    const phoneClean = phoneMatch[0].replace(/\s+/g, '');
    const key = `${p.shop_code || 'no_shop'}_${phoneClean}`;
    if (!batches[key]) {
      batches[key] = {
        shop: p.shop_code || 'Chưa rõ mã',
        phone: phoneClean || 'Chưa rõ SĐT',
        address: p.shipping_address,
        items: []
      };
    }
    batches[key].items.push(p);
  });
  const groupedBatches = Object.values(batches);

  document.getElementById('preview-count').textContent = `${groupedBatches.length} batches (${products.length} products)`;
  document.getElementById('preview-title').textContent = 'Preview (first 20 batches)';

  tbody.innerHTML = groupedBatches.slice(0, 20).map((b, i) => `
    <tr class="border-b border-white/5 bg-surface-1/50 hover:bg-surface-1 transition-colors group">
      <td class="px-4 py-4 text-slate-600 align-top">#${i + 1}</td>
      <td class="px-4 py-4 max-w-sm align-top">
        <div class="font-semibold text-brand-300 mb-1">🏪 Shop: ${b.shop}</div>
        <div class="text-xs text-slate-400 line-clamp-3 leading-relaxed" title="${b.address}">${b.address}</div>
      </td>
      <td class="px-4 py-4 align-top">
        <div class="flex flex-col gap-2">
          ${b.items.map(item => `
            <div class="flex items-center gap-3 bg-surface-2 rounded-lg p-2 border border-white/5">
               <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold text-slate-200 truncate mb-1">
                    ${item.sku_code || 'Chưa rõ SKU'}
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-1.5 py-0.5 bg-surface-1 rounded border border-white/5 text-[10px] text-slate-400">🎨 ${item.color || '—'}</span>
                    <span class="px-1.5 py-0.5 bg-surface-1 rounded border border-white/5 text-[10px] text-slate-400">📏 ${item.size || '—'}</span>
                    <span class="px-1.5 py-0.5 bg-brand-500/10 border border-brand-500/20 text-brand-400 rounded text-[10px] font-semibold">📦 x${item.quantity}</span>
                  </div>
               </div>
            </div>
          `).join('')}
        </div>
      </td>
    </tr>
  `).join('');
}

// Drop zone drag events
const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('file-input').files = dt.files;
    uploadFile(document.getElementById('file-input'));
  }
});

// ── API Fetching ─────────────────────────────────────────────────────────────
async function fetchApiTasks() {
  const limit = document.getElementById('api-limit').value || 10;
  const btn = document.getElementById('btn-fetch-api');
  btn.disabled = true;
  btn.textContent = 'Đang Kéo...';

  try {
    const res = await fetch(`/api/shein-tasks?limit=${limit}`);
    const data = await res.json();
    console.log(data);
    
    if (data.error) throw new Error(data.error);

    const orders = data.orders || [];
    
    // Map API tasks to internal format used by batch-runner
    apiFetchedProducts = orders.map(ord => ({
      orderId: ord.orderId,
      shop_code: ord.shopCode || '',
      sku_code: ord.sku || '',
      color: ord.color || '',
      size: ord.size || '',
      quantity: ord.quantity || 1,
      shipping_address: ord.address || '',
    }));

    showToast(`✅ Đã lấy ${apiFetchedProducts.length} đơn hàng`, 'success');
    renderApiPreview(apiFetchedProducts);
    document.getElementById('api-preview').classList.remove('hidden');

    // Auto switch to API run mode
    document.getElementById('run-mode').value = 'api';
  } catch (err) {
    showToast('❌ Fetch API failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Kéo Data Từ API`;
  }
}

function renderApiPreview(products) {
  const tbody = document.getElementById('api-preview-body');

  const batches = {};
  products.forEach(p => {
    let phoneClean = "";
    if (!p.shipping_address.includes('\n') && p.shipping_address.includes(',')) {
       const parts = p.shipping_address.split(',');
       phoneClean = (parts[parts.length - 1] || '').replace(/[^\d+]/g, '');
    } else {
       const phoneMatch = p.shipping_address.match(/(\+?\d[\d\s\-\.]{8,}\d)/) || [""];
       phoneClean = phoneMatch[0].replace(/\s+/g, '');
    }
    const key = `${p.shop_code || 'no_shop'}_${phoneClean}`;
    if (!batches[key]) {
      batches[key] = {
        shop: p.shop_code || 'Chưa rõ mã',
        phone: phoneClean || 'Chưa rõ SĐT',
        address: p.shipping_address,
        items: []
      };
    }
    batches[key].items.push(p);
  });
  const groupedBatches = Object.values(batches);

  document.getElementById('api-preview-count').textContent = `${groupedBatches.length} mẻ checkout (${products.length} SP)`;

  tbody.innerHTML = groupedBatches.map((b, i) => `
    <tr class="border-b border-white/5 bg-surface-1/50 hover:bg-surface-1 transition-colors group">
      <td class="px-4 py-4 text-slate-600 align-top">#${i + 1}</td>
      <td class="px-4 py-4 max-w-sm align-top">
        <div class="font-semibold text-brand-300 mb-1">🏪 Shop: ${b.shop}</div>
        <div class="text-xs text-slate-400 line-clamp-3 leading-relaxed" title="${b.address}">${b.address}</div>
      </td>
      <td class="px-4 py-4 align-top">
        <div class="flex flex-col gap-2">
          ${b.items.map(item => `
            <div class="flex items-center gap-3 bg-surface-2 rounded-lg p-2 border border-white/5">
               <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold text-slate-200 truncate mb-1">
                    <span class="text-xs text-amber-500">[${item.orderId}]</span> ${item.sku_code || 'Chưa rõ SKU'}
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="px-1.5 py-0.5 bg-surface-1 rounded border border-white/5 text-[10px] text-slate-400">🎨 ${item.color || '—'}</span>
                    <span class="px-1.5 py-0.5 bg-surface-1 rounded border border-white/5 text-[10px] text-slate-400">📏 ${item.size || '—'}</span>
                    <span class="px-1.5 py-0.5 bg-brand-500/10 border border-brand-500/20 text-brand-400 rounded text-[10px] font-semibold">📦 x${item.quantity}</span>
                  </div>
               </div>
            </div>
          `).join('')}
        </div>
      </td>
    </tr>
  `).join('');
}

// ── Profiles ──────────────────────────────────────────────────────────────────
function addProfileRow(id = '', label = '') {
  const list = document.getElementById('profile-list');
  const idx = list.children.length;
  const el = document.createElement('div');
  el.className = 'flex items-center gap-3';
  el.innerHTML = `
    <input type="text" placeholder="Label (e.g. Account 1)" value="${label}"
      class="input-field flex-1" data-field="label" />
    <input type="text" placeholder="Profile ID (UUID)" value="${id}"
      class="input-field flex-2" style="min-width:280px" data-field="profileId" />
    <button onclick="this.parentElement.remove()" class="w-9 h-9 rounded-xl bg-surface-2 hover:bg-red-900/30 border border-white/10 flex items-center justify-center text-slate-500 hover:text-red-400 transition-all flex-shrink-0">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  `;
  list.appendChild(el);
}

function saveProfiles() {
  const rows = document.querySelectorAll('#profile-list > div');
  profiles = Array.from(rows).map(row => ({
    label: row.querySelector('[data-field="label"]').value.trim(),
    profileId: row.querySelector('[data-field="profileId"]').value.trim(),
  })).filter(p => p.profileId);

  // Save to backend config to persist changes
  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles }),
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showToast(`✅ ${profiles.length} profiles saved`, 'success');
      } else {
        showToast('❌ Failed to save profiles', 'error');
      }
    })
    .catch(err => showToast('❌ ' + err.message, 'error'));
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function saveSettings() {
  const cfg = {
    email: document.getElementById('cfg-email').value.trim(),
    password: document.getElementById('cfg-password').value,
    automationToken: document.getElementById('cfg-token').value.trim(),
    folderId: document.getElementById('cfg-folder').value.trim(),
    concurrency: parseInt(document.getElementById('cfg-concurrency').value) || 3,
    maxProductsPerProfile: parseInt(document.getElementById('cfg-maxProductsPerProfile').value) || 30,
    headless: document.getElementById('cfg-headless').checked,
    profiles,
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const data = await res.json();
    if (data.success) showToast('✅ Settings saved', 'success');
  } catch (err) {
    showToast('❌ Failed to save settings', 'error');
  }
}

async function fetchWorkspaces() {
  const email = document.getElementById('cfg-email').value.trim();
  const password = document.getElementById('cfg-password').value;

  if (!email || !password) {
    showToast('⚠️ Enter email and password first', 'info');
    return;
  }

  const btn = document.getElementById('btn-fetch-ws');
  btn.disabled = true;
  btn.textContent = 'Fetching...';

  try {
    const res = await fetch('/api/mlx/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const select = document.getElementById('cfg-workspace');
    select.innerHTML = '<option value="">-- Select Workspace --</option>' +
      data.workspaces.map(ws => `<option value="${ws.workspace_id || ws.id}">${ws.name}</option>`).join('');
    
    showToast(`✅ Found ${data.workspaces.length} workspace(s)`, 'success');
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '1. Fetch';
  }
}

async function generateToken() {
  const email = document.getElementById('cfg-email').value.trim();
  const password = document.getElementById('cfg-password').value;
  const workspaceId = document.getElementById('cfg-workspace').value;

  if (!email || !password || !workspaceId) {
    showToast('⚠️ Email, Password & Workspace are required', 'info');
    return;
  }

  const btn = document.getElementById('btn-gen-token');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const res = await fetch('/api/mlx/automation-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, workspaceId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    document.getElementById('cfg-token').value = data.token;
    
    // Auto save all
    await saveSettings();
    showToast('✅ Automation Token generated and saved!', 'success');
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '2. Gen Token';
  }
}

// Import profile IDs from pasted Multilogin API JSON response
function importFromJson() {
  const raw = document.getElementById('json-paste-input').value.trim();
  const resultEl = document.getElementById('import-result');

  if (!raw) {
    showToast('⚠️ Vui lòng paste JSON vào ô trước', 'info');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    resultEl.className = 'text-sm rounded-xl p-4 border border-red-500/30 bg-red-900/10 text-red-400';
    resultEl.textContent = '❌ JSON không hợp lệ, vui lòng kiểm tra lại';
    resultEl.classList.remove('hidden');
    return;
  }

  // Try to extract profiles from various response shapes
  const profileList =
    parsed?.data?.profiles ||
    parsed?.profiles ||
    (Array.isArray(parsed) ? parsed : null);

  // Try to extract folder_id from URL param embedded in response, or from request_id field
  const folderId =
    parsed?.data?.folder_id ||
    parsed?.folder_id ||
    '';

  if (!profileList || profileList.length === 0) {
    resultEl.className = 'text-sm rounded-xl p-4 border border-amber-500/30 bg-amber-900/10 text-amber-400';
    resultEl.textContent = '⚠️ Không tìm thấy danh sách profiles trong JSON. Hãy chắc chắn bạn paste đúng response của request /profile?folder_id=...';
    resultEl.classList.remove('hidden');
    return;
  }

  let addedCount = 0;
  profileList.forEach(p => {
    const profileId = p.profile_id || p.id;
    const profileName = p.name || `Profile-${profileId?.slice(0, 8)}`;
    if (!profileId) return;
    if (profiles.some(x => x.profileId === profileId)) return; // skip duplicates
    addProfileRow(profileId, profileName);
    addedCount++;
  });

  // Auto-fill folder ID if found
  if (folderId && document.getElementById('cfg-folder')) {
    document.getElementById('cfg-folder').value = folderId;
  }

  resultEl.className = 'text-sm rounded-xl p-4 border border-emerald-500/30 bg-emerald-900/10 text-emerald-400';
  resultEl.innerHTML = `✅ Đã import <strong>${addedCount}</strong> profiles thành công!${folderId ? `<br>📁 Folder ID: <code class="font-mono text-xs">${folderId}</code>` : ' (Bạn vẫn cần nhập Folder ID thủ công vào ô Settings bên trên)'}`;
  resultEl.classList.remove('hidden');

  if (addedCount > 0) {
    showToast(`✅ Đã thêm ${addedCount} profiles vào danh sách`, 'success');
    setTimeout(() => showTab('profiles'), 1500);
  }
}


// Fetch all folders & profiles using automation token
async function fetchProfiles() {
  const token = document.getElementById('cfg-token').value.trim();

  if (!token) {
    showToast('⚠️ Generate or enter Automation Token first', 'info');
    return;
  }

  const btn = document.getElementById('btn-fetch');
  btn.disabled = true;
  btn.textContent = 'Fetching...';

  try {
    const res = await fetch('/api/mlx/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    fetchedFolders = data.folders;
    renderFolderBrowser(data.folders);
    document.getElementById('mlx-folders-panel').classList.remove('hidden');
    showToast(`✅ Found ${data.folders.length} folder(s)`, 'success');

  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> 3. Fetch Folders & Profiles`;
  }
}

function renderFolderBrowser(folders) {
  const list = document.getElementById('mlx-folders-list');
  list.innerHTML = folders.map(folder => `
    <div class="border border-white/10 rounded-xl overflow-hidden">
      <!-- Folder header -->
      <div class="flex items-center justify-between px-5 py-3.5 bg-surface-2 cursor-pointer hover:bg-white/5 transition-colors" onclick="toggleFolder('${folder.folderId}')">
        <div class="flex items-center gap-3">
          <svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
          <span class="font-semibold text-white text-sm">${folder.folderName}</span>
          <span class="text-xs text-slate-500">${folder.profiles.length} profiles</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="text-xs px-3 py-1 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/40 transition-colors"
            onclick="event.stopPropagation(); useFolderId('${folder.folderId}', '${folder.folderName}')">
            Use This Folder ID
          </button>
          <code class="text-xs text-slate-600 font-mono">${folder.folderId.slice(0,8)}…</code>
        </div>
      </div>

      <!-- Profile rows -->
      <div id="folder-${folder.folderId}" class="divide-y divide-white/5">
        ${folder.profiles.map(p => `
          <div class="flex items-center justify-between px-5 py-3 hover:bg-white/3 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-7 h-7 rounded-full bg-surface-2 border border-white/10 flex items-center justify-center text-xs text-slate-400">
                ${p.profileName?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div>
                <div class="text-sm text-white font-medium">${p.profileName}</div>
                <div class="text-xs text-slate-500 font-mono">${p.profileId}</div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs px-2 py-0.5 rounded-full ${p.status === 'Active' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500'}">${p.status || 'Inactive'}</span>
            </div>
          </div>
        `).join('')}
        ${folder.profiles.length === 0 ? `<div class="px-5 py-4 text-sm text-slate-600">No profiles in this folder</div>` : ''}
      </div>
    </div>
  `).join('');
}

function escapeStr(s) { return String(s || '').replace(/'/g, "\\'"); }

function toggleFolder(folderId) {
  const el = document.getElementById(`folder-${folderId}`);
  if (el) el.classList.toggle('hidden');
}

function useFolderId(folderId, folderName) {
  // Update UI Folder Input
  const folderInput = document.getElementById('cfg-folder');
  if (folderInput) folderInput.value = folderId;

  // Add all profiles in this folder
  const folder = fetchedFolders.find(f => f.folderId === folderId);
  if (folder && folder.profiles.length > 0) {
    const list = document.getElementById('profile-list');
    list.innerHTML = ''; // Clear existing DOM
    
    // Add new ones
    folder.profiles.forEach(p => addProfileRow(p.profileId, p.profileName));
    
    // Read them back into state
    const rows = document.querySelectorAll('#profile-list > div');
    profiles = Array.from(rows).map(row => ({
      label: row.querySelector('[data-field="label"]').value.trim(),
      profileId: row.querySelector('[data-field="profileId"]').value.trim(),
    })).filter(p => p.profileId);
    
    showToast(`✅ Folder "${folderName}" set & imported ${profiles.length} profiles!`, 'success');
  } else {
    showToast(`✅ Folder "${folderName}" set. No profiles inside.`, 'success');
  }

  // Save everything to backend (API /api/config will save both folderId and profiles)
  saveSettings();
  
  // Switch to profiles tab automatically if we imported some
  if (folder && folder.profiles.length > 0) {
    setTimeout(() => showTab('profiles'), 800);
  }
}


// Load existing settings on page load
async function loadSettings() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.email) document.getElementById('cfg-email').value = cfg.email;
    if (cfg.password && cfg.password !== '***') document.getElementById('cfg-password').value = cfg.password;
    if (cfg.automationToken) document.getElementById('cfg-token').value = cfg.automationToken;
    if (cfg.folderId) document.getElementById('cfg-folder').value = cfg.folderId;
    if (cfg.concurrency) document.getElementById('cfg-concurrency').value = cfg.concurrency;
    if (cfg.maxProductsPerProfile) document.getElementById('cfg-maxProductsPerProfile').value = cfg.maxProductsPerProfile;
    if (cfg.headless !== undefined) document.getElementById('cfg-headless').checked = cfg.headless;
    if (cfg.profiles?.length) {
      cfg.profiles.forEach(p => addProfileRow(p.profileId, p.label));
      profiles = cfg.profiles;
    }
  } catch {}
}

// ── Batch Control ─────────────────────────────────────────────────────────────
async function startBatch() {
  const runMode = document.getElementById('run-mode').value;
  let targetProducts = [];

  if (runMode === 'excel') {
    if (!uploadedProducts.length) {
      showToast('⚠️ Upload a product Excel file first', 'info');
      showTab('upload');
      return;
    }
    targetProducts = uploadedProducts;
  } else if (runMode === 'api') {
    if (!apiFetchedProducts.length) {
      showToast('⚠️ Fetch data from API first', 'info');
      showTab('api');
      return;
    }
    targetProducts = apiFetchedProducts;
  }

  if (!profiles.length) {
    showToast('⚠️ Add Multilogin profiles first', 'info');
    showTab('profiles');
    return;
  }

  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: targetProducts, profiles }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast(`🚀 Started ${data.taskCount} tasks`, 'success');
    updateStatusBadge('Running', 'blue');
    showTab('dashboard');
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

async function stopBatch() {
  await fetch('/api/stop', { method: 'POST' });
}

function clearTasks() {
  tasks = {};
  renderTasks();
  updateStats();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderTasks() {
  const grid = document.getElementById('task-grid');
  const empty = document.getElementById('empty-state');
  const ids = Object.keys(tasks);

  if (!ids.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  ids.forEach(renderTaskCard);
}

function renderTaskCard(taskId) {
  const t = tasks[taskId];
  const grid = document.getElementById('task-grid');
  let el = document.getElementById(`card-${taskId}`);

  const statusIcon = { pending: '⏳', running: '🔄', success: '✅', error: '❌' };
  const lastMsg = t.messages[t.messages.length - 1]?.message || 'Waiting...';
  const logs = t.messages.slice(-5).map(m => {
    const cls = m.message.includes('❌') ? 'log-error' : m.message.includes('✅') ? 'log-ok' : m.message.includes('⚠️') ? 'log-warn' : '';
    return `<div class="log-line ${cls}">${m.message}</div>`;
  }).join('');

  const html = `
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-base">${statusIcon[t.status] || '⏳'}</span>
          <span class="font-semibold text-white text-sm">${t.label}</span>
          <span class="text-xs text-slate-500 truncate" title="${t.skuLabel}">${t.skuLabel}</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-slate-500">
          ${t.itemCount ? `<span>📦 ${t.itemCount} items</span>` : ''}
        </div>
      </div>
      <span class="px-2.5 py-1 text-xs rounded-full font-medium flex-shrink-0 ${statusBadgeClass(t.status)}">${t.status}</span>
    </div>
    <div class="mt-3 border-t border-white/5 pt-3 space-y-0.5 max-h-24 overflow-y-auto">
      ${logs || `<div class="log-line">${lastMsg}</div>`}
    </div>
  `;

  if (!el) {
    el = document.createElement('div');
    el.id = `card-${taskId}`;
    el.className = `task-card status-${t.status}`;
    grid.prepend(el);
  } else {
    el.className = `task-card status-${t.status}`;
  }
  el.innerHTML = html;
}

function statusBadgeClass(status) {
  return {
    pending: 'bg-slate-800 text-slate-400',
    running: 'bg-blue-900/40 text-blue-400',
    success: 'bg-emerald-900/40 text-emerald-400',
    error:   'bg-red-900/40 text-red-400',
  }[status] || 'bg-slate-800 text-slate-400';
}

function updateStats() {
  const all = Object.values(tasks);
  document.getElementById('stat-total').textContent = all.length;
  document.getElementById('stat-running').textContent = all.filter(t => t.status === 'running').length;
  document.getElementById('stat-success').textContent = all.filter(t => t.status === 'success').length;
  document.getElementById('stat-failed').textContent = all.filter(t => t.status === 'error').length;

  const done = all.filter(t => ['success','error'].includes(t.status)).length;
  const pct = all.length ? Math.round(done / all.length * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `${done} / ${all.length}`;
}

function setRunningState(running) {
  document.getElementById('btn-start').disabled = running;
}

function updateStatusBadge(text, color) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  const colors = { blue: 'bg-blue-500', emerald: 'bg-emerald-500', yellow: 'bg-yellow-500', slate: 'bg-slate-600' };
  dot.className = `w-2 h-2 rounded-full inline-block ${colors[color] || colors.slate}`;
  label.textContent = text;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadSettings();

