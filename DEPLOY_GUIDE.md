# 🚀 Hướng Dẫn Build & Triển Khai Lên Windows VPS

Tài liệu này sẽ hướng dẫn bạn quy trình 1 vòng khép kín: đóng gói che giấu Source Code (Mã hóa JS) ở máy tính của bạn và các đầu việc cần set-up để VPS chạy mượt mà 24/7.

---

## Giai đoạn 1: Đóng gói tại máy tính của bạn (Dev Environment)

1. Đang chạy test thấy Tool ổn định? Tốt. Hãy làm sạch giỏ hàng Multilogin để sẵn sàng ráp vào VPS.
2. Tại màn hình Terminal (cmd/powershell), **tắt tắt server** đi bằng tổ hợp phím `Ctrl + C`.
3. Gõ lệnh build: 
   ```bash
   node build.js
   ```
4. Ngồi đợi khoảng 5-10 giây. Hệ thống sẽ:
   - Gom file `package.json` & `config.json` lưu cấu hình.
   - Bê nguyên bộ mặt Website (Frontend ở mục `public`) sang.
   - Nhào nặng, mã hoá làm mờ đi tới mức không thể đọc được cho toàn bộ não bộ Backend (`src/` và `server.js`).
5. Gói hàng xong, nó sẽ tạo ra thư mục **`build_vps`**. Cứ **Nén Zip** thư mục này lại và vứt qua VPS.

---

## Giai đoạn 2: Khởi động trên máy áo Windows (VPS Environment)

Tất cả các con bot Playwright & Multilogin đều đòi hỏi Môi trường Cửa Sổ Desktop (*User Session*). Đừng bao giờ cấu hình nó chạy ngầm kiểu *Window Service System*.

### 1. Chuẩn bị (Chỉ làm 1 lần)
- Tải & Cài đặt **Node.js** bản mới nhất (LTS) lên VPS.
- Mở Port `3000` trên phần mềm **Windows Defender Firewall with Advanced Security** (Inbound Rules -> New Rule -> Port -> 3000 -> Allow).

### 2. Cài cắm nền móng
- Copy thư mục vừa nén bỏ lên VPS & giải nén. Ví dụ bỏ vào ổ cứng ở `C:\Tool-Auto-Shein\`.
- Mở cửa sổ Terminal (cmd), di chuyển vào thư mục đó:
  ```bash
  cd C:\Tool-Auto-Shein
  ```
- Gõ lệnh cài thư viện ẩn giấu (`express`, `playwright`, v.v...):
  ```bash
  npm install
  ```

### 3. Vận hành Tool

#### 👉 Cách 1: Setup chay (đơn giản, dễ theo dõi)
Cứ gõ thẳng:
```bash
node server.js
```
Tool lên là xong. **Nhược điểm:** Bạn lỡ tay tắt cái cửa sổ đen (CMD) là đứt đoạn tool, sập không ai đỡ.

#### 👉 Cách 2: Vận hành bền vững (Dùng PM2)
PM2 là vệ sĩ cho Node.js, lỡ bạn tắt terminal hay tool đụt ngang, nó sẽ tự auto-restart sống lại liền.
- Cài PM2 vào máy ảo:
  ```bash
  npm install pm2 -g
  ```
- Start tool tự động khôi phục chạy nền nhưng k dính lỗi "đen window":
  ```bash
  pm2 start server.js --name "auto-shein"
  ```
- Bấm tổ hợp lưu session thần thánh:
  ```bash
  pm2 save
  ```

> ⚠️ Cần soi log sau khi đã dùng thủ thuật Cách 2 che đi?
> Chỉ cần gõ lệnh `pm2 log auto-shein` là vũng log lịch sử mua cái gì sẽ hiện ra đầy đủ.

---
🥂 Vậy là xong! Hãy đăng nhập vào `http://[IP-Của-VPS]:3000` test thử và mở sâm-panh đi nào!
