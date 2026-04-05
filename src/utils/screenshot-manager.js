const path = require('path');
const fs = require('fs');

function getFolderStructure(profileLabel) {
  const dateObj = new Date();
  const dateFolder = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
  const safeProfile = (profileLabel || 'unknown_profile').replace(/[^a-z0-9_-]/gi, '_');
  const dirPath = path.join(process.cwd(), 'screenshots', dateFolder, safeProfile);
  
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

async function takeStructuredScreenshot(page, stepName, profileLabel, productTitle = 'unknown') {
  try {
    const dirPath = getFolderStructure(profileLabel);
    
    const now = new Date();
    const timeStr = [
      now.getHours().toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0'),
      now.getSeconds().toString().padStart(2, '0')
    ].join('-');
    
    const safeTitle = (productTitle || 'unknown').replace(/[^a-z0-9_-]/gi, '_').substring(0, 30);
    const safeStep = stepName.replace(/[^a-z0-9_-]/gi, '_');
    
    const fileName = `${timeStr}_${safeTitle}_${safeStep}.png`;
    const filePath = path.join(dirPath, fileName);
    
    await page.screenshot({ path: filePath, fullPage: true });
  } catch (err) {
    console.warn(`[Screenshot] Could not take screenshot [${stepName}]: ${err.message}`);
  }
}

function cleanupOldScreenshots(retentionDays = 7) {
  const screenshotsDir = path.join(process.cwd(), 'screenshots');
  if (!fs.existsSync(screenshotsDir)) return;
  
  const folders = fs.readdirSync(screenshotsDir);
  const now = new Date();
  now.setHours(0, 0, 0, 0); // truncate to midnight
  
  for (const folder of folders) {
    const folderPath = path.join(screenshotsDir, folder);
    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) continue;
    
    const folderDate = new Date(folder);
    if (isNaN(folderDate.getTime())) continue; // Ignore non-date folders
    folderDate.setHours(0, 0, 0, 0);
    
    const diffTime = Math.abs(now - folderDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > retentionDays) {
      console.log(`[Cleanup] Deleting old screenshots folder (>${retentionDays} days): ${folder}`);
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
      } catch (err) {
        console.error(`[Cleanup] Failed to delete ${folder}: ${err.message}`);
      }
    }
  }
}

module.exports = { takeStructuredScreenshot, cleanupOldScreenshots };
