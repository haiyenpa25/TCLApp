# 📖 HƯỚNG DẪN CHI TIẾT SỬ DỤNG HỆ THỐNG QUẢN LÝ HỘI THÁNH & BAN NGÀNH

Tài liệu này hướng dẫn chi tiết từng bước từ A đến Z cách vận hành hệ thống phân cấp: Tạo Hội Thánh ➔ Tạo Ban Ngành ➔ Tự động sinh file Google Sheets riêng ➔ Triển khai Web App cho từng ban ngành.

---

## 🏛️ 1. MÔ HÌNH HOẠT ĐỘNG TỔNG QUAN

```
📁 GOOGLE DRIVE GỐC (Được phân quyền)
│
├── 📊 File Master: QLHT (Lưu danh bạ tất cả Hội Thánh & Ban Ngành)
│
├── 📁 Thư mục: Hội Thánh - HT Tân Minh
│   ├── 📊 DB_Ban_Thanh_Trang_HT_Tan_Minh  (File Sheet riêng của Ban Thanh Tráng)
│   ├── 📊 DB_Ban_Thanh_Nien_HT_Tan_Minh   (File Sheet riêng của Ban Thanh Niên)
│   └── 📊 DB_Ban_Phu_Nu_HT_Tan_Minh      (File Sheet riêng của Ban Phụ Nữ)
│
└── 📁 Thư mục: Hội Thánh - HT Gia Định
    ├── 📊 DB_Ban_Thanh_Trang_HT_Gia_Dinh
    └── 📊 DB_Ban_Nam_Gioi_HT_Gia_Dinh
```

---

## 🚀 2. QUY TRÌNH THỰC HIỆN TỪNG BƯỚC

### BƯỚC 1: Cấu hình Ban Đầu (Chỉ làm 1 lần duy nhất)
1. Mở Web App **Quản Lý Hội Thánh**.
2. Chọn mục **"Cài Đặt Drive"** trên thanh menu.
3. Kiểm tra 2 thông tin:
   * **Thư mục Google Drive gốc:** Hệ thống đã tự động nhận ID `1dy78gH_lwfvPUKaZMRCsiOwN2ZPWcBGj`. Nếu bạn đổi thư mục khác, chỉ cần dán link/ID thư mục mới rồi bấm **"Lưu Thư Mục"**.
   * **Cơ sở dữ liệu Master:** Hệ thống đã tự động nhận file `QLHT` (ID: `124O4hYFaxmZn1hg8FyRP4fci6hw84ziTg8o3eAUwMV0`).

---

### BƯỚC 2: Tạo Hội Thánh Mới (Auto Sinh Folder Drive)
1. Trên thanh menu, bấm vào tab **"Hội Thánh"**.
2. Bấm nút màu cam **"+ Thêm Hội Thánh Mới"**.
3. Điền thông tin Hội Thánh:
   * **Tên Hội Thánh:** (Bắt buộc) Ví dụ: `Hội Thánh Tin Lành Tân Minh`
   * **Mục Sư / Quản Nhiệm:** Ví dụ: `MS Nguyễn Văn A`
   * **Địa Chỉ / Tỉnh Thành / SĐT:** Điền thông tin liên hệ.
4. Bấm **"Lưu Hội Thánh"**.
5. ⚡ **Hệ thống tự động thực hiện ngầm:**
   * Lưu thông tin Hội Thánh vào Sheet Master `QLHT`.
   * Tự động tạo 1 thư mục riêng trên Google Drive có tên: `Hội Thánh - Hội Thánh Tin Lành Tân Minh`.

---

### BƯỚC 3: Tạo Ban Ngành Trực Thuộc Hội Thánh
1. Trên thanh menu, bấm vào tab **"Ban Ngành & Sheets"**.
2. Bấm nút màu hồng **"+ Thêm Ban Ngành Mới"**.
3. Điền thông tin Ban Ngành:
   * **Thuộc Hội Thánh:** Chọn Hội Thánh quản lý (VD: `Hội Thánh Tin Lành Tân Minh`).
   * **Tên Ban Ngành:** Ví dụ: `Ban Thanh Tráng Tân Minh`.
   * **Loại Ban Ngành:** Chọn loại ban tương ứng (`Ban Thanh Tráng`, `Ban Thanh Niên`, `Ban Thiếu Nhi`, `Ban Phụ Nữ`, `Ban Nam Giới`, `Ban Lão Niên`).
   * **Trưởng Ban / Thư Ký / SĐT:** Điền thông tin ban điều hành.
4. Bấm **"Lưu Ban Ngành"**.

---

### BƯỚC 4: Tự Động Tạo (Clone) File Google Sheet Riêng Cho Ban Ngành
Sau khi tạo xong, thẻ của ban ngành đó sẽ có trạng thái màu vàng **"Chưa có Google Sheet"**.

