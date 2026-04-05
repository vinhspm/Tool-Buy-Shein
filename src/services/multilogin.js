// Multilogin X API integration
// NOTE: Plan does not support /start via API → use detectRunningBrowser() instead
const axios = require('axios');
const md5   = require('md5');
const https = require('https');

const MLX_API  = 'https://api.multilogin.com';
const LAUNCHER = 'https://launcher.mlx.yt:45001';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const fs = require('fs');
const path = require('path');
const CONFIG_FILE = path.join(__dirname, '../../config.json');

async function getToken() {
  let config = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch(e) {}
  }

  if (config.automationToken) {
    return config.automationToken;
  }

  throw new Error('Automation Token not found. Please click "2. Gen Token" in Settings first.');
}

async function startProfile(folderId, profileId, email, password, headless = false) {
  const token = await getToken(email, password);
  const startUrl = `${LAUNCHER}/api/v2/profile/f/${folderId}/p/${profileId}/start?automation_type=playwright&headless_mode=${headless}`;
  console.log(`[MLX] Starting profile: ...${profileId.slice(-8)} (headless: ${headless})`);

  try {
    const response = await axios.get(startUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      httpsAgent,
    });
    const port = response.data.data?.port;
    if (!port) throw new Error(`No port in response: ${JSON.stringify(response.data)}`);
    const browserURL = `http://127.0.0.1:${port}`;
    console.log(`[MLX] ✅ Profile started at ${browserURL}`);
    return browserURL;

  } catch (err) {
    const status = err.response?.status;
    const raw    = err.response?.data;
    console.warn(`[MLX] Start error (HTTP ${status}):`, JSON.stringify(raw, null, 2));

    // 403 / already running → stop then restart
    if (status === 403) {
      console.warn(`[MLX] Profile might be running or permission denied. Trying stop → start...`);
      await forceStop(folderId, profileId, token);
      await sleep(2000); // wait for browser to close

      // Retry start
      const retry = await axios.get(startUrl, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        httpsAgent,
      });
      const port = retry.data.data?.port;
      if (!port) throw new Error(`No port after retry: ${JSON.stringify(retry.data)}`);
      const browserURL = `http://127.0.0.1:${port}`;
      console.log(`[MLX] ✅ Profile started (after stop) at ${browserURL}`);
      return browserURL;
    }

    throw new Error(`Launcher error ${status}: ${raw?.status?.message || err.message}`);
  }
}

async function forceStop(folderId, profileId, token) {
  try {
    await axios.get(
      `${LAUNCHER}/api/v1/profile/stop/p/${profileId}`,
      { headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
        }, httpsAgent }
    );
    console.log(`[MLX] Profile stopped successfully by forceStop`);
  } catch (e) {
    console.warn(`[MLX] Stop warning (non-critical):`, e.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stopProfile(folderId, profileId, email, password) {
  try {
    const token = await getToken(email, password);
    await axios.get(
      `${LAUNCHER}/api/v1/profile/stop/p/${profileId}`,
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent }
    );
    console.log(`[MLX] Profile ...${profileId.slice(-8)} stopped`);
  } catch (err) {
    console.warn(`[MLX] Stop (non-critical):`, err.message);
  }
}

// Stop ALL running instances of Multilogin profiles unconditionally
async function stopAllProfiles(tokenOrEmail, password) {
  try {
    let token = tokenOrEmail;
    if (password) {
      token = await getToken(tokenOrEmail, password);
    } else if (!token) {
      token = await getToken();
    }
    
    await axios.get(
      `${LAUNCHER}/api/v1/profile/stop_all?type=all`,
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent }
    );
    console.log(`[MLX] 🛑 ALL Profiles stopped successfully via stop_all API`);
  } catch (err) {
    console.warn(`[MLX] Stop All Warning:`, err.message);
  }
}

module.exports = { startProfile, stopProfile, forceStop, stopAllProfiles, getToken };
