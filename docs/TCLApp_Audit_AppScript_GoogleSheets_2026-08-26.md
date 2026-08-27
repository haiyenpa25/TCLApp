# TCLApp — Code Audit, Bug Report & Kiến trúc tối ưu Google Apps Script + Google Sheets

**Ngày rà soát:** 26/08/2026  
**Repository:** https://github.com/haiyenpa25/TCLApp  
**Nhánh rà soát:** `main`  
**Mục tiêu:** tìm lỗi hiện tại, đánh giá độ ổn định của source, xác định các điểm nghẽn khi dùng Google Apps Script + Google Sheets và đưa ra roadmap sửa theo thứ tự P0 → P3.

---

# 0. Kết luận nhanh

## Đánh giá tổng thể

TCLApp **có ý tưởng chức năng tốt nhưng source hiện tại chưa đủ an toàn để dùng production**.

Vấn đề không nằm ở việc chọn Google Apps Script + Google Sheets. Với một quán nhỏ hoặc một điểm bán, stack này **hoàn toàn có thể chạy nhanh và ổn định** nếu thiết kế đúng.

Vấn đề chính của source hiện tại là:

1. Có lỗi cấu trúc code làm endpoint khởi động `getInitialData()` không thực sự tồn tại ở global scope.
2. Frontend đang "nuốt" lỗi Apps Script nên khi backend lỗi, người dùng chỉ thấy màn hình không có dữ liệu.
3. `index.html` bị ghép sai cấu trúc: có code nằm sau `</html>`.
4. Web App đang để `ANYONE` và chạy bằng quyền người deploy nhưng lại có các API quản trị/nguy hiểm không được bảo vệ ở server.
5. Backend tin giá tiền/tổng tiền từ frontend — đây là lỗi toàn vẹn dữ liệu nghiêm trọng.
6. Logic điểm khách hàng hiện tại có thể cộng trùng, trừ sai đơn vị.
7. `editOrder()` có thể làm hỏng liên kết `Order_Details`, đồng thời rewrite gần như toàn bộ bảng chi tiết đơn.
8. Kiến trúc tối ưu hiện tại mới giảm "số RPC từ browser", nhưng **chưa giảm số lần Apps Script đọc Google Sheets ở backend**.
9. KDS polling 15 giây nhưng mỗi lần có thể quét toàn bộ Orders + Order_Details — dữ liệu càng lớn app càng chậm.
10. Báo cáo cũng đang đọc toàn bộ lịch sử rồi mới lọc.
11. Data model chưa có transaction/idempotency/ledger phù hợp cho POS.
12. `index.html` quá lớn, UI, state, mock, Vue engine và business logic bị trộn chung, rất dễ phát sinh lỗi khi vibe coding.

## Điểm đánh giá hiện tại

| Hạng mục | Điểm tham khảo |
|---|---:|
| Ý tưởng chức năng | 8/10 |
| Giao diện / UX | 7/10 |
| Cấu trúc frontend | 3/10 |
| Kiến trúc backend GAS | 4/10 |
| Tối ưu Google Sheets | 4/10 |
| Toàn vẹn dữ liệu | 2/10 |
| Bảo mật production | 2/10 |
| Khả năng maintain | 3/10 |
| Production readiness | **2.5/10** |

**Kết luận:** không nên vá từng lỗi nhỏ rồi tiếp tục thêm tính năng. Nên dừng feature mới, sửa P0 trước, sau đó tổ chức lại luồng đọc/ghi.

---

# 1. P0 — Lỗi có thể giải thích trực tiếp việc "bấm load nhưng không hiển thị"

## P0-01 — `getInitialData()` đang bị khai báo bên trong `withErrorHandling()`

Trong `api.js` hiện tại:

```js
function withErrorHandling(fn) {
  try {
    ...
  } catch (e) {
    ...
  }

  function getInitialData() {
    ...
  }
}
```

Theo source hiện tại, dấu `}` kết thúc `withErrorHandling()` nằm **sau** phần khai báo `getInitialData()`.

Điều này có nghĩa:

```js
getInitialData
```

không phải global server function.

Trong khi frontend gọi:

```js
callGAS('getInitialData')
```

qua:

```js
google.script.run.getInitialData(...)
```

### Hậu quả

Apps Script không tìm thấy server function như frontend mong đợi.

Đây là ứng viên số 1 cho lỗi:

> bấm load → loading chạy → dữ liệu không xuất hiện.

### Fix bắt buộc

`withErrorHandling()` phải đóng trước:

```js
function withErrorHandling(fn) {
  try {
    const result = fn();
    return result !== undefined ? result : { success: true };
  } catch (e) {
    console.error(e);
    return {
      success: false,
      error: String(e && e.message ? e.message : e)
    };
  }
}

function getInitialData() {
  ...
}
```

---

# 2. P0 — Frontend đang nuốt lỗi Apps Script

Hiện tại:

```js
const callGAS = (functionName, ...args) => {
  return new Promise((resolve) => {
    google.script.run
      .withSuccessHandler((res) => resolve(res))
      .withFailureHandler((err) => {
        console.error('[GAS Error]', err);

        resolve({
          success: false,
          error: err.message
        });
      })[functionName](...args);
  });
};
```

Vấn đề là `withFailureHandler()` vẫn gọi:

```js
resolve(...)
```

chứ không:

```js
reject(...)
```

Do đó đoạn:

```js
try {
   ...
} catch (err) {
   ...
}
```

hầu như không bắt được lỗi server.

## Tệ hơn

Nếu `getInitialData()` lỗi, code fallback chạy nhiều request:

```js
Promise.all([
  loadMenu(),
  loadTables(),
  loadOrders(),
  loadTasks(),
  loadReport(),
  loadSettings(),
  loadExpenses(),
  loadStaff(),
  loadCustomers()
]);
```

Nhưng mỗi hàm con cũng thường chỉ:

```js
if (res.success && res.data) {
   ...
}
```

không báo người dùng nếu thất bại.

Cuối cùng UI vẫn có thể hiện:

```text
Đã làm mới dữ liệu!
```

mặc dù request đã lỗi.

## Cách sửa

Tạo một chuẩn duy nhất:

```js
async function gas(functionName, ...args)
```

Quy tắc:

- GAS transport error → `reject`.
- Response `success:false` → throw `ApiError`.
- UI không được hiển thị "thành công" nếu có endpoint critical thất bại.
- Lỗi phải hiện Toast có mã lỗi.
- Console log phải có:
  - functionName
  - elapsedMs
  - correlationId
  - error message.

Ví dụ response chuẩn:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "...",
    "elapsedMs": 123
  }
}
```

Lỗi:

```json
{
  "ok": false,
  "error": {
    "code": "DB_SHEET_NOT_FOUND",
    "message": "Không tìm thấy sheet Products"
  }
}
```

---

# 3. P0 — `index.html` bị hỏng cấu trúc

Source hiện tại đóng:

```html
</script>
</body>
</html>
```

nhưng sau đó vẫn còn nguyên block:

```html
<div v-if="currentTab === 'expenses'">
   ...
</div>
```

Tức là UI "Sổ quỹ" được thêm **sau khi tài liệu HTML đã kết thúc**.

## Hậu quả

Block này:

- nằm ngoài `#app`;
- Vue không quản lý đúng;
- `v-if` không còn hoạt động đúng;
- tùy trình duyệt có thể bị browser parser tự "sửa" DOM theo cách khác;
- có thể thấy template raw;
- có thể bấm tab nhưng không hiện nội dung.

## Ngoài ra

Trong source còn có phần Expenses bên trong Settings.

Như vậy hiện tại có:

- Expenses trong Settings;
- Expenses top-level tab;
- một Expenses block bị đặt sau `</html>`.

### Fix

Chỉ giữ **một nguồn UI duy nhất**.

Khuyến nghị:

```text
Tabs
├── POS
├── KDS
├── Tables
├── Tasks
├── Expenses
├── Reports
└── Settings
```

Hoặc nếu muốn Expenses nằm trong Settings thì bỏ tab top-level.

