---
title: "Phân tích và kế hoạch tối ưu hiệu năng GGSheet-QLHT"
repository: "https://github.com/haiyenpa25/GGSheet-QLHT"
platform: "Google Apps Script + Google Sheets"
target_agent: "Antigravity"
status: "Đề xuất triển khai"
date: "2026-08-20"
language: "vi"
---

# PHÂN TÍCH VÀ KẾ HOẠCH TỐI ƯU HIỆU NĂNG GGSheet-QLHT

## 1. Mục tiêu

Tối ưu tốc độ xử lý của hệ thống **GGSheet-QLHT**, hiện đang sử dụng:

- Google Apps Script làm backend.
- Google Sheets làm cơ sở dữ liệu.
- HTML, CSS và JavaScript làm frontend.
- Hai nhóm chức năng chính:
  - `QuanLyHoiThanh`: quản lý Hội Thánh và Ban Ngành.
  - `QuanLyBanNganh`: quản lý thành viên, tổ nhóm, điểm danh, tài chính, lịch, thăm viếng và cài đặt.

Mục tiêu của đợt tối ưu:

1. Giảm thời gian chờ khi mở ứng dụng.
2. Giảm thời gian chờ khi lưu, sửa hoặc xóa dữ liệu.
3. Không tải lại toàn bộ cơ sở dữ liệu sau mỗi thao tác.
4. Giảm số lần gọi `SpreadsheetApp`.
5. Chuyển các thao tác nhiều dòng sang batch read và batch write.
6. Giảm số lần render lại giao diện.
7. Chuẩn bị kiến trúc để hệ thống tiếp tục hoạt động ổn định khi dữ liệu tăng.

---

# 2. Kết luận chính

Google Sheets chưa phải nguyên nhân duy nhất gây chậm.

Nút thắt lớn nhất nằm ở luồng xử lý hiện tại:

```text
Người dùng bấm Lưu
        ↓
Frontend gọi Apps Script để ghi dữ liệu
        ↓
Backend quét Sheet và ghi dữ liệu
        ↓
Frontend gọi refreshData()
        ↓
Backend chạy setupDatabase()
        ↓
Đọc toàn bộ tất cả các tab Google Sheets
        ↓
Trả lại toàn bộ dữ liệu về trình duyệt
        ↓
Frontend render lại tất cả màn hình
```

Một thao tác đơn giản như sửa số điện thoại của một thành viên có thể kéo theo:

1. Quét Sheet để tìm thành viên.
2. Ghi từng ô.
3. Gọi server lần thứ hai.
4. Kiểm tra lại cấu trúc database.
5. Đọc lại toàn bộ thành viên.
6. Đọc lại toàn bộ tổ nhóm.
7. Đọc lại toàn bộ điểm danh.
8. Đọc lại toàn bộ thu chi.
9. Đọc lại toàn bộ lịch.
10. Đọc lại toàn bộ thăm viếng.
11. Truyền toàn bộ JSON về trình duyệt.
12. Render lại tất cả giao diện, kể cả các màn hình đang bị ẩn.

Đây là nguyên nhân chính khiến người dùng phải chờ lâu.

---

# 3. Kiến trúc hiện tại và kiến trúc mục tiêu

## 3.1. Kiến trúc hiện tại

```text
Lưu bản ghi
→ đọc toàn Sheet
→ ghi nhiều ô
→ tải lại tất cả Sheet
→ gửi tất cả dữ liệu
→ render tất cả màn hình
```

## 3.2. Kiến trúc mục tiêu

```text
Lưu bản ghi
→ tìm dòng bằng cột ID
→ ghi một lần bằng setValues()
→ trả bản ghi vừa lưu
→ cập nhật state phía frontend
→ render đúng một module
```

## 3.3. Kiến trúc nhập hàng loạt hiện tại

```text
N bản ghi
→ N lần insert/update
→ nhiều lần đọc lại Sheet
→ nhiều lần lock
```

## 3.4. Kiến trúc nhập hàng loạt mục tiêu

```text
Đọc dữ liệu một lần
→ tạo Map để tra cứu
→ xử lý toàn bộ trong bộ nhớ
→ ghi theo lô
→ trả kết quả tổng hợp
```

---

# 4. Danh sách nút thắt theo mức độ ưu tiên

## P0 — Tải lại toàn bộ database sau gần như mọi thao tác

Frontend hiện gọi:

```javascript
await refreshData(false);
```

sau khi lưu hoặc xóa:

- Thành viên.
- Tổ nhóm.
- Giao dịch.
- Lịch.
- Điểm danh.
- Thăm viếng.

`refreshData()` tiếp tục gọi:

```javascript
apiGetInitialData
```

Backend lại đọc toàn bộ tất cả các Sheet.

### Vấn đề

Một thao tác cập nhật một bản ghi lại kéo theo:

```text
2 lần gọi server
+ đọc toàn bộ database
+ truyền toàn bộ JSON
+ render toàn bộ giao diện
```

### Phương án tối ưu

Sau khi lưu, backend trả lại chính bản ghi vừa lưu:

```javascript
{
  success: true,
  data: {
    record: savedMember,
    version: 125
  }
}
```

Frontend cập nhật bản ghi trong state:

```javascript
upsertById(state.members, response.data.record);
renderMembers();
renderDashboardKpis();
```

Không gọi `refreshData()` toàn bộ sau mỗi thao tác CRUD.

