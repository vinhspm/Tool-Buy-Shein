const { chromium } = require('playwright');
const { parseShippingAddress } = require('../utils/address-parser');
const path = require('path');
const fs = require('fs');

const { takeStructuredScreenshot } = require('../utils/screenshot-manager');
const { detectCaptcha, solveGeetestV4 } = require('../utils/captcha-solver');

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

// Mở một trình theo dõi ngầm (Background Watcher) cho Promotion Dialogs
async function startPromoWatcher(page, log) {
  if (page.promoWatcherStarted) return;
  page.promoWatcherStarted = true;

  if (log) log('🛡️ Khởi động luồng ngầm tự động chặn Promotion Popups...');
  // Chạy độc lập không chặn luồng chính
  (async () => {
    while (!page.isClosed()) {
      try {
        const dialogSelector = '.sui-dialog.checkout-retain-dialog-wrapper, .checkout-retain-dialog__wrap';
        const hasPromo = await page.evaluate((sel) => {
          const text = document.body.innerText;
          const hasDialog = document.querySelector(sel) !== null;
          return hasDialog ||
            text.includes('Promotion Savings') ||
            text.includes('Are you sure you want to leave') ||
            text.includes('Leave Now') ||
            text.includes('Got it') ||
            text.includes('CONTINUE CHECKING OUT');
        }, dialogSelector).catch(() => false);

        if (hasPromo) {
          const dialogLocator = page.locator(dialogSelector).first();
          const isDialogVisible = await dialogLocator.isVisible().catch(() => false);

          if (isDialogVisible) {
            if (log) log(`🛑 [Background] Promotion popup detected! Attempting dismiss...`);
            await dialogLocator.focus().catch(() => { });

            // Bấm nút X nếu có
            const buttonClose = page.locator('button.sui-dialog__closebtn').first();
            if (await buttonClose.isVisible().catch(() => false)) {
              await buttonClose.click().catch(() => { });
            }

            await new Promise(r => setTimeout(r, 1000));

            // Chiến thuật thoát thủ công: click góc ngoài rồi gõ Escape
            await page.mouse.click(10, 10);
            await new Promise(r => setTimeout(r, 300));
            await page.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 600));

            // Backup: Force display none
            if (await dialogLocator.isVisible().catch(() => false)) {
              if (log) log(`🛑 [Background] Popup stubborn. Force CSS display:none !`);
              await dialogLocator.evaluate(node => node.style.setProperty('display', 'none', 'important')).catch(() => { });
            }
          }
        }
      } catch (e) {
        if (page.isClosed()) return;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  })();
}



