# 🌿 CẨM NANG VẬN HÀNH TOÀN DIỆN — TIỆM CỦA LÁ (TCLApp v145)

> **Hệ Thống Quản Lý POS Bán Hàng, Bếp KDS, Sổ Quỹ Thu Chi, Chốt Ca Két Tiền, Khách Hàng CRM & Báo Cáo Tài Chính F&B**
>
> 🌐 **Link Web App Chính Thức:** [https://script.google.com/macros/s/AKfycbzFimdc1BIExHP6SD4WJA8ilvDhJ8oSvef4HgOZimZG0tjLpJvTz42_A_v4IIHZghwx/exec](https://script.google.com/macros/s/AKfycbzFimdc1BIExHP6SD4WJA8ilvDhJ8oSvef4HgOZimZG0tjLpJvTz42_A_v4IIHZghwx/exec)
> 📊 **Cơ Sở Dữ Liệu Google Sheet:** `1co9xhrZFdYi649Dl1OrWDuRAwbs4HsCoPTlt6i9QYw4`

---

## 🧭 MỤC LỤC HỆ THỐNG (7 PHÂN HỆ)

```
                       TIỆM CỦA LÁ — TRUNG TÂM ĐIỀU HÀNH
                                      │
     ┌───────────┬───────────┬────────┴───────┬───────────┬───────────┐
     ▼           ▼           ▼                ▼           ▼           ▼
 [BÁN HÀNG]  [BẾP KDS]   [SỔ QUỸ]         [CHỐT CA]   [CRM KHÁCH]  [BÁO CÁO]
  Order POS   3 Cột      Lọc ngày/nguồn   Két tiền    Tích điểm    Doanh thu
  Custom Size Pha Chế    Chi phí thực tế  Bàn giao    Khách VIP    Lợi nhuận
```

---

## 🍵 1. PHÂN HỆ BÁN HÀNG & GỌI MÓN (POS)

### 📌 Quy trình Order & Tính Tiền:
1. **Tìm kiếm & Phân loại món**:
   - Chọn nhanh danh mục: `Trà Trái Cây`, `Trà Sữa`, `Cà Phê`, `Ăn Vặt` hoặc nhập tên món vào ô tìm kiếm.
2. **Tùy chỉnh món (Customization Modal)**:
   - Nhấp vào món bất kỳ để mở bảng tùy chọn:
     - **Size**: S ($-3.000$ ₫) / M (Chuẩn) / L ($+5.000$ ₫).
     - **Mức Đá**: $100\%$, $70\%$, $50\%$, Không đá.
     - **Mức Đường**: $100\%$, $70\%$, $50\%$, Không đường.
     - **Topping thêm**: Thạch Lá Dứa, Trân Châu Hoàng Kim, Hạt Sen Nấu Đường Phèn, Kem Cheese Macchiato.
     - **Số lượng ly**: Tăng giảm bằng nút `+` / `-`.
   - Bấm **"Thêm Vào Giỏ Hàng"**.
3. **Chọn Bàn hoặc Mang Về**:
   - Nhấp nút **"Chọn Bàn"** trên thanh tiêu đề để chọn bàn ngồi tại quán hoặc chọn **"Mang Về / Giao Đi"**.
4. **Nhận diện Khách Quen & Trừ Điểm Thưởng**:
   - Trong giỏ hàng, nhập **Số điện thoại khách hàng**:
     - Hệ thống tự động nhận diện tên khách và số điểm tích lũy hiện có.
     - Tích vào ô **`[Dùng điểm]`** để giảm giá trực tiếp vào bill ($1$ điểm = $1.000$ ₫).
5. **Gửi Đơn Đến Bếp**:
   - Bấm **"Gửi Đơn Đến Bếp"** ➔ Đơn tự động chuyển sang màn hình Bếp KDS và phát âm thanh chuông báo!

---

## 🛎️ 2. PHÂN HỆ QUẦY PHA CHẾ (KITCHEN KDS)

### 📌 Luồng Xử Lý 3 Cột Kanban:
```
[1. ĐƠN MỚI] ──(Nhận Pha Chế)──► [2. ĐANG PHA CHẾ] ──(Hoàn Tất Món)──► [3. CHỜ GIAO / THU TIỀN]
```
- **Đếm thời gian trôi qua theo thời gian thực**:
  - 🟢 **Xanh lá ($< 5$ phút)**: Đơn mới vào, thời gian chuẩn bị an toàn.
  - 🟡 **Vàng hổ phách ($5 - 10$ phút)**: Nhắc nhở quầy bar ưu tiên làm.
  - 🔴 **Đỏ rực chớp nháy ($> 10$ phút)**: Khẩn cấp, cần ra món ngay cho khách!
- **Chuông báo âm thanh Web Audio API**: Tự động phát tiếng chuông báo khi có đơn mới (có thể bật/tắt bằng nút biểu tượng loa trên thanh Header).
- **Tab Lịch Sử Hôm Nay**: Xem lại toàn bộ các đơn hàng đã hoàn tất hoặc đã hủy trong ngày.

---

## 💸 3. PHÂN HỆ SỔ QUỸ CHI PHÍ (EXPENSES)

### 📌 Ghi Nhận Khoản Chi Đa Chiều:
- Bấm **"Ghi Khoản Chi Mới"**:
  - **Nội dung chi**: Nhập nội dung (VD: Mua sữa đặc, đá viên, bao bì...).
  - **Số tiền**: Nhập số tiền hoặc bấm nhanh phím tắt: `+20k`, `+50k`, `+100k`, `+200k`, `+500k`.
  - **Người chi**: Chọn nhân sự (`Yến`, `Trí`, `Linh`, `An`).
  - **Hình thức chi**: `Tiền mặt` hoặc `Chuyển khoản`.
  - **Danh mục chi**: `Nguyên liệu`, `Dụng cụ & Bao bì`, `Điện nước / Internet`, `Khác`.
  - **Nguồn tiền**: `Tiền quán` (lấy từ két) hoặc `Tiền túi chủ`.
- **Bộ lọc thời gian thông minh**:
  - Hôm Nay | Hôm Qua | Tuần Này (7 ngày) | Tháng Này | Tùy Chọn (Từ ngày ... Đến ngày ...).
  - Lọc theo Danh mục & Nguồn tiền.

---

## 💵 4. PHÂN HỆ CHỐT CA & BÀN GIAO KÉT TIỀN (SHIFT RECONCILIATION)

### 📌 Quy Trình Đóng Ca Cuối Ngày:
1. Nhấp nút **`[Chốt Ca]`** trên thanh tiêu đề.
2. Khai báo **Tiền lẻ ban đầu trong két** (mặc định $500.000$ ₫).
3. Hệ thống tự động tính:
   $$\text{Tiền Mặt Lý Thuyết} = \text{Tiền Đầu Ca} + \text{Thu Tiền Mặt} - \text{Chi Tiền Mặt Két}$$
4. Thu ngân đếm tiền mặt thực tế và nhập vào ô **"Tiền Mặt Thực Tế Đếm Được"**.
5. Hệ thống báo ngay:
   - 🟢 `0 ₫ (Khớp chuẩn 100%)`
   - 🔵 `+X ₫ (Thừa tiền)`
   - 🔴 `-X ₫ (Thiếu hụt tiền)`
6. Bấm **"In Bàn Giao"** để in phiếu 80mm bàn giao ca gửi chủ quán.

---

## 💖 5. PHÂN HỆ KHÁCH HÀNG & CRM LOYALTY

- **Quản lý danh sách khách hàng**: Tìm kiếm nhanh theo Tên hoặc Số điện thoại.
- **Huy hiệu phân hạng thành viên tự động**:
  - 🥉 `Thành Viên Mới` ($< 100.000$ ₫)
  - 🥈 `Hạng Bạc` ($100.000$ ₫ – $500.000$ ₫)
  - 🥇 `Hạng Vàng` ($500.000$ ₫ – $1.000.000$ ₫)
  - 💎 `VIP Kim Cương` ($> 1.000.000$ ₫)
- **Nút Gọi Điện Thoại Nhanh (`tel:`)**: Bấm vào SĐT để thực hiện cuộc gọi chăm sóc khách hàng ngay trên điện thoại.
- **Lưu ghi chú sở thích/khẩu vị**: Ghi nhớ thói quen uống của khách (VD: *"Uống trà ít ngọt, nhiều đá, giao lầu 3"*).

---

## 📈 6. PHÂN HỆ BÁO CÁO TÀI CHÍNH & PHÂN TÍCH DOANH THU (BI)

- **4 Thẻ Chỉ Số Tài Chính**:
  1. **Doanh Thu Thuần**: Tổng tiền đơn hàng hoàn tất.
  2. **Tổng Chi Phí**: Tổng tiền chi phí trong kỳ.
  3. **Lợi Nhuận Thuần (Net Profit)** = Doanh Thu - Chi Phí.
  4. **Giá Trị Đơn Trung Bình (AOV)** & Tỷ suất lợi nhuận %.
- **Phân Bổ Hình Thức Thanh Toán**: Tỷ lệ % và số tiền giữa **Chuyển Khoản VietQR** vs **Tiền Mặt** kèm thanh đo trực quan.
- **Top 5 Món Nước Bán Chạy Nhất**: Bảng vàng vinh danh món hot nhất quán kèm huy hiệu 🥇 🥈 🥉.
- **Biểu đồ doanh thu theo khung giờ** và **Bảng kê chi tiết đơn hàng** (hỗ trợ Xem lại & In lại Bill bất kỳ lúc nào).

---

## ⚙️ 7. PHÂN HỆ CÀI ĐẶT THỰC ĐƠN & QUÁN

- **Quản lý Món Nước**:
  - Thêm món mới, sửa giá bán, cập nhật link ảnh.
  - Tùy chọn bật/tắt Size S/M/L, Mức Đá, Mức Đường.
  - Chuyển trạng thái nhanh: `Đang Bán` / `Hết Hàng` / `Tạm Ẩn`.
- **Quản lý Topping Thêm**: Thêm, sửa tên và giá bán thêm của từng loại topping.
- **Cấu hình Quán & VietQR**:
  - Tên quán, Khẩu hiệu/Slogan, SĐT Hotline.
  - Mã ngân hàng Napas, Số tài khoản nhận tiền, Tên chủ tài khoản ➔ Tự động tạo mã VietQR động chính xác từng đơn hàng!

---

*Tài liệu được biên soạn và cập nhật theo phiên bản mới nhất **TCLApp v145**.*