### Yêu cầu triển khai

- Mỗi API tạo, sửa hoặc xóa phải trả dữ liệu cần thiết để frontend tự cập nhật state.
- Chỉ tải lại module khi thực sự cần.
- Không gọi lại `apiGetInitialData()` sau thao tác CRUD bình thường.

---

## P0 — `setupDatabase()` chạy trong luồng tải dữ liệu bình thường

Trong `apiGetInitialData()` hiện có:

```javascript
setupDatabase(customSheetId);
```

Điều này khiến mỗi lần mở ứng dụng hoặc refresh dữ liệu, chương trình lại kiểm tra cấu trúc các tab và cột.

### Vấn đề

Kiểm tra hoặc nâng cấp schema không nên nằm trong luồng đọc dữ liệu thường xuyên.

### Phương án

Dùng phiên bản schema:

```javascript
const DATABASE_SCHEMA_VERSION = '2026.08.20.01';
```

Lưu phiên bản theo từng Spreadsheet:

```text
schema_version:<spreadsheetId>
```

Ví dụ:

```javascript
function ensureDatabaseSchemaOnce_(spreadsheetId) {
  const properties = PropertiesService.getScriptProperties();
  const key = `schema_version:${spreadsheetId}`;
  const currentVersion = properties.getProperty(key);

  if (currentVersion === DATABASE_SCHEMA_VERSION) {
    return;
  }

  setupDatabase(spreadsheetId);
  properties.setProperty(key, DATABASE_SCHEMA_VERSION);
}
```

### Chỉ chạy `setupDatabase()` khi

- Tạo Google Sheet mới.
- Quản trị viên bấm “Đồng bộ cấu trúc”.
- Phiên bản schema trong code cao hơn phiên bản đã lưu.
- Không tìm thấy Sheet bắt buộc.

### Không được

- Không chạy `setupDatabase()` trong mỗi lần `apiGetInitialData()`.
- Không chạy schema migration trong các API CRUD thông thường.

---

## P0 — Sửa một bản ghi nhưng ghi từng ô một

Hàm `sheetUpdate()` đang thực hiện:

1. Đọc toàn bộ Sheet bằng `getDataRange().getValues()`.
2. Tìm dòng có ID.
3. Duyệt từng cột.
4. Gọi `setValue()` riêng cho từng ô cần sửa.

Ví dụ dạng hiện tại:

```javascript
headers.forEach((h, colIdx) => {
  if (updates[h] !== undefined) {
    sheet.getRange(i + 1, colIdx + 1).setValue(updates[h]);
  } else if (updates[norm] !== undefined) {
    sheet.getRange(i + 1, colIdx + 1).setValue(updates[norm]);
  }
});
```

### Vấn đề

Mỗi lần `getRange()` hoặc `setValue()` là một lần Apps Script làm việc với Spreadsheet Service.

Ghi từng ô làm tăng đáng kể thời gian xử lý.

### Phương án tối ưu

Tạo toàn bộ dòng mới trong bộ nhớ và ghi một lần:

```javascript
function sheetUpdateOptimized_(sheet, targetRow, headers, currentRow, updates) {
  const updatedRow = [...currentRow];

  headers.forEach((header, index) => {
    const normalized = normalizeHeaderKey(header);

    if (Object.prototype.hasOwnProperty.call(updates, header)) {
      updatedRow[index] = updates[header];
      return;
    }

    if (Object.prototype.hasOwnProperty.call(updates, normalized)) {
      updatedRow[index] = updates[normalized];
    }
  });

  sheet
    .getRange(targetRow, 1, 1, updatedRow.length)
    .setValues([updatedRow]);

  return updatedRow;
}
```

### Tối ưu thêm

Không đọc toàn bộ các cột để tìm ID.

Luồng đề xuất:

```text
1. Đọc hàng tiêu đề.
2. Xác định vị trí cột ID.
3. Chỉ đọc cột ID.
4. Tìm dòng cần sửa.
5. Chỉ đọc một dòng đó.
6. Ghi lại một dòng bằng setValues().
```

### Yêu cầu triển khai

- Không gọi `setValue()` trong vòng lặp cập nhật nhiều cột.
- Một bản ghi chỉ được ghi bằng một lần `setValues()`.
- Hàm update phải trả về object sau cập nhật.

---

## P0 — Gán tổ hàng loạt nhưng vẫn ghi từng thành viên

`apiBatchAssignGroup()` đang tìm đúng danh sách thành viên nhưng vẫn gọi:

```javascript
sheet.getRange(i + 1, toIdColIdx + 1).setValue(toId || '');
```

cho từng thành viên.

### Vấn đề

Nếu gán 100 thành viên, có thể phát sinh gần 100 lượt ghi riêng.

### Phương án

Đọc riêng cột ID và cột tổ nhóm:

```javascript
const idValues = sheet
  .getRange(2, idColumn, rowCount, 1)
  .getValues();

const groupValues = sheet
  .getRange(2, groupColumn, rowCount, 1)
  .getValues();

for (let i = 0; i < idValues.length; i++) {
  if (memberIdSet.has(String(idValues[i][0]))) {
    groupValues[i][0] = toId || '';
  }
}

sheet
  .getRange(2, groupColumn, rowCount, 1)
  .setValues(groupValues);
```

### Mục tiêu

Dù gán 10 hay 500 thành viên:

