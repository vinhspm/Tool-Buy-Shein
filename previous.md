# Tài Liệu Tổng Hợp Dự Án Tool-Buy-Shein (Project Overview)

> Tài liệu này được Agent Explorer và Documentation-Writer tự động gen ra để tóm tắt các tính năng, luồng chạy, cấu trúc kiến trúc và các logic kỹ thuật quan trọng của hệ thống auto mua hàng Shein ở trạng thái hiện tại. Các Agent làm việc trên dự án có thể tham khảo file này để hiểu nhanh bối cảnh.

## 1. Giới thiệu chức năng chung
- **Tên dự án:** Tool-Buy-Shein
- **Mục đích:** Là một công cụ Auto Buy (Tự động hóa mua hàng) trên sàn thương mại điện tử **Shein** (thị trường Mỹ - `us.shein.com`).
- **Nền tảng & Công nghệ cốt lõi:**
  - **Backend:** Node.js, Express.js (HTTP REST API), Socket.io (truyền thông realtime log xuống Frontend).
  - **Automation:** **Playwright** kết nối CDP đến các browser profile được giả lập bởi **Multilogin X**.
  - **Tích hợp:** Multilogin X API nội bộ & public (đảm bảo account/profils có fingerprint sạch, không dính device ban từ Shein).

## 2. Cấu trúc Source Code

```text
d:\Dev\Tool-Buy-Shein\
├── server.js                  # Điểm khởi tạo Express backend, REST API (config, start/stop, mlx fetch) và WebSocket server.
├── package.json               # Các package: playwright, express, socket.io, axios, multer, xlsx...
├── previous.md                # (File này) Tài liệu overview chi tiết về project.
├── public/                    # Code tĩnh Web Frontend (Dashboard UI điều khiển)
│   ├── index.html
│   └── app.js                 # Javascript DOM xử lý thao tác user trên giao diện.
├── src/
│   ├── services/
│   │   ├── multilogin.js      # Module thao tác API gửi lên launcher Multilogin X (startProfile, forceStop, getAutomationToken).
│   │   └── shein-automation.js# Trái tim logic mua hàng Playwright (cart, checkout, anti-captcha, parse DOM).
│   ├── workers/
│   │   └── batch-runner.js    # Job queue, kiểm soát luồng chạy Concurrency (nhiều Profile cùng chạy), đảm bảo mỗi Profile chạy tuần tự từng sản phẩm.
│   └── utils/
│       ├── address-parser.js  # Parse dữ liệu chuỗi địa chỉ raw lấy ra firstName, lastName, zip...
│       ├── excel-parser.js    # Đọc list order đầu vào bằng file .xlsx do người dùng upload.
│       └── screenshot-manager.js # Quản lý chụp ảnh màn hình bằng Playwright để debug/trace log khi xảy ra lỗi.
└── uploads/                   # Nơi hứng các file Excel được submit.
```

## 3. Luồng hoạt động chính của Automation (Workflow)

1. **Khởi tạo dữ liệu (Setup):**
   - User trên Frontend sẽ cấu hình thông tin Multilogin (Email/Pass/Folder ID), lấy *Automation Token* lưu lại vào `config.json`.
   - Setup danh sách các `profile_id` (trình duyệt) sẽ sử dụng.
   - Upload file **Excel (.xlsx)** định nghĩa các thông tin Order: `color`, `size`, `quantity`, `shipping_address`, đặc biệt là `sku_code`, và `shop_code`.

2. **Cơ chế Run Batch (`batch-runner.js` & `server.js`):**
   - Sự phân bổ task diễn ra theo quy tắc giới hạn (Quota). Mặc định hệ thống sẽ cấu hình **Max Products / Profile**. Các batch (nhóm sản phẩm theo shop/số điện thoại) sẽ được rải dần vào Profile đầu tiên, khi Profile này đạt tới giới hạn số lượng sản phẩm cấu hình, hệ thống sẽ tự động gán các batch tiếp theo cho Profile thứ 2, thứ 3...
   - Tại một thời điểm, công cụ sẽ mở song song và giới hạn các profile chạy theo số `concurrency` đã set. Mỗi profile sẽ tuần tự giải quyết các batch mảng con của riêng nó được chia.

