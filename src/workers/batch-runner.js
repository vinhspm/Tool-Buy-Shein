const { startProfile, stopProfile } = require('../services/multilogin');
const { runPurchase } = require('../services/shein-automation');

/**
 * Queue-based batch runner with concurrency control.
 * Each task = { taskId, product, profile: { folderId, profileId, label } }
 */
async function runBatch({ tasks, concurrency = 3, credentials, onTaskUpdate }) {
  const queue = [...tasks];
  const running = new Set();

  async function runTask(task) {
    const { product, profile, taskId } = task;

    const log = (msg) => {
      console.log(`[${profile.label}] ${msg}`);
      onTaskUpdate(taskId, 'running', msg);
    };

    const fail = (msg) => {
      console.error(`[${profile.label}] ${msg}`);
      onTaskUpdate(taskId, 'error', msg);
    };

    let browserURL = null;

    try {
      onTaskUpdate(taskId, 'running', `🚀 Starting profile ${profile.label}...`);

      if (!profile.folderId) {
        fail('❌ Folder ID is not configured. Go to Settings and enter your Folder ID.');
        return;
      }
      if (!profile.profileId) {
        fail('❌ Profile ID is missing. Go to Profiles tab and add your profile IDs.');
        return;
      }

      browserURL = await startProfile(
        profile.folderId,
        profile.profileId,
        credentials.email,
        credentials.password
      );
      log(`🔗 Browser connected at ${browserURL}`);

      const result = await runPurchase({
        browserURL,
        product,
        folderId: profile.folderId,
        profileId: profile.profileId,
        log,
      });

      if (result.success) {
        onTaskUpdate(taskId, 'success', '✅ Purchase completed successfully');
      } else {
        fail(`❌ Purchase failed: ${result.error}`);
      }

    } catch (err) {
      fail(`❌ Fatal error: ${err.message}`);
    } finally {
      running.delete(taskId);
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
      while (running.size < concurrency && queue.length > 0) {
        const task = queue.shift();
        running.add(task.taskId);
        runTask(task).then(() => {
          tryStartNext();
          if (running.size === 0 && queue.length === 0) resolve();
        });
      }
      if (running.size === 0 && queue.length === 0) resolve();
    }
    tryStartNext();
  });
}

module.exports = { runBatch };