```text
1 lần đọc cột ID
+ 1 lần đọc cột tổ
+ 1 lần ghi cột tổ
```

---

## P0 — Nhập thành viên hàng loạt đang CRUD từng dòng

Trong `apiBulkImportMembers()`:

- Chạy lại `setupDatabase()`.
- Đọc toàn bộ tổ nhóm.
- Đọc toàn bộ thành viên.
- Với mỗi dòng nhập:
  - Dùng `.find()` để tìm tổ.
  - Có thể gọi `sheetInsert()` để tạo tổ.
  - Dùng `.find()` để tìm thành viên.
  - Gọi `sheetUpdate()` hoặc `sheetInsert()` riêng.

### Vấn đề

Nếu nhập `N` thành viên:

```text
N × số thành viên hiện có
```

cho các thao tác `.find()` lặp lại.

Đồng thời có nhiều lần gọi Spreadsheet Service.

### Kiến trúc nhập hàng loạt đúng

```text
1. Đọc header một lần.
2. Đọc tổ nhóm một lần.
3. Đọc thành viên một lần.
4. Tạo Map cho tổ nhóm.
5. Tạo Map cho thành viên.
6. Xử lý toàn bộ dữ liệu trong RAM.
7. Ghi các tổ mới bằng một setValues().
8. Ghi các thành viên mới bằng một setValues().
9. Ghi các dòng cập nhật bằng một hoặc vài setValues().
```

### Dùng Map thay cho `.find()`

```javascript
const groupByName = new Map();
const memberByIdentity = new Map();
```

Ví dụ:

```javascript
existingGroups.forEach(group => {
  const key = normalizeText_(group.tenTo);
  groupByName.set(key, group);
});

existingMembers.forEach(member => {
  const key = buildMemberIdentityKey_(member);
  memberByIdentity.set(key, member);
});
```

### Mục tiêu

Nhập 500 thành viên không được gọi 500 lần `sheetInsert()` hoặc `sheetUpdate()`.

Mục tiêu:

```text
2–4 lượt đọc dữ liệu
+
2–4 lượt ghi dữ liệu theo lô
```

---

## P0 — `getScriptLock()` khiến các Ban Ngành chờ lẫn nhau

Các hàm insert, update, delete và điểm danh đang dùng:

```javascript
const lock = LockService.getScriptLock();
lock.waitLock(6000);
```

hoặc:

```javascript
lock.waitLock(8000);
```

### Vấn đề

`getScriptLock()` khóa trên phạm vi toàn bộ Apps Script project.

Hai Ban Ngành dùng hai Google Sheet khác nhau nhưng dùng chung Apps Script vẫn có thể phải chờ nhau.

Ví dụ:

```text
Ban Thanh Niên đang lưu dữ liệu
        ↓
Ban Trung Niên cũng lưu dữ liệu
        ↓
Ban Trung Niên phải đợi script lock
```

### Vấn đề bổ sung

Nếu mã đang bỏ qua lỗi timeout:

```javascript
try {
  lock.waitLock(6000);
} catch (e) {}
```

thì sau khi không lấy được lock, chương trình vẫn có thể tiếp tục ghi dữ liệu.

Điều này vừa gây chờ, vừa không bảo đảm an toàn đồng thời.

### Phương án trước mắt

```javascript
if (!lock.tryLock(1500)) {
  throw new Error(
    'Hệ thống đang xử lý một yêu cầu khác. Vui lòng thực hiện lại.'
  );
}
```

### Nguyên tắc sử dụng lock

- Chuẩn bị dữ liệu trước khi lấy lock.
- Chỉ giữ lock trong phần ghi dữ liệu.
- Không chạy `setupDatabase()` trong khi đang giữ lock.
- Không xử lý vòng lặp dài trong khi đang giữ lock.
- Batch operation chỉ dùng một lock.
- Không lock từng dòng trong thao tác hàng loạt.
- Luôn dùng `finally` để giải phóng lock.

Ví dụ:

```javascript
const lock = LockService.getScriptLock();

if (!lock.tryLock(1500)) {
  throw new Error('Hệ thống đang bận. Vui lòng thử lại.');
}

try {
  // Chỉ thực hiện phần ghi dữ liệu cần bảo vệ.
} finally {
  lock.releaseLock();
}
```

### Phương án dài hạn

Nếu số người thao tác đồng thời cao:

- Deploy Apps Script riêng theo từng Ban Ngành; hoặc
- Chuyển phần ghi dữ liệu sang backend có cơ chế khóa theo `spreadsheetId`.

---

## P1 — Điểm danh tải toàn bộ lịch sử

`apiSaveAttendance()` đã dùng `setValues()` theo lô, đây là điểm tốt.

Tuy nhiên, `apiGetInitialData()` đang trả về toàn bộ Sheet `DiemDanh`.

### Vấn đề

Dữ liệu điểm danh tăng theo:

```text
Số thành viên × số buổi điểm danh
```

Ví dụ:

```text
150 thành viên × 52 tuần = 7.800 dòng/năm
150 thành viên × 5 năm = 39.000 dòng
```

Không nên gửi toàn bộ 39.000 dòng về trình duyệt khi người dùng chỉ sửa một thông tin thành viên.

### Phương án

Tách API:

```javascript
apiGetAttendanceSummary()
apiGetAttendanceByDate(date)
apiGetAttendanceRange(fromDate, toDate)
apiSaveAttendanceForDate(payload)
```

