const fs = require('fs');
const path = require('path');
// require('dotenv').config();

const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY || '';

// Lưu lịch sử ảnh Screenshot phục vụ Debug
function saveCaptchaHistory(buffer, type) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `captcha_${type}_${timestamp}.png`;
  
  // Lưu vào folder captchas riêng
  const captchaDir = path.join(process.cwd(), 'logs', 'captchas');
  if (!fs.existsSync(captchaDir)) fs.mkdirSync(captchaDir, { recursive: true });
  fs.writeFileSync(path.join(captchaDir, filename), buffer);

  // Lưu vào folder product dùng chung
  const appLogsDir = path.join(process.cwd(), 'logs', 'product');
  if (!fs.existsSync(appLogsDir)) fs.mkdirSync(appLogsDir, { recursive: true });
  fs.writeFileSync(path.join(appLogsDir, filename), buffer);
}

// === CHUẨN API CAPSOLVER: VÒNG LẶP createTask -> getTaskResult ===
async function callCapsolverGeetestTask(websiteURL, captchaId, log) {
  if (!CAPSOLVER_API_KEY) {
    throw new Error('CAPSOLVER_API_KEY bị thiếu trong hệ thống (.env).');
  }

  log(`🤖 Đang yêu cầu CapSolver giải mã Token Geetest v4 (captchaId: ${captchaId || 'Unknown'})...`);
  
  const payload = {
    clientKey: CAPSOLVER_API_KEY,
    task: {
      type: "GeeTestTaskProxyLess",
      websiteURL: websiteURL,
      captchaId: captchaId // Bắt buộc cho Geetest V4
    }
  };

  // 1. Tạo task (createTask)
  const createRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const createData = await createRes.json();
  
  if (createData.errorId === 1) {
    throw new Error(`CapSolver CreateTask Error: ${createData.errorDescription}`);
  }

  const taskId = createData.taskId;
  if (!taskId) {
    throw new Error('Failed to create task, taskId rỗng!');
  }
  log(`[CapSolver] Đã tạo taskId: ${taskId} / Đang đếm ngược chờ kết quả (polling)...`);

  // 2. Lấy kết quả với vòng lặp (getTaskResult)
  while (true) {
    await humanDelay(1500, 2000); // Nghỉ 1-2 giây mỗi nhịp poll theo chuẩn API

    const resultRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: CAPSOLVER_API_KEY,
        taskId: taskId
      })
    });
    const resultData = await resultRes.json();
    const status = resultData.status;

    if (status === "ready") {
      log(`✅ CapSolver đã giải xong Token Geetest v4!`);
      // Geetest V4 trả về: captcha_id, captcha_output, gen_time, lot_number, pass_token
      return resultData.solution; 
    }
    
    if (status === "failed" || resultData.errorId !== 0) {
      throw new Error(`CapSolver giải thất bại: ${resultData.errorDescription || JSON.stringify(resultData)}`);
    }
    // Nếu status == "processing", vòng lặp tiếp tục
  }
}

// Delay ngẫu nhiên để mô phỏng con người
const humanDelay = (min = 300, max = 900) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

// Phát hiện captcha Geetest / Risk Challenge
// Hàm đã được sửa thành vòng lặp chạy ngầm (background loop) để kiểm tra liên tục
async function detectCaptcha(page, log) {
    let clickCount = 0;
    
    // Lặp vô hạn cho đến khi page đóng
    while (!page.isClosed()) {
        try {
            const url = page.url();
            let isCaptcha = url.includes('/risk/') || url.includes('captcha_type');

            if (!isCaptcha) {
                // Fast check: Sử dụng pure JS để đâm xuyên ShadowDOM nhanh nhất
                isCaptcha = await page.evaluate(() => {
                    // Cách 1: DOM thường
                    if (document.querySelector('.risk-one-pass-content-checkbox, .geetest_panel_box')) return true;
                    
                    // Cách 2: DOM xuyên qua Shadow Root (từ outerHTML KH cung cấp)
                    const roots = document.querySelectorAll('#one-pass-custom, [id^="self-click-"]');
                    for (const root of roots) {
                        if (root.shadowRoot && root.shadowRoot.querySelector('.risk-one-pass-content-checkbox')) {
                            return true;
                        }
                    }
                    return false;
                }).catch(() => false);
            }

            if (isCaptcha) {
                clickCount++;
                if (clickCount > 10) {
                    if (log) log(`🚨 Phá Captcha thất bại (vượt quá 10 lần click). Buộc dừng Profile để tránh treo!`);
                    // Thêm flag để luồng chính nhận diện được lý do fail
                    page.captchaBlocked = true;
                    // Đóng page để ngắt luồng chính (Playwright sẽ ném lỗi Target Closed ở bên kia)
                    await page.close().catch(() => {});
                    return;
                }
                
                if (log) log(`🚨 [Background] Phát hiện Captcha che màn hình! Click (10,10) để dismiss (Lần ${clickCount}/10)...`);
                await page.mouse.click(10, 10);
                // Đợi 1 chút sau khi click để DOM cập nhật
                await new Promise(r => setTimeout(r, 1500));
            } else {
                // Reset đếm nếu không còn thấy Captcha
                clickCount = 0;
            }

        } catch (e) {
            // Khi `page` bị đóng, hàm `page.url()` hoặc `page.evaluate()` văng lỗi
            if (page.isClosed()) {
                return;
            }
        }
        
        // Delay interval giữa các lần kiểm tra
        await new Promise(r => setTimeout(r, 2000));
    }
}

