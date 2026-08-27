# 📋 BẢNG LƯU Ý KỸ THUẬT & QUY TẮC VÀNG
## Lập trình Google Apps Script (GAS) & Google Sheets làm CSDL

Document này tổng hợp toàn bộ các lưu ý quan trọng, nguyên tắc tối ưu hiệu năng, bảo mật và các lỗi phổ biến cần tránh khi xây dựng ứng dụng web bằng **Google Apps Script (GAS)** kết nối với **Google Sheets làm CSDL**.

---

## 📑 MỤC LỤC
1. [Quản lý Google Sheets làm CSDL (Database)](#1-quản-lý-google-sheets-làm-csdl-database)
2. [Tối ưu & Xử lý Backend trong Code.gs](#2-tối-ưu--xử-lý-backend-trong-codegs)
3. [Tương tác Frontend <-> Backend (google.script.run)](#3-tương-tác-frontend---backend-googlescriptrun)
4. [Bảo mật, Tranh chấp dữ liệu & LockService](#4-bảo-mật-tranh-chấp-dữ-liệu--lockservice)
5. [Triển khai Web App & Quản lý Phiên bản (Deploy)](#5-triển-khai-web-app--quản-lý-phiên-bản-deploy)
6. [Quản lý Giới hạn (Quotas & Limits) của Google](#6-quản-lý-giới-hạn-quotas--limits-của-google)
7. [Checklist Kiểm Tra Trước Khi Release](#7-checklist-kiểm-tra-trước-khi-release)

---

## 1. QUẢN LÝ GOOGLE SHEETS LÀM CSDL (DATABASE)

> [!CRITICAL]
> **Quy tắc vàng 1:** Tuyệt đối **KHÔNG** đọc/ghi dữ liệu từng ô (`getValue()` / `setValue()`) trong vòng lặp (`for`, `forEach`). Hãy đọc/ghi theo mảng 2 chiều bằng `getValues()` và `setValues()`.

### 1.1 Tối ưu Đọc / Ghi dữ liệu (Batch Operations)
- ❌ **SAI (Chậm gấp 50 - 100 lần):**
  ```javascript
  // Lặp và ghi từng ô - Làm app treo hoặc sập do quá thời gian thực thi (Execution Timeout)
  for (let i = 0; i < data.length; i++) {
    sheet.getRange(i + 1, 1).setValue(data[i].name);
    sheet.getRange(i + 1, 2).setValue(data[i].email);
  }
  ```
- ✅ **ĐÚNG (Chạy cực nhanh):**
  ```javascript
  // Chuyển dữ liệu thành mảng 2 chiều và ghi 1 lần duy nhất
  const rows = data.map(item => [item.name, item.email]);
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  ```

### 1.2 Tìm kiếm & Truy vấn dữ liệu hiệu quả
- Không dùng `sheet.appendRow()` nếu cần kiểm tra khóa chính trùng lặp hoặc cần lấy dòng vừa chèn.
- Đọc toàn bộ dữ liệu 1 lần vào RAM, chuyển thành `Map` hoặc `Object` theo Key (ví dụ: `ID` hoặc `Email`) để tra cứu với độ phức tạp $O(1)$ thay vì lặp qua mảng nhiều lần $O(N)$.
  ```javascript
  const values = sheet.getDataRange().getValues();
  const headers = values.shift(); // Lấy header
  
  // Tạo Map index để tra cứu theo ID
  const dataMap = new Map();
  values.forEach((row, index) => {
    const id = row[0]; // Giả sử ID ở cột A
    dataMap.set(id, { rowIndex: index + 2, data: row }); // Index sheet bắt đầu từ 1, bỏ header +1 -> index + 2
  });
  ```

### 1.3 Quản lý Khóa chính (Primary Key / Auto ID)
- Google Sheet không tự tăng ID như MySQL hay PostgreSQL.
- Cần tự phát sinh ID duy nhất:
  - **Dạng chuỗi ngẫu nhiên (UUID/Timestamp):** `const newId = 'REQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);`
  - **Dạng số tự tăng:** Tìm `MAX(ID)` hiện tại trong CSDL + 1 (Phải dùng `LockService` để tránh 2 người tạo trùng ID cùng lúc).

### 1.4 Múi giờ & Kiểu dữ liệu Date
- Google Sheet lưu ngày tháng dưới dạng **Serial Date Number**.
- Khi `getValues()`, GAS sẽ tự chuyển thành JavaScript `Date` object theo múi giờ của Sheet (`File > Settings > Timezone`).
- ⚠️ **Lỗi thường gặp:** Múi giờ của Script (`appsscript.json`) khác múi giờ của Sheet dẫn đến ngày bị lệch ±1 ngày hay sai giờ.
- **Giải pháp:** Đồng bộ múi giờ trong `appsscript.json` (ví dụ `"timeZone": "Asia/Ho_Chi_Minh"`) trùng khớp với cài đặt của Trang tính.
- Định dạng ngày tháng trước khi trả về Frontend: Dùng `Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")` hoặc truyền dưới dạng ISO string (`date.toISOString()`).

---

## 2. TỐI ƯU & XỬ LÝ BACKEND TRONG CODE.GS

### 2.1 Chuẩn hóa Cấu trúc Phản hồi (API Response Standard)
Luôn trả về một Object có cấu trúc nhất định để Frontend dễ xử lý lỗi:
```javascript
function createApiResponse(success, data = null, errorMessage = "") {
  return {
    success: success,
    data: data,
    error: errorMessage,
    timestamp: new Date().toISOString()
  };
}

// Ví dụ trong hàm backend:
function getContentById(contentId) {
  try {
    // Logic lấy dữ liệu ...
    if (!content) {
      return createApiResponse(false, null, "Không tìm thấy nội dung!");
    }
    return createApiResponse(true, content);
  } catch (err) {
    Logger.log("Lỗi getContentById: " + err.toString());
    return createApiResponse(false, null, "Lỗi máy chủ: " + err.message);
  }
}
```

### 2.2 Sử dụng CacheService để giảm tải đọc Sheet
Những dữ liệu ít thay đổi (ví dụ: Danh sách danh mục, Quyền người dùng, Cấu hình hệ thống) nên được lưu vào `CacheService`:
```javascript
function getUsersCached() {
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get("USERS_LIST");
  
  if (cachedData) {
    return JSON.parse(cachedData);
  }
  
  // Nếu chưa có cache, đọc từ Sheet
  const users = getUsersFromSheet(); // Hàm đọc sheet
  cache.put("USERS_LIST", JSON.stringify(users), 1500); // Cache trong 25 phút (tối đa 21600s = 6h)
  return users;
}
```
*Lưu ý: Khi có thao tác Thêm/Sửa/Xóa Người dùng, nhớ xóa cache:* `CacheService.getScriptCache().remove("USERS_LIST");`

### 2.3 Bẫy lỗi & Ghi Log chuyên nghiệp (Logging)
- Đừng để lỗi uncaught exception bắn về Client làm đứt đoạn trải nghiệm.
- Tạo 1 sheet tên `Logs` để ghi lại các lỗi quan trọng ở backend giúp debug khi sản phẩm đã chạy trên thực tế.

---

## 3. TƯƠNG TÁC FRONTEND <-> BACKEND (GOOGLE.SCRIPT.RUN)

### 3.1 Chuyển đổi google.script.run thành Promise
Dùng Callback gốc của `google.script.run` dễ gây nên "Callback Hell". Hãy bọc nó bằng `Promise` ở `JavaScript.html`:

```javascript
// Bọc wrapper Promise cho tất cả các hàm gọi Backend
function runGAS(functionName, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((response) => resolve(response))
      .withFailureHandler((error) => reject(error))
      [functionName](...args);
  });
}

// Cách sử dụng siêu gọn nhẹ với async/await ở Frontend:
async function loadData() {
  showSpinner();
  try {
    const res = await runGAS("getContentsList", { status: "Pending" });
    if (res.success) {
      renderTable(res.data);
    } else {
      alert("Lỗi: " + res.error);
    }
  } catch (err) {
    console.error("Lỗi kết nối GAS:", err);
    alert("Không thể kết nối tới máy chủ Google!");
  } finally {
    hideSpinner();
  }
}
```

### 3.2 Các Giới hạn của Tham số truyền nhận
- `google.script.run` **chỉ truyền được các kiểu dữ liệu có thể tuần tự hóa JSON (JSON serializable)**:
  - ✅ Được phép: `String`, `Number`, `Boolean`, `Array`, `Object chuẩn`.
  - ❌ KHÔNG được phép: `Date Object` nguyên bản (nên `.toISOString()`), `Function`, `DOM Elements`, `Blob` (trừ khi chuyển thành Base64 string).

### 3.3 Ngăn chặn Double-Submit (Click nhiều lần)
- Luôn **disable** nút hành động (Submit/Update/Delete) và hiển thị Loading Spinner ngay khi bắt đầu gọi `google.script.run`.
- Re-enable nút trong khối `finally` của Promise.

---

## 4. BẢO MẬT, TRANH CHẤP DỮ LIỆU & LOCKSERVICE

### 4.1 Sử dụng LockService chống xung đột ghi (Concurrency Control)
Khi 2 người dùng bấm "Lưu" hoặc "Duyệt bài" cùng một thời điểm, dữ liệu có thể bị ghi đè (Race Condition).
```javascript
function approveContent(contentId, note) {
  // Lấy lock toàn hệ thống
  const lock = LockService.getScriptLock();
  
  // Đợi tối đa 10 giây để lấy quyền ghi
  const success = lock.tryLock(10000);
  if (!success) {
    return createApiResponse(false, null, "Hệ thống đang bận do có người khác đang ghi dữ liệu. Vui lòng thử lại sau vài giây!");
  }
  
  try {
    // --- THỰC HIỆN ĐỌC VÀ GHI ĐẾN SHEET TẠI ĐÂY ---
    const sheet = getSheetByName("Contents");
    // ... logic cập nhật trạng thái ...
    
    return createApiResponse(true, "Duyệt bài thành công!");
  } catch (err) {
    return createApiResponse(false, null, err.message);
  } finally {
    // BẮT BUỘC phải giải phóng lock trong khối finally
    lock.releaseLock();
  }
}
```

### 4.2 Bảo mật Phân quyền (Role-based Security)
- **Không bao giờ tin tưởng Frontend gửi Role lên.** (Ví dụ: Frontend gửi `{ email: "abc@gmail.com", role: "Admin" }`).
- Ở Backend (`Code.gs`), **luôn luôn xác thực lại người dùng bằng `Session.getActiveUser().getEmail()`**:
  ```javascript
  function deleteContent(contentId) {
    const userEmail = Session.getActiveUser().getEmail();
    const userRole = getUserRoleFromSheet(userEmail); // Tra cứu trực tiếp từ CSDL
    
    if (userRole !== "Admin") {
      return createApiResponse(false, null, "BẠN KHÔNG CÓ QUYỀN XÓA NỘI DUNG NÀY!");
    }
    // Thực hiện xóa ...
  }
  ```

---

## 5. TRIỂN KHAI WEB APP & QUẢN LÝ PHIÊN BẢN (DEPLOY)

### 5.1 Phân biệt URL Chạy thử (`/dev`) và URL Chính thức (`/exec`)
- **Dev URL (`.../dev`):** Luôn phản ánh code mới nhất vừa chỉnh sửa trong editor. Chỉ dành cho lập trình viên/Admin xem thử. Người dùng thường sẽ bị lỗi thiếu quyền nếu truy cập link này.
- **Exec URL (`.../exec`):** Dành cho Người dùng cuối. Đảm bảo tính ổn định.

> [!WARNING]
> **LỖI PHỔ BIẾN NHẤT:** Chỉnh sửa code trong `Code.gs` hay `HTML` xong nhưng người dùng vào Web App không thấy có sự thay đổi.
> **LÝ DO:** Bạn chưa tạo **New Version Deployment**!

### 5.2 Quy trình cập nhật Web App khi sửa code:
1. Nhấn nút **Deploy (Triển khai)** ở góc trên bên phải.
2. Chọn **Manage deployments (Quản lý các bản triển khai)**.
3. Chọn bản triển khai Web app hiện tại, bấm biểu tượng **Pencil (Chỉnh sửa)**.
4. Ở mục Version (Phiên bản), chọn **New version (Phiên bản mới)**.
5. Điền mô tả ngắn về thay đổi (ví dụ: `v1.2 - Sửa lỗi giao diện duyệt bài`).
6. Nhấn **Deploy**.

---

## 6. QUẢN LÝ GIỚI HẠN (QUOTAS & LIMITS) CỦA GOOGLE

| Tính năng | Tài khoản Gmail miễn phí (`@gmail.com`) | Tài khoản Google Workspace |
|---|---|---|
| **Thời gian chạy tối đa 1 lần (Execution Time)** | 6 phút / lượt | 30 phút / lượt |
| **Số Email gửi qua MailApp/GmailApp** | 100 email / ngày | 1,500 email / ngày |
| **Kích thước file Google Sheet tối đa** | 10 triệu ô (cells) | 10 triệu ô (cells) |
| **Kích thước phản hồi URL Fetch** | 50 MB | 50 MB |

### Cắt giảm Email gửi tự động:
- Đừng gửi email khi không thực sự cần thiết.
- Gộp các thông báo nhiều bài duyệt thành **1 Email tổng hợp cuối ngày** (dùng Trigger theo giờ) thay vì mỗi bài gửi 1 email riêng lẻ nếu số lượng bài duyệt lớn.

---

## 7. CHECKLIST KIỂM TRA TRƯỚC KHI RELEASE

Trước khi bàn giao hoặc đẩy phiên bản mới lên sử dụng chính thức, hãy rà soát kỹ bảng kiểm tra này:

- [ ] **Múi giờ:** Đã kiểm tra `appsscript.json` và cài đặt Google Sheet cùng là `Asia/Ho_Chi_Minh` (GMT+7).
- [ ] **Vòng lặp Sheet:** Không còn lệnh `getValue()` hay `setValue()` nào nằm trong vòng lặp `for`/`while`.
- [ ] **LockService:** Các hàm Thêm/Sửa/Xóa dữ liệu CSDL đã được bọc `LockService` và giải phóng `lock.releaseLock()` trong `finally`.
- [ ] **Xác thực Backend:** Các hàm nhạy cảm (Duyệt, Xóa, Phân quyền) ở Backend đã dùng `Session.getActiveUser().getEmail()` để kiểm tra quyền, không phụ thuộc vào dữ liệu role client truyền lên.
- [ ] **Kiểu dữ liệu Date:** Toàn bộ ngày tháng truyền từ Backend về Frontend đã được format sang chuỗi `YYYY-MM-DD` hoặc `ISO String`.
- [ ] **UI Loading State:** Các nút bấm ở Frontend đã có hiệu ứng Loading và bị `disabled` ngay khi click để tránh đúp request.
- [ ] **Quản lý phiên bản:** Đã chọn **Deploy > Manage Deployments > New Version** để phát hành code mới cho URL `/exec`.

---
*Tài liệu này được biên soạn cho dự án Quản lý & Duyệt Nội dung Hội Thánh (Google Apps Script CMS).*
