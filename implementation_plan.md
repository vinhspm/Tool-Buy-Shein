# Thay Đổi Logic Phân Bổ Task Theo Quota (Product Limit)

Mục tiêu: Xóa bỏ cơ chế mỗi profile chạy toàn bộ các batch (Cartesian Product). Thay vào đó, mỗi profile sẽ có **Quota mua hàng tối đa (dựa trên số product)**. Tool sẽ gán tuần tự các batch cho profile cho đến khi hết quota thì chuyển sang profile tiếp theo. Sự tính toán này diễn ra tại thời điểm `Bấm Start`, tức là phân rã các Task hợp lý trước khi ném vào Queue.

## User Review Required

> [!WARNING]
> Mức độ thay đổi: Logic cốt lõi ảnh hưởng trực tiếp tới cách tool phân loại và nhóm hóa công việc ở Backend `server.js` cũng như cách hiển thị Settings trên UI `index.html`. Vui lòng xem xét các câu hỏi mở bên dưới trước khi duyệt plan.

## Proposed Changes

---

### Backend Logic (API) & Data Structure

#### [MODIFY] `server.js` (Endpoint `/api/start`)
- Thay thế vòng lặp nhân chéo O(N*M) hiện tại.
- Thêm biến đếm `currentProfileIndex = 0` và `currentProfileProducts = 0`.
- Lặp qua từng `Batch` (đã group theo shop + phone):
    - Tính số lượng product trong Batch này (`batch.length`).
    - Tính tổng số đơn nếu gán batch này cho profile hiện tại: `currentProfileProducts + batch.length`.
    - **Logic kiểm tra quota:** Nếu tổng số > `config.maxProductsPerProfile` **VÀ** profile hiện tại đã ôm ít nhất 1 product (`currentProfileProducts > 0`):
        - Nhảy sang profile tiếp theo: `currentProfileIndex++`
        - Nhảy sang thì `currentProfileProducts = 0`.
    - Lấy thông tin của profile hiện tại: `targetProfiles[currentProfileIndex]`.
    - Gán task cho profile đó. Cộng dồn: `currentProfileProducts += batch.length`.
    - **Ngoại lệ hết Profile:** Nếu `currentProfileIndex >= targetProfiles.length`, tức là đã dùng hết tất cả các profile được chọn nhưng vẫn còn thừa Batch chưa chạy $\rightarrow$ bỏ qua các batch còn lại hoặc văng lỗi (Tuỳ thuộc vào lựa chọn của người dùng ở phần Socratic Questions).

#### [MODIFY] `server.js` (Config Management)
- Thêm trường `maxProductsPerProfile: 30` vào `DEFAULT_CONFIG`.

---

### Frontend UI (Dashboard)

#### [MODIFY] `public/index.html`
- Bổ sung một ô input trong mục **Settings (Multilogin Settings)** để cấu hình `Max Products / Profile`.
- Cho phép người dùng chỉnh định mức tùy ý (mặc định lấy theo config, ví dụ là 30).

#### [MODIFY] `public/app.js`
- Đọc giá trị cấu hình `maxProductsPerProfile` từ API và đổ vào input.
- Khi bấm Save Settings, lấy giá trị từ input ném qua API `/api/config` để lưu lại.

---

## Open Questions / Socratic Gate 🛑

Để đảm bảo hiểu đúng 100% nghiệp vụ và các edge-case trước khi tiến hành code, vui lòng trả lời hoặc thảo luận 3 câu hỏi dưới đây:

> [!IMPORTANT]
> ### 1. Tràn Quota (Ran out of Profiles)
> **Question:** Nếu tổng số product trong file Excel (ví dụ 100) vượt quá tổng sức chứa của các Profile (ví dụ bật 3 profile, limit X=30 -> tổng sức chứa là 90), thì 10 product còn thừa sẽ được xử lý thế nào?
> **Options:**
> - Bỏ qua (Skip) những product còn thừa đó, chỉ chạy 90.
> - Văng lỗi ngay từ lúc bấm Start "Số lượng profile không đủ để gánh hết đơn, vui lòng tăng giới hạn X hoặc thêm profile". (An toàn nhất)
> - Tự động quay vòng lại Profile 1. (Rủi ro vượt quota)
> **Default:** Báo lỗi từ chối chạy ngay từ lúc bấm Start.

> [!IMPORTANT]
> ### 2. Batch lấn át Quota
> **Question:** Nếu có 1 BATCH CỰC LỚN (cùng shop + số điện thoại) chứa số lượng product lớn hơn cả limit X (Ví dụ: Batch có 35 product, mà X=30). Chuyện gì sẽ xảy ra?
> **Why this matters:** Batch sinh ra để tránh chia nhỏ đơn mua. Nếu tách batch đó ra cho 2 profile thì mất ý nghĩa của gộp đơn. Nếu không tách thì profile phải cõng lố 35 > 30.
> **Options:**
> - Cho phép profile đó bị quá tải (ôm trọn 35).
> - Tách đôi batch đó ra làm 2 (giữ đúng X=30).
> - Bỏ qua batch này, ghi log lỗi.
> **Default:** Cho phép profile đó bị quá tải một lần để xả nguyên cụm Batch, sau đó lập tức chuyển sang profile tiếp theo ngay. (Ví dụ 0 + 35 = 35 -> Gán xong 35 chuyển luôn profile).

> [!IMPORTANT]
> ### 3. UX Cảnh báo trên Giao diện
> **Question:** Khi thuật toán chia task xong, bạn có muốn hiện ở ngoài màn hình tổng thể (Dashboard) xem Profile 1 đang gánh bao nhiêu product, Profile 2 gánh bao nhiêu product để dễ quan sát không?
> **Default:** Có, vì UI hiện tại có hỗ trợ hiển thị Label của Profile và Item Count trên giao diện task grid, sẽ nhìn thấy ngay profile nào gánh task nào.

## Verification Plan
1. Khởi động công cụ và nhập Excel giả lập có 50 sản phẩm. Chọn 2 array (mỗi array đại diện 1 batch khác nhau).
2. Set profile X = 30 và bật 2 Profile.
3. Test xem Backend có chia đúng 30 sản phẩm cho Profile 1, và 20 sản phẩm sang Profile 2 hay không.
4. Test xem nếu 1 Batch có 35 thẻ, Profile 1 có tự chuyển gánh quá tải và ngưng lấy thêm hay không.