3. **Core Mua Hàng (`shein-automation.js`):**
   - Mở browser Playwright connect CDP lấy context Multilogin.
   - *Phase 1:* Đi vào trang chủ Shein và Clear sạch giỏ hàng hiện tại để tránh lưu rác từ lần chạy trước báo lỗi.
   - *Phase 2:* Tìm kiếm đích danh theo `sku_code` -> Mở ra trang chi tiết sản phẩm chuẩn.
   - *Phase 3:* Lọc thông minh (Select Variant) để click đúng `Color` và `Size` như Excel mô tả. Fallback linh hoạt giữa các Attribute Selector mới-cũ của Shein. Click nút **Add To Cart**.
   - *Phase 4 (Cart):* Vào giỏ hàng quét lại và xóa các sản phẩm không khớp tên (Mismatch cleanup). Điền số lượng (Quantity) mua bằng Raw JS / Bỏ Readonly attr + Send phím bấm. Bấm **Checkout**.
   - *Phase 5 (Checkout & Shipping):* Inject thông tin cá nhân. Do Shein đã thiết kế chặn auto-fill bằng thuộc tính `readonly`, tool áp dụng Raw JS `node.removeAttribute('readonly')` lên input Tên/Họ/Điện thoại rồi mới gõ. Search list địa chỉ thả xuống và Save Form. Bấm **Place Order**.
   - *Phase 6 (Verify):* Chờ load đến trang "Payment Successful" / thông tin Order Table rồi map lại với thông số Color/Size/Sku. Nếu chuẩn = Thành công.
   - Nếu gặp **Promotion Overlay (Ads)**: Tự động quét DOM text nhận diện click skip/escape.
   - Nếu dính **Captcha / Device Block Check**: Exception văng ra lỗi `CAPTCHA_BLOCKED`, batch runner lập tức bỏ qua toàn bộ danh sách sản phẩm còn lại của Profile đó, chuyển sang chạy Profile khác (Tiết kiệm thời gian bị block).

## 4. Các điểm kỹ thuật phức tạp (Technical Highlights / Issues Handled)
- **Thoát Captcha / Risk Check:** 
  - Tool luôn nhận diện trước element của màn hình check bot, ưu tiên fail-fast đóng trình duyệt cho profile đó thay vì treo cứng ở màn Captcha hình họa (Geetest V4).
- **Anti Anti-Bot DOM (Bypass `readonly` trap):**
  - Gần đây màn hình Shipping Address của Shein bọc màng `readonly` hoặc CSS pointer-events chặn gõ tự động (Playwright `.fill()` sẽ thất bại). Tool dùng `await input.evaluate(node => node.removeAttribute('readonly'))` triệt để bypass và kết hợp delay chuẩn `type` giả lập người thật.
- **Multilogin X API Flow (Token Workspace):**
  - Fix xử lý authentication (Lỗi 403 Permission): Quá trình call API đã được code tách biệt quy trình lấy token `refresh_token` qua `workspace_id` và lấy tiếp `permanent automation token` (expiration_period=no_exp).
- **Cart Synchronization:**
  - Logic chỉnh sửa Quantity bên trong module cart rất khó chịu khi DOM reload liên tục. Workflow cũ đã được đổi sang: focus Input Text -> nhấn xoá Backspace 3 lần -> gõ giá trị -> nhấn `Enter` thẳng trên field để trigger API Request Reload ở client, chống desync giỏ hàng.

---
**Để cập nhật hoặc debug về sau:** 
- Nắm rõ cách bypass thay đổi DOM / JS Trap của trang `.j-cart-check` và trang `sui-business-address` của Shein nằm chủ yếu tại `shein-automation.js`.
- Bất kì tính năng concurrency / dừng task nào thì xem ở `batch-runner.js`.
- Start/stop trình duyệt và gọi backend MLX nằm ở `multilogin.js`.

## 5. Các bản cập nhật gần nhất (Recent Updates)
- **Giao diện Frontend (Preview Table):** Đã cấu trúc lại UI bảng Preview sản phẩm lúc Upload file Excel. Frontend hiện tại nhóm trực tiếp các sản phẩm lại theo `Batch` (được định danh bởi `shop_code` và Regex tách Số điện thoại từ `shipping_address`), giúp UI mạch lạc dễ nhìn hơn thay vì một danh sách dẹt đơn thuần.
- **Lược bỏ hoàn toàn `product_url`:** Toàn bộ tool từ Frontend đến utils Excel Parser đã loại bỏ triệt để cột `product_url`. Việc validate hiện tại bắt buộc phải dựa vào khoá chính là cột `sku_code`.
- **Tinh chỉnh Bot Delay:** Cập nhật lại quãng nghỉ `humanDelay` sau thao tác bấm nút `Add to Bag` trên trang chi tiết sản phẩm tăng lên thành `5s - 8s` (thay vì `3s - 5s` như trước) để đảm bảo Shein server ghi nhận chính xác kiện hàng vào giỏ mà không bị overload hành vi click liên tục.
- **Rải Batch Theo Quota Limit:** Khai tử hoàn toàn giải thuật chia việc cồng kềnh Cartesian (mỗi profile một list tổng). Công cụ giờ nhận thiết lập `Max Products / Profile` giúp phân mảnh chính xác các block batch theo chuỗi liên tục, an toàn và tối đa số lượng mua tuỳ chỉnh.
