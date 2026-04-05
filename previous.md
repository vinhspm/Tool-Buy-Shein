# SHEIN Auto Buy Tool – Project Analysis & Summary

## 1. Mục tiêu và Tổng quan
Dự án là một công cụ tự động (Auto-Buy Tool) dùng để tự động thiết lập và mua hàng loạt trên nền tảng thương mại điện tử SHEIN. Công cụ dựa trên sức mạnh của trình duyệt chống phát hiện Multilogin X (tránh ban, duy trì Trust score cho account) kết hợp với thư viện Playwright để thao tác kịch bản tự động hóa trên trang web. Hệ thống hỗ trợ một giao diện Dashboard qua nền web để dễ dàng cấu hình chạy đa luồng.

## 2. Kiến trúc & Công nghệ (Tech Stack)
* **Backend:** NodeJS, Express (REST API), Socket.io (cập nhật trạng thái Real-time về Dashboard).
* **Automated Browser:** Playwright (kết nối CDP tới phiên Node của Multilogin).
* **Anti-detect Services:** API Multilogin X.
* **Utilities:** Thư viện `xlsx` (đọc file Excel các đơn hàng đầu vào), `multer` (upload file tạm).

## 3. Cấu trúc Mã nguồn chính
* `server.js`: Web Server chính. Nó quản lý API upload file cấu hình (Config, Credentials), lấy danh sách workspace/profile từ Multilogin. Nó cũng đóng vai trò phát các luồng sự kiện Socket (`io.emit`) để báo trạng thái tiến trình hiện hành về giao diện.
* `public/`: Thư mục Frontend (HTML/JS/CSS thuần) cho trang Dashboard điều khiển ứng dụng (với các thẻ Cài đặt, Cấu hình Profiles, Upload Input, Trạng thái Batch).
* `src/workers/batch-runner.js`: Trình quản lý hàng đợi (Queue Worker). Giới hạn số luồng chạy song song (concurrency - mặc định là 3), đảm nhiệm khởi động (Start) Multilogin config và dọn dẹp kịch bản khi tắt luồng.
* `src/services/shein-automation.js`: Mạch máu cốt lõi chứa toàn bộ logic tự động thao tác trên website chức năng của Shein: nhận dạng sản phẩm, chọn Option, xử lý thanh toán, địa chỉ. 
* `src/services/multilogin.js`: Xử lý HTTP API call tới Multilogin X để Start/Stop từng profile.
* `src/utils/excel-parser.js` & `address-parser.js`: Logic phụ dùng để mapping các cột Excel thành Object JS (URL, Color, Size, Quantity, Address) và bóc tách cấu trúc tên, đường phố, zipcode của dữ liệu địa chỉ.

## 4. Quy trình vận hành & Tự động hóa chi tiết ở Shein (Workflow)
1. **Khởi tạo Input:** Người dùng thiết lập Excel đầu vào và tải lên Dashboard. Hệ thống map từng dòng sản phẩm với một Profile Multilogin cụ thể thông qua cơ chế Round-Robin hoặc tuỳ chỉnh.
2. **Khởi chạy Môi trường (Batch):** Chạy Playwright dùng `chromium.connectOverCDP(browserURL)` để chui trực tiếp vào trình duyệt đã log-in trước do Multilogin quản lý.
3. **Mở Sản phẩm & Captcha Bypass:** 
   - Tool tiến hành mở đường dẫn URL sản phẩm.
   - Nếu phát hiện Captcha chặn truy cập Web, ứng dụng sẽ không tìm cách giải Captcha phức tạp mà thực hiện vòng lặp Reload (Tối đa 3 lần).
4. **Lựa chọn Biến thể (Variants) & Xử lý UI:**
   - Liên tục tìm kiếm nút Đóng popup để tự động đóng các hộp thoại khuyến mãi (Promotion Savings) vô tình cản trở chuột.
   - Mapping thuộc tính `Color` theo `aria-label`/`title`/`data-name` của selector.
   - Tìm và matching Size bằng text content hoặc attributes tương đương.
5. **Thêm vào Giỏ (Add to Cart):** Quá trình Submit sản phẩm vào giỏ, sau đó điều hướng thông qua Icon Cart ở thanh Header.
6. **Xác minh và Dọn giỏ hàng (Check & Cleanup Cart):** Bước cực kỳ quan trọng. Hệ thống quét qua các sản phẩm trong giỏ, đối chiếu tiêu đề sản phẩm vừa thêm để tự động click nút Xóa (Trash button) cho những sản phẩm dư thừa (đã có ở session trước), đảm bảo giỏ hàng hoàn toàn chuẩn. 
7. **Bơm Số lượng (Set Quantity):** Nhập trực tiếp tổng số lượng mua cho ITEM này chứ không bấm dấu "+" nhiều lần. 
8. **Checkout & Khai báo địa chỉ giao hàng (`handleShippingAddress`):**
   - Điền thông tin vào form dựa theo data Excel đã parse trước đó.
   - Phá vòng phòng thủ của Shein: Công cụ dùng phương thức inject JS (`node.removeAttribute('readonly')`) để gỡ bỏ triệt để khóa Input Box khiến Automation bình thường không đánh máy được.
   - Thay vì paste chuỗi nguyên cục, Tool tạo hiệu ứng gõ phím ngẫu nhiên của con người (`humanType`).
   - Sử dụng ô AutoComplete (Address Search) để tìm Zipcode và Click Option chuẩn.
9. **Chốt đơn (Finalize):** Nhấn `Place Order` và sẽ tự động snap ảnh screenshot lại báo cáo kết quả hoàn thành hoặc lưu ảnh nếu tiến trình đó thất bại ở `/screenshots/`.

## 5. Những tính năng & Stability Design nổi bật
* Giới hạn thông lượng bằng Batch Queue, giúp máy tính tránh tình trạng nhồi hàng loạt Multilogin làm lag máy hoặc OOM (Out-of-memory).
* Truyền thông điệp (Log messages) liên tục theo thời gian thực (Real-time).
* Bắt chước hành vi thật của người dùng: Thời gian ngẫu nhiên đứt đoạn `humanDelay`, Gõ phím chậm như con người thao tác thật.
* Cơ chế tự bảo vệ: Lồng Try/Catch khắt khe vào từng Component con trên DOM và timeout tự động Retry chứ không sập cả chương trình.
