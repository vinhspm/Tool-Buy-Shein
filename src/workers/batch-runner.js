const { startProfile, stopProfile, stopAllProfiles, unlockProfiles } = require('../services/multilogin');
const { runPurchase } = require('../services/shein-automation');
const { cleanupOldScreenshots } = require('../utils/screenshot-manager');

let abortFlag = false;

async function abortBatch() {
  abortFlag = true;
  console.log(`[Batch] 🛑 Abort signal dispatched, clearing queue and terminating browsers...`);
  await stopAllProfiles(); 
  await unlockProfiles();
}

/**
 * Queue-based batch runner with concurrency control.
 * Each task = { taskId, product, profile: { folderId, profileId, label } }
 */
async function runBatch({ tasks, concurrency = 3, credentials, onTaskUpdate }) {
  abortFlag = false;
  
  // Clean old screenshots before starting heavy loop
  cleanupOldScreenshots(7);

  const profileGroups = new Map();
  for (const task of tasks) {
    const pId = task.profile.profileId;
    if (!profileGroups.has(pId)) {
      profileGroups.set(pId, { profile: task.profile, tasks: [] });
    }
    profileGroups.get(pId).tasks.push(task);
  }

  const queue = Array.from(profileGroups.values());
  const runningGroups = new Set();

  async function runGroup(group) {
    const { profile, tasks: groupTasks } = group;
    let browserURL = null;

    const logGroup = (msg) => {
      console.log(`[${profile.label}] ${msg}`);
      // Notify the first pending task or all pending tasks so UI knows the profile is spinning up
      for (const t of groupTasks) {
        if (!t.started) {
          onTaskUpdate(t.taskId, 'running', msg);
        }
      }
    };

    const failRemaining = (msg) => {
      console.error(`[${profile.label}] ${msg}`);
      for (const t of groupTasks) {
        if (!t.started) {
          onTaskUpdate(t.taskId, 'error', msg);
        }
      }
    };

    try {
      if (!profile.folderId) {
        failRemaining('❌ Folder ID is not configured. Go to Settings and enter your Folder ID.');
        return;
      }
      if (!profile.profileId) {
        failRemaining('❌ Profile ID is missing. Go to Profiles tab and add your profile IDs.');
        return;
      }

      logGroup(`🚀 Starting profile ${profile.label} for ${groupTasks.length} tasks...`);
      browserURL = await startProfile(
        profile.folderId,
        profile.profileId,
        credentials.email,
        credentials.password,
        credentials.headless
      );
      
      console.log(`[${profile.label}] 🔗 Browser connected at ${browserURL}`);

      // Run each batch task sequentially in the same opened profile
      for (const t of groupTasks) {
        if (abortFlag) break;
        t.started = true;
        
        const logTask = (msg) => {
          console.log(`[${profile.label} | ${t.skuLabel}] ${msg}`);
          onTaskUpdate(t.taskId, 'running', msg);
        };

        try {
          const result = await runPurchase({
            browserURL,
            products: t.products,
            folderId: profile.folderId,
            profileId: profile.profileId,
            profileLabel: profile.label,
            log: logTask,
          });

          if (result.success === 'full') {
            onTaskUpdate(t.taskId, 'success', `✅ Thành công hoàn toàn: ${result.successful_skus.join(', ')}`);
          } else if (result.success === 'partial') {
            onTaskUpdate(t.taskId, 'error', `⚠️ Mua được một phần: Thành công [${result.successful_skus.join(', ')}] | Thất bại [${result.failed_skus.join(', ')}]`);
          } else {
            if (result.error === 'CAPTCHA_BLOCKED') {
               onTaskUpdate(t.taskId, 'error', `❌ Blocked by Captcha`);
               failRemaining(`❌ Profile hit Captcha. Skipping remaining tasks.`);
               break; // Thoát vòng lặp sản phẩm, đổi sang profile tiếp theo
            } else {
               onTaskUpdate(t.taskId, 'error', `❌ Thất bại hoàn toàn: ${result.error || result.failed_skus?.join(', ')}`);
            }
          }
        } catch (err) {
          onTaskUpdate(t.taskId, 'error', `❌ Fatal error: ${err.message}`);
        }
      }

    } catch (err) {
      failRemaining(`❌ Profile Error: ${err.message}`);
    } finally {
      runningGroups.delete(profile.profileId);
      if (browserURL) {
        try {
          await stopProfile(profile.folderId, profile.profileId, credentials.email, credentials.password);
          console.log(`[${profile.label}] 🛑 Profile stopped`);
        } catch {}
      }
    }
  }

  return new Promise((resolve) => {
    function tryStartNext() {
      if (abortFlag) {
        queue.length = 0; // instantly clear pending groups
      }

      while (runningGroups.size < concurrency && queue.length > 0) {
        const group = queue.shift();
        runningGroups.add(group.profile.profileId);
        runGroup(group).then(() => {
          tryStartNext();
          if (runningGroups.size === 0 && queue.length === 0) resolve();
        });
      }
      if (runningGroups.size === 0 && queue.length === 0) {
        resolve();
      }
    }
    tryStartNext();
  });
}

module.exports = { runBatch, abortBatch };
