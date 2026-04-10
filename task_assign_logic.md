# Cơ Chế Nhóm Việc Và Giao Việc Cho Profile (Task Assignment Logic)

Tài liệu này giải thích chi tiết quá trình ứng dụng đọc dữ liệu, phân rã công việc (task), và quản lý luồng mua hàng trên nhiều profile trình duyệt cùng lúc. Hệ thống được chia thành 2 cấp độ gánh vác logic chính: **Route Controller** (nhóm & phân bổ) và **Worker Runner** (vận hành & đa luồng).

---

## 1. Giai đoạn 1: Gom nhóm & Phân rã dữ liệu (Tích Đề-các)
*Vị trí file: `server.js` - Endpoint `POST /api/start`*

Khi người dùng nhấn "Start Batch" từ giao diện, Server sẽ nhận được 1 array chứa toàn bộ list **Sản phẩm (products)** và 1 array chứa danh sách các **Profiles** được chọn chạy.

### Bước 1.1: Gom nhóm sản phẩm thành các "Batch"
Hệ thống không chạy lắt nhắt từng dòng Excel đơn lẻ, mà sẽ tự động gom các món hàng vào **chung một Batch** nếu chúng thỏa mãn 2 điều kiện:
- Cùng mã **`shop_code`**.
- Cùng **số điện thoại người nhận** (được Regex bóc tách tự động ra từ chuỗi `shipping_address`).

*Mục đích:* Tối ưu hóa đơn. Gộp các mặt hàng của cùng 1 kho/shop và cùng ship về cho 1 người vào *1 lần thanh toán (Checkout)* để giảm phí vận chuyển phụ và tránh nghi ngờ từ phía bot-detection của Shein.

### Bước 1.2: Rải việc theo Quota Limit (Sequential Allocation)
Hệ thống sẽ không nhân chéo dữ liệu nữa, thay vào đó việc gán việc sẽ phụ thuộc vào cài đặt `Max Products / Profile` (Ví dụ `X = 30`). Cơ chế tính toán từ Backend: 
- Trước tiên check toàn bộ lượng Product có lớn hơn khả năng chứa của các profiles gộp lại không (Ném lỗi `400` nếu quá tải). Check xem đơn có cụm batch nào bị bự hơn khả năng chứa 1 profile không (ném lỗi từ chối phiên lập tức nến có).
- **Quy tắc trượt (Sliding Assignment):** Đảo qua từng Batch. Gán đè Batch 1 vào Profile 1. Nếu việc gán thêm Batch 2 làm Profile 1 bị vượt ngưỡng (sức chứa + Batch 2 > 30), hệ thống sẽ ngắt và ném trọn Batch 2 này sang Profile 2, tiếp tục quá trình nhồi task vào mảng đệm cho tới khi hết file.
- **Ví dụ:** Upload 1 file Excel 55 products chia làm `5 Batch`. `X = 30`. 
  $\rightarrow$ Tool sẽ rải: Profile 1 ôm Batch 1 và Batch 2 (Tầm 28 products). Profile 2 sẽ ôm Batch 3, Batch 4, Batch 5 (27 Products). Tổng cộng chỉ sinh ra 5 Tasks nhưng đã được chia đều cho các profiles khác nhau.
- Những task này được ném vào mảng `currentTasks[]` với đích danh gán cứng cho Profile chỉ định. Trạng thái dội về giao diện là `pending`.

---

## 2. Giai đoạn 2: Quản lý hàng đợi Đa luồng (Worker Queue)
*Vị trí file: `src/workers/batch-runner.js` - Hàm `runBatch()`*

Sau khi có 15 tasks ở trên, 15 tasks này được ném cho Worker `runBatch()` cày ải, kèm thêm tham số `concurrency` (số luồng chạy song song tối đa, ví dụ: 2 luồng).

### Bước 2.1: Gom ngược Tasks Group theo Profile
Thay vì để 5 tasks dính chùm hoặc rời rạc, Worker sẽ gom nó thành các nhóm **Profile Groups**:
- Profile 1 -> ôm [Batch Task 1, Batch Task 2]
- Profile 2 -> ôm [Batch Task 3, Batch Task 4, Batch Task 5]
- Profile 3 -> (Có thể trống task nếu lượng product đã bị xử lý hết ở 2 profile đầu).

### Bước 2.2: Cơ chế Concurrency (Luồng chạy)
Hệ thống định nghĩa một vòng lặp nhả task thông qua hàm `tryStartNext()`:
1. So sánh `runningGroups.size` (số luồng đang chạy) với `concurrency` (số luồng tối đa cho phép).
2. Khi số luồng thấp hơn mức trần $\rightarrow$ Rút 1 Profile từ trong Hàng đợi (Queue) tống ra chạy.
3. Nếu cài `concurrency = 2`, thì Profile 1 và Profile 2 sẽ được Start Multilogin bật trình duyệt lên trước. Profile 3 đứng im chờ đợi.

### Bước 2.3: Thực thi mua hàng tuần tự trong nội bộ thư mục (Sequential per Profile)
Đối với nội bộ 1 Profile đang được mở (Ví dụ Profile 1):
1. Gọi API Multilogin đánh thức trình duyệt bật lên. Connect Playwright vào thông qua mã `browserURL`.
2. Dùng 1 vòng lặp `for...of` để **chạy lần lượt từng phần tử (từng Batch)** của nó: (Chạy Batch 1 -> Checkout -> Xong -> Chạy Batch 2 -> Checkout -> ...).
   *Việc chạy tuần tự bên trong 1 Profile là bắt buộc vì 1 trình duyệt không thể checkout 2 đơn chung 1 lúc.*
3. Gọi hàm `runPurchase()` từ `shein-automation.js` để thực hiện hành vi quét giỏ hàng tự động.

### Bước 2.4: Fast-failure (Chống kẹt Captcha)
Đây là logic rất thông minh bên trong Worker:
- Trong quá trình mua `Batch 1`, nếu Playwright bị văng lỗi `CAPTCHA_BLOCKED` (Do Shein nghi gian lận, chăn bot lại).
- Worker lập tức bắt lỗi Exception này. Đánh giá dấu hiệu IP hoặc Profile này đã bị cờ "Red Flag".
- **Hành động:** Sử dụng lệnh `break;` văng thẳng ra ngoài vòng lặp Batch nội bộ. Bỏ qua và **Hủy (Skip) toàn bộ các Batch 2, 3, 4, 5** đằng sau mác lỗi *❌ Profile hit Captcha. Skipping remaining tasks.*
- *Mục đích:* Không chày cối đâm đầu vào tường vì đã bị khoá thì checkout cỡ nào cũng tịt, tốn tài nguyên. Đóng sớm profile này lại.

### Bước 2.5: Đóng luồng - Mở luồng
- Sau khi profile đã xong hết chùy batch (hoặc đứt gánh giữa chừng), nó sẽ lao vào block `finally {}`.
- Call API ngắt trình duyệt.
- Xóa profile khỏi `runningGroups`.
- Lập tức hook gọi lại `tryStartNext()`. Khi đó slot `concurrency` bị trống một chỗ $\rightarrow$ Profile 3 trong Hàng đợi sẽ được xuất tướng và chu kỳ cứ thế tiếp diễn cho tới khi Queue rỗng 100%. Mọi thứ kết thúc.
