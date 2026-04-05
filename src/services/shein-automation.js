const { chromium } = require('playwright');
const { parseShippingAddress } = require('../utils/address-parser');
const path = require('path');
const fs = require('fs');

const { takeStructuredScreenshot } = require('../utils/screenshot-manager');

const CAPTCHA_RETRY_LIMIT = 3;

// Random human-like delay between min and max ms
const humanDelay = (min = 300, max = 900) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

// Type text slowly like a human
async function humanType(page, selector, text) {
  await page.click(selector);
  await page.fill(selector, '');
  for (const char of text) {
    await page.type(selector, char, { delay: Math.floor(Math.random() * 120 + 40) });
  }
}

// Dismiss promotional overlays safely using text detection
async function dismissPromotionDialog(page, log) {
  try {
    const hasPromo = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Promotion Savings') || 
             text.includes('Are you sure you want to leave') || 
             text.includes('Leave Now') || 
             text.includes('Promotion Savings') || 
             text.includes('Got it') || 
             text.includes('CONTINUE CHECKING OUT');
    }).catch(() => false);

    if (hasPromo) {
       log(`🛑 Promotion popup detected. Sending ESC to dismiss...`);
       const buttonClose = page.locator('button.sui-dialog__closebtn');
       await buttonClose.waitFor({ state: 'visible', timeout: 5000 });
       await buttonClose.click();
      //  await page.keyboard.press('Escape');
       await new Promise(r => setTimeout(r, 600)); 
    }

  } catch(e) {}
}