Không duy trì 2 UI cùng quản lý một state.

---

# 4. P0 — `getInitialData()` trả sai shape của Expenses

`getExpenses()` trả:

```js
{
  success: true,
  data: {
    expenses: [...],
    total: ...
  }
}
```

Nhưng `getInitialData()` lại trả:

```js
expenses: expensesRes.data || []
```

Frontend sau đó:

```js
expenses.value = d.expenses
```

Do đó `expenses.value` có thể trở thành:

```js
{
  expenses: [...],
  total: ...
}
```

trong khi phần còn lại của UI đang xem `expenses` là Array.

### Fix

Backend:

```js
expenses: expensesRes.data?.expenses || [],
expenseTotal: expensesRes.data?.total || 0
```

Hoặc thống nhất DTO:

```js
expenses: {
  items: [],
  total: 0
}
```

và toàn frontend dùng đúng schema đó.

---

# 5. P0 SECURITY — `?action=resetmenu` đang có thể gọi từ Web App public

`main.js` hiện có:

```js
if (e.parameter.action === 'setup') ...
if (e.parameter.action === 'resetmenu') ...
```

Trong khi `appsscript.json`:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "ANYONE"
}
```

`resetMenu()` xóa dữ liệu Products/Toppings rồi seed lại.

## Đây là lỗi production nghiêm trọng

Người biết Web App URL có thể thử:

```text
...?action=resetmenu
```

Nếu deployment đang public và thực thi bằng quyền deployer, đây là đường tấn công không cần UI Admin.

### Fix bắt buộc

Production `doGet()` không bao giờ được chứa:

```text
setup
reset
seed
truncate
migrate destructive
debug
test write
```

### Setup database chỉ được chạy bằng một trong các cách

Ưu tiên:

1. chạy thủ công từ Apps Script Editor;
2. CLI riêng;
3. maintenance function chỉ owner chạy;
4. tuyệt đối không expose qua public `doGet`.

---

# 6. P0 SECURITY — Admin PIN hiện không bảo vệ các API admin

Source có:

```js
verifyPin()
changePin()
```

nhưng các function như:

```text
addProduct
updateProduct
deleteProduct
addTopping
deleteTopping
saveSettings
deleteTable
addExpense
deleteExpense
addStaff
updateStaff
checkoutOrder
cancelOrder
...
```

không bắt buộc:

```text
admin session
role
token
permission
```

## Client-side PIN không phải security

Ẩn button bằng Vue không bảo vệ server.

Người mở DevTools vẫn có thể gọi trực tiếp server method nếu function được expose cho trang.

## Nguy hiểm hơn

`getInitialData()` dự kiến trả về:

```text
Customers
Staff
Expenses
Report
Settings
```

cho bootstrap.

Nếu trang customer QR cũng dùng bootstrap này, khách có thể nhận dữ liệu không nên được public như:

- số điện thoại khách hàng;
- email;
- địa chỉ;
- nhân viên;
- chi phí;
- báo cáo doanh thu.

## Kiến trúc đúng

Tách API thành 3 vùng:

```text
PUBLIC
├── getPublicBootstrap
├── getPublicMenu
├── getPublicTable
├── submitPublicOrder
└── getPublicOrderStatus

STAFF
├── getKdsSnapshot
├── updateOrderStatus
├── switchTable
└── checkoutOrder

ADMIN
├── menu CRUD
├── customer CRM
├── expenses
├── settings
├── staff
├── report
└── task templates
```

Mọi STAFF/ADMIN endpoint phải gọi:

```js
requireAuth(sessionToken)
```

hoặc:

```js
requireRole(sessionToken, ['ADMIN', 'STAFF'])
```

---

# 7. P0 DATA INTEGRITY — Backend đang tin giá tiền do frontend gửi lên

Frontend tự tính:

```text
product price
size price
topping price
discount
points discount
cart total
final total
```

rồi gửi:

```js
{
  totalAmount: finalCartTotal,
  items: cart
}
```

Backend `submitOrder()` lại ghi thẳng:

```js
payload.totalAmount
item.price
```

## Đây là lỗi thiết kế POS

Frontend là môi trường không tin cậy.

Người dùng có thể sửa JavaScript state trong DevTools và gửi:

```text
Ly 50.000 → 1.000
Tổng đơn 300.000 → 10.000
```

## Quy tắc bắt buộc

Frontend chỉ gửi:

```json
{
  "items": [
    {
      "productId": "P001",
      "size": "L",
      "toppingIds": ["T01", "T05"],
      "quantity": 2
    }
  ]
}
```

Backend phải:

1. đọc Product authoritative;
2. đọc Topping authoritative;
3. kiểm tra Status;
4. tính base price;
5. tính size;
6. tính topping;
7. tính quantity;
8. tính discount;
9. validate points;
10. tính tổng cuối cùng.

### Không bao giờ tin

```text
item.price
item.subtotal
totalAmount
pointsDiscount
discountAmount
```

từ browser.

---

# 8. P0 — Logic điểm khách hàng đang sai nghiêm trọng

## 8.1. Cộng điểm khi vừa submit order

Trong `submitOrder()`:

```js
Points += pts
TotalSpent += totalAmount
```

Đơn lúc này mới ở:

```text
NEW
```

chưa thanh toán.

## 8.2. Checkout lại cộng lần nữa

Trong `checkoutOrder()`:

```js
Points += pts
TotalSpent += order.TotalAmount
```

=> một đơn hoàn tất có nguy cơ cộng **hai lần**.

## 8.3. Hủy đơn trừ Points bằng tiền

Trong cancel status:

```js
Points = Points - order.TotalAmount
```

Ví dụ:

```text
đơn 50.000đ
```

thì code có thể trừ:

```text
50.000 điểm
```

thay vì số point được cộng.

## 8.4. Edit order cũng cộng `diff` tiền vào Points

```js
Points += diff
```

`diff` là số tiền chênh lệch, không phải point.

## Thiết kế đúng

Không cập nhật `Customers.Points` ở submit.

Chỉ cập nhật khi:

```text
payment = COMPLETED
```

và chỉ đúng **một lần**.

Nên thêm:

```text
CustomerPointLedger
```

Schema:

| Column | Ý nghĩa |
|---|---|
| ID | unique |
| CustomerID | khách |
| OrderID | đơn |
| Type | EARN / REDEEM / REFUND / ADJUST |
| Points | số điểm |
| CreatedAt | thời gian |
| PerformedBy | người thực hiện |
| Note | ghi chú |

Unique logic:

```text
OrderID + Type
```

để chống cộng hai lần.

---

# 9. P0 — `editOrder()` hiện có thể phá `Order_Details`

Hiện tại:

```js
var newRows = _buildOrderDetailRows(
  orderId + '-E',
  payload.items,
  detSheet
);
```

Trong `_buildOrderDetailRows()`:

```js
OrderID: orderId
```

Do đó sau khi edit:

```text
Order.ID = ORD-123
```

nhưng detail mới có:

```text
OrderID = ORD-123-E
```

Khi load lại:

```js
detailsMap.get(order.ID)
```

sẽ tìm:

```text
ORD-123
```

và không thấy:

```text
ORD-123-E
```

### Hậu quả

Sau sửa đơn:

- chi tiết món có thể biến mất;
- report top product sai;
- in bill sai;
- KDS có thể không thấy món.

---

# 10. P0/P1 — `editOrder()` đang xóa rồi ghi lại toàn bộ bảng Order_Details

Code hiện tại làm:

```js
detSheet.clearContents();
```

sau đó ghi lại:

```text
header
+
toàn bộ detail không thuộc order đang sửa
+
detail mới
```

## Đây là pattern rất nguy hiểm

Sửa 1 đơn nhưng:

```text
rewrite toàn bộ lịch sử Order_Details
```

### Hậu quả

- càng nhiều dữ liệu càng chậm;
- tăng số cell write;
- nếu script fail giữa chừng có thể làm sheet rỗng/thiếu dữ liệu;
- concurrent operation có nguy cơ ghi đè;
- một bug trong filter có thể phá toàn bộ detail;
- không phù hợp POS.

## Fix

Không `clearContents()` bảng lịch sử.

Có 2 hướng.

### Hướng A — đơn giản

Tìm rows thuộc `OrderID` và update/delete đúng vùng đó.

### Hướng B — khuyến nghị

Order details theo version:

```text
OrderDetailVersions
```

hoặc:

```text
Version
IsActive
```

Khi edit:

1. mark detail cũ `IsActive=false`;
2. append detail version mới;
3. Order.Version++.

Không rewrite history.

---

# 11. P0/P1 — Checkout không idempotent

`checkoutOrder()` hiện không kiểm tra rõ:

```text
order đã COMPLETED chưa?
```

Nếu:

- user double click;
- mạng lag;
- frontend retry;
- request được gửi 2 lần;

thì có nguy cơ:

```text
cộng điểm 2 lần
ghi note thanh toán 2 lần
```

## Fix

Mọi mutation quan trọng phải có:

```text
idempotencyKey
```

Ví dụ client tạo:

```text
REQ-UUID
```

Backend lưu:

```text
LastRequestId
```

hoặc bảng:

```text
IdempotencyKeys
```

Nếu request cũ đã xử lý:

```text
return kết quả cũ
```

không thực thi lại.

Checkout đồng thời phải validate:

```text
SERVING -> COMPLETED
```

chỉ một lần.

---

# 12. P1 — "1 RPC" không có nghĩa là nhanh nếu backend vẫn đọc Sheet nhiều lần

README nói:

```text
getInitialData() tải toàn hệ thống trong 1 network roundtrip
```

Ý tưởng giảm browser → server roundtrip là đúng.

Nhưng `getInitialData()` hiện gọi lần lượt:

```text
getMenu
getTables
getActiveOrders
getTasksForToday
getExpenses
getStaff
getCustomers
getSettings
getReport
```

Mỗi function lại tự:

```js
getSheetData(...)
```

nhiều lần.

Ví dụ cùng request có thể đọc:

```text
Orders
Orders
Orders
Order_Details
Order_Details
Expenses
Expenses
Products
...
```

## Quy tắc quan trọng nhất khi tối ưu GAS

Không chỉ đếm:

```text
google.script.run calls
```

Phải đếm:

```text
Spreadsheet service calls
Drive service calls
Properties service calls
external service calls
```

Google chính thức khuyến nghị:

- giảm calls tới services;
- batch read/write;
- đọc dữ liệu một lần vào Array;
- xử lý trong RAM;
- ghi theo batch.

---

# 13. P1 — KDS 15 giây đang có nguy cơ quét toàn lịch sử

Frontend:

```text
15 giây → loadOrders()
```

Backend `getOrders()`:

```js
getSheetData(ORDERS, false)
getSheetData(ORDER_DETAILS, false)
```

sau đó mới filter active.

Điều này có nghĩa:

```text
KDS cần 5 đơn đang chạy
```

nhưng có thể đọc:

```text
toàn bộ lịch sử Orders
toàn bộ lịch sử Order_Details
```

mỗi 15 giây.

## Đây là điểm nghẽn sẽ tăng theo thời gian

Ngày đầu:

```text
nhanh
```

Sau vài tháng:

```text
chậm
```

Sau lịch sử lớn:

```text
mỗi polling lại quét lịch sử
```

## Kiến trúc đúng

Tách HOT và COLD data.

```text
ActiveOrders
ActiveOrderDetails

