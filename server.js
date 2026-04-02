const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const md5 = require('md5');

const { parseExcel } = require('./src/utils/excel-parser');
const { runBatch } = require('./src/workers/batch-runner');
const { startProfile } = require('./src/services/multilogin');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer config for Excel upload
const upload = multer({
  dest: UPLOAD_DIR,
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx?$/.test(file.originalname);
    cb(null, ok);
  },
});

// ─── PERSISTENT CONFIG ───────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  email: '',
  password: '',
  automationToken: '',
  folderId: '',
  profiles: [],
  concurrency: 3,
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('[Config] Failed to load config.json:', e.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[Config] Failed to save config.json:', e.message);
  }
}

let currentTasks = [];
let isRunning = false;
let config = loadConfig();
console.log(`[Config] Loaded: email=${config.email || '(empty)'}, folderId=${config.folderId || '(empty)'}, profiles=${config.profiles.length}`);

// ─── REST ENDPOINTS ──────────────────────────────────────────────────────────

// Upload Excel
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const products = parseExcel(req.file.path);
  res.json({ success: true, count: products.length, products });
});

// Save config (persistent)
app.post('/api/config', (req, res) => {
  config = { ...config, ...req.body };
  saveConfig(config);
  res.json({ success: true });
});

// Get current config
app.get('/api/config', (req, res) => {
  res.json({ ...config, password: config.password ? '***' : '' });
});

// Start batch run
app.post('/api/start', (req, res) => {
  if (isRunning) return res.status(400).json({ error: 'Already running' });

  const { products, profileAssignments } = req.body;
  // profileAssignments: [{ rowIndex, profileId, label }]

  if (!products?.length) return res.status(400).json({ error: 'No products provided' });
  if (!config.email || !config.password) return res.status(400).json({ error: 'Credentials not configured' });

  // Build tasks
  currentTasks = products.map((product, i) => {
    const assignment = profileAssignments?.[i] || { profileId: config.profiles[i % config.profiles.length]?.profileId, label: `Profile-${i + 1}` };
    return {
      taskId: `task-${i}-${Date.now()}`,
      product,
      profile: {
        folderId: config.folderId,
        profileId: assignment.profileId,
        label: assignment.label || `Row ${product.rowIndex}`,
      },
    };
  });

  // Emit initial state
  io.emit('tasks:init', currentTasks.map(t => ({ taskId: t.taskId, label: t.profile.label, product: t.product, status: 'pending' })));
  isRunning = true;
  res.json({ success: true, taskCount: currentTasks.length });

  // Run async
  runBatch({
    tasks: currentTasks,
    concurrency: config.concurrency,
    credentials: { email: config.email, password: config.password },
    onTaskUpdate: (taskId, status, message) => {
      io.emit('task:update', { taskId, status, message, time: new Date().toISOString() });
    },
  }).then(() => {
    isRunning = false;
    io.emit('batch:complete', { time: new Date().toISOString() });
    console.log('✅ Batch completed');
  }).catch(err => {
    isRunning = false;
    io.emit('batch:error', { error: err.message });
    console.error('❌ Batch error:', err.message);
  });
});

// Stop batch
app.post('/api/stop', (req, res) => {
  isRunning = false;
  io.emit('batch:stopped', {});
  res.json({ success: true });
});

// Status
app.get('/api/status', (req, res) => {
  res.json({ isRunning, taskCount: currentTasks.length });
});

// ─── DEBUG: Test profile start directly ──────────────────────────────────────
app.post('/api/mlx/test-start', async (req, res) => {
  const { folderId, profileId } = req.body;
  const email = req.body.email || config.email;
  const password = req.body.password || config.password;

  if (!folderId || !profileId || !email || !password) {
    return res.status(400).json({ error: 'folderId, profileId, email, password required' });
  }

  try {
    const browserURL = await startProfile(folderId, profileId, email, password);
    res.json({ success: true, data: { port: browserURL.split(':').pop() }, browserURL });
  } catch (err) {
    console.error('[TEST] ❌ error:', err.message);
    res.status(400).json({
      error: err.message,
    });
  }
});



// ─── MULTILOGIN HELPER ENDPOINTS ─────────────────────────────────────────────