### Luồng đề xuất

- Khi mở màn hình điểm danh, chỉ lấy ngày đang chọn.
- Dashboard chỉ lấy số liệu tổng hợp.
- Cảnh báo vắng chỉ lấy ba buổi gần nhất.
- Báo cáo mới tải theo khoảng thời gian.

---

## P1 — Có nguy cơ ghi trùng dữ liệu điểm danh

Hàm lưu điểm danh append các bản ghi mới.

Nếu không xóa hoặc cập nhật bản ghi cũ theo khóa:

```text
ngayDiemDanh + thanhVienId
```

thì lưu lại cùng ngày có thể tạo dữ liệu trùng.

### Phương án

Dùng khóa nghiệp vụ:

```text
attendanceKey = ngayDiemDanh + ":" + thanhVienId
```

Khi lưu:

1. Đọc dữ liệu của ngày đang chọn.
2. Tạo Map theo `attendanceKey`.
3. Cập nhật bản ghi đã có.
4. Thêm bản ghi chưa có.
5. Ghi lại phạm vi cần thiết.

Hoặc dùng chiến lược:

```text
Xóa toàn bộ điểm danh của ngày đang chọn
→ ghi lại toàn bộ danh sách của ngày đó bằng setValues()
```

Chiến lược thứ hai thường đơn giản hơn với Google Sheets nếu dữ liệu mỗi ngày không quá lớn.

---

## P1 — Frontend render lại tất cả giao diện

`renderAll()` đang chạy:

```javascript
renderDashboard();
renderBirthdays();
renderAbsenceWarnings();
renderMembers();
renderGroups();
renderAttendance();
renderFinance();
renderSchedule();
renderVisitations();
renderSettings();
```

### Vấn đề

Dù người dùng đang ở màn hình thành viên, chương trình vẫn render:

- Điểm danh.
- Tài chính.
- Lịch.
- Thăm viếng.
- Cài đặt.
- Dashboard.

### Phương án

Chỉ render màn hình hiện tại:

```javascript
function renderCurrentView() {
  switch (state.currentView) {
    case 'dashboard':
      renderDashboard();
      renderBirthdays();
      renderAbsenceWarnings();
      break;

    case 'members':
      renderMembers();
      break;

    case 'attendance':
      renderAttendance();
      break;

    case 'finance':
      renderFinance();
      break;

    case 'schedule':
      renderSchedule();
      break;

    case 'visitations':
      renderVisitations();
      break;

    case 'settings':
      renderSettings();
      break;
  }
}
```

### Dirty flags

```javascript
state.dirty = {
  dashboard: true,
  members: true,
  groups: true,
  attendance: false,
  finance: false,
  schedule: false,
  visitations: false,
  settings: false
};
```

Chỉ render khi module đang `dirty`.

---

## P1 — Bấm điểm danh một người nhưng dựng lại toàn bộ danh sách

Luồng hiện tại có dạng:

```javascript
state.liveAttendance[memberId][field] = val;
renderAttendanceList();
```

### Vấn đề

Mỗi lần bấm checkbox:

- Dựng lại toàn bộ chuỗi HTML.
- Thay lại `innerHTML`.
- Tạo lại toàn bộ DOM.
- Có thể mất focus.
- Chậm khi danh sách lớn.

### Phương án

Chỉ cập nhật dòng vừa thay đổi:

```javascript
function handleToggleLiveAttendance(memberId, field, value) {
  const record = state.liveAttendance[memberId];
  record[field] = value;

  updateAttendanceRow(memberId);
  updateAttendanceSummary();
}
```

Chỉ cập nhật:

- Một dòng vừa thay đổi.
- Bộ đếm có mặt.
- Bộ đếm thuộc câu gốc.
- Phần trăm.

---

## P1 — Cảnh báo vắng dùng `.find()` lặp lại nhiều lần

Thuật toán hiện tại có dạng:

```javascript
for (const date of recentDates) {
  const record = allAttendance.find(item =>
    item.ngayDiemDanh === date &&
    String(item.thanhVienId) === String(member.id)
  );
}
```

### Vấn đề

`.find()` quét tuyến tính từ đầu mảng cho mỗi thành viên và mỗi ngày.

### Phương án

Tạo index một lần:

```javascript
const attendanceIndex = new Map();

state.attendances.forEach(record => {
  const key =
    `${record.ngayDiemDanh}:${String(record.thanhVienId)}`;

  attendanceIndex.set(key, record);
});
```

Tra cứu:

```javascript
const record = attendanceIndex.get(
  `${date}:${member.id}`
);
```

Tốt hơn nữa, backend chỉ gửi dữ liệu ba ngày gần nhất cho widget cảnh báo vắng.

---

## P1 — Local cache chỉ hiển thị sớm, không giảm công việc server

Frontend đọc dữ liệu từ `localStorage`, hiển thị dữ liệu cũ, sau đó vẫn gọi:

```javascript
await refreshData(false);
```

### Vấn đề

Cache hiện tại không giảm:

- Số lần gọi Apps Script.
- Số Sheet backend phải đọc.
- Kích thước JSON trả về.
- Số lần render toàn bộ.

### Phương án

Dùng phiên bản dữ liệu:

```text
clientVersion = 125
serverVersion = 125
→ không cần tải lại

clientVersion = 125
serverVersion = 126
→ chỉ tải module đã thay đổi
```