OrderHistory
OrderDetailHistory
```

KDS chỉ đọc:

```text
ActiveOrders
ActiveOrderDetails
```

Khi checkout/hủy:

```text
move/append sang History
remove/mark inactive khỏi Active
```

KDS latency lúc đó gần như không phụ thuộc lịch sử.

---

# 14. P1 — Report đang scan toàn bộ lịch sử rồi mới lọc ngày

`getReportByRange()` hiện:

```js
var allOrders   = getSheetData(ORDERS, false);
var allDetails  = getSheetData(ORDER_DETAILS, false);
var allExp      = getSheetData(EXPENSES, false);
var allProducts = getSheetData(PRODUCTS, false);
```

rồi mới:

```js
filter dateFrom/dateTo
```

## Sai hướng tối ưu cho báo cáo

Nếu user xem:

```text
Hôm nay
```

không nên đọc toàn lịch sử nhiều năm.

## Phương án nhanh nhất trên Google Sheets

Tạo bảng aggregate:

```text
DailySales
DailyProductSales
```

### DailySales

| Date | Revenue | Orders | Expenses | Profit | Cash | Transfer |
|---|---:|---:|---:|---:|---:|---:|

### DailyProductSales

| Date | ProductID | ProductName | Qty | Revenue |
|---|---|---|---:|---:|

Khi checkout:

```text
update aggregate của ngày đó
```

Khi expense:

```text
update DailySales.Expenses
```

Report 30 ngày chỉ cần đọc:

```text
30 dòng DailySales
+
các row DailyProductSales trong khoảng
```

thay vì toàn bộ Orders.

---

# 15. P1 — `updateRowInSheet()` luôn đọc toàn bộ Sheet để tìm một ID

Hiện tại:

```js
const data = sheet.getDataRange().getValues();

for (...) {
  if (data[i][idIndex] == idValue) {
      ...
  }
}
```

Đây là:

```text
O(N)
```

cho mỗi update.

Một đơn chuyển:

```text
NEW
-> PREPARING
-> PACKING
-> SERVING
-> COMPLETED
```

mỗi lần đều có thể quét cả bảng Orders.

## Với bảng nhỏ

Chấp nhận được.

## Với bảng lịch sử tăng mãi

Không ổn.

## Giải pháp ưu tiên

Không cần xây database engine phức tạp ngay.

Hãy:

```text
ActiveOrders = bảng nhỏ
History = bảng append-only lớn
```

Lúc đó O(N) trên `ActiveOrders` vẫn rất nhỏ.

Đây đơn giản hơn nhiều so với cố build secondary index phức tạp trên Google Sheets.

---

# 16. P1 — `switchTable()` tạo nhiều full scan

Hiện tại loop:

```js
for (...) {
  updateRowInSheet(ORDERS, id, ...)
}
```

Mỗi `updateRowInSheet()` lại:

```text
getDataRange()
scan toàn bảng
write
```

Nếu bàn có nhiều active order:

```text
K lần update
=
K lần full read
```

## Fix

Đọc ActiveOrders **một lần**:

```text
RAM
```

update tất cả row cần đổi:

```text
RAM
```

ghi batch một lần.

---

# 17. P1 — Cache hiện dùng chưa đúng đối tượng

`db.js` đang cache nguyên:

```text
TCL_DB_<sheet>
```

Ý tưởng cache đúng, nhưng cần lưu ý:

Google Apps Script Cache có giới hạn:

- tối đa khoảng **100 KB / key**;
- tối đa khoảng **1.000 entries**;
- expiration chỉ là "suggestion";
- cache có thể bị evict trước hạn.

## Không nên cache

```text
Orders toàn lịch sử
Order_Details toàn lịch sử
Customers toàn bộ nếu chứa PII
```

## Nên cache

```text
menu_public
shop_settings
toppings
active_orders_snapshot
table_status_snapshot
daily_report_<date>
```

Cache phải là:

```text
performance layer
```

không phải source of truth.

---

# 18. P1 — `getActiveSpreadsheet()` nên thay bằng Spreadsheet ID cố định

Hiện tại:

```js
SpreadsheetApp
  .getActiveSpreadsheet()