1. Tại thẻ của ban ngành đó, bạn bấm nút màu xanh: **"⚡ Tạo Sheet Tự Động"**.
2. Một hộp thoại xác nhận hiện ra ➔ Bấm **OK**.
3. ⚡ **Hệ thống tự động thực hiện toàn bộ:**
   * Tạo một file Google Sheet mới tinh đặt tên theo chuẩn: `DB_Ban_Thanh_Tráng_Tân_Minh_Hội_Thánh_Tin_Lành_Tân_Minh`.
   * Tự động di chuyển file này vào đúng thư mục con của Hội Thánh đó trên Google Drive.
   * Tự động tạo sẵn và định dạng đẹp mắt **10 bảng dữ liệu chuẩn**:
     1. `ThanhVien` (Quản lý ban viên)
     2. `ToNhom` (Tổ nhóm nhỏ)
     3. `DiemDanh` (Lịch sử điểm danh hàng tuần)
     4. `ThamVieng` (Nhật ký thăm viếng)
     5. `LichQuy` (Lịch phân công thờ phượng)
     6. `ChuDe` (Chủ đề & câu gốc năm/quý)
     7. `SoQuy` (Thu chi tài chính)
     8. `DanhMucQuy` (Danh mục quỹ)
     9. `MauTinNhan` (Kho tin nhắn mẫu Zalo/SMS)
     10. `CauHinh` (Thông tin ban ngành)
   * Tự động lấy **Spreadsheet ID** & **URL** của file vừa tạo và lưu về Master.
4. Thẻ ban ngành chuyển sang màu xanh lá **"Đã có Google Sheet"** ➔ Có nút **"Mở"** để bạn bấm vào là mở trực tiếp file Google Sheet trên trình duyệt!

> 💡 **Cách khác nếu bạn đã có sẵn 1 file Google Sheet từ trước:**
> Bạn bấm vào nút **"Gán ID"** (biểu tượng móc xích 🔗) ➔ Dán link hoặc ID file Google Sheet có sẵn vào ➔ Bấm **"Lưu Liên Kết"**.

---

### BƯỚC 5: Triển Khai Web App Cho Ban Ngành Sinh Hoạt
Khi ban ngành đã có file Google Sheet riêng:
1. Mở dự án **`QuanLyBanNganh`** (Script ID: `1tj_RVNqCmRSOz6SL8ygDdLBAUWRfjksiIvHzQmlCVIeIY2uUfHgWjzZq`).
2. Vào phần **Cài Đặt** của Web App Ban Ngành ➔ Dán ID Google Sheet của ban đó vào để kết nối.
3. Copy đường link Web App (`https://script.google.com/.../exec`) của ban đó.
4. Quay lại Web App **Quản Lý Hội Thánh** ➔ Bấm **Sửa** ban ngành đó ➔ Dán link vào ô **"Link Web App Triển Khai"** ➔ Bấm **Lưu**.
5. Bây giờ tại danh sách Ban Ngành, bạn sẽ có thêm nút **"Mở Web App"** để nhảy thẳng sang Web App của ban ngành đó chỉ với 1 cú nhấp chuột!

---

## 💻 3. HƯỚNG DẪN ĐỒNG BỘ CODE TỰ ĐỘNG (KHÔNG BAO GIỜ BỊ LỖI)

Từ bây giờ, bạn có **2 cách cực kỳ tiện lợi** để code tự động cập nhật lên Web App & GitHub:

### ✨ CÁCH 1: Bật Auto-Sync Realtime (Khuyên dùng - Tiện nhất)
* Nhấp đúp chuột vào file **`auto_watch_and_sync.bat`** ở thư mục gốc và để cửa sổ đó chạy ngầm.
* Mỗi khi bạn sửa code và bấm **`Ctrl + S` (Lưu file)**:
  * ⚡ Hệ thống sẽ **tự động đẩy code lên Google Apps Script**.
  * ⚡ **Tự động deploy bản live Web App** (không cần vào Apps Script bấm deploy thủ công).
  * ⚡ **Tự động push lên GitHub Pages**.
  * 👉 Bạn chỉ việc F5 trình duyệt là thấy thay đổi ngay lập tức!

---

### 🚀 CÁCH 2: Nhấp Đúp File Batch 1-Click Khi Cần
Nếu không muốn bật chạy ngầm, bạn chỉ cần nhấp đúp file batch:

| Tên File Batch | Tính Năng Tự Động |
| :--- | :--- |
| **`update_all.bat`** | *(Khuyên dùng)* **1 cú nhấp chuột làm tất cả**: Đẩy code + Tự động deploy cả 2 Web App + Đẩy GitHub Pages. |
| **`update_ban_nganh.bat`** | Đẩy code & Auto-deploy Web App **Ban Thanh Tráng** + GitHub. |
| **`update_hoi_thanh.bat`** | Đẩy code & Auto-deploy Web App **Quản Lý Hội Thánh** + GitHub. |

---

## 🛠️ 4. XỬ LÝ SỰ CỐ THƯỜNG GẶP

1. **Sau khi update code bằng file `.bat`, web app chưa đổi?**
   * *Nguyên nhân:* Google Apps Script giữ bản snapshot của lần deploy trước.
   * *Khắc phục:* Vào Apps Script ➔ **Deploy** ➔ **Manage deployments** ➔ Bấm cây bút ✏️ ➔ Chọn **New version** ➔ Bấm **Deploy**.

2. **Muốn tạo thêm ban ngành mới (ví dụ Ban Thanh Niên)?**
   * Vào Web App Quản Lý Hội Thánh ➔ Bấm **"Thêm Ban Ngành"** ➔ Chọn loại `Ban Thanh Niên` ➔ Bấm **"Tạo Sheet Tự Động"** ➔ Ban Thanh Niên sẽ có ngay 1 file Sheet riêng biệt 100%!