Có thể dùng `CacheService` cho:

- Dashboard KPI.
- Danh sách tổ nhóm.
- Chủ đề.
- Cấu hình ít thay đổi.
- Ba ngày điểm danh gần nhất.

### Lưu ý

Cache chỉ là dữ liệu tạm.

Luôn phải có fallback đọc Google Sheets.

---

## P1 — `QuanLyHoiThanh` lọc Ban Ngành nhiều lần

Luồng có dạng:

```javascript
const churches = sheetFindAll(SHEET_NAMES.HOI_THANH);
const ministries = sheetFindAll(SHEET_NAMES.BAN_NGANH);

churches.forEach(church => {
  church.soLuongBanNganh = ministries.filter(...).length;
});
```

### Vấn đề

Mỗi Hội Thánh lại lọc toàn bộ danh sách Ban Ngành.

### Phương án

Duyệt một lần:

```javascript
const ministryCountByChurch = new Map();

ministries.forEach(ministry => {
  const key = String(ministry.hoiThanhId);

  ministryCountByChurch.set(
    key,
    (ministryCountByChurch.get(key) || 0) + 1
  );
});

churches.forEach(church => {
  church.soLuongBanNganh =
    ministryCountByChurch.get(String(church.id)) || 0;
});
```

---

## P1 — Lưu URL Web App đang update từng Ban Ngành

Khi đổi URL Web App, chương trình có thể đang:

1. Đọc toàn bộ Ban Ngành.
2. Duyệt từng Ban Ngành.
3. Gọi `sheetUpdate()` riêng cho từng dòng.

### Vấn đề

Nếu `sheetUpdate()` lại đọc toàn bộ Sheet để tìm dòng thì độ phức tạp tăng mạnh.

### Phương án

```text
Đọc Sheet một lần
→ cập nhật toàn bộ mảng trong RAM
→ ghi lại bằng một lần setValues()
```

---

# 5. Kiến trúc API đề xuất

Không tiếp tục dùng một API khổng lồ:

```javascript
apiGetInitialData()
```

trả toàn bộ dữ liệu.

## 5.1. Bootstrap API

```javascript
apiGetBootstrapData(sheetId)
```

Trả về:

- Tên Ban Ngành.
- Theme.
- KPI cơ bản.
- Danh sách tổ nhóm.
- Thông tin Spreadsheet.
- Phiên bản dữ liệu.
- Quyền người dùng nếu có.

## 5.2. Thành viên

```javascript
apiGetMembers(sheetId, options)
```

`options`:

```javascript
{
  keyword: '',
  groupId: '',
  status: '',
  page: 1,
  pageSize: 50,
  sortBy: 'hoTen',
  sortDirection: 'asc'
}
```

## 5.3. Điểm danh

```javascript
apiGetAttendanceByDate(sheetId, date)
apiGetAttendanceSummary(sheetId)
apiGetAttendanceRange(sheetId, fromDate, toDate)
apiSaveAttendanceForDate(sheetId, payload)
```

## 5.4. Tài chính

```javascript
apiGetTransactions(sheetId, {
  page,
  pageSize,
  fromDate,
  toDate,
  type,
  fundId
})
```

## 5.5. Lịch

```javascript
apiGetSchedule(sheetId, {
  year,
  quarter,
  month
})
```

## 5.6. Thăm viếng

```javascript
apiGetVisitations(sheetId, {
  page,
  pageSize,
  fromDate,
  toDate,
  memberId
})
```

---

# 6. Luồng frontend mục tiêu

```text
Mở ứng dụng
    ↓
Tải bootstrap data
    ↓
Render dashboard

Người dùng vào Thành viên
    ↓
Chỉ tải Thành viên

Người dùng vào Tài chính
    ↓
Chỉ tải 50 giao dịch gần nhất

Người dùng vào Điểm danh
    ↓
Chỉ tải ngày đang chọn
```

---

# 7. Quy tắc làm việc với Google Sheets

## Bắt buộc

1. Đọc theo khối bằng `getValues()`.
2. Xử lý dữ liệu trong mảng JavaScript.
3. Ghi theo khối bằng `setValues()`.
4. Không gọi `setValue()` trong vòng lặp lớn.
5. Không gọi `getRange()` lặp lại nếu có thể lấy một range lớn.
6. Không đọc toàn bộ workbook cho một thao tác nhỏ.
7. Không tải toàn bộ lịch sử giao dịch khi chỉ cần dữ liệu hiện tại.
8. Dùng `Map` và `Set` để tra cứu.
9. Chỉ giữ lock trong phần ghi dữ liệu.
10. Trả về dữ liệu vừa thay đổi để frontend cập nhật cục bộ.

---

# 8. Kế hoạch triển khai theo giai đoạn

## Giai đoạn 1 — Tối ưu hạ tầng đọc và ghi

### Công việc

1. Viết helper đọc header.
2. Viết helper tìm dòng theo ID bằng một cột.
3. Viết lại `sheetUpdate()`.
4. Viết helper batch insert.
5. Viết helper batch update.
6. Chuẩn hóa kết quả trả về của API.
7. Thêm schema version.
8. Bỏ `setupDatabase()` khỏi luồng tải bình thường.

### Kết quả mong đợi

- Một thao tác update chỉ ghi một lần.
- Không còn `setValue()` trong vòng lặp update.
- Không còn chạy setup database mỗi lần tải.