// Navigate and solve captcha immediately if found (Fail-fast instead of loop)
async function navigateWithRetry(page, url, log) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay(1500, 3000);


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
        await humanDelay(3000, 5000);
        return true;
      }
    }

    // Fallback: search by text content
    await page.locator(`[class*="color-item"]:has-text("${colorName}")`).first().click({ timeout: 5000 });
    await humanDelay(3000, 5000);
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
      const text = ((await opt.textContent()) || '').trim().toLowerCase();

      if (attrName === normalized || text === normalized) {
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
async function cleanupCartItemsBatch(page, addedProducts, log) {
  log(`🗑️ Verifying cart items. Scanning for non-matching products to remove...`);
  if (!addedProducts || addedProducts.length === 0) return;
  try {
    // Collect specific product identifiers
    const titleElements = await page.$$('a.bsc-cart-item-goods-title__content');
    let removedCount = 0;

    // Reverse iterate handles DOM shifting when deleting items
    for (let i = titleElements.length - 1; i >= 0; i--) {
      const itemText = (await titleElements[i].textContent() || '').trim();

      // Navigate up to container to locate its variation text
      const containerHandle = await titleElements[i].evaluateHandle(el => el.closest('div.bsc-cart-item, li[class*="cart-item"], div[class*="cart-item-main"]') || el.parentElement.parentElement);

      const containerText = (await containerHandle.evaluate(el => el.innerText) || '').toLowerCase();

      // Is this cart item one of the targets we just added?
      const isMatch = addedProducts.some(ap => {
        const tMatch = itemText.includes(ap.title);
        const cMatch = ap.product.color ? containerText.includes(String(ap.product.color).toLowerCase()) : true;
        // TODO: Placeholder selector to refine size text search if innerText fails
        const sMatch = ap.product.size ? containerText.includes(String(ap.product.size).toLowerCase()) : true;
        return tMatch && cMatch && sMatch;
      });

      if (!isMatch) {
        log(`🗑️ Found mismatching item in cart, deleting...`);

        const trashBtn = await containerHandle.$('.icon-delete, .del-btn, .j-delete-goods, svg[class*="trash"], [class*="delete"], button[aria-label*="delete" i]');
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
          const checkbox = await containerHandle.$('input[type="checkbox"], [class*="checkbox"]');
          if (checkbox) {
            const isChecked = await checkbox.isChecked().catch(() => false);
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

  log(`🛒 Clicking Cart Icon...`);
  const cartIcon = page.locator('.header-right-dropdown-cart, .bsc-mini-cart__trigger, [class*="mini-cart"], a[href*="cart"]').first();
  await cartIcon.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

  // Also try direct URL if icon isn't clickable
  await cartIcon.click().catch(() => navigateWithRetry(page, 'https://us.shein.com/cart', log));

  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
  await humanDelay(2000, 3000);



  let hasItems = true;
  let attempts = 0;
  while (hasItems && attempts < 10) {
    attempts++;
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

// Set quantity for target items inside cart
async function setCartItemQuantityBatch(page, addedProducts, log) {
  log(`🔢 Adjusting exact quantity in cart for ${addedProducts.length} added products`);
  try {
    const titleElements = await page.$$('a.bsc-cart-item-goods-title__content');

    for (const ap of addedProducts) {
      const qty = ap.product.quantity;
      if (!qty || qty <= 0) continue;

      let targetContainer = null;
      for (const titleEl of titleElements) {
        const itemText = (await titleEl.textContent() || '').trim();
        const containerHandle = await titleEl.evaluateHandle(el => el.closest('div.bsc-cart-item-main__wrap'));
        const containerText = (await containerHandle.evaluate(el => el.innerText) || '').toLowerCase();

        const tMatch = itemText.includes(ap.title);
        const cMatch = ap.product.color ? containerText.includes(String(ap.product.color).toLowerCase()) : true;
        // TODO: Placeholder selector to refine size text search if innerText fails
        const sMatch = ap.product.size ? containerText.includes(String(ap.product.size).toLowerCase()) : true;

        if (tMatch && cMatch && sMatch) {
          targetContainer = containerHandle;
          break;
        }
      }

      if (!targetContainer) {
        log(`⚠️ Could not find exact cart item matching ${ap.product.sku_code} | ${ap.product.color} | ${ap.product.size} for quantity update`);
        continue;
      }

      const qtyInput = await targetContainer.$('.bsc-cart-item-goods-qty__input');
      if (!qtyInput) {
        log(`⚠️ Could not find input element for item ${ap.product.sku_code}`);
        continue;
      }

      // Bỏ thuộc tính readonly (nếu có)
      await qtyInput.evaluate(node => node.removeAttribute('readonly')).catch(() => false);

      // Cách xóa cũ đã hoạt động ổn định: click 3 lần và Backspace
      await qtyInput.click({ clickCount: 3 });
      await qtyInput.press('Backspace');
      await humanDelay(200, 400);

      // Điền số chậm
      await qtyInput.fill(String(qty));
      await humanDelay(500, 1000);

      // Ấn Enter BẮT ĐÍCH DANH lúc Input đang Focus (để trigger Loading trên Web)
      await qtyInput.press('Enter');

      // Nhả focus bằng cách click ra chỗ trống
      await page.mouse.click(10, 10);

      log(`✅ Quantity set to ${qty} for ${ap.product.sku_code}`);

      // Trễ cố định để chờ Loading UI trên web
      await humanDelay(3500, 4500);
    }
  } catch (err) {
    log(`⚠️ Could not modify multiple cart quantity: ${err.message}`);
  }
}

async function verifyOrderDetailsBatch(page, addedProducts, failedSkusAtAdd, log, profileLabel) {
  log(`⏳ Waiting for Shein to process payment and show order details...`);
  try {
    const orderTable = page.locator('table.new-order-table').first();
    const paymentSuccess = page.locator('text="Payment Successful"').first();

    // Sử dụng locator.or() để chờ 1 trong 2 màn hình một cách an toàn
    try {
      await orderTable.or(paymentSuccess).waitFor({ state: 'visible', timeout: 45000 });
    } catch (e) {
      // Có thể timeout nếu trang load chậm, kệ để chờ bảng Order Table sẽ bắt lỗi bên dưới
    }

    if (await paymentSuccess.isVisible()) {
      log(`✅ Detected "Payment Successful" screen!`);
      await takeStructuredScreenshot(page, 'payment_successful', profileLabel, addedProducts[0]?.title || 'batch');

      const viewOrderBtn = page.locator('button.pay-result-content__jump').first();
      await viewOrderBtn.waitFor({ state: 'visible', timeout: 10000 });
      await viewOrderBtn.click().catch(() => { });
      log(`🔄 Clicked "View My Order", waiting for order details table...`);
      await humanDelay(2000, 3000);
    }

    await orderTable.waitFor({ state: 'visible', timeout: 30000 });

    await humanDelay(1000, 2000);
    const orderText = (await orderTable.textContent() || '').toLowerCase();

    const successful_skus = [];
    const failed_skus = [...failedSkusAtAdd];

    for (const ap of addedProducts) {
      let missingFields = [];
      const { sku_code, color, size, quantity } = ap.product;

      if (sku_code && !orderText.includes(String(sku_code).toLowerCase())) missingFields.push(`SKU: ${sku_code}`);
      // if (color && !orderText.includes(String(color).toLowerCase())) missingFields.push(`Color: ${color}`);
      if (size && !orderText.includes(String(size).toLowerCase())) missingFields.push(`Size: ${size}`);
      if (quantity && !orderText.includes(String(quantity).toLowerCase())) missingFields.push(`Quantity: ${quantity}`);

      if (missingFields.length > 0) {
        log(`⚠️ SKU ${sku_code} Mismatch in Order Table - Missing: ${missingFields.join(', ')}`);
        failed_skus.push(sku_code);
      } else {
        successful_skus.push(sku_code);
      }
    }

    let orderIdShein = "";
    try {
      const billNoEl = page.locator('div.order-info-billno h4').first();
      if (await billNoEl.isVisible({ timeout: 3000 })) {
        orderIdShein = await billNoEl.textContent();
        orderIdShein = orderIdShein ? orderIdShein.replace(/Order\s*No\.?\s*:/i, '').trim() : "";
      }
    } catch (e) { }

    await takeStructuredScreenshot(page, 'order_verified_result', profileLabel, addedProducts[0]?.title || 'batch');
    return { successful_skus, failed_skus, orderIdShein };

  } catch (err) {
    log(`⚠️ Order verification failed: ${err.message}`);
    await takeStructuredScreenshot(page, 'order_verified_failed', profileLabel, 'batch');
    throw new Error(`Order verification failed: ${err.message}`);
  }
}

async function navigateToProductBySku(page, sku_code, log) {
  const searchUrl = `https://us.shein.com/pdsearch/${sku_code}/`;
  log(`🔍 Searching product by SKU: ${sku_code} (${searchUrl})`);
  await navigateWithRetry(page, searchUrl, log);
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
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
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
}

// Main automation: run product batch purchase for one profile
async function runPurchase({ browserURL, products, folderId, profileId, profileLabel, log }) {
  if (!products || products.length === 0) {
    return { success: 'failed', error: 'No products provided for this batch.' };
  }

  // Use the address from the first product, as grouping guaranteed they are the same
  const addr = parseShippingAddress(products[0].shipping_address);

  log(`🌐 Connecting to Multilogin profile browser for batch sequence...`);
  const browser = await chromium.connectOverCDP(browserURL, { timeout: 15000 });
  const context = browser.contexts()[0];
  const page = await context.newPage();

  // Khởi động luồng ngầm kiểm tra Captcha vô hạn
  detectCaptcha(page, log).catch(() => { });
  startPromoWatcher(page, log).catch(() => { });

  let globalProductTitle = 'batch';
  const addedProducts = [];
  const failedSkusAtAdd = [];

  try {
    // Step 0: Clear Entire Cart to prevent leftovers from failed loops
    await emptyEntireCart(page, log);

    // Step 1 - 4: Loop through products to add them to cart
    for (const product of products) {
      const { color, size, quantity, sku_code } = product;
      if (!sku_code) {
        log(`❌ Error: SKU code is missing for an item. Skipping...`);
        failedSkusAtAdd.push('UNKNOWN');
        continue;
      }

      try {
        log(`🔄 Processing product: ${sku_code} | Color: ${color} | Size: ${size}`);
        await navigateToProductBySku(page, sku_code, log);
        const productTitle = await getProductTitle(page, log);
        globalProductTitle = productTitle || globalProductTitle; // last successful title for screenshots

        // if (color) await selectColor(page, color, log);
        await humanDelay(600, 1200);

        let sizeOut = false;
        if (size) {
          const sizeSelected = await selectSize(page, size, log);
          if (!sizeSelected) {
            log(`⚠️ Size/Item Sold Out or Error for ${sku_code}. Skipping this item...`);
            sizeOut = true;
          }
        }
        if (sizeOut) {
          failedSkusAtAdd.push(sku_code);
          continue;
        }

        await takeStructuredScreenshot(page, 'variant_selected', profileLabel, productTitle);

        log(`🛒 Clicking Add to Cart for ${sku_code}...`);
        const addToCartBtn = page.locator('button:has-text("Add to Bag"), button:has-text("Add to Cart"), .add-to-cart, [class*="add-btn"]').first();
        await addToCartBtn.waitFor({ timeout: 10000 });
        await addToCartBtn.click();
        await humanDelay(5000, 8000);
        await takeStructuredScreenshot(page, 'cart_added', profileLabel, productTitle);

        log(`✅ Added ${sku_code} to cart.`);
        addedProducts.push({ product, title: productTitle });

      } catch (err) {
        // Exception caught specifically for THIS item, so the batch can still continue
        if (err.message === 'CAPTCHA_BLOCKED') throw err; // critical abort
        log(`⚠️ Failed to add ${sku_code} to cart: ${err.message}. Skipping...`);
        failedSkusAtAdd.push(sku_code);
      }
    }

    if (addedProducts.length === 0) {
      log(`❌ No items were successfully added to cart. Aborting checkout.`);
      return { success: 'failed', error: 'All items failed or were sold out.', failed_skus: failedSkusAtAdd };
    }

    log(`✅ All valid items added to cart, navigating to Cart page...`);

    // Step 5: Go to Cart via header icon
    const cartIcon = page.locator('.bsc-mini-cart__trigger, [class*="mini-cart"], a[href*="cart"]').first();
    await cartIcon.waitFor({ state: 'visible', timeout: 10000 });
    await cartIcon.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    await humanDelay(2000, 4000);



    // Step 6: Cleanup Cart & Set Quantity Batch Mode
    await cleanupCartItemsBatch(page, addedProducts, log);
    await setCartItemQuantityBatch(page, addedProducts, log);
    await takeStructuredScreenshot(page, 'cart_verified', profileLabel, globalProductTitle);

    // Step 7: Proceed to Checkout from Cart
    log(`📲 Clicking Checkout in Cart...`);
    const checkoutBtnCart = page.locator('.j-cart-check').first();
    await checkoutBtnCart.waitFor({ state: 'visible', timeout: 10000 });
    await checkoutBtnCart.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
    await humanDelay(3000, 5000);



    // Step 8: Handle shipping address
    log(`📦 Managing batch shipping address for: ${addr.firstName} ${addr.lastName}`);
    await handleShippingAddress(page, addr, log, globalProductTitle, profileLabel);

    // Step 9: Final Place Order (on Checkout Page)
    log(`🎯 Placing order...`);

    log(`📊 Extracting order summary details...`);


    const detailOrderShein = {
      retailPrice: await extractPriceByLabel(page, "Retail Price"),
      shippingFee: await extractPriceByLabel(page, "Shipping Fee"),
      promotion_discount: await extractPriceByLabel(page, "Promotions"),
      tax: await extractPriceByLabel(page, "Sales Tax"),
      membership_discount: await extractPriceByLabel(page, "SHEIN CLUB Exclusive Discount"),
      wallet_credit_used: await extractPriceByLabel(page, "Wallet Credit")
    };

    let baseCost = await extractPriceByLabel(page, "Order Total") + detailOrderShein.wallet_credit_used;

    await humanDelay(3000, 5000);
    const placeOrderBtn = page.locator('button:has-text("Place Order"), button:has-text("Continue"), [class*="place-order"]').first();
    await placeOrderBtn.waitFor({ state: 'visible', timeout: 15000 });
    await placeOrderBtn.click();

    await humanDelay(3000, 5000);

    const { successful_skus, failed_skus, orderIdShein } = await verifyOrderDetailsBatch(page, addedProducts, failedSkusAtAdd, log, profileLabel);

    const orderData = { orderIdShein, detailOrderShein, baseCost };

    if (failed_skus.length === 0) {
      log(`✅ All products purchased successfully!`);
      return { success: 'full', successful_skus, failed_skus, ...orderData };
    } else if (successful_skus.length > 0) {
      log(`⚠️ Partial success: ${successful_skus.join(',')} successful, ${failed_skus.join(',')} failed.`);
      return { success: 'partial', successful_skus, failed_skus, ...orderData };
    } else {
      log(`❌ Batch failed completely during verification.`);
      return { success: 'failed', successful_skus, failed_skus, ...orderData };
    }

  } catch (err) {
    const errorMsg = (err.message === 'CAPTCHA_BLOCKED' || page.captchaBlocked) ? 'CAPTCHA_BLOCKED' : err.message;
    log(`❌ Batch Error: ${errorMsg}`);
    await takeStructuredScreenshot(page, 'batch_error', profileLabel, globalProductTitle);
    return { success: 'failed', error: errorMsg, failed_skus: failedSkusAtAdd };
  } finally {
    await page.close().catch(() => { });
  }
}
// Helper lấy giá trị số từ màn hình Order Summary dựa vào đoạn text mô tả bên trái
const extractPriceByLabel = async (page, labelText) => {
  try {
    const textValue = await page.evaluate((lText) => {
      const labels = Array.from(document.querySelectorAll('.checkout-price-detail__item-left-name'));
      const target = labels.find(el => el.textContent.toLowerCase().includes(lText.toLowerCase()));
      if (target) {
        const parent = target.closest('.checkout-price-detail__item-parent');
        if (parent) {
          const priceEl = parent.querySelector('.checkout-price-detail__item-price');
          // Có khả năng Order Total lại dùng class khác cho phần giá, dự phòng query thẻ span cuối
          if (priceEl) return priceEl.textContent;
          const anyLastSpan = parent.querySelector('span:last-child');
          if (anyLastSpan) return anyLastSpan.textContent;
        }
      }
      // Xử lý trực tiếp cho trường hợp Order Total với class do user cung cấp
      if (lText === "Order Total") {
        const totalSpan = document.querySelector('span.checkout-price-detail__total-amount-all.checkout-price-detail__total-amount-discount, span.checkout-price-detail__total-amount-all');
        if (totalSpan) return totalSpan.textContent;

        // Xử lý ngược tiếp nếu không tìm thấy (ít xảy ra)
        const totalLabels = Array.from(document.querySelectorAll('div, span'));
        const totalTarget = totalLabels.find(el => el.textContent.trim().toLowerCase() === "order total:");
        if (totalTarget && totalTarget.parentElement) {
          return totalTarget.parentElement.textContent.replace(totalTarget.textContent, '');
        }
      }
      return null;
    }, labelText);

    if (textValue) {
      if (textValue.toLowerCase().includes('free')) return 0;
      const match = textValue.match(/[\d.]+/);
      return match ? parseFloat(match[0]) : 0;
    }
  } catch (e) { }
  return 0;
};

// Shipping address handler
async function handleShippingAddress(page, addr, log, productTitle, profileLabel) {
  log(`📝 [Address] Editing address for: ${addr.firstName} ${addr.lastName}`);
  try {
    // 1. Locate and click Edit Address button with Retry Mechanism
    const editBtn = page.locator('button.main-address-right').first();
    await editBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

    let dialogAppeared = false;
    const dialogSelector = 'div.sui-business-address';

    for (let attempts = 0; attempts < 5; attempts++) {
      if (attempts > 0) {
        log(`🔄 Address dialog not detected. Retrying click... (${attempts}/5)`);
        await humanDelay(4000, 6000); // Wait 2s before retrying
      }

      try {
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
    await firstNameHandle.focus();
    await firstNameHandle.fill(addr.firstName);
    await humanDelay(300, 600);

    const lastNameInput = page.locator('span:visible:has-text("Last Name") + input, span:visible:has-text("Last") + input').first();
    await lastNameInput.evaluate(node => node.removeAttribute('readonly')).catch(() => false);
    await lastNameInput.fill(addr.lastName);
    await humanDelay(300, 600);

    const phoneInput = page.locator('span:visible:has-text("Phone Number") + input, span:visible:has-text("Phone") + input').first();
    await phoneInput.evaluate(node => node.removeAttribute('readonly')).catch(() => false);
    await phoneInput.fill(addr.phone);
    await humanDelay(300, 600);
    // 3. Search Address Input & Dropdown Loop
    const searchInput = page.locator('input.addr-search-content__core').first();
    await searchInput.evaluate(node => node.removeAttribute('readonly')).catch(() => false);

    let words = addr.detailedAddress.trim().split(/\s+/);
    let addressMatched = false;
    const firstResult = page.locator('ul.search-result__container#associate-listbox:visible > li').first();

    while (words.length > 0) {
      const query = `${words.join(' ')} ${addr.zip}`;
      log(`🔍 Searching address dropdown for: ${query}`);
      await page.mouse.click(10, 10);
      await searchInput.click({ clickCount: 3, delay: 100 });
      await page.keyboard.press('Backspace');
      await humanDelay(300, 600);
      await searchInput.fill(query);
      await humanDelay(1500, 2500);

      try {
        await firstResult.waitFor({ state: 'visible', timeout: 5000 });
        const hasOptions = await firstResult.isVisible().catch(() => false);

        if (hasOptions) {
          const optionText = (await firstResult.textContent() || '').toLowerCase();
          const zipCodeStr = (addr.zip || '').toString().toLowerCase();

          const matchesZip = optionText.includes(zipCodeStr);

          let matchingWordsCount = 0;
          for (const word of words) {
            if (optionText.includes(word.toLowerCase())) {
              matchingWordsCount++;
            }
          }

          const matchRatio = matchingWordsCount / words.length;
          if (matchesZip && matchRatio >= 0.6) {
            log(`☑️ Found good address suggestion (${Math.round(matchRatio * 100)}% match). Selecting it.`);
            await firstResult.click();
            await humanDelay(1000, 2000);
            addressMatched = true;
            break;
          } else {
            log(`⚠️ Option 1 mismatch (Zip: ${matchesZip}, Words Match: ${Math.round(matchRatio * 100)}%). Dropping last word and retrying...`);
          }
        }
      } catch (e) {
        log(`⚠️ Dropdown timeout for query: ${query}. Dropping last word and retrying...`);
      }

      // Drop the last word
      words.pop();
    }

    // 4. Fallback if loop finishes without finding a match
    if (!addressMatched) {
      log(`⚠️ All detailed address combinations failed. Trying state and city fallback...`);
      const fallbackQuery = `${addr.state} ${addr.city}`;
      await searchInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await humanDelay(300, 600);
      await searchInput.fill(fallbackQuery);
      await humanDelay(1500, 3000);

      try {
        await firstResult.waitFor({ state: 'visible', timeout: 8000 });
        const hasFallbackOptions = await firstResult.isVisible().catch(() => false);
        if (hasFallbackOptions) {
          log(`☑️ Selected first fallback address suggestion`);
          await firstResult.click();
          await humanDelay(1500, 2500);

          // Wait to see if dropdown is still visible (sub-options)
          const stillVisible = await page.locator('ul.search-result__container#associate-listbox:visible').isVisible().catch(() => false);
          if (stillVisible) {
            log(`☑️ Sub-options appeared. Clicking first option again.`);
            await firstResult.click();
            await humanDelay(1000, 2000);
          }
        }
      } catch (e) {
        log(`⚠️ State/City fallback also failed to show dropdown.`);
      }

      // Explicitly fill zip code since we used a generic location
      const zipcodeInput = page.locator('span:visible:has-text("ZIP Code") + input, span:visible:has-text("ZIP") + input, span:visible:has-text("Zip") + input').first();
      const zipAvailable = await zipcodeInput.isVisible().catch(() => false);
      if (zipAvailable) {
        log(`📝 Refilling ZIP code explicitly...`);
        await zipcodeInput.evaluate(node => node.removeAttribute('readonly')).catch(() => false);
        await zipcodeInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await zipcodeInput.fill(String(addr.zip));
        await humanDelay(300, 600);
      }
    }

    // 5. Explicit Street Address Override
    const streetInput = page.locator('.sui-textarea-title:has(span:has-text("Street address")) textarea').first();
    await streetInput.evaluate(node => node.removeAttribute('readonly')).catch(() => false);
    await streetInput.click({ clickCount: 3 }); // highlight to delete
    await page.keyboard.press('Backspace');
    await humanDelay(500, 1000);
    await streetInput.fill(addr.detailedAddress);
    await humanDelay(500, 1000);

    // 6. Save the Form
    const saveBtn = page.locator('button.save:visible').first();
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
