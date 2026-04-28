# Phân tích và Kế hoạch cập nhật API (Tool-Buy-Shein)

Mục tiêu là cập nhật lại toàn bộ luồng gọi API đến `https://sla.tooltik.app/inforShein/checkout-status` để đồng bộ đúng trạng thái `pending`, `inProgress`, và `fail` kèm thông tin định danh của profile (sử dụng trường `email` trên API).

## Proposed Changes

---

### 1. Phía Server & Backend (`server.js`)

**File: `server.js`**
- **Sửa API fetch ban đầu:** Ở hàm proxy cho trang Dashboard (`app.get('/api/shein-tasks')`), thay vì gọi `/inProgress?limit=...`, ta sẽ đổi thành chuẩn API mới là lấy các đơn đang chờ:  
  `https://sla.tooltik.app/inforShein/checkout-status/pending?limit=${limit}`

---

### 2. Core Queue & Logic (`src/workers/batch-runner.js`)

Cập nhật lại logic chạy batch để tool bắn API realtime tương ứng với vòng đời (lifecycle) của từng đơn hàng.

- **Helper Function `updateApiOrderStatus`:** Xây dựng một hàm gọi API có khả năng nhận array `products` và filter duy nhất các `orderId` khác nhau, sau đó loop qua và bắn request `PATCH /inforShein/checkout-status/:orderId` (sử dụng đầu api full data update để bypass check transition layer).  
  *Payload:* Gửi bao gồm `{ checkoutStatus: status, email: profileLabel, ...extraDetail }`  
  *(Lưu ý: Theo yêu cầu, ta sẽ mapping "tên của profile" vào trong trường `email` của payload để backend nhận diện).*

- **Trạng thái `inProgress`:** 
  Ngay trong scope chạy của vòng lặp `for (const t of groupTasks)`, **trước khi** `await runPurchase(…)` để mở automation, ta sẽ gọi helper func trên để set toàn bộ Order có trong `t.products` sang trạng thái `inProgress`.

- **Trạng thái `ordered`:**
  Logic đã có sẵn ở block `result.success === 'full' || result.success === 'partial'`. Ta chỉ cần thêm key `email: profile.label` vào payload lúc PATCH là xong.

- **Trạng thái `fail`:**
  - **Khi Partial mua được một phần:** Lọc ra những `sku` nằm trong danh sách rớt mạng (`result.failed_skus`), rồi mapping ngược lại để tìm `orderId` tương ứng. Gửi PATCH sang trạng thái `fail` cho những đơn thất bại.
  - **Khi Fatal Error/Lỗi tổng (Vào `else` không phải Captcha, hoặc rơi xuống block `catch`):** Gọi helper func gửi PATCH `fail` cho toàn bộ array `t.products`.
  - **Lỗi từ lúc chưa kịp chạy / Fail Remaining (vd: Folder ID empty):** Gọi PATCH `fail` bằng hàm helper.

- **Dính Block Captcha (Shift sang Profile khác):** Đối với logic cắt và chuyển task (`shiftTasksToNextProfile`), ta **KHÔNG CẦN** bắn reset status về lại `pending`. Task chỉ đơn giản là sang queue mới, khi tới lượt profile đó chạy thì code sẽ tự động bắn `inProgress` đè lên lần nữa (API PATCH by id không block vụ này).
  - *Riêng trường hợp hết profile sạch sẽ không thể cứu:* Lúc này hàm shift profile fail, ta sẽ PATCH toàn bộ các đơn tồn đọng sang trạng thái `fail`.

---

### 3. Phía Frontend (`public/index.html`)

**File: `public/index.html`**
- Cập nhật Label ở thanh Select Dropdown Mode (dòng ~111):  
  Đổi từ `🌐 API (inProgress)` sang `🌐 API (pending)`.
- Cập nhật text mô tả ở section API Orders (dòng ~130):  
  Đổi từ _"Fetch các đơn hàng trạng thái `inProgress`"_ sang _"Fetch các đơn hàng trạng thái `pending`"_.

## Verification Plan
1. Reset lại database đơn trên CMS / API của ToolTik.
2. Thêm đơn và set tick Tool để các đơn nằm ở `pending`.
3. Nhấn "Kéo Data Từ API", kiểm tra xem tool có load về đúng đơn `pending` không.
4. Nhấn Start Batch:
   - Tool chuẩn bị chạy -> Bắn API check `inProgress`, check field `email` chứa (Ví dụ: "Profile-1").
   - Tool báo mua xong -> Bắn API check `ordered`.
   - Cố tình nhập sai pass hoặc huỷ trang -> Gây lỗi -> Tool gọi báo API `fail`.