---

## Giai đoạn 2 — Tối ưu CRUD frontend

### Công việc

1. Bỏ `refreshData()` sau lưu thành viên.
2. Bỏ `refreshData()` sau xóa thành viên.
3. Bỏ `refreshData()` sau lưu tổ nhóm.
4. Bỏ `refreshData()` sau lưu tài chính.
5. Bỏ `refreshData()` sau lưu lịch.
6. Bỏ `refreshData()` sau lưu thăm viếng.
7. Cập nhật state cục bộ bằng kết quả API.
8. Chỉ render module liên quan.

### Kết quả mong đợi

```text
1 thao tác CRUD
→ 1 lần gọi server
→ cập nhật state
→ render một module
```

---

## Giai đoạn 3 — Tối ưu thao tác hàng loạt

### Công việc

1. Viết lại `apiBatchAssignGroup()`.
2. Viết lại `apiBulkImportMembers()`.
3. Dùng `Map` để tra cứu tổ nhóm.
4. Dùng `Map` để tra cứu thành viên.
5. Batch insert các tổ mới.
6. Batch insert các thành viên mới.
7. Batch update các thành viên cũ.
8. Chỉ dùng một lock cho toàn bộ giao dịch.

### Kết quả mong đợi

- Nhập 500 dòng không gọi 500 CRUD.
- Gán tổ cho 500 thành viên chỉ ghi một hoặc vài lần.

---

## Giai đoạn 4 — Tách API theo module

### Công việc

1. Tạo `apiGetBootstrapData()`.
2. Tạo API thành viên.
3. Tạo API điểm danh theo ngày.
4. Tạo API tài chính theo trang.
5. Tạo API lịch theo thời gian.
6. Tạo API thăm viếng theo trang.
7. Xóa phụ thuộc vào `apiGetInitialData()` khổng lồ.

### Kết quả mong đợi

- Chỉ tải dữ liệu khi người dùng mở module.
- Payload JSON nhỏ hơn.
- Thời gian mở app nhanh hơn.

---

## Giai đoạn 5 — Tối ưu giao diện

### Công việc

1. Tạo `renderCurrentView()`.
2. Thêm dirty flags.
3. Không render module đang ẩn.
4. Điểm danh chỉ cập nhật một dòng.
5. Dùng `Map` cho cảnh báo vắng.
6. Không thay toàn bộ `innerHTML` khi chỉ thay đổi một trạng thái.

### Kết quả mong đợi

- Giao diện phản hồi nhanh hơn.
- Không bị giật khi danh sách thành viên lớn.
- Không mất focus không cần thiết.

---

## Giai đoạn 6 — Cache và version

### Công việc

1. Tạo `dataVersion` theo module.
2. Tăng version khi dữ liệu thay đổi.
3. Frontend gửi version hiện có.
4. Backend chỉ trả dữ liệu khi version khác.
5. Dùng `CacheService` cho KPI và danh mục ít thay đổi.
6. Cache luôn có fallback về Google Sheets.

### Kết quả mong đợi

- Giảm số lần đọc dữ liệu không thay đổi.
- Giảm tải server.
- Tránh gửi lại dữ liệu giống hệt.

---

# 9. Thứ tự ưu tiên thực hiện

| Thứ tự | Hạng mục | Mức tác động |
|---:|---|---|
| 1 | Bỏ `refreshData()` toàn bộ sau CRUD | Rất lớn |
| 2 | Sửa `sheetUpdate()` thành một lần `setValues()` | Rất lớn |
| 3 | Sửa `apiBatchAssignGroup()` thành batch write | Rất lớn |
| 4 | Viết lại `apiBulkImportMembers()` bằng `Map` và batch write | Rất lớn |
| 5 | Không chạy `setupDatabase()` trong mỗi lần tải | Lớn |
| 6 | Chia nhỏ `apiGetInitialData()` theo module | Lớn |
| 7 | Tải điểm danh, tài chính và thăm viếng theo phạm vi | Lớn |
| 8 | Chỉ render màn hình hiện tại | Trung bình đến lớn |
| 9 | Thay `.find()` lặp lại bằng `Map` | Trung bình |
| 10 | Cache KPI và dữ liệu ít thay đổi | Trung bình |
| 11 | Lưu trữ hoặc tách dữ liệu lịch sử theo năm | Lớn khi dữ liệu tăng |

---

# 10. Tiêu chuẩn code cần tuân thủ

## 10.1. Backend Apps Script

- Dùng JSDoc cho các hàm public.
- Tên helper kết thúc bằng `_`.
- Validate input trước khi ghi.
- API trả cấu trúc thống nhất.
- Không nuốt exception.
- Dùng `try/finally` với lock.
- Không ghi log dữ liệu nhạy cảm.
- Không tạo Spreadsheet call trong vòng lặp nếu tránh được.
- Tách phần đọc, xử lý và ghi.

### Cấu trúc response đề xuất

```javascript
{
  success: true,
  data: {},
  meta: {
    version: 125,
    serverTime: '2026-08-20T10:00:00.000Z'
  },
  error: null
}
```

Khi lỗi:

```javascript
{
  success: false,
  data: null,
  meta: {
    serverTime: '2026-08-20T10:00:00.000Z'
  },
  error: {
    code: 'MEMBER_NOT_FOUND',
    message: 'Không tìm thấy thành viên.'
  }
}
```

## 10.2. Frontend

