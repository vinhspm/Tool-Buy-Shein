# Cập Nhật Hoàn Tất: Chuyển Đổi Logic Phân Task

Thực hiện theo plan, hệ thống đã loại bỏ cơ chế phân task theo dạng ma trận (Cartesian Product) khiến mỗi profile ôm trọn list đơn. Giờ đây, tool sẽ "nhồi" tuần tự các đơn hàng cho từng profile theo đúng giới hạn `Max Products / Profile`.

## Chi Tiết Các Thay Đổi

### 1. Backend (`server.js`)
- Đã gỡ bỏ hai vòng lặp lồng nhau kiểu `forEach` lúc tạo `currentTasks`.
- Thêm cơ chế validation bảo vệ:
  - Nếu `Tổng số product trong File Excel` > `Số Profile * Max Products`, chặn và báo lỗi `"Vượt quá sức chứa"`.
  - Nếu `Số product của 1 Batch` > `Max Products`, chặn và báo lỗi `"Cụm đơn chứa X items, vượt quota"`.
- Viết lại hàm chia task: 
  - Mở lặp kiểm đếm và cộng dồn sức nặng của từng mẻ đơn.
  - Mỗi khi sức nặng > mức sàn, nó sẽ sang tên ngay phần dư cho profile tiếp theo một cách trơn tru.

### 2. Frontend Settings (`public/index.html` & `app.js`)
- Thêm trường input **Max Products / Profile** vào giao diện cài đặt (nhóm "Multilogin Settings"), giá trị mặc định được đưa về `30`.
- Tích hợp hàm `saveSettings()` lưu giới hạn xuống config server, và `loadSettings()` tự điền lại input khi F5 trình duyệt.

> [!TIP]
> **Hướng dẫn Test Flow Mới**
> Bạn có thể chạy ngay lệnh preview (nếu cấu hình server auto refresh) hoặc F5 ứng dụng để kiểm chứng:
> 1. Tải lên 1 file có 50 lines.
> 2. Chỉnh trong Settings: Chọn 2 profile, Set Max Products = 30.
> 3. Hit **Start**, vào Dashboard bạn sẽ thấy Profile 1 rải 30 tasks, và phần còn lại đi qua Profile 2.