```

Cách này phụ thuộc context project.

Nếu sau này:

- chuyển standalone script;
- deploy lại;
- clone project;
- clasp push sang project khác;

rất dễ trỏ nhầm hoặc không có active spreadsheet như mong đợi.

## Khuyến nghị

ScriptProperties:

```text
DB_SPREADSHEET_ID
```

Helper:

```js
function getDb() {
  const id = PropertiesService
    .getScriptProperties()
    .getProperty('DB_SPREADSHEET_ID');

  if (!id) {
    throw new Error('DB_SPREADSHEET_ID_NOT_CONFIGURED');
  }

  return SpreadsheetApp.openById(id);
}
```

Toàn project dùng:

```js
getDb()
```

Không dùng `getActiveSpreadsheet()` trong repository layer.

---

# 19. P1 — `setupDatabase()` có bug thêm cột

Hiện tại:

```js
const existing = ...
headers.forEach(h => {
  if (!existing.includes(h)) {
    sheet.getRange(1, existing.length + 1).setValue(h);
  }
});
```

`existing.length` không thay đổi trong loop.

Nếu thiếu:

```text
3 columns
```

cả 3 có thể ghi vào cùng một cột.

## Fix

```js
const missing = headers.filter(h => !existing.includes(h));

if (missing.length) {
  sheet
    .getRange(1, existing.length + 1, 1, missing.length)
    .setValues([missing]);
}
```

Tốt hơn nữa:

```text
SchemaVersion
Migration_001
Migration_002
...
```

Không dùng setup tự động kiểu "đoán schema" cho production lâu dài.

---

# 20. P1 — Task seed dùng uppercase nhưng engine dùng lowercase

Seed:

```text
DAILY
WEEKLY
HIGH
MEDIUM
```

Engine:

```js
case 'daily'
case 'weekly'
case 'biweekly'
case 'monthly'
```

=> Task seed mặc định có thể không sinh instance.

## Quy tắc

Toàn hệ thống dùng một enum chuẩn.

Khuyến nghị uppercase:

```text
DAILY
EVERY_X
WEEKLY
BIWEEKLY
MONTHLY

HIGH
MEDIUM
LOW
```

Ở boundary:

```js
String(value).toUpperCase()
```

---

# 21. P1 — `addTable()` tạo ID bằng số lượng row

Hiện tại logic dạng:

```text
existing.length + 1
```

Nếu:

```text
TBL01
TBL02
TBL03
```

xóa `TBL02`, sau đó add mới, số lượng có thể làm phát sinh ID đã tồn tại.

## Fix

Dùng:

```text
UUID
```

hoặc:

```text
TBL-<timestamp>-<random>
```

Tên hiển thị:

```text
Bàn 01
```

không cần trùng ID.

---

# 22. P1 — Timezone đang bị trộn UTC và Asia/Ho_Chi_Minh

`appsscript.json`:

```text
Asia/Ho_Chi_Minh
```

nhưng nhiều nơi dùng:

```js
new Date().toISOString().split('T')[0]
```

`toISOString()` dùng UTC.

Ở đầu ngày Việt Nam có thể lệch ngày.

## Bắt buộc tạo helper

```js
function todayVN() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}
```

Tất cả:

```text
Orders
Expenses
Tasks
Reports
Daily Summary
```

dùng cùng helper.

---

# 23. P1 — Payment Method đang được nhét vào Note

Checkout tạo:

```text
[TT:CASH]
[TT:TRANSFER]
TM:
CK:
Tips:
```

và Report parse chuỗi trong Note để suy ra phương thức.

Đây là schema không ổn.

## Orders cần thêm field chính thức

```text
PaymentStatus
PaymentMethod
PaidAt
CashAmount
TransferAmount
Tips
DiscountAmount
PointsRedeemed
PointsEarned
FinalAmount
```

`Note` chỉ dùng ghi chú.

Không dùng Note làm database column ẩn.

---

# 24. P1 — Upload ảnh có thể bị abuse nếu endpoint public

`uploadProductImage()`:

1. nhận base64;
2. tạo Drive file;
3. chia sẻ `ANYONE_WITH_LINK`.

Nếu endpoint không được auth:

```text
người ngoài có thể gửi file liên tục
```

và tiêu tốn Drive storage.

## Fix

- chỉ ADMIN được upload;
- validate MIME;
- chỉ:
  - jpg
  - jpeg
  - png
  - webp;
- giới hạn bytes;
- resize/compress client và validate server;
- lưu `MENU_IMAGE_FOLDER_ID` trong ScriptProperties;
- không `getFoldersByName()` mỗi upload;
- đặt filename an toàn;
- audit upload.

---

# 25. P1/P2 — Logo/Banner UI và backend chưa đồng bộ

Frontend có chức năng upload/chọn:

```text
logo
banner
```

nhưng `getSettings()` / `saveSettings()` hiện chưa thể hiện đầy đủ field tương ứng.

Nếu định lưu base64 vào ScriptProperties thì cũng không nên.

Apps Script Properties hiện có giới hạn value khoảng:

```text
9 KB / value
```

Ảnh base64 sẽ vượt rất nhanh.

## Thiết kế đúng

```text
upload image -> Drive
-> lấy fileId / public URL
-> Properties chỉ lưu URL / fileId
```

---

# 26. P2 — OAuth scopes đang rộng hơn nhu cầu thấy được trong source

Manifest hiện xin:

```text
spreadsheets.currentonly
spreadsheets
script.container.ui
calendar.events
script.external_request
drive
```

Trong source đang rà:

```text
Calendar
```

không phải dependency cốt lõi TCLApp hiện tại.

## Nguyên tắc

Least privilege.

Chỉ giữ scope thực sự dùng.

Nếu DB dùng `openById()`:

```text
spreadsheets
```

là scope chính.

Không cần giữ scope trùng/không dùng chỉ vì từng test một tính năng.

---

# 27. P2 — `ALLOWALL` iframe cần cân nhắc lại

`doGet()`:

```js
.setXFrameOptionsMode(
  HtmlService.XFrameOptionsMode.ALLOWALL
)
```

Nếu không thực sự cần nhúng app trong iframe bên ngoài:

```text
không nên bật ALLOWALL
```

Giảm bề mặt clickjacking/UI embedding không mong muốn.

Nếu cần iframe:

- phải có lý do cụ thể;
- kiểm tra nơi embed;
- các action quan trọng phải auth server-side.

---

# 28. P2 — README nói "0 CDN dependency / offline-ready" nhưng source vẫn dùng CDN

`index.html` đang load:

```text
Google Fonts
Material Symbols
Tailwind CDN
```

README lại ghi:

```text
0 CDN dependency
100% offline-ready
```

Hai điều này không khớp.

## Cách ổn hơn

Production:

```text
Tailwind build trước
-> CSS minified
-> đưa vào Apps Script HTML artifact
```

Font:

- dùng system font; hoặc
- chấp nhận external Google Font nhưng README không được gọi offline-ready.

---

# 29. P2 — Frontend monolith đang quá lớn

`index.html` hiện khoảng:

```text
3.300 dòng
```

và chứa:

```text
HTML
Tailwind config
CSS
Vue engine/bundle
state
computed
API bridge
mock API
business logic
modal
report
admin
KDS
CRM
tasks
expenses
```

Đây là lý do vibe coding rất dễ:

```text
sửa A
-> phá B
```

## Source repo nên tách

```text
src/
├── client/
│   ├── app.js
│   ├── api-client.js
│   ├── stores/
│   ├── composables/
│   ├── modules/
│   │   ├── pos/
│   │   ├── kds/
│   │   ├── tables/
│   │   ├── expenses/
│   │   ├── reports/
│   │   ├── admin/
│   │   └── tasks/
│   └── styles/
│
├── server/
│   ├── config.js
│   ├── db.js
│   ├── auth.js
│   ├── repositories/
│   ├── services/
│   ├── api/
│   └── jobs/
│
└── shared/
    ├── enums.js
    └── schemas.js