- State là nguồn dữ liệu chính của giao diện.
- Không gọi full refresh sau CRUD.
- Dùng `upsertById()`.
- Dùng `removeById()`.
- Render theo module.
- Không render lại toàn bộ DOM nếu chỉ thay một dòng.
- Có loading state theo từng module.
- Có error state rõ ràng.
- Không khóa toàn bộ giao diện khi chỉ một module đang tải.

---

# 11. Helper frontend đề xuất

## 11.1. Upsert bản ghi

```javascript
function upsertById(collection, record) {
  const index = collection.findIndex(
    item => String(item.id) === String(record.id)
  );

  if (index === -1) {
    collection.unshift(record);
    return;
  }

  collection[index] = {
    ...collection[index],
    ...record
  };
}
```

## 11.2. Xóa bản ghi

```javascript
function removeById(collection, id) {
  const index = collection.findIndex(
    item => String(item.id) === String(id)
  );

  if (index !== -1) {
    collection.splice(index, 1);
  }
}
```

## 11.3. Gọi Apps Script bằng Promise

```javascript
function callServer(functionName, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [functionName](...args);
  });
}
```

---

# 12. Đo lường hiệu năng

Cần thêm đo thời gian cho các API quan trọng.

## 12.1. Helper đo thời gian

```javascript
function measureExecution_(label, callback) {
  const startedAt = Date.now();

  try {
    return callback();
  } finally {
    const duration = Date.now() - startedAt;
    console.log(`[PERF] ${label}: ${duration} ms`);
  }
}
```

## 12.2. Log nên có

```text
[PERF] apiGetBootstrapData: 450 ms
[PERF] apiSaveMember: 280 ms
[PERF] apiBulkImportMembers: 1800 ms
[PERF] apiGetAttendanceByDate: 320 ms
```

## 12.3. Chỉ số cần theo dõi

- Tổng thời gian API.
- Số dòng đọc.
- Số dòng ghi.
- Số Spreadsheet calls.
- Kích thước JSON trả về.
- Thời gian render frontend.
- Số lần full refresh.
- Số lần lock timeout.

---

# 13. Tiêu chí nghiệm thu

## 13.1. CRUD một bản ghi

- Không gọi `apiGetInitialData()` sau khi lưu.
- Không đọc toàn bộ workbook.
- Không ghi từng ô.
- API trả bản ghi vừa lưu.
- Frontend cập nhật đúng một module.

## 13.2. Gán tổ hàng loạt

- Không gọi `setValue()` trong vòng lặp.
- Tối đa một hoặc vài `setValues()`.
- Có báo cáo số dòng cập nhật.
- Không gây mất dữ liệu ngoài danh sách đã chọn.

## 13.3. Nhập hàng loạt

- Không gọi CRUD riêng cho từng dòng.
- Dùng `Map` và `Set`.
- Có thống kê:
  - Số thêm mới.
  - Số cập nhật.
  - Số bỏ qua.
  - Số lỗi.
- Có danh sách lỗi theo dòng.
- Không chạy `setupDatabase()` mỗi lần import.

## 13.4. Tải ứng dụng

- Bootstrap không trả toàn bộ lịch sử.
- Điểm danh chỉ tải khi mở module.
- Tài chính có phân trang.
- Thăm viếng có phân trang.
- Không render tất cả màn hình khi khởi động.

## 13.5. Lock

- Không nuốt lỗi lock.
- Có `finally` để release.
- Lock chỉ bao quanh phần ghi.
- Batch operation chỉ lock một lần.

---

# 14. Phạm vi chưa nên làm ngay

Chưa cần chuyển sang database khác ngay nếu dữ liệu hiện tại chưa quá lớn.

Có thể tiếp tục sử dụng:

```text
Google Apps Script + Google Sheets
```

nếu tuân thủ:

- Batch read.
- Batch write.
- API theo module.
- Phân trang.
- Chỉ tải dữ liệu cần thiết.
- State update cục bộ.
- Cache có kiểm soát.
- Lưu trữ dữ liệu lịch sử.

Chỉ cân nhắc chuyển database khi:

- Số người dùng đồng thời tăng cao.
- Số giao dịch tăng nhanh.
- Cần truy vấn phức tạp.
- Cần audit và transaction chặt chẽ.
- Apps Script thường xuyên chạm quota.
- Google Sheets đạt giới hạn vận hành thực tế.

---

# 15. Chỉ dẫn triển khai dành cho Antigravity

## 15.1. Nguyên tắc

Hãy tối ưu repo theo từng giai đoạn, không sửa toàn bộ cùng lúc.

Sau mỗi giai đoạn phải:

1. Liệt kê file đã sửa.
2. Giải thích thay đổi.
3. Đưa diff hoặc mã hoàn chỉnh.
4. Không thay đổi tên cột Google Sheets nếu chưa cần.
5. Không làm mất khả năng tương thích dữ liệu cũ.
6. Không xóa chức năng hiện có.
7. Thêm logging hiệu năng.
8. Cung cấp hướng dẫn test.
9. Chờ xác nhận trước khi chuyển sang giai đoạn tiếp theo.

## 15.2. Giai đoạn đầu tiên cần thực hiện

Ưu tiên bốn phần sau:

1. Viết lại `sheetUpdate()`:
   - Chỉ đọc cột ID để tìm dòng.
   - Đọc một dòng cần sửa.
   - Ghi một lần bằng `setValues()`.
   - Trả bản ghi sau cập nhật.