// Detect if CAPTCHA is present on page
async function hasCaptcha(page) {
  try {
    const captchaSelectors = [
      'iframe[src*="captcha"]',
      '[class*="captcha"]',
      '[id*="captcha"]',
      '.bots-tip',
      '.captcha-container',
      '.geetest_panel_box'
    ];
    for (const sel of captchaSelectors) {
      const el = await page.$(sel);
      if (el) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Navigate with captcha retry logic
async function navigateWithRetry(page, url, log) {
  for (let attempt = 1; attempt <= CAPTCHA_RETRY_LIMIT; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(1500, 3000);

    if (await hasCaptcha(page)) {
      log(`⚠️ Captcha detected (attempt ${attempt}/${CAPTCHA_RETRY_LIMIT}), refreshing...`);
      if (attempt === CAPTCHA_RETRY_LIMIT) {
        throw new Error('CAPTCHA_BLOCK: Could not bypass captcha after retries');
      }
      await humanDelay(2000, 4000);
      continue;
    }
    return; // success
  }
}

// Select Color variant
async function selectColor(page, colorName, log) {
  const normalized = colorName.trim().toLowerCase();
  log(`🎨 Selecting color: "${colorName}"`);

  try {
    // Shein new DOM structure + old fallbacks
    const colorOptions = await page.$$('.main-sales-attr__color-container .radio-container');
    for (const opt of colorOptions) {
      const ariaLabel = (await opt.getAttribute('aria-label') || '').toLowerCase();
      const title = (await opt.getAttribute('title') || '').toLowerCase();
      const dataName = (await opt.getAttribute('data-name') || '').toLowerCase();

      if (ariaLabel === normalized || ariaLabel.includes(normalized) || 
          (title && title.includes(normalized)) || 
          (dataName && dataName.includes(normalized))) {
        await opt.click();
        await humanDelay(500, 1200);
        return true;
      }
    }

    // Fallback: search by text content
    await page.locator(`[class*="color-item"]:has-text("${colorName}")`).first().click({ timeout: 5000 });
    await humanDelay(500, 1000);
    return true;
  } catch (err) {
    log(`⚠️ Color "${colorName}" not found or error occurred, skipping.`);
    return false;
  }
}

// Select Size variant
async function selectSize(page, sizeName, log) {
  const normalized = sizeName.trim().toLowerCase();
  log(`📐 Selecting size: "${sizeName}"`);

  try {
    // Shein new DOM structure for sizes + old fallbacks
    const sizeOptions = await page.$$('.product-intro__size-choose .size-radio [data-attr_value_name], .product-intro__size-radio');
    for (const opt of sizeOptions) {
      const attrName = (await opt.getAttribute('data-attr_value_name') || '').toLowerCase();
      const ariaLabel = (await opt.getAttribute('aria-label') || '').toLowerCase();
      const text = ((await opt.textContent()) || '').trim().toLowerCase();
      const title = (await opt.getAttribute('title') || '').toLowerCase();

      if (attrName === normalized || (ariaLabel && ariaLabel.includes(normalized)) || text === normalized || (title && title.includes(normalized))) {
        const isDisabled = await opt.getAttribute('aria-disabled') === 'true';
        const className = await opt.getAttribute('class') || '';

        if (isDisabled || className.includes('disabled') || className.includes('soldout')) {
          log(`⚠️ Size "${sizeName}" is sold out`);
          return false;
        }
        await opt.click();
        await humanDelay(500, 1000);
        return true;
      }
    }
  } catch (err) {
    log(`⚠️ Error checking size "${sizeName}": ${err.message}`);
  }

  log(`⚠️ Size "${sizeName}" not found`);
  return false;
}

// Extract product title from detail page
async function getProductTitle(page, log) {
  try {
    let title = '';
    const titleLocator = page.locator('h1.product-intro__head-name > span.fsp-element, h1.fsp-element, h1[class*="product-intro"]').first();
    
    try {
      // Chờ h1 hiển thị (nhưng không được thêm thẻ <title> vào đây vì title luôn bị hidden)
      await titleLocator.waitFor({ state: 'visible', timeout: 3000 });
      title = await titleLocator.textContent();
    } catch (e) {
      // Bỏ qua lỗi timeout nếu không tìm thấy h1
    }
    
    let cleanTitle = (title || '').trim();
    
    // Nếu h1 không lấy được, Fallback lấy trực tiếp Title của cả trang web
    if (!cleanTitle) {
      const pageTitle = await page.title(); // Dùng hàm gốc của Playwright
      // Cắt bỏ phần hậu tố rác của web (ví dụ: "Áo sơ mi ... | SHEIN USA")
      cleanTitle = pageTitle.split('|')[0].replace('SHEIN', '').trim();
    }

    if (cleanTitle) log(`🏷️ Product Title detected: "${cleanTitle}"`);
    return cleanTitle;
  } catch (err) {
    log(`⚠️ Could not detect product title: ${err.message}`);
    return '';
  }
}

// Cleanup mismatched items from the cart
async function cleanupCartItems(page, targetTitle, log) {
  log(`🗑️ Verifying cart items. Scanning for non-matching products to remove...`);
  try {
    const cartItems = await page.$$('a.bsc-cart-item-goods-title__content');
    let removedCount = 0;
    
    for (const item of cartItems) {
      const itemText = (await item.textContent() || '').trim();
      
      if (targetTitle && !itemText.includes(targetTitle)) {
         log(`🗑️ Found mismatching item in cart, deleting...`);
         
         const trashBtn = await item.$('.icon-delete, .del-btn, .j-delete-goods, svg[class*="trash"], [class*="delete"], button[aria-label*="delete" i]');
         if (trashBtn) {
           await trashBtn.click();
           await humanDelay(800, 1500);
           
           // Handle confirmation dialogue if Shein displays one
           const confirmBtn = await page.$('.j-ok, .S-button-primary, .bsc-button--primary, button:has-text("Yes"), button:has-text("Delete")');
           if (confirmBtn) {
             await confirmBtn.click();
             await humanDelay(1500, 2500);
           }
           removedCount++;
         } else {
           // Fallback to deselecting if trash icon isn't found
           const checkbox = await item.$('input[type="checkbox"], [class*="checkbox"]');
           if (checkbox) {
             const isChecked = await checkbox.isChecked().catch(()=>false);
             if (isChecked) await checkbox.click();
           }
         }
      }
    }
    if (removedCount === 0) log(`✅ Cart is clean, no other items detected.`);
  } catch (err) {
    log(`⚠️ Cart cleanup error: ${err.message}`);
  }
}

// Empties the entire cart by going to homepage and clicking cart icon
async function emptyEntireCart(page, log) {
  log(`🛒 Going to homepage to check cart...`);
  await navigateWithRetry(page, 'https://us.shein.com/', log);
  await humanDelay(2000, 4000);
  await dismissPromotionDialog(page, log);

  log(`🛒 Clicking Cart Icon...`);
  const cartIcon = page.locator('.header-right-dropdown-cart, .bsc-mini-cart__trigger, [class*="mini-cart"], a[href*="cart"]').first();
  await cartIcon.waitFor({ state: 'visible', timeout: 10000 }).catch(()=>{});
  
  // Also try direct URL if icon isn't clickable
  await cartIcon.click().catch(()=> navigateWithRetry(page, 'https://us.shein.com/cart', log));
  
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await humanDelay(2000, 3000);

  if (await hasCaptcha(page)) {
    throw new Error('CAPTCHA_BLOCK: Captcha appeared on Cart page');
  }

  let hasItems = true;
  let attempts = 0;
  while(hasItems && attempts < 10) {
    attempts++;
    await dismissPromotionDialog(page, log);
    const trashBtns = await page.$$('div.bsc-cart-item-main__delete');
    
    if (trashBtns.length === 0) {
      log(`✅ Cart is completely empty.`);
      break;
    }
    
    log(`🗑️ Found ${trashBtns.length} item(s). Deleting one...`);
    try {
      await trashBtns[0].click();
      await humanDelay(800, 1500);
      
      const confirmBtn = await page.$('button:has-text("Yes")');
      if (confirmBtn) {
        await confirmBtn.click();
        await humanDelay(2000, 3000);
      }
    } catch (e) {
      log(`⚠️ Failed to click delete, retrying...`);
    }
    await humanDelay(1500, 2500);
  }
}

// Set quantity for target item inside cart
async function setCartItemQuantity(page, qty, log) {
  if (!qty || qty <= 0) return;
  log(`🔢 Adjusting exact quantity in cart to: ${qty}`);
  try {
    const qtyInput = page.locator('.bsc-cart-item-goods-qty__input').first();
    await qtyInput.waitFor({ state: 'visible', timeout: 5000 });
    
    // Bỏ thuộc tính readonly (nếu có)
    await qtyInput.evaluate(node => node.removeAttribute('readonly')).catch(() => false);

    // Cách xóa cũ đã hoạt động ổn định: click 3 lần và Backspace
    await qtyInput.click({ clickCount: 3 });
    await qtyInput.press('Backspace');
    await humanDelay(200, 400);
    
    // Điền số chậm
    await qtyInput.pressSequentially(String(qty), { delay: 150 });
    await humanDelay(500, 1000);
    
    // Ấn Enter BẮT ĐÍCH DANH lúc Input đang Focus (để trigger Loading trên Web)
    await qtyInput.press('Enter');
    
    // Nhả focus bằng cách click ra chỗ trống
    await page.mouse.click(10, 10);
    
    log(`✅ Quantity set to ${qty}`);
    
    // Trễ cố định để chờ Loading UI trên web
    await humanDelay(4000, 5000); 
  } catch(err) {
    log(`⚠️ Could not modify cart quantity: ${err.message}`);
  }
}

async function verifyOrderDetails(page, product, log, profileLabel, productTitle) {
  log(`⏳ Waiting for Shein to process payment and show order details...`);
  try {
    const orderTable = page.locator('table.new-order-table').first();
    await orderTable.waitFor({ state: 'visible', timeout: 45000 });
    
    await humanDelay(1000, 2000);
    const orderText = (await orderTable.textContent() || '').toLowerCase();
    
    const missingFields = [];
    const { sku_code, color, size, quantity } = product;

    if (sku_code && !orderText.includes(String(sku_code).toLowerCase())) missingFields.push(`SKU: ${sku_code}`);
    if (color && !orderText.includes(String(color).toLowerCase())) missingFields.push(`Color: ${color}`);
    if (size && !orderText.includes(String(size).toLowerCase())) missingFields.push(`Size: ${size}`);
    if (quantity && !orderText.includes(String(quantity).toLowerCase())) missingFields.push(`Quantity: ${quantity}`);
    
    if (missingFields.length > 0) {
      throw new Error(`Mismatch in Order Table - Missing: ${missingFields.join(', ')}`);
    }
    
    await takeStructuredScreenshot(page, 'order_verified_success', profileLabel, productTitle);
    log(`✅ Order verified successfully (SKU, Size, Color, Qty matched)`);
  } catch (err) {
    log(`⚠️ Order verification failed: ${err.message}`);
    await takeStructuredScreenshot(page, 'order_verified_failed', profileLabel, productTitle);
    throw new Error(`Order verification failed: ${err.message}`);
  }
}

async function navigateToProductBySku(page, sku_code, log) {
  const searchUrl = `https://us.shein.com/pdsearch/${sku_code}/`;
  log(`🔍 Searching product by SKU: ${sku_code} (${searchUrl})`);
  await navigateWithRetry(page, searchUrl, log);
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await humanDelay(1500, 3000);
  
  const noResults = await page.evaluate(() => {
    return document.body.innerText.includes("We couldn't find any results");
  }).catch(() => false);

  if (noResults) {
    throw new Error(`Product matching SKU [${sku_code}] not found (Empty Search).`);
  }

  log(`🎯 Target product card found. Extracting details link...`);
  const firstProductDiv = page.locator('div.j-expose__product-item').first();
  await firstProductDiv.waitFor({ state: 'visible', timeout: 15000 });
  
  const productLink = firstProductDiv.locator('a').first();
  const targetHref = await productLink.getAttribute('href');
  if (!targetHref) throw new Error("Could not extract product link from search results.");
  
  const productDetailUrl = targetHref.startsWith('http') ? targetHref : 'https://us.shein.com' + targetHref;
  log(`🛍️ Opening product details page: ${productDetailUrl}`);
  
  await navigateWithRetry(page, productDetailUrl, log);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

// Main automation: run one product purchase for one profile
async function runPurchase({ browserURL, product, folderId, profileId, profileLabel, log }) {
  const { product_url, color, size, quantity, shipping_address, sku_code } = product;
  
  if (!sku_code) {
    log(`❌ Error: SKU code is missing for this input. Please update the Excel file.`);
    return { success: false, error: 'SKU code is missing.' };
  }

  const addr = parseShippingAddress(shipping_address);

  log(`🌐 Connecting to Multilogin profile browser...`);
  const browser = await chromium.connectOverCDP(browserURL, { timeout: 15000 });
  const context = browser.contexts()[0];
  const page = await context.newPage();

  try {
    // Step 0: Clear Entire Cart to prevent leftovers from failed loops
    await emptyEntireCart(page, log);

    // Step 1: Navigate to product via SKU Search
    await navigateToProductBySku(page, sku_code, log);

    // Step 2: Extract Target Product Title
    const productTitle = await getProductTitle(page, log);

    // Step 3: Select variant
    if (color) await selectColor(page, color, log);
    await humanDelay(600, 1200);
    if (size) await selectSize(page, size, log);
    await humanDelay(600, 1200);
    await takeStructuredScreenshot(page, 'variant_selected', profileLabel, productTitle);

    // Step 4: Add to Cart (Directly)
    log(`🛒 Clicking Add to Cart...`);
    await dismissPromotionDialog(page, log);
    const addToCartBtn = page.locator('button:has-text("Add to Bag"), button:has-text("Add to Cart"), .add-to-cart, [class*="add-btn"]').first();
    await addToCartBtn.waitFor({ timeout: 10000 });
    await addToCartBtn.click();
    await humanDelay(1500, 3000);
    await takeStructuredScreenshot(page, 'cart_added', profileLabel, productTitle);

    log(`✅ Added to cart, navigating to Cart page...`);

    // Step 5: Go to Cart via header icon
    await dismissPromotionDialog(page, log);
    const cartIcon = page.locator('.bsc-mini-cart__trigger, [class*="mini-cart"], a[href*="cart"]').first();
    await cartIcon.waitFor({ timeout: 10000 });
    await cartIcon.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await humanDelay(2000, 4000);

    if (await hasCaptcha(page)) {
      throw new Error('CAPTCHA_BLOCK: Captcha appeared on navigating to Cart');
    }

    // Step 6: Cleanup Cart & Set Quantity
    await cleanupCartItems(page, productTitle, log);
    await setCartItemQuantity(page, quantity, log);
    await takeStructuredScreenshot(page, 'cart_verified', profileLabel, productTitle);

    // Step 7: Proceed to Checkout from Cart
    log(`📲 Clicking Checkout in Cart...`);
    await dismissPromotionDialog(page, log);
    const checkoutBtnCart = page.locator('.j-cart-check').first();
    await checkoutBtnCart.waitFor({ timeout: 10000 });
    await checkoutBtnCart.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await humanDelay(3000, 5000);

    if (await hasCaptcha(page)) {
      throw new Error('CAPTCHA_BLOCK: Captcha on checkout page');
    }

    // Step 8: Handle shipping address
    log(`📦 Managing shipping address for: ${addr.firstName} ${addr.lastName}`);
    await handleShippingAddress(page, addr, log, productTitle, profileLabel);

    // Step 9: Final Place Order (on Checkout Page)
    log(`🎯 Placing order...`);
    await dismissPromotionDialog(page, log);
    const placeOrderBtn = page.locator('button:has-text("Place Order"), button:has-text("Continue"), [class*="place-order"]').first();
    await placeOrderBtn.waitFor({ timeout: 15000 });
    await placeOrderBtn.click();
    
    await verifyOrderDetails(page, product, log, profileLabel, productTitle);
    return { success: true };

  } catch (err) {
    log(`❌ Error: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// Shipping address handler
async function handleShippingAddress(page, addr, log, productTitle, profileLabel) {
  log(`📝 [Address] Editing address for: ${addr.firstName} ${addr.lastName}`);
  try {
    // 1. Locate and click Edit Address button with Retry Mechanism
    const editBtn = page.locator('button.main-address-right').first();
    await editBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    
    let dialogAppeared = false;
    const dialogSelector = 'div.sui-business-address';
    
    for (let attempts = 0; attempts < 5; attempts++) {
      if (attempts > 0) {
        log(`🔄 Address dialog not detected. Retrying click... (${attempts}/5)`);
        await humanDelay(4000, 6000); // Wait 2s before retrying
      }
      
      try {
        await dismissPromotionDialog(page, log);
        await editBtn.click({ timeout: 5000 });
      } catch (err) {
        log(`⚠️ Could not click edit button: ${err.message}`);
      }
      
      try {
        // Wait max 1 second for the dialog to show up
        const dialog = page.locator(dialogSelector).first();
        await dialog.waitFor({ state: 'visible', timeout: 1000 });
        dialogAppeared = true;
        log(`✅ Address modal appeared successfully.`);
        break; 
      } catch (e) {
        // Timed out, loop will restart
      }
    }
    
    if (!dialogAppeared) {
      await takeStructuredScreenshot(page, 'edit_modal_failed', profileLabel, productTitle);
      throw new Error(`Address dialog (${dialogSelector}) did not appear after 5 retries.`);
    }

    await humanDelay(1000, 1500);

    // 2. Fill First and Last Name
    const firstNameHandle = await page.waitForFunction(() => {
      const spans = Array.from(document.querySelectorAll('span'));
      for (const span of spans) {
        // Use trim() to remove weird whitespace, check start
        const txt = span.textContent.trim();
        if (txt.startsWith('First Name') || txt.startsWith('First')) {
          // Bỏ chữ :not([readonly]) đi vì Shein cố tình cài attribute readonly vào toàn bộ form
          const input = span.parentElement.querySelector('input');
          if (input) {
            const rect = input.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return input;
          }
        }
      }
      return null;
    }, { timeout: 15000 }).catch(async () => {
      await takeStructuredScreenshot(page, 'firstname_js_not_found', profileLabel, productTitle);
      throw new Error("First Name input not found via JS querySelector. Check console for HTML dump.");
    });
    
    // TIÊU DIỆT SỰC CẢN TRỞ READONLY CỦA SHEIN:
    // Cưỡng chế xoá thuộc tính readonly bằng Raw JS rồi mới gõ
    await firstNameHandle.evaluate(node => node.removeAttribute('readonly'));
    await dismissPromotionDialog(page, log);
    await firstNameHandle.focus();
    await firstNameHandle.fill(addr.firstName);
    await humanDelay(300, 600);
    
    const lastNameInput = page.locator('span:visible:has-text("Last Name") + input, span:visible:has-text("Last") + input').first();
    await lastNameInput.evaluate(node => node.removeAttribute('readonly')).catch(()=>false);
    await dismissPromotionDialog(page, log);
    await lastNameInput.fill(addr.lastName);
    await humanDelay(300, 600);
    
    const phoneInput = page.locator('span:visible:has-text("Phone Number") + input, span:visible:has-text("Phone") + input').first();
    await phoneInput.evaluate(node => node.removeAttribute('readonly')).catch(()=>false);
    await dismissPromotionDialog(page, log);
    await phoneInput.fill(addr.phone);
    await humanDelay(300, 600);
    // 3. Search Address Input
    const searchInput = page.locator('input.addr-search-content__core:visible').first();
    await searchInput.evaluate(node => node.removeAttribute('readonly')).catch(()=>false);
    const query = `${addr.detailedAddress} ${addr.zip}`;
    log(`🔍 Searching address dropdown for: ${query}`);
    await dismissPromotionDialog(page, log);
    await searchInput.fill(query);
    await humanDelay(1500, 2500);
    
    // 4. Dropdown Selection: wait for the visible ul that contains list items, select first item
    const firstResult = page.locator('ul.search-result__container#associate-listbox:visible > li').first();
    await firstResult.waitFor({ state: 'visible', timeout: 10000 }).catch(async () => {
      await takeStructuredScreenshot(page, 'address_dropdown_timeout', profileLabel, productTitle);
      throw new Error("Address suggestions dropdown did not appear.");
    });
    const hasOptions = await firstResult.isVisible().catch(() => false);
    if (hasOptions) {
      log(`☑️ Selected first address suggestion`);
      await dismissPromotionDialog(page, log);
      await firstResult.click();
      await humanDelay(1000, 2000);
    } else {
      log(`⚠️ No auto-complete options appeared for address search.`);
    }

    // 5. Explicit Street Address Override
    const streetInput = page.locator('.sui-textarea-title:has(span:has-text("Street address")) textarea').first();
    await streetInput.evaluate(node => node.removeAttribute('readonly')).catch(()=>false);
    await dismissPromotionDialog(page, log);
    await streetInput.click({ clickCount: 3 }); // highlight to delete
    await page.keyboard.press('Backspace');
    await humanDelay(500, 1000);
    await dismissPromotionDialog(page, log);
    await streetInput.fill(addr.detailedAddress);
    await humanDelay(500, 1000);

    // 6. Save the Form
    const saveBtn = page.locator('button.save:visible').first();
    await dismissPromotionDialog(page, log);
    await saveBtn.click();
    await humanDelay(2000, 4000);
    
    await takeStructuredScreenshot(page, 'address_filled', profileLabel, productTitle);
    log(`✅ Specific address details configured and saved.`);
  } catch (err) {
    log(`⚠️ Error in handleShippingAddress: ${err.message}`);
    await takeStructuredScreenshot(page, 'address_error_fallback', profileLabel, productTitle);
    // Not throwing here in case address edit wasn't strictly mandatory or it already existed.
  }
}

module.exports = { runPurchase };