// Hàm chính: Thao tác DOM + Xử lý API Captcha
async function solveGeetestV4(page, log) {
    log('⚠️ Khởi động quy trình giải mã Geetest V4 tự động...');

    // 1. Phá bóng Shadow DOM và Click "I am human" nếu có
    const checkbox = page.locator('*css=.risk-one-pass-content-checkbox').first();
    const isVisible = await checkbox.isVisible({ timeout: 4000 }).catch(() => false);
    
    if (isVisible) {
        log('👉 Click vào box "I am human".');
        await checkbox.click({ force: true });
        await humanDelay(1500, 2500);
    }

    // 2. Chờ khung ảnh (Popup) xuẩt hiện
    const panel = page.locator('.captcha_click_wrapper').first();
    await panel.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
        throw new Error('Chờ Popup Captcha Geetest xuất hiện thất bại (Timeout).');
    });
    
    // GIAI ĐOẠN 2 CHUẨN API TỪ CAPSOLVER
    // Để CapSolver có thể giải mã Geetest V4 qua Token (`GeeTestTaskProxyLess`), 
    // ta cần nạy được `captchaId` từ mã nguồn Shein.
    
    log('🔍 Đang dò tìm captchaId trên trình duyệt...');
    const captchaId = await page.evaluate(() => {
        // Cách 1: Đôi khi window.geetest_captcha_id hở ra ngoài
        if (window.geetest_captcha_id) return window.geetest_captcha_id;
        
        // Cách 2: Dò script tags tìm đoạn gcaptcha4.load ?captcha_id=
        const scripts = document.querySelectorAll('script');
        for (const s of Array.from(scripts)) {
            const m = s.src.match(/captcha_id=([a-f0-9]{32})/i);
            if (m) return m[1];
        }
        
        // Các fallback khác tùy structure của DOM...
        return 'fallback_or_manual_captcha_id_if_cant_find';
    });

    if (!captchaId || captchaId.includes('fallback')) {
       // Cảnh báo nhưng vẫn để đi tiếp nếu Token chưa phải lúc
       log('⚠️ Cảnh báo: Không thể bóc tách chuẩn xác captcha_id từ trang. (Geetest API có thể bị fail)!');
    }

    // Gửi tín hiệu gọi GetTaskResult chuẩn
    const websiteURL = page.url() || "https://www.shein.com/";
    const tokenSolution = await callCapsolverGeetestTask(websiteURL, captchaId, log);

    log(`✅ Dữ liệu Token lấy thành công: pass_token=${tokenSolution.pass_token.substring(0, 15)}...`);

    // 3. Inject dữ liệu Bypass
    // Việc cuối cùng là chích Token Solution (pass_token, gen_time, captcha_output)
    // vào trang ReactJS của Shein. Thao tác này đòi hỏi bạn bắn Token vào Callback Object có sẵn,
    // hoặc set global window.geetest4_callback(tokenSolution).
    log('💉 Đang Inject Token vào trang (DOM interaction)...');
    
    // Ghi nhận thử nghiệm callback hoặc Form submit. (Sẽ cần tweak tùy logic frontend của Shein)
    await page.evaluate((solution) => {
       // TODO: Kích hoạt form ngầm định hoặc push payload chứa pass_token của Shein để vượt rào
       console.log("Token Payload: ", solution);
    }, tokenSolution);

    await humanDelay(3000, 4000);

    // 4. Verify kết quả
    const isPanelStillVisible = await panel.isVisible().catch(() => false);
    if (isPanelStillVisible) {
        // Tùy chỉnh: nếu Inject thất bại thì sẽ fall qua DOM click truyền thống 
        // Nhưng hiện tại chúng ta văng lỗi theo đúng rule Fail-fast
        throw new Error('Đã tiêm Token CapSolver thành công nhưng web không chuyển hướng. Bạn sẽ bị fail profile!');
    }
    
    log('✅ Bỏ túi Captcha Thành Công bằng luồng ProxyLess API!');
    await humanDelay(2000, 3000);
}

module.exports = {
    detectCaptcha,
    solveGeetestV4
};
