const { startProfile, stopProfile, stopAllProfiles, unlockProfiles } = require('../services/multilogin');
const { runPurchase } = require('../services/shein-automation');
const { cleanupOldScreenshots } = require('../utils/screenshot-manager');
const axios = require('axios');

async function updateApiOrderStatus(products, status, profileLabel, logTask, extraDetail = {}) {
  const orderIdsToUpdate = new Set();
  for (const p of products) {
    if (p.orderId) {
      orderIdsToUpdate.add(p.orderId.toString().trim());
    }
  }
  for (const oId of orderIdsToUpdate) {
    try {
      const payload = {
        checkoutStatus: status,
        email: profileLabel,
        ...extraDetail
      };
      
      await axios.patch(`https://sla.tooltik.app/inforShein/checkout-status/${encodeURIComponent(oId)}`, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (logTask) logTask(`✅ Đã đẩy status '${status}' cho API OrderID: ${oId}`);
    } catch (err) {
      const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      if (logTask) logTask(`⚠️ Lỗi đẩy status API OrderID ${oId} (Status: ${status}): ${errDetail}`);
    }
  }
}

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
async function runBatch({ tasks, concurrency = 3, credentials, onTaskUpdate, availableProfiles }) {
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
  const runningGroups = new Map(); // pId => group
  const bannedProfiles = new Set();

  async function shiftTasksToNextProfile(remainingTasks) {
    const safeProfiles = (availableProfiles || []).filter(p => !bannedProfiles.has(p.profileId));
    if (safeProfiles.length === 0) {
      for (const t of remainingTasks) {
         if (!t.started) {
           onTaskUpdate(t.taskId, 'error', '❌ Hủy do hết profile dự phòng (tất cả đều dính block Captcha).');
           await updateApiOrderStatus(t.products, 'fail', t.profile.label);
         }
      }
      return;
    }
    
    // Pick the first safe profile
    const nextProf = safeProfiles[0];
    const pId = nextProf.profileId;

    for (const t of remainingTasks) {
        t.profile = { ...t.profile, profileId: nextProf.profileId, label: nextProf.label || pId };
        t.started = false; // reset state
    }

    if (runningGroups.has(pId)) {
       const activeGroup = runningGroups.get(pId);
       activeGroup.tasks.push(...remainingTasks);
       onTaskUpdate(remainingTasks[0].taskId, 'info', `🔄 Đã shift task sang profile đang chạy: ${nextProf.label}`);
    } else {
       let qGroup = queue.find(g => g.profile.profileId === pId);
       if (qGroup) {
          qGroup.tasks.push(...remainingTasks);
          onTaskUpdate(remainingTasks[0].taskId, 'info', `🔄 Đã gộp task vào queue profile: ${nextProf.label}`);
       } else {
          const freshGroup = { profile: remainingTasks[0].profile, tasks: remainingTasks };
          queue.push(freshGroup);
          onTaskUpdate(remainingTasks[0].taskId, 'info', `🔄 Đã lên lịch profile mới: ${nextProf.label} để gánh task`);
       }
    }
  }

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

    const failRemaining = async (msg) => {
      console.error(`[${profile.label}] ${msg}`);
      for (const t of groupTasks) {
        if (!t.started) {
          onTaskUpdate(t.taskId, 'error', msg);
          await updateApiOrderStatus(t.products, 'fail', profile.label);
        }
      }
    };

    try {
      if (!profile.folderId) {
        await failRemaining('❌ Folder ID is not configured. Go to Settings and enter your Folder ID.');
        return;
      }
      if (!profile.profileId) {
        await failRemaining('❌ Profile ID is missing. Go to Profiles tab and add your profile IDs.');
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
        
        let currentTaskStatus = 'running';
        const logTask = (msg) => {
          console.log(`[${profile.label} | ${t.skuLabel}] ${msg}`);
          onTaskUpdate(t.taskId, currentTaskStatus, msg);
        };

        const setTaskStatus = (status, msg) => {
          currentTaskStatus = status;
          onTaskUpdate(t.taskId, status, msg);
        };

        try {
          await updateApiOrderStatus(t.products, 'inProgress', profile.label, logTask);

          const result = await runPurchase({
            browserURL,
            products: t.products,
            folderId: profile.folderId,
            profileId: profile.profileId,
            profileLabel: profile.label,
            log: logTask,
          });

          if (result.success === 'full' || result.success === 'partial') {
            if (result.success === 'full') {
              setTaskStatus('success', `✅ Thành công hoàn toàn: ${result.successful_skus.join(', ')}`);
            } else {
              setTaskStatus('error', `⚠️ Mua được một phần: Thành công [${result.successful_skus.join(', ')}] | Thất bại [${result.failed_skus.join(', ')}]`);
              const failedProducts = t.products.filter(p => (result.failed_skus || []).includes(p.sku_code));
              await updateApiOrderStatus(failedProducts, 'fail', profile.label, logTask);
            }
            
            // Sync result to API
            const successSkus = result.successful_skus || [];
            const successProducts = t.products.filter(p => successSkus.includes(p.sku_code));
            await updateApiOrderStatus(successProducts, 'ordered', profile.label, logTask, {
                confirmState: 'cho_track',
                orderIdShein: result.orderIdShein || '',
                baseCost: String(result.baseCost || 0),
                detailOrderShein: result.detailOrderShein || {}
            });

          } else {
            if (result.error === 'CAPTCHA_BLOCKED') {
               setTaskStatus('error', `❌ Blocked by Captcha`);
               
               bannedProfiles.add(profile.profileId);
               const tIndex = groupTasks.indexOf(t);
               const remainingTasksToShift = groupTasks.slice(tIndex); // Includes current failed task to retry
               
               console.log(`[${profile.label}] ❌ Bị Captcha. Đang cắt ${remainingTasksToShift.length} task chuyển sang Profile khác.`);
               
               // Stop processing remainder of this group
               groupTasks.length = tIndex; 
               
               await shiftTasksToNextProfile(remainingTasksToShift);
               break; // Thoát profile hiện tại
            } else {
               setTaskStatus('error', `❌ Thất bại: ${result.error || result.failed_skus?.join(', ')}`);
               await updateApiOrderStatus(t.products, 'fail', profile.label, logTask);
            }
          }
        } catch (err) {
          setTaskStatus('error', `❌ Fatal error: ${err.message}`);
          await updateApiOrderStatus(t.products, 'fail', profile.label, logTask);
        }
      }

    } catch (err) {
      await failRemaining(`❌ Profile Error: ${err.message}`);
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
        runningGroups.set(group.profile.profileId, group);
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