2. Viết lại `apiBatchAssignGroup()`:
   - Không dùng `setValue()` trong vòng lặp.
   - Ghi cột tổ nhóm bằng một lần `setValues()`.

3. Viết lại `apiBulkImportMembers()`:
   - Dùng `Map`.
   - Batch insert.
   - Batch update.
   - Trả báo cáo import.

4. Thêm schema version:
   - Loại `setupDatabase()` khỏi luồng tải thường xuyên.
   - Chỉ nâng cấp schema khi version thay đổi.

## 15.3. Ràng buộc

- Không đổi giao diện trong giai đoạn đầu.
- Không đổi schema dữ liệu nếu chưa cần.
- Không chuyển khỏi Google Sheets.
- Không thêm thư viện ngoài nếu chưa cần.
- Tương thích Apps Script V8.
- Không sử dụng API không được Apps Script hỗ trợ.
- Mỗi thay đổi phải có phương án rollback.
- Code phải dễ đọc và có JSDoc.

## 15.4. Kết quả đầu ra Antigravity cần cung cấp

```text
1. Phân tích file và hàm liên quan.
2. Danh sách lỗi hiệu năng.
3. Mã thay thế hoàn chỉnh.
4. Danh sách file cần sửa.
5. Hướng dẫn copy code.
6. Hướng dẫn test.
7. So sánh trước và sau.
8. Các rủi ro còn lại.
```

---

# 16. Prompt sẵn dùng cho Antigravity

```text
Bạn hãy phân tích và tối ưu repository:

https://github.com/haiyenpa25/GGSheet-QLHT

Hệ thống sử dụng Google Apps Script làm backend và Google Sheets làm database.

Hãy đọc toàn bộ tài liệu đặc tả trong file Markdown này và thực hiện theo từng giai đoạn.

Giai đoạn hiện tại chỉ xử lý bốn nội dung:

1. Viết lại sheetUpdate():
   - Không đọc toàn bộ Sheet nếu không cần.
   - Chỉ đọc cột ID để tìm dòng.
   - Chỉ đọc một dòng cần cập nhật.
   - Không gọi setValue() trong vòng lặp.
   - Ghi lại một dòng bằng một lần setValues().
   - Trả về object sau cập nhật.

2. Viết lại apiBatchAssignGroup():
   - Dùng Set để tra cứu ID.
   - Đọc cột ID và cột tổ nhóm theo khối.
   - Cập nhật mảng trong bộ nhớ.
   - Ghi bằng một lần setValues().
   - Không ghi từng ô.

3. Viết lại apiBulkImportMembers():
   - Không gọi sheetInsert() hoặc sheetUpdate() cho từng dòng.
   - Dùng Map để tra cứu tổ nhóm và thành viên.
   - Batch insert tổ nhóm mới.
   - Batch insert thành viên mới.
   - Batch update thành viên đã có.
   - Trả báo cáo added, updated, skipped và errors.

4. Thêm cơ chế schema version:
   - Không gọi setupDatabase() trong mỗi apiGetInitialData().
   - Chỉ chạy setup khi tạo database, thiếu Sheet hoặc schema version thay đổi.
   - Lưu version theo spreadsheetId trong PropertiesService.

Ràng buộc:

- Không thay đổi schema hiện tại nếu chưa cần.
- Không xóa chức năng hiện có.
- Không đổi tên cột.
- Không đổi giao diện frontend trong giai đoạn này.
- Tương thích Google Apps Script V8.
- Có JSDoc.
- Có try/finally khi dùng LockService.
- Không nuốt exception.
- Có log thời gian thực thi.
- Có hướng dẫn kiểm thử chi tiết.
- Có phương án rollback.

Hãy trả kết quả theo cấu trúc:

1. File và hàm liên quan.
2. Vấn đề hiện tại.
3. Kiến trúc đề xuất.
4. Mã hoàn chỉnh.
5. Hướng dẫn thay thế.
6. Test cases.
7. Tiêu chí nghiệm thu.
8. Rủi ro và lưu ý.

Không chuyển sang giai đoạn tiếp theo cho đến khi giai đoạn này được kiểm thử và xác nhận.
```

---

# 17. Tài liệu tham khảo

- Repository:
  - https://github.com/haiyenpa25/GGSheet-QLHT
- Google Apps Script Best Practices:
  - https://developers.google.com/apps-script/guides/support/best-practices
- Lock Service:
  - https://developers.google.com/apps-script/reference/lock/lock-service
- Cache Service:
  - https://developers.google.com/apps-script/reference/cache/cache-service

---

# 18. Kết luận

Phần cần tối ưu trước không phải là thay Google Sheets bằng database khác.

Cần sửa lại cách ứng dụng:

1. Đọc dữ liệu.
2. Ghi dữ liệu.
3. Tải lại dữ liệu.
4. Render giao diện.
5. Xử lý hàng loạt.
6. Sử dụng lock.
7. Quản lý dữ liệu lịch sử.

Thay đổi có tác động lớn nhất là:

```text
Bỏ full refresh sau CRUD
+
batch read/write
+
tách API theo module
+
render cục bộ
```

Sau khi hoàn thành các hạng mục P0, tốc độ thao tác sẽ được cải thiện rõ rệt mà vẫn giữ nguyên Google Apps Script và Google Sheets.
