# SHEIN Auto Buy Tool – Technical Summary (MVP)

## 1. Mục tiêu

Xây dựng tool tự động mua hàng trên SHEIN:

* Input: file Excel chứa danh sách sản phẩm
* Mỗi sản phẩm gồm:

  * Link sản phẩm
  * Color (text)
  * Size (text)
* Có nhiều account (đã login sẵn trong Multilogin)
* Tool sẽ:

  * Mở từng account
  * Vào sản phẩm
  * Chọn đúng variant
  * Add to cart
  * (Optional) Place order

---

## 2. Kiến trúc tổng thể

### Stack

* NodeJS
* Playwright
* Multilogin (anti-detect browser)

---

### Flow chính

```
Excel → Script → Multilogin API → Playwright → SHEIN
```

---

### Flow chi tiết

```
FOR mỗi account:
    Start profile (Multilogin API)
    Connect Playwright (CDP)

    FOR mỗi sản phẩm:
        Open product page
        Handle captcha
        Select variant (color + size)
        Add to cart
        Log result

    Stop profile
```

---

## 3. Multi-account strategy

### Không làm:

* Không chạy 40 account cùng lúc

### Nên làm:

* Batch: 5–10 account concurrent
* Queue xử lý

---

## 4. CAPTCHA handling

### Không dùng:

* API solve captcha
* Reverse engineering captcha

### Cách đơn giản (MVP):

```
IF detect captcha:
    reload page 1–3 lần
    IF vẫn còn:
        skip sản phẩm
```

---

## 5. Vấn đề chính: chọn đúng variant

### ❌ Sai hướng

1. Dùng UI selector cố định → không ổn định
2. Dùng SKU → không đúng bản chất SHEIN

---

## 6. Insight quan trọng

* SKU KHÔNG phải là variant đầy đủ
* Variant = tổ hợp:

  * Color
  * Size
  * (có thể thêm attribute khác)

---

## 7. Giải pháp đúng: Attribute Mapping

### Mục tiêu:

```
"Black, L" (Excel)
→ colorId + sizeId (trong page)
→ click đúng option
```

---

## 8. Lấy dữ liệu từ page

### Source:

```js
window.gbRawData
```

hoặc:

```js
window.__INITIAL_STATE__
```

---

### Structure quan trọng:

```json
{
  "productIntroData": {
    "attrList": [
      {
        "attr_name": "Color",
        "attr_value_list": [
          {
            "attr_value_name": "Black",
            "attr_value_id": "123"
          }
        ]
      },
      {
        "attr_name": "Size",
        "attr_value_list": [
          {
            "attr_value_name": "L",
            "attr_value_id": "456"
          }
        ]
      }
    ]
  }
}
```

---

## 9. Mapping logic

### Normalize text

```js
const normalize = (s) => s.trim().toLowerCase();
```

---

### Find attr_id

```js
function findAttrId(attrs, type, target) {
  const attr = attrs.find(a =>
    a.attr_name.toLowerCase().includes(type)
  );

  const value = attr?.attr_value_list.find(v =>
    v.attr_value_name.toLowerCase().includes(target)
  );

  return value?.attr_value_id;
}
```

---

## 10. Select variant

```js
await page.locator(`[data-attr-id="${colorId}"]`).click();
await page.locator(`[data-attr-id="${sizeId}"]`).click();
```

---

## 11. Check availability (optional nhưng nên có)

### Data dạng:

```json
{
  "sku_sale_attr": [
    {
      "attr_value_path": "123_456",
      "stock": 10
    }
  ]
}
```

---

### Check:

```js
const path = `${colorId}_${sizeId}`;

const available = skuList.find(s =>
  s.attr_value_path === path && s.stock > 0
);

if (!available) {
  throw new Error("Out of stock");
}
```

---

## 12. Add to cart flow

```js
await page.goto(link);

await handleCaptcha(page);

const attrs = await getAttrs(page);

const colorId = findAttrId(attrs, "color", color);
const sizeId = findAttrId(attrs, "size", size);

await selectVariant(page, colorId, sizeId);

await page.click("text=Add to Cart");
```

---

## 13. Logging (bắt buộc)

| account | product | color | size | status | step | error |
| ------- | ------- | ----- | ---- | ------ | ---- | ----- |

---

## 14. Stability rules

* Luôn:

  * waitForSelector
  * retry nhẹ
  * log lỗi

* Không:

  * hardcode class
  * click quá nhanh

---

## 15. MVP Scope

### Bắt buộc:

* 1 account chạy ổn
* Select đúng variant
* Add to cart
* Handle captcha

### Chưa cần:

* Payment full auto
* API reverse
* Distributed system

---

## 16. Nâng cấp sau

* Retry queue
* Proxy per account
* Dashboard tracking
* Auto checkout

---

## 17. Kết luận

* Không dùng SKU → không reliable
* Dùng attr_id mapping → ổn định nhất
* Multilogin + Playwright → đúng hướng
* CAPTCHA → retry, không cần solve

---

## 18. Next step

* Implement:

  * getAttrs()
  * findAttrId()
  * selectVariant()

* Test với 1 account

* Sau đó scale multi-account