// 1. Fetch available workspaces
app.post('/api/mlx/workspaces', async (req, res) => {
  const email = req.body.email || config.email;
  const password = req.body.password || config.password;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const signinRes = await axios.post(
      'https://api.multilogin.com/user/signin',
      { email, password: md5(password) },
      { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );
    const token = signinRes.data.data?.token || signinRes.data.token;
    if (!token) throw new Error('No login token received');

    const wsRes = await axios.get('https://api.multilogin.com/user/workspaces', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const workspaces = wsRes.data.data?.workspaces || [];
    res.json({ success: true, workspaces });
  } catch (err) {
    const msg = err.response?.data?.status?.message || err.response?.data?.message || err.message;
    console.error('[MLX] Fetch Workspaces error:', msg);
    res.status(400).json({ error: msg });
  }
});

// 2. Generate permanent automation token for a specific workspace
app.post('/api/mlx/automation-token', async (req, res) => {
  const { email, password, workspaceId } = req.body;
  if (!email || !password || !workspaceId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // A. Signin to get refresh token
    const signinRes = await axios.post(
      'https://api.multilogin.com/user/signin',
      { email, password: md5(password) },
      { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );
    const refreshToken = signinRes.data.data?.refresh_token || signinRes.data.refresh_token;
    if (!refreshToken) throw new Error('No refresh token received');

    // B. Refresh token specifically for the selected workspace
    const trRes = await axios.post(
      'https://api.multilogin.com/user/refresh_token',
      { email, refresh_token: refreshToken, workspace_id: workspaceId },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const wsToken = trRes.data.data?.token || trRes.data.token;
    if (!wsToken) throw new Error('Could not get token for workspace');

    // C. Get permanent automation token bound to this workspace
    const autoRes = await axios.get(
      `https://api.multilogin.com/workspace/automation_token?expiration_period=no_exp`,
      { headers: { 'Authorization': `Bearer ${wsToken}` } }
    );
    const automationToken = autoRes.data.data?.token || autoRes.data.token;
    if (!automationToken) throw new Error('Failed to create automation token');
    
    // Save locally to server config memory as well just in case
    config.automationToken = automationToken;
    saveConfig(config);

    res.json({ success: true, token: automationToken });
  } catch (err) {
    const msg = err.response?.data?.status?.message || err.response?.data?.message || err.message;
    console.error('[MLX] Generate Automation Token error:', msg);
    res.status(400).json({ error: msg });
  }
});

// 3. Fetch folders & profiles USING ONLY the automation token
app.post('/api/mlx/profiles', async (req, res) => {
  const token = req.body.token || config.automationToken;
  if (!token) return res.status(400).json({ error: 'Automation Token is required' });

  try {
    // Verify by fetching folders
    const foldersRes = await axios.get('https://api.multilogin.com/workspace/folders', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const folders = foldersRes.data.data?.folders || foldersRes.data.data || foldersRes.data.folders || [];
    
    const result = [];
    for (const folder of folders) {
      const fId = folder.folder_id || folder.id;
      const fName = folder.folder_name || folder.name || 'Unknown Folder';
      
      try {
        const profilesRes = await axios.post(
          'https://api.multilogin.com/profile/search',
          { folder_id: fId, search_text: '', limit: 100 },
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const rawProfiles = profilesRes.data.data?.profiles || profilesRes.data.profiles || [];
        
        result.push({
          folderId: fId,
          folderName: fName,
          profiles: rawProfiles.map(p => ({
            profileId: p.id || p.profile_id,
            profileName: p.name,
            browser: p.browser_type || p.browser,
            status: p.status || '',
          }))
        });
      } catch (e) {
        console.warn(`[MLX] Could not fetch profiles for folder ${fId}`);
        result.push({ folderId: fId, folderName: fName, profiles: [], error: e.message });
      }
    }

    res.json({ success: true, folders: result });
  } catch (err) {
    const msg = err.response?.data?.status?.message || err.response?.data?.message || err.message;
    console.error('[MLX] Fetch Profiles (Token) error:', msg);
    res.status(400).json({ error: msg });
  }
});



// ─── SOCKET ──────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[WS] Client disconnected: ${socket.id}`));
});

// ─── START ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🚀 Shein Auto-Buy Tool running at: http://localhost:${PORT}\n`);
});