```

Sau đó build:

```text
dist/index.html
dist/*.gs
```

để `clasp push`.

Nếu chưa muốn có build tool phức tạp, tối thiểu Apps Script project nên chia:

```text
Main.gs
Config.gs
Auth.gs
Db.gs
OrderRepository.gs
OrderService.gs
CustomerService.gs
ReportService.gs
ApiPublic.gs
ApiStaff.gs
ApiAdmin.gs

Index.html
Styles.html
App.html
```

---

# 30. Kiến trúc đề xuất — GAS + Google Sheets vẫn dùng được

## Mục tiêu

Cho một quán / một site:

```text
Google Apps Script
+
Google Sheets
```

vẫn là phương án:

- rẻ;
- dễ vận hành;
- dễ backup;
- phù hợp vibe coding;
- không cần server riêng.

Nhưng Sheets không được sử dụng như một relational database server thực thụ.

---

# 31. Kiến trúc tổng thể đề xuất

```text
┌──────────────────────────────────────────────┐
│                 FRONTEND                    │
│ Vue 3                                       │
│                                              │
│ Public Menu   Staff/KDS   Admin             │
└──────────────┬─────────────┬─────────────────┘
               │             │
               ▼             ▼
┌──────────────────────────────────────────────┐
│                API LAYER                    │
│                                              │
│ PublicApi                                    │
│ StaffApi  -> requireRole(STAFF)              │
│ AdminApi  -> requireRole(ADMIN)              │
│                                              │
│ Request validation                           │
│ Error normalization                          │
└────────────────────┬─────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│               SERVICE LAYER                 │
│                                              │
│ OrderService                                 │
│ PaymentService                               │
│ CustomerService                              │
│ MenuService                                  │
│ TaskService                                  │
│ ReportService                                │
│                                              │
│ Business Rules                              │
│ Transaction-like flow                        │
│ Idempotency                                  │
└────────────────────┬─────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│             REPOSITORY LAYER                │
│                                              │
│ ProductsRepo                                 │
│ ActiveOrdersRepo                             │
│ HistoryRepo                                  │
│ CustomersRepo                                │
│ ExpenseRepo                                  │
│ SummaryRepo                                  │
└────────────────────┬─────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│             GOOGLE SHEETS DB                │
│                                              │
│ Small master tables                          │
│ Hot transactional tables                    │
│ Append-only history                          │
│ Daily aggregate                             │
└──────────────────────────────────────────────┘
```

---

# 32. Google Sheets schema đề xuất

## 32.1. Master data

```text
Products
Toppings
Tables
Staff
TaskTemplates
```

Nhỏ, ít thay đổi.

Có thể CacheService.

---

## 32.2. Hot data

```text
ActiveOrders
ActiveOrderDetails
TaskInstances
```

Chỉ chứa dữ liệu đang hoạt động.

### ActiveOrders

```text
ID
TableID
Status
OrderType
CustomerID
CustomerName
CustomerPhone
CreatedAt
UpdatedAt
FinalAmount
Note
Version
RequestId
```

### ActiveOrderDetails

```text
ID
OrderID
ProductID
ProductNameSnapshot
UnitPrice
Size
Ice
Sugar
ToppingsJson
Quantity
Subtotal
```

---

## 32.3. Cold/history data

```text
OrderHistory
OrderDetailHistory
```

Append-only.

Không quét trong KDS.

Có thể archive theo năm/tháng khi lớn.

---

## 32.4. Loyalty

```text
Customers
CustomerPointLedger
```

Không cộng/trừ point trực tiếp bằng "số tiền chênh".

---

## 32.5. Finance

```text
Expenses
DailySales
DailyProductSales
```

Báo cáo đọc aggregate.

---

## 32.6. System

```text
AuditLogs
SchemaMigrations
```

### AuditLogs

```text
ID
Time
ActorID
Role
Action
Entity
EntityID
BeforeJson
AfterJson
RequestID
```

Audit đặc biệt cần cho:

```text
checkout
cancel
refund
expense
menu price change
settings
customer points
```

---

# 33. Luồng load nhanh đề xuất

## 33.1. Customer QR

Không tải toàn hệ thống.

Chỉ:

```js
getPublicBootstrap(tableToken)
```

Response:

```json
{
  "shop": {},
  "menu": {},
  "table": {},
  "version": {}
}
```

Không trả:

```text
Customers
Staff
Expenses
Reports
Admin settings
Tasks
```

---

## 33.2. Staff POS

```js
getPosBootstrap()
```

Chỉ:

```text
menu
tables
small customer search config
shop settings
```

Customer search chạy theo nhu cầu.

Không tải toàn bộ CRM lúc mở app.

---

## 33.3. KDS

```js
getKdsSnapshot(lastVersion)
```

Nếu không thay đổi:

```json
{
  "changed": false
}
```

Nếu thay đổi:

```json
{
  "changed": true,
  "version": 124,
  "orders": []
}
```

KDS chỉ đọc:

```text
ActiveOrders
ActiveOrderDetails
```

---

## 33.4. Report

Lazy load khi user mở tab:

```js
getReportSummary(dateFrom, dateTo)
```

Không đưa report vào initial bootstrap.

---

## 33.5. Admin/CRM

Lazy load theo tab.

Không tải:

```text
customers
staff
expenses
reports
```

chỉ vì user vừa mở POS.

---

# 34. Tối ưu CacheService

## TTL gợi ý

| Cache | TTL |
|---|---:|
| `public_menu` | 5–15 phút |
| `shop_settings` | 30 phút |
| `toppings` | 5–15 phút |
| `table_master` | 1–5 phút |
| `active_orders_snapshot` | 2–10 giây |
| `daily_report_YYYYMMDD` | 30–120 giây |
| `report_range_*` | 30–120 giây |

## Invalidate khi write

Ví dụ menu:

```text
addProduct
updateProduct
deleteProduct
toggleStock
```

đều:

```text
invalidate public_menu
invalidate admin_menu
```

## Không cache dữ liệu lớn

Không:

```text
JSON.stringify toàn OrderHistory
```

vì cache không phải data warehouse và giới hạn khoảng 100 KB mỗi key.

---

# 35. Tối ưu read/write Google Sheets

## Quy tắc vàng

### Không làm

```js
for (...) {
  sheet.getRange(...).getValue();
}
```

hoặc:

```js
for (...) {
  sheet.getRange(...).setValue(...);
}
```

### Làm

```text
1 getValues
-> process RAM
-> 1 setValues
```

---

## Mỗi request nên có snapshot

Ví dụ:

```js
const snapshot = loadSnapshot([
  SHEETS.ACTIVE_ORDERS,
  SHEETS.ACTIVE_ORDER_DETAILS,
  SHEETS.TABLES
]);
```

Sau đó mọi service dùng:

```text
snapshot
```

không gọi Sheets lại.

---

# 36. Không dùng `deleteRow()` thường xuyên trên bảng transaction

`deleteRow()`:

- thay đổi row index;
- làm secondary index khó giữ;
- tốn thao tác;
- dễ gây race.

## Nên dùng

```text
Status
IsDeleted
ArchivedAt
```

và archive batch.

Với ActiveOrders nhỏ, có thể compact/cleanup bằng scheduled job ngoài giờ.

---

# 37. Luồng `submitOrder()` production-ready

```text
CLIENT
  |
  | productId + options + qty + requestId
  v
SERVER
  |
  +--> validate request
  |
  +--> validate signed table token
  |
  +--> check idempotency
  |
  +--> load menu authoritative
  |
  +--> calculate price server-side
  |
  +--> acquire short lock
  |
  +--> recheck idempotency
  |
  +--> write ActiveOrders status=CREATING
  |
  +--> batch write ActiveOrderDetails
  |
  +--> set order status=NEW
  |
  +--> update table OCCUPIED
  |
  +--> increment KDS version
  |
  +--> release lock
  |
  v
RETURN authoritative order
```

Nếu fail giữa chừng:

```text
CREATING
```

không được KDS hiển thị.

Recovery job có thể xử lý order CREATING quá lâu.

---

# 38. Luồng checkout production-ready

```text
SERVING
  |
  v
checkoutOrder()
  |
  +--> auth staff
  +--> validate status
  +--> idempotency check
  +--> lock
  +--> write payment fields
  +--> append point ledger
  +--> update customer summary
  +--> append OrderHistory
  +--> append OrderDetailHistory
  +--> update DailySales
  +--> update DailyProductSales
  +--> remove/archive Active Order
  +--> free table if no active order
  +--> audit log
  +--> unlock
  |
  v
COMPLETED
```

Nếu gọi checkout lần hai:

```text
return previous result
```

không cộng thêm điểm.

---

# 39. Luồng chỉnh sửa Order

Không được:

```text
clearContents toàn Order_Details
```

Nên:

```text
find details của OrderID
update version
append version mới
```

Server phải tính lại giá.

Nếu status đã:

```text
SERVING / COMPLETED / CANCELLED
```

thì không cho edit bình thường.

Nếu cần sửa sau thanh toán:

```text
Adjustment / Refund
```

là nghiệp vụ khác.

---

# 40. State machine cho Order

Không cho client set status tự do.

```text
NEW
  ↓
PREPARING
  ↓
PACKING
  ↓
SERVING
  ↓
COMPLETED
```

Nhánh:

```text
NEW/PREPARING/PACKING
   ↓
CANCELLED
```

Server validate:

```js
ALLOWED_TRANSITIONS[current].includes(next)
```

Không cho:

```text
COMPLETED -> NEW
CANCELLED -> SERVING
```

trừ admin recovery function riêng có audit.

---

# 41. Security model đề xuất

## Nếu vẫn muốn customer QR public

Public app bắt buộc phải tồn tại.

Nhưng ADMIN không thể chỉ dựa vào việc "ẩn nút".

### Hướng tốt nhất

Server function sensitive luôn nhận:

```text
authToken
```

Token có:

```text
userId
role
exp
nonce
signature
```

ký bằng secret trong ScriptProperties.

Pseudo:

```text
payload
+
HMAC SHA256
```

Server:

```text
verify signature
verify expiry
verify role
```

### Roles

```text
CUSTOMER
STAFF
MANAGER
ADMIN
```

## Tối thiểu

```text
STAFF
ADMIN
```

---

# 42. Không gửi toàn bộ Customers xuống browser

Hiện tại bootstrap có ý định load cả CRM.

Không nên.

POS cần tìm khách theo số điện thoại:

```js
searchCustomer(phone)
```

Server trả:

```text
ID
DisplayName
MaskedPhone / phone phù hợp nghiệp vụ
Points
```

chỉ các field cần thiết.

Admin CRM mới được xem:

```text
full customer
```

---

# 43. Public QR order cần signed table token

Không nên QR chỉ là:

```text
?table=TB01
```

vì user có thể đổi:

```text
TB01 -> TB99
```

Dùng:

```text
tableId
exp/version
signature
```

Ví dụ:

```text
?t=TB01&sig=...
```

Server validate signature.

Nếu QR là cố định lâu dài, token có thể không cần expiration nhưng phải có HMAC để chống tự sửa table ID.

---

# 44. Google Apps Script quota cần nhớ

Google hiện nêu các giới hạn Apps Script đáng chú ý:

```text
Script runtime: 6 phút / execution
Simultaneous executions: 30 / user
Simultaneous executions: 1.000 / script
Properties value: 9 KB / value
Properties store: 500 KB
```

Các quota có thể thay đổi.

Do đó POS không được thiết kế theo kiểu:

```text
1 thao tác user
-> hàng chục GAS executions
```

hoặc:

```text
mỗi 15 giây
-> scan toàn history
```

---

# 45. Apps Script + Google Sheets: cái gì làm nhanh nhất?

Xếp theo mức ảnh hưởng.

## #1 — Giảm Spreadsheet service calls

Quan trọng nhất.

```text
getValues 1 lần
process RAM
setValues 1 lần
```

---

## #2 — Không scan bảng lịch sử cho realtime

KDS:

```text
Active only
```

POS:

```text
Master + Active
```

Report:

```text
Daily aggregate
```

---

## #3 — Lazy loading theo tab

Đừng load:

```text
Menu
Tables
Orders
Tasks
Expenses
Staff
Customers
Report
Settings
```

cùng lúc.

Load đúng dữ liệu màn hình đang cần.

---

## #4 — Cache dữ liệu nhỏ, đọc nhiều

Menu/settings/master.

---

## #5 — Server authoritative

Giá, discount, point, order status.

Việc này không chỉ bảo mật mà còn giúp code frontend đơn giản hơn.

---

## #6 — Batch mutation

Switch table, archive, order details, report aggregate.

---

## #7 — Idempotency

Chống double click / retry.

---

## #8 — Hot/Cold separation

Đây là thay đổi đem lại tốc độ lớn nhất khi dữ liệu tăng.

---

## #9 — Không dùng Google Sheets như transaction DB hoàn chỉnh

Sheets không có transaction ACID như MySQL/PostgreSQL.

Cần thiết kế flow:

```text
CREATING
PENDING
COMPLETED
AUDIT
IDEMPOTENCY
```

để tự phục hồi.

---

# 46. Kiến trúc API gợi ý

## Public

```text
getPublicBootstrap(tableToken)
submitPublicOrder(request)
getPublicOrderStatus(orderId, token)
```

## Staff

```text
staffLogin(pin)
getPosBootstrap(token)
getKdsSnapshot(token, version)
updateOrderStatus(token, request)
switchTable(token, request)
checkoutOrder(token, request)
```

## Admin

```text
getAdminBootstrap(token)
getMenuAdmin(token)
saveProduct(token, request)
deleteProduct(token, id)
saveExpense(token, request)
getCustomers(token, query)
getReport(token, range)
saveSettings(token, request)
manageStaff(token, request)
```

Mọi API trả cùng response envelope.

---

# 47. Không nên để `getInitialData()` tải "toàn bộ app"

Tên đúng hơn:

```text
getPublicBootstrap
getPosBootstrap
getAdminBootstrap
```

Tùy màn hình.

"Single RPC" tốt.

"Single RPC trả toàn database" không tốt.

---

# 48. Cách tổ chức DB Repository

## Không để Service gọi `getSheetData()` tùy ý

Tạo Repository rõ ràng.

Ví dụ:

```text
OrderRepository
```

chịu trách nhiệm:

```text
findActiveById
listActive
appendActive
updateActive
archive
```

`OrderService` không biết Google Sheet row nào.

---

# 49. Không trộn response DB với response API

Sheet row có:

```text
ID
CreatedAt
Status
```

API có thể trả DTO khác.

Ví dụ:

```json
{
  "id": "ORD...",
  "status": "NEW",
  "createdAt": "...",
  "items": []
}
```

Frontend không nên phụ thuộc trực tiếp tên header Sheets mọi nơi.

Lợi ích:

```text
đổi schema Sheet
không bắt buộc sửa toàn Vue
```

---

# 50. Chuẩn hóa enum

Tạo duy nhất:

```js
ORDER_STATUS
PAYMENT_METHOD
PRODUCT_STATUS
TABLE_STATUS
TASK_STATUS
TASK_REPEAT
PRIORITY
USER_ROLE
```

Không dùng lúc:

```text
DAILY
```

lúc:

```text
daily
```

---

# 51. Tạo SchemaVersion

Sheet:

```text
SystemMeta
```

Ví dụ:

| Key | Value |
|---|---|
| schema_version | 4 |
| app_version | 3.8.0 |
| kds_version | 125 |
| last_archive_at | ... |

Migration:

```text
001_initial
002_add_payment_fields
003_add_point_ledger
004_active_order_split
```

Không chạy destructive schema setup khi mỗi người mở app.

---

# 52. Logging và monitoring

Mỗi API nên log:

```text
requestId
function
user/role
elapsedMs
result
errorCode
```

Ví dụ:

```text
[API]
requestId=abc
fn=checkoutOrder
orderId=ORD123
elapsed=412ms
status=OK
```

Không log:

```text
PIN
token
full phone
sensitive customer data
```

## Health check

Tạo:

```js
healthCheck()
```

chỉ admin/dev.

Check:

```text
Spreadsheet accessible
required sheets exist
required headers exist
schema version
cache
script properties
```

---

# 53. CI/CD với clasp + GitHub

Repo hiện chỉ có một commit và chưa thể hiện một pipeline kiểm soát chất lượng mạnh.

Đề xuất:

```text
GitHub
  |
  +--> lint
  +--> syntax check
  +--> unit tests pure JS
  +--> schema contract tests
  +--> build frontend
  +--> clasp push DEV
  +--> smoke test
  +--> manual approve
  +--> clasp deploy PROD
```

## Hai môi trường

```text
DEV
PROD
```

Hai Spreadsheet riêng.

Không test seed/reset trên dữ liệu thật.

---

# 54. Test bắt buộc trước production

## Load

- app mở được;
- Vue mount;
- public bootstrap;
- staff bootstrap;
- tab chuyển đúng;
- lỗi backend hiển thị đúng.

## Menu

- add;
- edit;
- out-of-stock;
- delete/soft-delete;
- image upload.

## Orders

- dine-in;
- takeaway;
- multiple items;
- toppings;
- edit;
- cancel;
- switch table;
- double click submit;
- retry network.

## Payment

- cash;
- transfer;
- mixed;
- checkout hai lần;
- checkout khi status sai.

## Loyalty

- earn;
- redeem;
- cancel trước payment;
- refund sau payment;
- edit order;
- không cộng trùng.

## Tasks

- daily;
- weekly;
- every X;
- casing enum;
- overdue.

## Reports

- today;
- yesterday;
- date range;
- cash;
- transfer;
- expenses;
- top products;
- order edited;
- cancelled order.

## Security

- public visitor không gọi được admin mutation;
- public không tải CRM;
- reset/setup URL không tồn tại;
- invalid token;
- expired token;
- role mismatch.

---

# 55. Performance test

Không chỉ test database nhỏ.

Tạo dataset giả đủ lớn để kiểm tra:

```text
nhiều tháng Orders
nhiều OrderDetails
nhiều Customers
```

### Acceptance

KDS endpoint không được phụ thuộc trực tiếp tổng lịch sử.

Public bootstrap không được đọc:

```text
OrderHistory
Customer list
Report
Expenses
```

Report không được scan OrderDetailHistory toàn bộ nếu đã có aggregate.

---

# 56. Roadmap sửa TCLApp

# PHASE P0 — DỪNG FEATURE, SỬA LỖI NGUY HIỂM

## P0.1

Fix scope:

```text
withErrorHandling
getInitialData
```

## P0.2

Fix `callGAS()`:

```text
reject lỗi transport
throw lỗi API
```

## P0.3

Xóa code sau:

```html
</html>
```

## P0.4

Thống nhất Expenses UI.

## P0.5

Remove public:

```text
?action=setup
?action=resetmenu
```

## P0.6

Bảo vệ API admin/staff.

## P0.7

Server-side price calculation.

## P0.8

Sửa Customer Points.

## P0.9

Sửa `editOrder()`:

```text
không -E sai OrderID
không clear toàn Order_Details
```

## P0.10

Checkout idempotent.

### Chỉ khi P0 pass test mới tiếp tục.

---

# PHASE P1 — PERFORMANCE

## P1.1

Config:

```text
DB_SPREADSHEET_ID
```

## P1.2

Tách:

```text
ActiveOrders
ActiveOrderDetails
History
```

## P1.3

KDS chỉ đọc active.

## P1.4

Tạo:

```text
DailySales
DailyProductSales
```

## P1.5

Lazy loading per tab.

## P1.6

Snapshot read 1 lần / request.

## P1.7

Cache small derived data.

## P1.8

Batch switch table / updates.

---

# PHASE P2 — MAINTAINABILITY

## P2.1

Tách frontend modules.

## P2.2

Tách:

```text
API
Service
Repository
```

## P2.3

Enums shared.

## P2.4

Schema migrations.

## P2.5

AuditLog.

## P2.6

Structured error codes.

## P2.7

DEV/PROD deployment.

## P2.8

CI tests.

---

# PHASE P3 — NÂNG CAO

- role/permission chi tiết;
- customer point ledger;
- refund workflow;
- offline queue cho POS nếu cần;
- PWA;
- printer bridge nếu cần;
- inventory;
- ingredient costing;
- multi-branch;
- sync/warehouse;
- migrate DB nếu tải tăng.

---

# 57. Khi nào Google Sheets còn phù hợp?

## Phù hợp

```text
1 quán
ít terminal
traffic vừa phải
không yêu cầu transaction ACID tuyệt đối
dữ liệu được archive/aggregate
realtime chỉ đọc active set nhỏ
```

## Không nên cố dùng lâu dài nếu

```text
nhiều chi nhánh
rất nhiều concurrent users
đơn hàng liên tục cường độ cao
inventory transaction phức tạp
accounting ledger nghiêm ngặt
cần realtime push thật
cần query/filter/index phức tạp
```

Khi đó cân nhắc:

```text
Firestore
Supabase/PostgreSQL
Cloud SQL
```

Frontend vẫn có thể giữ Vue.

Apps Script có thể chuyển vai trò thành:

```text
automation/report/integration
```

thay vì transaction backend chính.

---

# 58. Nếu vẫn giữ GAS + Sheets, đây là kiến trúc tôi khuyến nghị nhất cho TCLApp

```text
Vue 3
  |
  ├── Public Module
  ├── POS Module
  ├── KDS Module
  └── Admin Module
        |
        v
Google Apps Script
        |
        ├── Auth
        ├── Validation
        ├── Service
        ├── Repository
        ├── Cache
        ├── Lock
        ├── Audit
        └── Error Handler
                |
                v
Google Sheets
        |
        ├── MASTER
        │   ├── Products
        │   ├── Toppings
        │   ├── Tables
        │   └── Staff
        │
        ├── HOT
        │   ├── ActiveOrders
        │   ├── ActiveOrderDetails
        │   └── TaskInstances
        │
        ├── HISTORY
        │   ├── OrderHistory
        │   ├── OrderDetailHistory
        │   └── CustomerPointLedger
        │
        └── AGGREGATE
            ├── DailySales
            └── DailyProductSales
```

Đây là thay đổi quan trọng nhất.

---

# 59. Các nguyên tắc bắt buộc cho Antigravity khi refactor

## RULE-01 — Không thêm feature mới trong P0

Không:

```text
inventory
voucher
new dashboard
new UI
```

trước khi fix integrity/security.

---

## RULE-02 — Không rewrite toàn project một lần

Refactor theo vertical slice.

Ví dụ:

```text
Order
```

sửa đủ:

```text
API
Service
Repository
Sheet
Frontend
Tests
```

rồi mới sang Customer.

---

## RULE-03 — Mỗi thay đổi phải có regression checklist

Không được sửa "cho chạy" rồi thôi.

---

## RULE-04 — Không thay đổi schema âm thầm

Mọi thay đổi sheet phải có:

```text
migration
schema version
rollback note
```

---

## RULE-05 — Không tin dữ liệu tài chính từ client

Server calculate.

---

## RULE-06 — Không để public function destructive

Không:

```text
reset
setup
seed
truncate
deleteAll
```

trong public path.

---

## RULE-07 — Không gọi Spreadsheet trong loop nếu batch được

Đây là hard rule.

---

## RULE-08 — Không scan history từ KDS

Hard rule.

---

## RULE-09 — Không cache raw history lớn

Cache derived small view.

---

## RULE-10 — Không duplicate UI

Một feature:

```text
1 state
1 source component
1 API contract
```

---

# 60. Prompt giao trực tiếp cho Antigravity

## Mục tiêu

Refactor TCLApp hiện tại theo roadmap P0 → P3 nhưng **không làm mất chức năng đang có**.

## Yêu cầu triển khai

1. Audit source trước khi sửa.
2. Tạo branch:
   ```text
   refactor/p0-stability
   ```
3. Không thay đổi feature ngoài phạm vi.
4. Fix toàn bộ P0 trước.
5. Mỗi bug phải có:
   - root cause;
   - file bị ảnh hưởng;
   - test case;
   - acceptance result.
6. Tách business logic khỏi Vue.
7. Tạo API response standard.
8. Server-side validation.
9. Server-side price calculation.
10. Idempotent order submit/checkout.
11. Không clear/rewrite toàn bộ Order_Details.
12. Không expose reset/setup public.
13. Mọi admin mutation phải authenticated.
14. Không trả Customers/Expenses/Report cho public bootstrap.
15. Sau P0 mới làm P1 performance.
16. P1 bắt buộc:
   - explicit Spreadsheet ID;
   - active/history split;
   - KDS active-only;
   - daily aggregates;
   - cache small views;
   - lazy load.
17. Tạo test checklist trong:
   ```text
   docs/QA_CHECKLIST.md
   ```
18. Tạo architecture:
   ```text
   docs/ARCHITECTURE.md
   ```
19. Tạo schema:
   ```text
   docs/DATABASE_SCHEMA.md
   ```
20. Tạo migration log:
   ```text
   docs/MIGRATIONS.md
   ```

---

# 61. Definition of Done — P0

Không được đánh dấu P0 hoàn thành nếu chưa đáp ứng tất cả:

- [ ] `getInitialData` hoặc bootstrap replacement callable global.
- [ ] Không có HTML content sau `</html>`.
- [ ] Refresh lỗi phải hiển thị lỗi thật.
- [ ] Không có public `resetmenu`.
- [ ] Không có public `setup`.
- [ ] Sensitive mutation có server auth.
- [ ] Public bootstrap không chứa CRM/Expenses/Report.
- [ ] Server tự tính giá.
- [ ] Edit order không detach details.
- [ ] Edit order không clear toàn detail sheet.
- [ ] Customer points không cộng hai lần.
- [ ] Cancel không trừ VND vào Points.
- [ ] Checkout idempotent.
- [ ] Order status validate transition.
- [ ] Setup migration không overwrite missing headers.
- [ ] Task enums đồng nhất.
- [ ] Timezone dùng Asia/Ho_Chi_Minh nhất quán.
- [ ] Smoke tests pass.

---

# 62. Definition of Done — P1

- [ ] KDS không scan OrderHistory.
- [ ] KDS không scan OrderDetailHistory.
- [ ] Initial public load chỉ lấy dữ liệu public.
- [ ] Admin data lazy load.
- [ ] Report dùng aggregate.
- [ ] Không có repeated `getDataRange()` cùng sheet trong một request.
- [ ] Multi-row update được batch.
- [ ] Cache có TTL/invalidation rõ ràng.
- [ ] Cache không chứa raw history vượt lớn.
- [ ] DB Spreadsheet dùng explicit ID.
- [ ] Có performance logging.

---

# 63. File ưu tiên sửa theo thứ tự

```text
1. api.js
2. index.html
3. main.js
4. db.js
5. appsscript.json
6. README.md
7. tests/docs
```

## api.js

Ưu tiên:

```text
scope bug
auth
order integrity
points
checkout
editOrder
report
task enums
```

## index.html

Ưu tiên:

```text
HTML corruption
API error handling
bootstrap
public/admin data split
monolith split
```

## main.js

Ưu tiên:

```text
remove reset/setup from doGet
DB config
schema migration
timezone
```

## db.js

Ưu tiên:

```text
explicit DB
snapshot reads
active/history repos
batch updates
soft delete
```

## appsscript.json

Ưu tiên:

```text
least privilege scopes
review webapp exposure
```

---

# 64. Những thứ KHÔNG nên tối ưu sai hướng

## Không cần

Viết Map/Set khắp nơi nhưng vẫn:

```text
getDataRange toàn database
```

Map nhanh trong RAM, nhưng bottleneck chính là service I/O.

---

## Không cần

Gộp 9 API thành một endpoint nếu endpoint đó vẫn:

```text
đọc cùng sheet 3–5 lần
```

---

## Không cần

Cache mọi thứ.

Cache toàn lịch sử lớn có thể còn gây:

```text
serialization cost
size limit
stale data
```

---

## Không cần

Global Lock cho mọi thao tác.

Lock chỉ vùng read-modify-write thật sự cần atomic-like behavior.

Giữ lock càng ngắn càng tốt.

---

## Không cần

Tạo hệ thống index quá phức tạp ngay.

Tách:

```text
Active
History
Aggregate
```

đem lại phần lớn lợi ích với code đơn giản hơn.

---

# 65. Điểm mạnh nên giữ lại

Không phải source hiện tại đều xấu.

Các hướng đúng nên giữ:

1. Vue 3 SPA phù hợp.
2. `setValues()` batch là đúng.
3. Map grouping OrderID là đúng khi data đã nằm trong RAM.
4. Cache menu/settings là đúng.
5. Lock ở submit/checkout là đúng hướng.
6. Optimistic UI có thể giữ, nhưng backend phải authoritative.
7. `Order_Details` riêng khỏi Orders là hợp lý.
8. KDS/POS/Table/Task/Report chia domain rõ về nghiệp vụ.
9. `clasp` + GitHub là hướng deployment tốt.
10. Google Sheets phù hợp MVP/small-shop nếu hot-path được thiết kế lại.

---

# 66. Kết luận kiến trúc

Tôi không đề nghị bỏ Google Apps Script + Google Sheets ngay.

Tôi đề nghị:

```text
GIỮ STACK
NHƯNG ĐỔI KIẾN TRÚC DATA FLOW
```

TCLApp hiện tại đang có mô hình:

```text
Browser
   ↓
nhiều API / hoặc 1 API rất lớn
   ↓
mỗi service tự đọc toàn Sheet
   ↓
lọc trong RAM
   ↓
rewrite/update sheet
```

Nên đổi thành:

```text
Browser
   ↓
API theo screen/use-case
   ↓
Service
   ↓
Repository
   ↓
Small HOT dataset / Cache / Aggregate
   ↓
History append-only
```

Đây mới là hướng làm Apps Script + Google Sheets nhanh và bền.

---

# 67. Ưu tiên thực tế tôi đề nghị

Nếu chỉ có thời gian sửa ít, hãy làm đúng thứ tự:

```text
1. Fix getInitialData scope
2. Fix HTML sau </html>
3. Fix callGAS error handling
4. Remove reset/setup public
5. Protect admin API
6. Server-side price calculation
7. Fix points
8. Fix editOrder
9. Idempotent checkout
10. ActiveOrders / History split
11. Report aggregate
12. Modularize source
```

Sau 12 mục này, source sẽ khác rất nhiều về độ ổn định.

---

# 68. Tài liệu nguồn đã đối chiếu

## TCLApp

- Repository:
  https://github.com/haiyenpa25/TCLApp

- `api.js`:
  https://raw.githubusercontent.com/haiyenpa25/TCLApp/refs/heads/main/api.js

- `db.js`:
  https://raw.githubusercontent.com/haiyenpa25/TCLApp/refs/heads/main/db.js

- `main.js`:
  https://raw.githubusercontent.com/haiyenpa25/TCLApp/refs/heads/main/main.js

- `index.html`:
  https://raw.githubusercontent.com/haiyenpa25/TCLApp/refs/heads/main/index.html

- `appsscript.json`:
  https://raw.githubusercontent.com/haiyenpa25/TCLApp/refs/heads/main/appsscript.json

## Google Apps Script

- Best Practices:
  https://developers.google.com/apps-script/guides/support/best-practices

- Quotas:
  https://developers.google.com/apps-script/guides/services/quotas

- Cache:
  https://developers.google.com/apps-script/reference/cache/cache

---

# 69. Ghi chú cuối

Các nhận xét P0 ở trên được đưa ra từ source `main` đã đọc trực tiếp ngày 26/08/2026.

Đặc biệt, các lỗi:

```text
getInitialData nested scope
HTML sau </html>
public resetmenu/setup
client trusted total
double customer points
editOrder OrderID -E
clearContents toàn Order_Details
task enum mismatch
```

không phải chỉ là đề xuất tối ưu; đây là các vấn đề cụ thể đang có trong source hiện tại và nên sửa trước khi tiếp tục phát triển tính năng mới.
