# 🍵 Tiệm Của Lá — F&B POS & Restaurant Management Web App

Hệ thống quản lý bán hàng (POS), quầy pha chế (KDS), quản lý bàn & mã QR Standee, sổ quỹ thu chi, công việc ca làm và báo cáo kinh doanh chuyên nghiệp cho quán Trà & Cà Phê, phát triển trên nền tảng **Google Apps Script + Google Sheets + Vue 3**.

---

## 🌟 Tính Năng Nổi Bật

### 1. ☕ Bán Hàng & Đặt Món (POS / Customer Menu)
- Danh mục đồ uống: *Trà Trái Cây, Trà Sữa, Cà Phê, Ăn Vặt, Đá Xay*.
- Modal tùy chỉnh món nâng cao: Size (S/M/L), Mức đường (0/30/50/70/100%), Mức đá (0/30/50/70/100%), Topping đa dạng.
- Giỏ hàng thông minh: Tự động tính tiền, tra cứu khách hàng thân thiết theo số điện thoại & đổi điểm thưởng.
- Tùy chọn Dùng tại bàn (Dine-in) hoặc Mang đi (Takeaway).

### 2. 🍳 Quầy Pha Chế (Kitchen Display System — KDS)
- Phân loại đơn theo thời gian thực: *Chờ pha chế (Pending)*, *Đang làm (Preparing)*, *Đã xong (Completed)*.
- Đồng hồ đếm giờ thực hiện món với cảnh báo trực quan (Xanh: <15p, Vàng: >15p, Đỏ: >25p).
- Chuyển trạng thái 1 chạm, thanh toán VietQR động chuẩn ngân hàng & In hóa đơn bill.

### 3. 🪑 Quản Lý Bàn & QR Standee
- Sơ đồ bàn theo màu sắc trạng thái (*Bàn trống, Có khách, Đã đặt*).
- Chuyển bàn / Đổi bàn linh hoạt giữa các bàn.
- Trình tạo và in mã QR Standee riêng cho từng bàn để khách tự quét gọi món.

### 4. 💸 Sổ Quỹ Thu Chi & Chi Phí Quán (Dedicated Tab)
- Theo dõi dòng tiền, chi phí nhập hàng, mặt bằng, tiện ích, lương nhân viên.
- Thống kê nhanh: *Tổng Chi Hôm Nay, Doanh Thu Hôm Nay, Lợi Nhuận Ròng*.
- Ghi nhận và xóa khoản chi tức thì với Optimistic UI (0ms).

### 5. 📋 Công Việc Vận Hành (Daily Tasks & Checklist)
- Danh sách công việc lặp lại theo ngày (*Nấu trà đầu ngày, Kiểm kho, Dọn dẹp cuối ca...*).
- Thanh tiến độ hoàn thành theo ca làm việc, hỗ trợ tạo việc đột xuất (Ad-hoc).

### 6. 📊 Báo Cáo Doanh Thu & Business Intelligence (BI)
- Bộ lọc mốc thời gian: *Hôm nay, Hôm qua, 7 ngày qua, Tháng này, Tùy chỉnh*.
- Biểu đồ phân tích trực quan: Doanh thu theo ngày, Top sản phẩm bán chạy nhất, Cơ cấu danh mục, Phương thức thanh toán.

### 7. ⚙️ Cài Đặt Hệ Thống, Menu Admin & CRM
- Tải và thay đổi Logo quán & Banner trực tiếp từ điện thoại.
- Quản lý danh mục món & Topping: Thêm món, sửa giá, tải ảnh món từ máy, bật/tắt Hết hàng.
- Quản lý khách hàng thân thiết (CRM) và tích điểm.
- Phân quyền nhân viên và đổi mã PIN bảo mật Admin.

---

## 🛠️ Kiến Trúc Công Nghệ & Tối Ưu Hiệu Năng

- **Backend**: Google Apps Script V8 Engine.
- **Database**: Google Sheets (Multi-table relational model: `Products`, `Orders`, `Order_Details`, `Tables`, `Customers`, `Expenses`, `Staff`, `TaskTemplates`, `TaskInstances`).
- **Frontend**: Single Page Application (SPA), Vue 3 Composition API inlined (CSP-proof, 0 CDN dependency, 100% offline-ready).
- **Styling**: Modern Tailwind CSS tokens + Google Fonts Material Symbols.
- **Tối ưu GGSheet-QLHT**:
  - Endpoint gộp `getInitialData()` tải toàn bộ hệ thống trong đúng 1 network roundtrip.
  - Quản lý đồng thời với `LockService.getScriptLock()`.
  - Batch writes (`appendRowsToSheet`, `setValues`) giảm 90% số lần gọi SpreadsheetApp.

---

## 🚀 Triển Khai

1. Clone repository:
   ```bash
   git clone https://github.com/haiyenpa25/TCLApp.git
   cd TCLApp
   ```
2. Đẩy mã nguồn lên Google Apps Script:
   ```bash
   npx @google/clasp push
   ```
3. Triển khai Web App:
   ```bash
   npx @google/clasp deploy -d "TCLApp Release"
   ```

---
*Phát triển bởi đội ngũ Tiệm Của Lá.*
