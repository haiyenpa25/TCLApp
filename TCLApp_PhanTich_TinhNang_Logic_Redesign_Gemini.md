# TCLApp — PHÂN TÍCH CHUYÊN SÂU TÍNH NĂNG & ĐẶC TẢ LOGIC RE-DESIGN CHO GEMINI CODE

**Repository:** https://github.com/haiyenpa25/TCLApp  
**Nhánh rà soát:** `main`  
**Ngày rà soát:** 26/08/2026  
**Stack giữ lại:** Google Apps Script + Google Sheets + Vue 3  
**Mục tiêu:** sửa lại logic nghiệp vụ POS / QR gọi món / KDS / bàn / thanh toán / loyalty / báo cáo theo hướng dùng được thật, không chỉ vá giao diện.

---

# 0. CÁCH GEMINI PHẢI DÙNG TÀI LIỆU NÀY

Đây là **Functional Specification + Business Logic Specification + Refactor Roadmap**.

Gemini không được làm theo kiểu:

```text
thấy lỗi -> vá một dòng
thấy thiếu UI -> thêm modal
thấy chậm -> thêm CacheService
```

Phải đi theo thứ tự:

```text
Nghiệp vụ
  -> State machine
  -> Data model
  -> Server rules
  -> API contract
  -> Frontend flow
  -> Validation
  -> Tests
```

Ưu tiên:

```text
P0 = app chạy đúng + tiền + bảo mật + toàn vẹn dữ liệu
P1 = order / QR bàn / KDS / payment UX
P2 = performance / report / CRM
P3 = tasks / nâng cao
```

**Không thêm feature mới trước khi P0 hoàn tất.**

---

# 1. KẾT LUẬN SAU KHI ĐỌC LẠI SOURCE

Source hiện tại không chỉ “UI chưa đẹp”. Có lỗi ở cả bốn tầng:

```text
UI
Business Logic
Data Integrity
Architecture
```

Điểm yếu lớn nhất là TCLApp đang trộn các khái niệm sau thành gần như một luồng duy nhất:

```text
Đơn hàng
Phiếu pha chế
Bàn
Phục vụ
Thanh toán
Điểm khách hàng
```

Trong F&B thực tế, chúng liên quan nhưng không phải một state machine duy nhất.

Ví dụ đúng nghiệp vụ:

- Một bàn có thể gọi món nhiều lần trong cùng một lượt khách.
- Món đã gửi quầy không nên bị sửa âm thầm.
- Món có thể đã phục vụ nhưng bill chưa thanh toán.
- Khách có thể thanh toán trước khi món pha xong.
- Một bill có thể trả tiền mặt + chuyển khoản.
- QR chuyển khoản chỉ tạo nội dung chuyển tiền; QR **không chứng minh tiền đã vào tài khoản**.
- Khách scan QR bàn phải bị khóa vào đúng bàn.
- KDS chỉ nên lo chế biến, không nên kiêm thu ngân.
- Loyalty chỉ phát sinh theo giao dịch thanh toán hợp lệ.

---

# 2. CÁC LỖI NGHIÊM TRỌNG ĐANG CÓ TRONG SOURCE

Phần này là **source-derived**: được rút trực tiếp từ source `main` hiện tại.

## 2.1. P0 — `getInitialData()` bị đặt sai scope

Trong `api.js`, `withErrorHandling()` chưa được đóng trước khi khai báo `getInitialData()`. Vì vậy `getInitialData()` nằm bên trong function khác thay vì global callable endpoint.

Hậu quả tiềm năng:

```text
Frontend gọi google.script.run.getInitialData()
-> Apps Script không có global server function đúng như mong đợi
-> bootstrap lỗi
-> dữ liệu không load
```

**Fix:** đóng `withErrorHandling()` đúng vị trí, sau đó khai báo các endpoint server ở global scope.

---

## 2.2. P0 — `index.html` có code sau `</html>`

Source hiện tại đóng:

```html
</body>
</html>
```

nhưng sau đó vẫn còn block Expenses Vue.

Hậu quả:

- browser tự sửa DOM;
- component có thể nằm ngoài `#app`;
- Vue không quản lý đúng;
- lỗi render khó đoán.

**Hard rule:** không có HTML/script/style sau `</html>`.

---

## 2.3. P0 — nhiều modal bị `style="display: none;"` cứng

Source hiện tại có dạng:

```html
<div v-if="showCartDrawer" style="display: none;" ...>
```

Xuất hiện ở các modal quan trọng như:

- Product customization;
- Cart drawer;
- Checkout/payment;
- Receipt.

Inline `display:none` khiến modal vẫn bị ẩn dù Vue condition đã true.

Đây là lỗi có thể giải thích trực tiếp hiện tượng:

```text
bấm món -> không thấy tùy chỉnh
bấm giỏ -> không hiện
bấm thanh toán -> QR không hiện
bấm in bill -> modal không hiện
```

**Fix:** bỏ toàn bộ static `display:none` khỏi Vue modal. Chỉ dùng `v-if`/`v-show` và `v-cloak` để chống flash.

---

## 2.4. P0 — `callGAS()` nuốt lỗi backend

Frontend hiện dùng Promise chỉ có `resolve()`. `withFailureHandler` cũng `resolve({success:false})` thay vì reject.

Hậu quả:

```text
GAS lỗi
-> Promise vẫn resolve
-> catch không chạy
-> UI có thể im lặng
```

Ngoài ra source còn có mock fallback nếu `google.script.run` không tồn tại. Production không được tự chuyển sang mock vì sẽ che lỗi thật.

**Target:** một `ApiClient` chuẩn có:

```text
TRANSPORT_ERROR
VALIDATION_ERROR
AUTH_ERROR
BUSINESS_ERROR
CONFLICT
DB_ERROR
```

---

## 2.5. P0 — QR bàn hiện tại không thực sự bind vào TableID

QR hiện tạo URL theo **tên bàn**:

```text
?table=<table name>
```

Khi mount, frontend chỉ set:

```text
currentTableName
orderType=DINE_IN
```

nhưng không resolve/set `selectedTable`.

Trong khi submit order lại lấy:

```text
tableId = selectedTable ? selectedTable.ID : ''
```

Vì vậy khách có thể thấy UI ghi “Bàn 03” nhưng payload lại có `TableID=''`.

Đây là lỗi nghiệp vụ cốt lõi.

---

## 2.6. Customer QR dùng chung app với staff/admin

Navigation source hiện chứa:

```text
POS
KDS
Tables
Expenses
Tasks
Reports
Settings
```

Không có phân tách customer mode đúng nghĩa và không có server role gate tương ứng.

Customer self-order tuyệt đối không được nhận hoặc nhìn thấy:

```text
CRM
chi phí
report doanh thu
staff
settings
KDS quản trị
```

---

## 2.7. Tạo đơn thiếu validation theo OrderType

Current `placeOrder()` gửi:

```text
tableId
orderType
customerId
customerName
customerPhone
note
totalAmount
items
```

Nhưng:

### DINE_IN
Không bắt buộc table.

### DELIVERY
Có nút “Giao Hàng” nhưng cart workflow không có `DeliveryAddress`.

### TAKEAWAY
Không có pickup name/code rõ ràng.

### QR customer
Không khóa OrderType/Table bằng server token.

---

## 2.8. P0 MONEY — Backend tin giá do frontend gửi

Frontend tự tính:

```text
Product.Price
+ size hardcoded
+ topping
= item.price
```

rồi gửi `item.price` và `totalAmount` lên server. Backend dùng trực tiếp những giá trị đó để ghi đơn/detail.

Đây là lỗi data integrity nghiêm trọng vì browser không phải trusted source.

**Hard rule mới:** frontend chỉ gửi ID + lựa chọn + quantity. Backend tự tính lại toàn bộ giá từ menu authoritative.

---

## 2.9. Size/ice/sugar hardcode toàn app

Current source hardcode:

```text
S +0
M +3000
L +6000
```

và các mức đá/đường dùng chung mọi sản phẩm.

Điều này không phù hợp vì mỗi món có option khác nhau.

Target cần `ProductVariants` + `ModifierGroups` + `Modifiers`.

---

## 2.10. Cart chưa đủ cho POS thật

Current cart chủ yếu có:

```text
+
-
remove
```

Thiếu:

```text
Edit variant
Edit sugar/ice
Edit topping
Item note
Duplicate customized item
Merge identical items đúng rule
```

---

## 2.11. Topping lưu bằng Name thay vì ID

Frontend lưu danh sách tên topping. Rename topping sau này làm reference/history khó kiểm soát.

Request cần dùng `ModifierID`. History lưu snapshot name/price.

---

## 2.12. P0 MONEY — Loyalty đang sai logic nghiêm trọng

Backend hiện:

1. **Tạo order đã cộng Points + TotalSpent** dù chưa thanh toán.
2. **Checkout lại cộng lần nữa**.
3. Cancel đang có đoạn lấy `TotalAmount` tiền để trừ trực tiếp vào `Points`.
4. Edit order lấy chênh lệch tiền để cộng vào Points.

Ví dụ đơn 50.000đ có nguy cơ bị trừ 50.000 điểm.

**Kết luận:** loyalty hiện tại không nên dùng production.

---

## 2.13. Customer self-order có nguy cơ dùng điểm người khác qua phone lookup

UI tra số điện thoại rồi cho tick “Dùng điểm”. Nếu public customer mode cho phép như vậy, chỉ biết số điện thoại là có thể thử tiêu điểm của người khác.

**P1 rule:** customer QR có thể tích điểm, nhưng redeem chỉ trong Staff POS. Nếu muốn customer tự redeem sau này phải có OTP/authenticated customer session.

---

## 2.14. P0 — `editOrder()` có thể phá `Order_Details`

Current logic:

```text
lọc detail cũ
create detail mới với OrderID = orderId + '-E'
clearContents toàn sheet Order_Details
rewrite toàn bộ bảng
```

Hai vấn đề:

- Detail mới mất liên kết với OrderID gốc.
- Sửa một order nhưng rewrite toàn lịch sử detail, rủi ro data loss/concurrency cực lớn.

**Hard rule:** cấm `clearContents()` toàn transaction history để edit một order.

---

## 2.15. KDS đang kiêm luôn thanh toán

Current flow thực tế gần như:

```text
NEW -> PREPARING -> PACKING -> SERVING -> THANH TOÁN
```

Sai vì KDS/Barista không nên là state owner của payment.

Phải tách:

```text
KitchenStatus
FulfillmentStatus
PaymentStatus
```

---

## 2.16. `PACKING` không phù hợp DINE_IN

DINE_IN không nhất thiết có packing. TAKEAWAY/DELIVERY có lifecycle khác nhau. Không dùng cùng một state machine cho mọi OrderType.

---

## 2.17. Payment UI quá sơ sài

Current UI chỉ có:

```text
CASH
TRANSFER
Hoàn tất thanh toán
```

Thiếu:

- tiền khách đưa;
- tiền thừa;
- paid/balance due;
- mixed payment;
- transaction reference;
- PaidAt;
- cashier;
- refund/void;
- payment status riêng.

---

## 2.18. QR thanh toán có hai nguồn không đồng bộ

Current frontend có một `shopOfficialQR` hardcode URL riêng, trong khi dynamic QR lại lấy `settings.bankId/accountNo/accountName`.

Admin đổi tài khoản có thể làm dynamic QR đổi nhưng official QR vẫn trỏ tài khoản cũ — đây là rủi ro tiền thật.

**Rule:** không hardcode QR/account trong frontend.

---

## 2.19. QR hiển thị không đồng nghĩa tiền đã nhận

VietQR chỉ pre-fill lệnh chuyển. Nếu chưa tích hợp bank webhook/API thật, hệ thống không tự biết tiền đã vào.

UI phải thể hiện rõ:

```text
QR DISPLAYED != PAYMENT RECEIVED
```

Staff phải kiểm tra app ngân hàng rồi xác nhận thủ công.

---

## 2.20. P0 MONEY — Checkout đang optimistic trước server

Current frontend:

```text
remove order khỏi UI
free table
hide modal
show success toast
sau đó mới gọi checkoutOrder()
```

Financial mutation tuyệt đối không được làm vậy.

**Rule:** payment success chỉ hiển thị sau khi server commit thành công.

---

## 2.21. Payment data bị nhét vào `Note`

Backend ghi dạng:

```text
[TT:TRANSFER] TM:... CK:... Tips:...
```

rồi report parse Note.

Target phải có bảng `Payments` riêng.

---

## 2.22. Payment report có thể sai vì fallback sang `Source`

Report hiện dùng logic kiểu:

```text
PaymentMethod || Source
```

`Source=ONLINE` không có nghĩa là chuyển khoản. Order source và payment method là hai dimension khác nhau.

---

## 2.23. Receipt và Kitchen Slip bị trộn

Current modal mang ý nghĩa cả “THERMAL RECEIPT / KITCHEN SLIP”. Cần tách ba tài liệu:

```text
KITCHEN TICKET
PRE-BILL (CHƯA THANH TOÁN)
PAID RECEIPT
```

---

## 2.24. Table switch thiếu guard

Target table hiện chủ yếu chỉ loại source table, chưa bắt buộc FREE. Backend cũng có thể move active orders vào table đang OCCUPIED.

Cần hai action tách biệt:

```text
MOVE_TABLE
MERGE_TABLE
```

P1 chỉ implement MOVE_TABLE sang bàn FREE.

---

## 2.25. Reset bàn không dựa trên open session

Không được chỉ set `Status=FREE`. Bàn chỉ FREE khi không còn open TableSession, hoặc manager force close có audit.

---

## 2.26. KDS polling quét toàn lịch sử

Frontend poll ~15 giây. Backend `getOrders()` đọc toàn Orders + toàn Order_Details rồi mới filter active.

Càng dùng lâu càng chậm.

---

## 2.27. Report quét toàn lịch sử

`getReportByRange()` load toàn Orders, Order_Details, Expenses rồi mới filter ngày.

Target cần aggregate theo ngày.

---

## 2.28. `updateRowInSheet()` quét full sheet để update một ID

Với bảng history lớn, mỗi state transition sẽ chậm dần. Hướng tối ưu đúng là tách HOT và HISTORY, không cố biến Sheets thành database index engine phức tạp.

---

## 2.29. `getInitialData()` tải quá nhiều domain

Current bootstrap dự kiến gom:

```text
menu + tables + orders + tasks + expenses + staff + customers + settings + report
```

Customer chỉ xem menu nhưng vẫn có nguy cơ tải data quản trị. Sai cả performance và privacy.

---

## 2.30. Logo/banner chưa có persistence đồng bộ

Frontend có `logoUrl/bannerUrl`, nhưng backend settings hiện không persist đầy đủ các field này. Media nên upload Drive, lưu FileID/URL trong settings.

---

## 2.31. Admin PIN chưa phải authorization thật

Có `verifyPin/changePin`, nhưng sensitive server endpoints chưa cùng nhau enforce `requireRole()`/session.

Ẩn button phía client không phải security.

---

# 3. TARGET PRODUCT — 5 MODE TÁCH BIỆT

TCLApp nên có 5 mode nghiệp vụ:

```text
1. CUSTOMER SELF ORDER
2. STAFF POS
3. KDS / BAR
4. CASHIER
5. ADMIN / MANAGEMENT
```

Không bắt buộc là 5 URL riêng, nhưng phải tách:

```text
UI
API
Permissions
Data bootstrap
State owner
```

---

# 4. KIẾN TRÚC NGHIỆP VỤ TARGET

```text
CUSTOMER QR / STAFF POS
          |
          v
     TABLE SESSION / CHECK
          |
          +--> ORDER BATCH 1 --> KDS
          +--> ORDER BATCH 2 --> KDS
          +--> ORDER BATCH 3 --> KDS
          |
          +--> PAYMENT(S)
          |
          +--> LOYALTY LEDGER
          |
          +--> RECEIPT
          |
          v
       CLOSED
```

Tách khỏi đó:

```text
KDS only owns preparation status
Cashier owns payment confirmation
TableSession owns occupancy lifecycle
Payment owns money truth
LoyaltyLedger owns points truth
```# 5. MODE CUSTOMER SELF-ORDER QUA QR BÀN

## 5.1. UX mục tiêu

```text
Quét QR
-> hệ thống biết đúng bàn
-> xem menu
-> chọn món / customize
-> xem giỏ
-> gửi order
-> nhận mã đơn + tổng server
-> theo dõi trạng thái
-> gọi thêm món trong cùng lượt khách
```

Customer **không có**:

```text
chọn bàn
chọn DINE_IN/TAKEAWAY
KDS
reports
expenses
CRM
settings
staff
```

## 5.2. QR URL

Không dùng:

```text
?table=Bàn 01
```

Target:

```text
?mode=customer&t=<signedTableToken>
```

Token đại diện cho:

```text
TableID
TokenVersion
Signature/HMAC
```

Ví dụ conceptual:

```text
TBL01.v3.<signature>
```

Server phải verify token và resolve TableID. Client không tự truyền TableID authoritative.

## 5.3. Bootstrap customer

Endpoint:

```text
getCustomerBootstrap(tableToken)
```

Server:

1. verify table token;
2. load table active;
3. tìm/open TableSession;
4. lấy public shop settings;
5. lấy menu public;
6. trả DTO tối thiểu.

Response example:

```json
{
  "success": true,
  "data": {
    "shop": {},
    "table": {"id":"TBL01","name":"Bàn 01"},
    "session": {"id":"TS-...","status":"OPEN"},
    "menu": {
      "categories": [],
      "products": [],
      "modifierGroups": []
    }
  }
}
```

Không được trả Customers full / Staff / Expenses / Reports.

## 5.4. Customer cart line

```text
ClientLineID
ProductID
ProductNameDisplay
VariantID
VariantNameDisplay
ModifierSelections[]
Quantity
ItemNote
EstimatedUnitPrice
EstimatedSubtotal
```

Customer được:

```text
Edit
Remove
Increase/Decrease
Add item note
```

## 5.5. Customer submit request

```json
{
  "idempotencyKey": "UUID",
  "tableToken": "...",
  "items": [
    {
      "productId": "P01",
      "variantId": "PV03",
      "modifierIds": ["MOD01", "MOD12"],
      "quantity": 2,
      "note": "ít đá"
    }
  ],
  "customer": {
    "name": "",
    "phone": ""
  }
}
```

**Không gửi authoritative:**

```text
Price
Subtotal
FinalAmount
TableID
```

Server tự resolve/tính.

## 5.6. Sau khi gửi

Server trả:

```text
OrderID
DisplayNumber
TrackingToken
ServerCalculatedTotal
KitchenStatus
```

Customer UI:

```text
✓ Quán đã nhận đơn
Mã #A102
Tổng: 128.000đ

[Theo dõi đơn]
[Gọi thêm món]
```

Tracking states customer-friendly:

```text
ĐÃ NHẬN
ĐANG PHA
SẴN SÀNG
ĐÃ PHỤC VỤ
```

---

# 6. MODE STAFF POS

## 6.1. Mục tiêu UX

Staff cần tốc độ và ít click hơn customer.

Desktop recommendation:

```text
+------------------------------------------------------+
| Search | Categories                                  |
+-------------------------------+----------------------+
|                               | Context              |
| Product Grid                  | Bàn 05 / Takeaway   |
|                               | ------------------   |
|                               | Current Check        |
|                               | items                |
|                               | total                |
|                               |                      |
|                               | [GỬI QUẦY]           |
|                               | [THANH TOÁN]         |
+-------------------------------+----------------------+
```

Mobile: product list + sticky current-check button.

## 6.2. Staff phải chọn context trước

```text
DINE_IN
TAKEAWAY
DELIVERY
```

### DINE_IN

Bắt buộc TableID.

Nếu table FREE:

```text
Open TableSession
```

Nếu OCCUPIED:

```text
Open existing TableSession
```

Không tạo một commercial bill rời hoàn toàn mỗi lần gọi thêm.

### TAKEAWAY

Fields:

```text
PickupName optional
Phone optional
PickupCode generated server-side
```

### DELIVERY

Bắt buộc:

```text
CustomerName
Phone
DeliveryAddress
```

Optional:

```text
DeliveryNote
ShippingFee
```

---

# 7. TABLE SESSION / CHECK — KHÁI NIỆM BẮT BUỘC

Current model nhiều order rời theo table làm flow dine-in kém tự nhiên.

Target có `TableSessions` đại diện cho **một lượt khách / một bill đang mở**.

Ví dụ:

```text
Bàn 05
Session TS-1001

18:05 gọi 2 trà
18:20 gọi thêm khoai
18:40 gọi thêm cà phê
19:10 thanh toán chung
```

Tất cả gắn cùng session.

## 7.1. TableSession status

```text
OPEN
CHECKOUT_PENDING
CLOSED
CANCELLED
```

Table occupancy chủ yếu suy ra từ session:

```text
No OPEN session -> FREE
OPEN session -> OCCUPIED
```

`RESERVED` nếu cần booking là concern riêng.

## 7.2. Table release

Không free table chỉ vì một order hoàn tất.

Target:

```text
TableSession CLOSED -> FREE
```

Nếu khách trả trước nhưng vẫn đang ngồi/chờ món:

```text
PaymentStatus=PAID
SessionStatus=OPEN
Table=OCCUPIED
```

---

# 8. ORDER BATCH / GỬI QUẦY

Trong một TableSession có nhiều lần gửi món:

```text
Batch 1: 18:05 - 2 trà
Batch 2: 18:20 - khoai
Batch 3: 18:40 - cà phê
```

Đây là cách giữ history chế biến đúng và cho phép “gọi thêm món”.

Concept:

```text
TableSession
  -> Order/Check
       -> SendBatch / BatchNo
            -> OrderItems
```

Nếu muốn giảm số Sheet, có thể lưu `BatchNo` trực tiếp trên `ActiveOrderItems`.

---

# 9. MENU / VARIANT / MODIFIER DESIGN

Current `HasSize/HasIce/HasSugar` + option hardcode phải được thay.

## 9.1. Products

```text
ID
Name
CategoryID
BasePrice
ImageUrl
Status
KitchenStation
SortOrder
Description
```

## 9.2. ProductVariants

Ví dụ:

```text
PV01 | P01 | S | 0
PV02 | P01 | M | 3000
PV03 | P01 | L | 6000
```

Món không size có variant `STANDARD` hoặc no variant theo rule thống nhất.

## 9.3. ModifierGroups

Ví dụ:

```text
SUGAR
ICE
TOPPING
MILK
EXTRA_SHOT
```

Fields:

```text
ID
Name
SelectionType: SINGLE | MULTI
Required
MinSelect
MaxSelect
SortOrder
Status
```

## 9.4. Modifiers

```text
ID
GroupID
Name
PriceDelta
Status
SortOrder
```

## 9.5. ProductModifierGroups

```text
ProductID
GroupID
RequiredOverride
SortOrder
```

## 9.6. Pricing algorithm — SERVER ONLY

```text
unitPrice = BasePrice
          + VariantPriceDelta
          + sum(Modifier.PriceDelta)

lineSubtotal = unitPrice * quantity
```

Lưu snapshot trong order item:

```text
ProductNameSnapshot
VariantNameSnapshot
ModifierSnapshotJson
UnitPriceSnapshot
```

Menu đổi giá ngày mai không được làm history hôm qua đổi.

---

# 10. CART LOGIC

## 10.1. Trước khi gửi quầy

Cho phép edit tự do:

```text
variant
modifiers
qty
item note
remove
```

## 10.2. Merge line rule

Hai line chỉ merge nếu giống tất cả:

```text
ProductID
VariantID
sorted ModifierIDs
ItemNote
```

## 10.3. Sau khi đã gửi quầy

Không edit âm thầm.

Nếu KitchenStatus=NEW và policy cho phép:

```text
AMEND + notification
```

Nếu PREPARING trở đi:

```text
cancel item with reason
+ create replacement/new batch
```

Có audit.

---

# 11. STATE MODEL — TÁCH CÁC CHIỀU

Không dùng một cột `Status` cho mọi nghiệp vụ.

## 11.1. Commercial Order/Check status

```text
OPEN
CLOSED
CANCELLED
```

## 11.2. Kitchen status — ở batch/item

```text
NEW
PREPARING
READY
DONE
CANCELLED
```

Allowed transitions:

```text
NEW -> PREPARING
PREPARING -> READY
READY -> DONE
```

Cancel rules riêng.

## 11.3. Payment status

```text
UNPAID
PARTIAL
PAID
PARTIALLY_REFUNDED
REFUNDED
VOID
```

## 11.4. Fulfillment status

### DINE_IN

```text
WAITING
READY
SERVED
```

### TAKEAWAY

```text
WAITING
READY_FOR_PICKUP
HANDED_OVER
```

### DELIVERY

```text
WAITING
READY_FOR_DRIVER
OUT_FOR_DELIVERY
DELIVERED
```

---

# 12. KDS V2

KDS chỉ sở hữu preparation workflow.

Không payment.

## 12.1. KDS card

```text
#A102
Bàn 05 | DINE-IN | 18:22 | 08:35

2 x Trà Đào L
    50% đường
    ít đá
    + đào miếng

1 x Cà Phê Sữa
    không đá

NOTE: Ly đầu ít ngọt
```

Buttons:

```text
NEW -> [BẮT ĐẦU]
PREPARING -> [READY]
```

## 12.2. Urgency

Configurable settings:

```text
KdsWarningMinutes
KdsUrgentMinutes
```

Ví dụ:

```text
0-10 normal
10-15 warning
>15 urgent
```

## 12.3. KitchenStation

Product có `KitchenStation`, ví dụ:

```text
BAR
KITCHEN
DESSERT
```

P1 có thể chỉ BAR nhưng schema không khóa tương lai.

## 12.4. KDS polling tối ưu

`SystemMeta`:

```text
KDS_VERSION = 105
```

Client gửi `lastVersion=105`.

Nếu unchanged:

```json
{"changed":false,"version":105}
```

Nếu changed mới trả Active snapshot.

KDS tuyệt đối không scan OrderHistory mỗi 15 giây.

---

# 13. CASHIER V2 — TÁCH KHỎI KDS

Cashier có thể là panel trong POS hoặc tab riêng.

Tìm bill/check bằng:

```text
Table
Order/check number
Pickup code
Customer phone
```

Checkout summary:

```text
Subtotal
Discount
Loyalty Redeem
Shipping/Service if any
Already Paid
BALANCE DUE
```

Payment buttons:

```text
TIỀN MẶT
CHUYỂN KHOẢN
HỖN HỢP
```

---

# 14. CASH PAYMENT FLOW

UI:

```text
Balance Due: 128.000
Khách đưa: [_______]

[Đúng tiền] [150k] [200k] [500k]
Tiền thừa: 22.000
```

Request:

```json
{
  "idempotencyKey":"...",
  "checkId":"...",
  "method":"CASH",
  "cashReceived":150000
}
```

Server:

```text
balanceDue authoritative
cashReceived >= balanceDue
change = cashReceived - balanceDue
```

Persist:

```text
AmountApplied
CashReceived
ChangeAmount
```

---

# 15. TRANSFER / VIETQR FLOW

## 15.1. Chỉ một QR đúng

Bỏ concept frontend hardcoded “Official QR” song song với dynamic QR.

`prepareCheckout(checkId)` server trả:

```text
amountDue
bankId
accountNo
accountName
paymentCode
qrUrl/qrPayload
```

Payment code ví dụ:

```text
TCL A102 X7Q2
```

Không chỉ dùng bốn số cuối nếu dễ collision.

## 15.2. Transfer screen

```text
CHUYỂN KHOẢN

128.000đ

[ QR lớn ]

Ngân hàng ...
STK xxxx1234
TRUONG HOAI DINH
Nội dung: TCL A102 X7Q2

[ĐÃ KIỂM TRA & NHẬN ĐƯỢC TIỀN]
```

## 15.3. Không giả bank verification

Nếu chưa có webhook ngân hàng thật:

```text
QR displayed != Paid
```

Staff phải kiểm tra giao dịch và xác nhận thủ công.

Nếu sau này có provider callback thật mới tự động match PaymentIntent.

---

# 16. MIXED PAYMENT

Ví dụ:

```text
Bill: 200.000
Cash applied: 50.000
Transfer applied: 150.000
```

Rule:

```text
sum(payment applied amounts) == balance due
```

Nếu cash received > cash applied thì tính change trên phần cash.

Dynamic QR của phần transfer phải dùng **chính transfer amount**, không full bill.

---

# 17. PAYMENT MODEL

Tạo Sheet `Payments`.

Columns đề xuất:

```text
ID
CheckID
OrderID
Method
Status
AmountApplied
CashReceived
ChangeAmount
TransferReference
PaymentCode
BankIDSnapshot
AccountNoSnapshot
AccountNameSnapshot
PaidAt
CashierID
CreatedAt
IdempotencyKey
VoidReason
RefundedAmount
```

Không ghi payment method vào free-text Note để làm source báo cáo.

## 17.1. Payment state

```text
PENDING -> PAID
PENDING -> CANCELLED
PAID -> PARTIALLY_REFUNDED
PAID -> REFUNDED
PAID -> VOID (theo policy)
```

## 17.2. Idempotency

Double click confirm không được tạo hai payment.

Mỗi mutation tài chính bắt buộc có `idempotencyKey`.

---

# 18. PAYMENT ALGORITHM — SERVER FIRST

```text
confirmPayment(request)

1. require STAFF/CASHIER
2. validate idempotency
3. load current check/order
4. calculate balance due server-side
5. validate payment amount/method
6. acquire short lock
7. re-read critical payment/check status
8. if already paid -> return previous committed result
9. append Payment
10. update check PaymentStatus
11. apply loyalty redemption if any
12. award eligible loyalty once
13. update DailySales/DailyProductSales
14. write audit
15. save idempotency result
16. release lock
17. return PaidReceipt DTO
```

**Frontend chỉ show success sau bước 17.**

---

# 19. RECEIPTS V2

## 19.1. Kitchen Ticket

Dành cho bar/kitchen:

```text
Order/Batch #
Table/Pickup
Time
Items
Modifiers
Notes
```

Không cần financial details.

## 19.2. Pre-bill

```text
items
qty
price
subtotal
discount
total
CHƯA THANH TOÁN
```

## 19.3. Paid Receipt

Chỉ sau payment commit:

```text
Receipt #
PaidAt
Cashier
Payment methods
Applied amounts
Cash received
Change
Payment code/reference
Items
Total
```

---

# 20. CUSTOMER / CRM

## 20.1. Normalize phone server-side

```text
remove spaces
remove separators
normalize +84/0 rule
```

Dùng `PhoneNormalized` cho exact match.

Không tự lấy result đầu tiên từ partial-search để bind customer.

## 20.2. Public customer lookup

Không trả CRM full.

Nếu cần xác định thành viên, chỉ trả tối thiểu:

```text
display name
masked phone
membership summary
```

---

# 21. LOYALTY V2

Config:

```text
EarningUnit = 10000 VND / point
PointValue = 100 VND / point
MaxRedeemPercent = 50%
```

## 21.1. Earn

Chỉ sau payment successful theo policy:

```text
pointsEarned = floor(eligiblePaidAmount / EarningUnit)
```

Không earn khi:

```text
unpaid
cancelled
```

Refund phải reverse tương ứng.

## 21.2. Redeem

P1 chỉ Staff POS.

Server validate:

```text
current point balance
max redeem %
min points
bill amount
```

Frontend không tự quyết discount.

## 21.3. LoyaltyLedger

Columns:

```text
ID
CustomerID
CheckID
PaymentID
Type
Points
BalanceBefore
BalanceAfter
CreatedAt
PerformedBy
Note
```

Types:

```text
EARN
REDEEM
REFUND_EARN
RETURN_REDEEM
ADJUST
```

`Customers.PointsBalance` chỉ là materialized summary; Ledger là audit source.

---

# 22. CANCEL / VOID / REFUND — TÁCH ĐÚNG NGHIỆP VỤ

## Cancel order/item

Dành cho order chưa paid, cần Reason + Actor.

Nếu kitchen NEW có thể cancel theo permission.

Nếu PREPARING trở đi cần confirm/manager theo policy.

## Paid transaction

Không gọi `cancelOrder()` nữa.

Phải đi:

```text
VOID
hoặc
REFUND
```

Refund ảnh hưởng:

```text
Payments
LoyaltyLedger
DailySales
AuditLog
```

Không sửa lịch sử total âm thầm.

---

# 23. TABLE MANAGEMENT V2

Table card nên hiển thị:

```text
Bàn 05
4 chỗ
OCCUPIED từ 18:05
Bill: 328.000
Paid: 0
Due: 328.000
2 batch đang làm
```

Actions:

```text
Thêm món
Xem bill
Thanh toán
Chuyển bàn
```

## 23.1. Move table

P1 chỉ cho target `FREE`.

Move **TableSession** từ A sang B, không loop sửa từng order như primary domain action.

## 23.2. Merge table

Action riêng P2, có confirmation và logic merge check/session rõ ràng.

## 23.3. Delete table

Không hard delete table đã có history. Dùng `Active=false/INACTIVE`.

Không deactivate khi có OPEN session.

---

# 24. MENU ADMIN V2

Admin cần quản lý:

```text
Categories
Products
Variants
Modifier Groups
Modifiers
Product-Modifier mapping
Kitchen station
Status / Out of stock
Images
Sort order
```

Product statuses:

```text
ACTIVE
OUT_OF_STOCK
INACTIVE
```

Server submit-order luôn recheck status dù client menu đang cache.

Nếu món vừa hết:

```text
PRODUCT_UNAVAILABLE
```

UI phải giữ cart các món khác và báo đúng món lỗi.

---

# 25. IMAGE / BRAND ASSET

Không lưu base64 dài trong ScriptProperties.

Flow:

```text
select image
-> client resize/compress
-> authenticated upload
-> Drive folder by fixed FolderID
-> return FileID + URL
-> persist URL/FileID in entity/settings
```

Validate MIME + size.

Settings chia:

### Public

```text
ShopName
Slogan
Phone
Facebook
LogoUrl
BannerUrl
```

### Payment

```text
BankID
AccountNo
AccountName
PaymentPrefix
```

### Loyalty

```text
EarningUnit
PointValue
MaxRedeemPercent
```

### Operations

```text
Timezone
Currency
KdsWarningMinutes
KdsUrgentMinutes
```

---

# 26. AUTH / ROLES

Minimum target:

```text
CUSTOMER
STAFF
MANAGER
ADMIN
```

MVP có thể chỉ STAFF + ADMIN cho private app, nhưng server phải enforce.

`loginStaff()` trả signed short-lived token chứa:

```text
StaffID
Role
Expiry
Nonce
Signature
```

Sensitive endpoint gọi:

```text
requireRole(token, allowedRoles)
```

Không dựa vào việc frontend ẩn menu.

Public API:

```text
getCustomerBootstrap
createCustomerOrder
getCustomerOrderTracking
```

Staff API:

```text
staffLogin
getPosBootstrap
openTableSession
addOrderBatch
getOpenChecks
getKdsSnapshot
startKitchenBatch
markKitchenReady
prepareCheckout
confirmCashPayment
confirmTransferPayment
confirmMixedPayment
moveTable
```

Admin API:

```text
menu CRUD
staff CRUD
settings
expenses
reports
CRM detail
loyalty adjustment
audit
```# 27. API RESPONSE STANDARD

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "REQ-...",
    "serverTime": "..."
  }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "TABLE_REQUIRED",
    "message": "Vui lòng chọn bàn."
  },
  "meta": {
    "requestId": "REQ-..."
  }
}
```

Error codes tối thiểu:

```text
AUTH_REQUIRED
FORBIDDEN
INVALID_INPUT
TABLE_REQUIRED
TABLE_NOT_FOUND
TABLE_NOT_AVAILABLE
INVALID_TABLE_TOKEN
SESSION_NOT_FOUND
PRODUCT_NOT_FOUND
PRODUCT_UNAVAILABLE
INVALID_VARIANT
INVALID_MODIFIER
PRICE_CHANGED
ORDER_NOT_FOUND
INVALID_ORDER_STATE
PAYMENT_ALREADY_COMPLETED
PAYMENT_AMOUNT_INVALID
CUSTOMER_NOT_FOUND
INSUFFICIENT_POINTS
IDEMPOTENCY_CONFLICT
SYSTEM_BUSY
DB_ERROR
```

Frontend rule:

```text
Server lỗi -> visible error + retry
Không mock fallback production
Không mất cart/user input khi transient error
```

Mutation button trong lúc request:

```text
disabled + spinner
```

Nhưng vẫn bắt buộc server idempotency.

---

# 28. GOOGLE SHEETS TARGET DATA MODEL

Không bắt buộc migrate tất cả trong một lần. Đây là target để Gemini không thiết kế chắp vá.

## 28.1. `Products`

```text
ID
Name
CategoryID
BasePrice
ImageUrl
ImageFileID
Status
KitchenStation
Description
SortOrder
CreatedAt
UpdatedAt
```

## 28.2. `ProductVariants`

```text
ID
ProductID
Name
PriceDelta
Status
SortOrder
```

## 28.3. `ModifierGroups`

```text
ID
Name
SelectionType
Required
MinSelect
MaxSelect
SortOrder
Status
```

## 28.4. `Modifiers`

```text
ID
GroupID
Name
PriceDelta
Status
SortOrder
```

## 28.5. `ProductModifierGroups`

```text
ProductID
GroupID
RequiredOverride
SortOrder
```

## 28.6. `Tables`

```text
ID
Name
Capacity
Status
QRTokenVersion
SortOrder
Active
CreatedAt
UpdatedAt
```

## 28.7. `TableSessions`

```text
ID
TableID
Status
OpenedAt
ClosedAt
OpenedBy
ClosedBy
CustomerID
GuestCount
Note
```

## 28.8. `ActiveOrders`

```text
ID
SessionID
TableID
OrderType
Source
CustomerID
CustomerNameSnapshot
CustomerPhoneSnapshot
Status
PaymentStatus
FulfillmentStatus
Subtotal
DiscountAmount
LoyaltyDiscount
ShippingFee
FinalAmount
CreatedAt
UpdatedAt
CreatedBy
Revision
IdempotencyKey
Note
```

## 28.9. `ActiveOrderItems`

```text
ID
OrderID
BatchNo
ProductID
ProductNameSnapshot
VariantID
VariantNameSnapshot
ModifierSnapshotJson
Quantity
UnitPrice
Subtotal
KitchenStatus
FulfillmentStatus
ItemNote
SentAt
StartedAt
ReadyAt
CompletedAt
CancelledAt
CancelReason
```

## 28.10. `OrderHistory`

Commercial fields như ActiveOrders +:

```text
ClosedAt
ArchivedAt
```

## 28.11. `OrderItemHistory`

Các field như ActiveOrderItems.

## 28.12. `Payments`

Theo Payment Model ở phần trên.

## 28.13. `Customers`

```text
ID
Name
Phone
PhoneNormalized
Type
Company
Address
Email
PointsBalance
TotalPaid
CreatedAt
UpdatedAt
Status
Note
```

## 28.14. `LoyaltyLedger`

Theo phần Loyalty.

## 28.15. `Expenses`

```text
ID
Date
Category
Description
Amount
FundingSource
PerformedBy
CreatedAt
Status
VoidedAt
VoidedBy
VoidReason
Note
```

Không hard-delete financial row đã ghi nhận; dùng VOID.

## 28.16. `Staff`

```text
ID
Name
Role
PinHash
Status
CreatedAt
UpdatedAt
```

## 28.17. `DailySales`

```text
Date
GrossSales
Discounts
LoyaltyDiscounts
Refunds
NetSales
OrderCount
CashAmount
TransferAmount
Expenses
UpdatedAt
```

## 28.18. `DailyProductSales`

```text
Date
ProductID
ProductNameSnapshot
Quantity
NetSales
```

## 28.19. `AuditLogs`

```text
ID
CreatedAt
ActorID
Role
Action
EntityType
EntityID
RequestID
BeforeJson
AfterJson
Reason
```

## 28.20. `SystemMeta`

```text
Key
Value
UpdatedAt
```

Ví dụ:

```text
SCHEMA_VERSION
APP_VERSION
KDS_VERSION
MENU_VERSION
```

---

# 29. HOT / HISTORY ARCHITECTURE — QUAN TRỌNG NHẤT CHO TỐC ĐỘ

Realtime screens chỉ đọc HOT data:

```text
ActiveOrders
ActiveOrderItems
TableSessions OPEN
```

History:

```text
OrderHistory
OrderItemHistory
Payments history
```

Khi check/session đóng:

```text
append/copy sang history
compact/remove active
```

KDS không bao giờ đọc history để render current queue.

---

# 30. APP BOOTSTRAP — BỎ “LOAD CẢ HỆ THỐNG”

Không dùng một `getInitialData()` trả toàn bộ domain.

Target:

```text
getCustomerBootstrap()
getPosBootstrap()
getKdsBootstrap()
getCashierBootstrap()
getAdminBootstrap()
```

### Customer

```text
public settings
table/session
public menu
```

### POS

```text
menu
tables
open-check summary
staff session
```

Customer lookup lazy.

### KDS

```text
active kitchen items
KDS_VERSION
```

### Cashier

```text
open unpaid checks
payment settings
```

### Admin

Lazy load từng tab.

---

# 31. GOOGLE APPS SCRIPT PERFORMANCE RULES

Theo Best Practices chính thức của Google Apps Script, cần giảm service calls, batch reads/writes và cache dữ liệu được dùng lại.

Hard rules cho TCLApp:

## Rule 1

Không gọi Spreadsheet service trong loop nếu batch được.

## Rule 2

Trong cùng request, cùng một Sheet không `getDataRange()` lặp lại nếu có thể giữ snapshot trong RAM.

## Rule 3

KDS chỉ đọc active rows.

## Rule 4

Report phổ biến đọc aggregate.

## Rule 5

Customer bootstrap không load admin data.

## Rule 6

Cache là performance layer, không source of truth.

## Cache phù hợp

```text
MENU_PUBLIC
MENU_ADMIN
SHOP_PUBLIC_SETTINGS
PAYMENT_SETTINGS
TABLE_MASTER
KDS_SNAPSHOT:<version>
```

## Không cache raw data lớn

```text
full OrderHistory
full OrderItemHistory
full Customers
```

---

# 32. DB CONNECTION

Không nên phụ thuộc `getActiveSpreadsheet()` làm database locator lâu dài.

ScriptProperties:

```text
DB_SPREADSHEET_ID
```

Repository dùng:

```text
SpreadsheetApp.openById(DB_SPREADSHEET_ID)
```

Lợi ích:

```text
DEV DB riêng
PROD DB riêng
clone/deploy rõ ràng
không phụ thuộc active container context
```

---

# 33. REPORT V2

## 33.1. Revenue recognition

Report thu tiền nên dựa trên `PaidAt`, không mặc định `CreatedAt`.

Ví dụ bill tạo 23:58, paid 00:10 thì payment-day report ghi vào ngày PaidAt.

Nếu muốn sales-by-order-created-date, tạo report dimension riêng.

## 33.2. Daily KPIs

```text
Gross Sales
Discounts
Net Sales
Refunds
Orders
AOV
Cash
Transfer
Mixed
Expenses
Open Unpaid
```

Payment breakdown lấy từ `Payments`, không parse Note/Source.

## 33.3. Product report

```text
Qty
Net Sales
```

Dùng `DailyProductSales` cho view thường xuyên.

## 33.4. Không gọi “Profit” nếu chưa có COGS

Nếu mới chỉ có:

```text
Sales - manually entered Expenses
```

thì nên gọi:

```text
Thu ròng sau chi phí ghi nhận
```

Không gọi lợi nhuận kế toán thật nếu chưa có recipe/COGS/inventory/labor allocation.

---

# 34. CASH SESSION — P2 ĐỀ XUẤT

Nếu quán quản lý tiền mặt cuối ca, thêm `CashSessions`:

```text
ID
BusinessDate
OpeningCash
CashSales
CashExpenses
ExpectedCash
CountedCash
Variance
OpenedBy
ClosedBy
OpenedAt
ClosedAt
```

Giúp đối soát cashier.

---

# 35. EXPENSES V2

Expense entry:

```text
Category
Amount
FundingSource
PerformedBy
Note
```

Sau khi đã ghi sổ/đóng ngày:

```text
không hard delete
```

Dùng:

```text
Status=VOID
VoidReason
VoidedBy
VoidedAt
```

---

# 36. TASK MODULE

Không ưu tiên P0/P1. Sau khi sales core ổn mới sửa.

Chuẩn hóa enum:

```text
DAILY
EVERY_X_DAYS
WEEKLY
BIWEEKLY
MONTHLY
```

Priority:

```text
HIGH
MEDIUM
LOW
```

Không trộn uppercase/lowercase giữa seed và engine.

---

# 37. SOURCE OF TRUTH MATRIX

| Dữ liệu | Source of Truth |
|---|---|
| Giá món | Server/Menu Repository |
| Availability | Server |
| Table association từ QR | Signed Table Token |
| Order total | PricingService server |
| Payment state | Payments + PaymentService |
| Loyalty balance | LoyaltyLedger |
| Table occupied | Open TableSession |
| KDS queue | ActiveOrderItems |
| Report payment method | Payments |

Frontend chỉ render, thu input và có thể hiển thị estimated price; không quyết định financial truth.

---

# 38. OPTIMISTIC UI POLICY

Có thể optimistic:

```text
local cart qty
filters
search
UI-only preferences
```

Cẩn trọng:

```text
Kitchen status transition
```

Không optimistic:

```text
Payment
Refund
Void expense
Loyalty redeem
Destructive table/session actions
```

---

# 39. ORDER SUBMISSION ALGORITHM

```text
createOrder(request)

1. auth staff OR verify table token
2. validate idempotency key
3. normalize request
4. load authoritative menu snapshot
5. validate product status
6. validate variant
7. validate modifier groups/min/max
8. calculate authoritative prices
9. resolve/create TableSession if dine-in
10. acquire short lock
11. re-check idempotency/session conflicts
12. append ActiveOrder
13. batch append ActiveOrderItems
14. update/open TableSession
15. increment KDS_VERSION
16. save idempotency result
17. release lock
18. return authoritative Order DTO
```

---

# 40. CANCEL RULES

Cancel request phải có:

```text
Order/Item ID
Reason
Actor
```

KitchenStatus=NEW có thể cancel theo role.

PREPARING trở đi cần stricter confirmation.

Nếu PaymentStatus=PAID thì **không cancel order như unpaid order**; dùng Refund/Void flow.

---

# 41. FRONTEND TARGET MODULES

Không giữ `index.html` monolith >3000 dòng.

Logical structure:

```text
client/
  core/
    api-client
    auth-store
    error-handler
    formatters

  customer/
    CustomerMenu
    CustomerCart
    OrderTracking

  pos/
    PosHome
    ContextSelector
    ProductGrid
    OpenCheck
    ItemEditor

  kds/
    KdsBoard
    KdsCard

  cashier/
    Checkout
    CashPayment
    TransferPayment
    MixedPayment
    PaidReceipt

  tables/
    TableMap
    TableSession
    MoveTable

  admin/
    MenuAdmin
    Settings
    Staff
    CRM
    Expenses
    Reports
```

Nếu chưa dùng bundler, có thể chia thành HTML includes nhưng vẫn giữ module boundaries.

---

# 42. SERVER TARGET MODULES

```text
00_Config.gs
01_Enums.gs
02_Errors.gs
03_Response.gs

10_Db.gs
11_Cache.gs
12_Auth.gs
13_Idempotency.gs
14_Audit.gs

20_ProductRepository.gs
21_TableRepository.gs
22_OrderRepository.gs
23_PaymentRepository.gs
24_CustomerRepository.gs
25_ReportRepository.gs

30_PricingService.gs
31_OrderService.gs
32_KdsService.gs
33_PaymentService.gs
34_LoyaltyService.gs
35_TableService.gs
36_ReportService.gs

40_PublicApi.gs
41_StaffApi.gs
42_AdminApi.gs

90_Main.gs
```

---

# 43. UI/UX ACCEPTANCE — CUSTOMER

Customer landing:

```text
Logo
Tiệm Của Lá
Bàn 05

Search
Categories
Products
```

Sticky cart:

```text
3 món • 128.000đ
[Xem giỏ]
```

After submit:

```text
✓ Quán đã nhận đơn
#A102
128.000đ
[Theo dõi]
[Gọi thêm món]
```

Không có admin navigation.

---

# 44. UI/UX ACCEPTANCE — STAFF POS

Click FREE table:

```text
[Mở bàn & gọi món]
```

Click OCCUPIED table:

```text
Bàn 05
Mở từ 18:05
Bill 328k
Paid 0
Due 328k

[Thêm món]
[Xem bill]
[Thanh toán]
[Chuyển bàn]
```

---

# 45. UI/UX ACCEPTANCE — KDS

Top filters/counts:

```text
NEW 3
PREPARING 4
READY 2
```

Không có QR payment button.

Modifiers/item note phải nổi bật và dễ đọc từ xa.

Audio notification chỉ phát khi snapshot version mới thật sự có new ticket, không phát mỗi polling.

---

# 46. UI/UX ACCEPTANCE — CASHIER QR

Không toggle hai loại QR. Chỉ hiển thị một QR từ PaymentSettings/server quote.

```text
CHUYỂN KHOẢN
128.000đ

[QR]

Bank ...
STK xxxx1234
Account Name ...
Content: TCL A102 X7Q2

[Đã kiểm tra & nhận tiền]
```

---

# 47. TEST MATRIX — ORDER

- [ ] DINE_IN không table -> reject.
- [ ] QR customer không đổi được bàn.
- [ ] QR dùng signed TableID token, không Name.
- [ ] DELIVERY thiếu address -> reject.
- [ ] Product inactive/out-of-stock -> server reject.
- [ ] Modifier invalid -> server reject.
- [ ] Client sửa price thành 1đ -> backend vẫn tính đúng.
- [ ] Double-click submit cùng idempotency key -> một order.
- [ ] Reload customer vẫn track order bằng tracking token.
- [ ] Gọi thêm món cùng table -> cùng TableSession.
- [ ] Item đã sent không bị rewrite âm thầm.

---

# 48. TEST MATRIX — KDS

- [ ] NEW -> PREPARING.
- [ ] PREPARING -> READY.
- [ ] Invalid transition -> reject server.
- [ ] KDS không chứa payment action.
- [ ] New ticket audio một lần.
- [ ] Cancel/change sau sent hiển thị rõ.
- [ ] KDS không scan history.
- [ ] DINE_IN không bắt buộc PACKING.

---

# 49. TEST MATRIX — PAYMENT

- [ ] Cash exact.
- [ ] Cash overpay -> change đúng.
- [ ] Cash insufficient -> reject.
- [ ] Transfer QR đúng bank settings.
- [ ] QR amount = authoritative due.
- [ ] Payment content unique đủ dùng.
- [ ] Đổi bank settings -> QR đổi.
- [ ] Không hardcoded official QR.
- [ ] Chưa staff confirm -> chưa PAID.
- [ ] Double confirm -> một Payment.
- [ ] Backend fail -> order/check vẫn còn UI.
- [ ] Backend fail -> table không tự FREE.
- [ ] Mixed payment tổng applied = due.
- [ ] Paid receipt chỉ sau commit.
- [ ] Report payment method lấy từ Payments.
- [ ] Không parse Notes để xác định payment.

---

# 50. TEST MATRIX — LOYALTY

- [ ] Submit order không cộng points.
- [ ] PAID cộng đúng một lần.
- [ ] Double checkout không cộng lại.
- [ ] Cancel unpaid không trừ VND thành points.
- [ ] Edit unpaid không đổi points.
- [ ] Redeem không vượt balance.
- [ ] Redeem không vượt policy max %.
- [ ] Public customer không redeem chỉ bằng phone.
- [ ] Refund tạo ledger reversal.

---

# 51. TEST MATRIX — TABLE

- [ ] Table có OPEN session không reset FREE.
- [ ] Move chỉ tới FREE table.
- [ ] Merge là action riêng.
- [ ] Không hard delete table có history.
- [ ] Table FREE chỉ khi session CLOSED.
- [ ] Paid-before-ready không tự free table nếu session còn OPEN.

---

# 52. TEST MATRIX — SECURITY

- [ ] Customer không gọi admin mutation.
- [ ] Customer không load Customers full.
- [ ] Customer không load Expenses.
- [ ] Customer không load Reports.
- [ ] Staff thường không save admin settings nếu role không cho phép.
- [ ] `?action=resetmenu` không còn public.
- [ ] `?action=setup` không còn public.
- [ ] Image upload authenticated.
- [ ] Payment confirm authenticated.
- [ ] Tampered table token bị reject.

---

# 53. TEST MATRIX — UI RUNTIME

- [ ] Không static `display:none` trên Vue modal.
- [ ] Không content sau `</html>`.
- [ ] JS syntax test pass.
- [ ] Vue mounts.
- [ ] Product customization mở được.
- [ ] Cart mở được.
- [ ] Checkout mở được.
- [ ] Receipt mở được.
- [ ] GAS failure hiện message.
- [ ] Không fallback mock production.
- [ ] Cart không mất do transient API error.

---

# 54. MIGRATION ROADMAP — KHÔNG BIG-BANG

## PHASE 0 — Runtime Stability

Chỉ sửa:

```text
getInitialData scope
HTML after </html>
static display:none on modals
callGAS error handling
production mock fallback
public setup/reset routes
```

Không đổi nghiệp vụ lớn trong phase này.

## PHASE 1 — Ordering Core

```text
Product variants/modifiers
Server pricing
Customer/Staff modes
Signed table QR
TableSession
Order batch/items
Context validation
Idempotent submit
Cart edit
```

## PHASE 2 — KDS

```text
Kitchen state separation
Active-only storage
KDS_VERSION polling
Remove payment from KDS
Cancel/change notification
```

## PHASE 3 — Payments

```text
Payments sheet
Cash flow
Dynamic VietQR
Manual transfer confirm
Mixed payment
Paid receipt
Idempotency
Table close rules
```

## PHASE 4 — Loyalty / CRM

```text
Normalize customer phone
LoyaltyLedger
Earn only after PAID
Staff-only redeem MVP
Refund reversals
```

## PHASE 5 — Reports / Performance

```text
DailySales
DailyProductSales
Payment-based reporting
HOT/HISTORY split
Lazy loading
Cache
```

## PHASE 6 — Admin / Tasks

```text
media persistence
roles
expense void
task enums
audit UI
```

---

# 55. MIGRATION SAFETY

Trước schema mutation:

```text
backup Spreadsheet
```

Không:

```text
clearContents transaction history
delete all
destructive rename không adapter
```

Migration phải:

```text
idempotent
versioned
logged
```

Trong quá trình chuyển đổi có thể giữ legacy:

```text
Orders
Order_Details
```

làm history/compatibility, đồng thời thêm:

```text
ActiveOrders
ActiveOrderItems
TableSessions
Payments
```

Chuyển write path từng phase.

---

# 56. FILE PRIORITY

## `index.html`

Vấn đề chính:

```text
monolith
hidden modals
mixed customer/staff/admin
frontend business rules
hardcoded QR
```

## `api.js`

```text
scope bug
client-trusted pricing
loyalty bugs
payment model
editOrder destructive
status mixing
auth/report semantics
```

## `db.js`

```text
full-sheet reads
linear updates
activeSpreadsheet dependency
```

## `main.js`

```text
public maintenance actions
schema migration logic
```

---

# 57. KHÔNG “TỐI ƯU” SAI HƯỚNG

Không được nghĩ:

```text
Map/Set = đã nhanh
```

nếu trước đó vẫn tải 100k rows.

Không được nghĩ:

```text
1 getInitialData call = tối ưu
```

nếu endpoint đó đọc cả database.

Không được nghĩ:

```text
Optimistic UI = tốt
```

với payment.

Không được nghĩ:

```text
QR hiện = đã trả tiền
```

---

# 58. APPS SCRIPT + GOOGLE SHEETS CÓ CÒN PHÙ HỢP?

Có, nếu TCLApp là một cửa hàng/số terminal vừa phải và kiến trúc đúng:

```text
active data nhỏ
history tách riêng
batch I/O
cache master data
aggregate reports
mode-specific bootstrap
```

Google Apps Script chính thức khuyến nghị giảm service calls, batch read/write và dùng CacheService hợp lý. Vì vậy mục tiêu số một là:

> **Mỗi request phải chạm Google Sheets ít nhất có thể.**

Khi có nhiều chi nhánh, concurrency cao, inventory/warehouse/accounting phức tạp, lúc đó mới cân nhắc Firestore / PostgreSQL / Cloud SQL.

---

# 59. DEFINITION OF DONE — POS 1.0

- [ ] Context DINE_IN/TAKEAWAY/DELIVERY đúng.
- [ ] DINE_IN bind table đúng.
- [ ] QR customer auto-bind table.
- [ ] Cart edit đầy đủ.
- [ ] Server authoritative pricing.
- [ ] Submit idempotent.
- [ ] TableSession hoạt động.
- [ ] Gọi thêm món cùng session.
- [ ] KDS nhận đúng batch.
- [ ] Customer tracking có token.
- [ ] DELIVERY có address.
- [ ] TAKEAWAY có pickup code.

---

# 60. DEFINITION OF DONE — PAYMENT 1.0

- [ ] Payments sheet riêng.
- [ ] PaymentStatus tách Order/Kitchen status.
- [ ] Cash received/change.
- [ ] Dynamic VietQR từ server settings.
- [ ] Không hardcode QR.
- [ ] Manual transfer confirmation rõ ràng.
- [ ] Mixed payment.
- [ ] Server commit trước UI success.
- [ ] Idempotency.
- [ ] Paid receipt riêng.
- [ ] Reports đọc Payments.
- [ ] Loyalty chỉ apply đúng một lần.

---

# 61. DEFINITION OF DONE — KDS 1.0

- [ ] Không payment button.
- [ ] NEW/PREPARING/READY.
- [ ] Modifiers/note dễ đọc.
- [ ] Urgency timer.
- [ ] Cancel/change notification.
- [ ] Version polling.
- [ ] Active-only data.
- [ ] Server transition validation.

---

# 62. DEFINITION OF DONE — TABLE QR 1.0

- [ ] QR dùng signed token.
- [ ] Scan vào customer mode.
- [ ] Không admin nav.
- [ ] Không table selector customer.
- [ ] Server verify token.
- [ ] Order lưu đúng TableID.
- [ ] Rename table không hỏng QR.
- [ ] Có QR token version/rotation strategy.

---

# 63. NHỮNG FEATURE KHÔNG NÊN LÀM NGAY

Tạm hoãn:

```text
inventory phức tạp
recipe costing
multi-branch
bank webhook giả
AI
delivery map
```

trước khi order/payment/table/KDS đúng.

---

# 64. GỢI Ý TÁCH PR CHO GEMINI

```text
PR-001 fix/p0-runtime
PR-002 security/app-modes
PR-003 order/server-pricing
PR-004 table-session-qr
PR-005 kds-state
PR-006 payments-v2
PR-007 loyalty-ledger
PR-008 reports-aggregate
```

Sau mỗi PR Gemini phải STOP và báo:

```text
FILES CHANGED
SCHEMA CHANGED
MIGRATION
TESTS RUN
KNOWN RISKS
ROLLBACK NOTE
```

Không tự triển khai tất cả phase một lần.

---

# 65. PROMPT CHÍNH GIAO CHO GEMINI CODE

## ROLE

Bạn là Senior Product Engineer + F&B POS Architect + Google Apps Script Engineer.

## REPOSITORY

```text
https://github.com/haiyenpa25/TCLApp
```

## MISSION

Refactor TCLApp từ prototype hiện tại thành POS/KDS/QR Ordering system nhỏ nhưng đúng logic nghiệp vụ. Không được chỉ vá UI.

Ưu tiên:

```text
correctness
data integrity
payment safety
user flow
Apps Script performance
maintainability
```

## READ FIRST

Đọc toàn bộ:

```text
README.md
SPECIFICATION.md
index.html
api.js
db.js
main.js
appsscript.json
```

Sau đó đối chiếu với tài liệu này.

## HARD REQUIREMENTS

1. Không tin price/total từ frontend.
2. Không cộng loyalty trước payment.
3. Không dùng KDS để checkout.
4. Không hardcode QR payment.
5. Không optimistic payment success.
6. Public customer không truy cập admin data.
7. Không dùng table name làm technical QR key.
8. Không rewrite toàn Order_Details để edit một order.
9. KDS không scan history.
10. Không dùng free-text Note làm payment database.
11. Financial mutations bắt buộc idempotent.
12. Sensitive mutations authenticated server-side.
13. Không big-bang rewrite.
14. Có migration + regression tests.
15. Stop sau từng phase để review.

---

# 66. GEMINI FIRST TASK — CHỈ PHASE 0

```text
PHASE 0 — Runtime Stability
```

Scope:

- sửa scope `getInitialData`;
- sửa content sau `</html>`;
- xóa static `display:none` trên Vue modals;
- chuẩn hóa `callGAS` reject/error path;
- disable production mock fallback;
- thêm visible fatal/bootstrap error UI;
- xóa public setup/reset routes;
- không thay business feature lớn.

Deliverables:

```text
docs/P0_AUDIT.md
docs/P0_TESTS.md
code changes
migration note if any
```

Tests:

- Vue mount;
- product customization opens;
- cart opens;
- checkout opens;
- receipt opens;
- GAS failure visible;
- no content after `</html>`;
- no public destructive endpoint;
- existing menu/tables still load.

**STOP sau P0.**

---

# 67. PROMPT GEMINI PHASE 1 — ORDER CORE

```text
Implement Order Core V2.

Requirements:
- Separate CUSTOMER and STAFF ordering modes.
- Introduce TableSession.
- Table QR uses signed TableID token.
- Customer mode locked to QR table.
- DINE_IN requires table.
- DELIVERY requires name, phone, address.
- Server calculates all prices from Products/Variants/Modifiers.
- Frontend submits IDs/options only.
- Introduce idempotency keys.
- Replace hardcoded global sizes with ProductVariants.
- Replace topping names with Modifier IDs.
- Add cart item editing.
- Additional table orders attach to same open TableSession.
- Do not redesign payment/KDS beyond compatibility adapters in this phase.
- Add tests.
- STOP for review.
```

---

# 68. PROMPT GEMINI PHASE 2 — KDS

```text
Implement KDS V2.

Requirements:
- KDS handles preparation only.
- Remove checkout/payment from KDS.
- NEW -> PREPARING -> READY kitchen transitions.
- Validate transitions server-side.
- DINE_IN/TAKEAWAY/DELIVERY labels and fulfillment differ.
- Use active-only Sheets.
- Add KDS_VERSION delta/snapshot polling.
- Do not read historical orders per poll.
- Show modifiers/item notes prominently.
- Add cancellation/change handling.
- Urgency thresholds configurable.
- STOP for review.
```

---

# 69. PROMPT GEMINI PHASE 3 — PAYMENTS

```text
Implement Payments V2.

Requirements:
- Create Payments model/sheet.
- Separate PaymentStatus from Order/Kitchen status.
- CASH: cash received + change.
- TRANSFER: one dynamic VietQR from server-side PaymentSettings.
- Remove hardcoded official QR.
- QR display must not imply payment success.
- Staff manually confirms transfer unless a real provider callback exists.
- MIXED cash + transfer.
- Payment confirmation server-first, not optimistic.
- Idempotency required.
- Paid receipt separate from kitchen ticket/pre-bill.
- Do not store payment method in Note.
- STOP for review.
```

---

# 70. PROMPT GEMINI PHASE 4 — LOYALTY

```text
Implement Loyalty V2.

Requirements:
- Create LoyaltyLedger.
- No points on order submission.
- Earn once after successful PAID transaction.
- Redeem only after server validation.
- Public customer QR cannot spend points based only on knowing a phone number.
- Support reversal for refund.
- Customers.PointsBalance may be materialized summary; ledger is audit source.
- Add regression tests: double checkout, cancel, edit, refund.
- STOP for review.
```

---

# 71. NGUỒN ĐÃ ĐỐI CHIẾU

Repository:

```text
https://github.com/haiyenpa25/TCLApp
```

Source chính đã đọc:

```text
README.md
SPECIFICATION.md
api.js
index.html
main.js
db.js
```

Google Apps Script Best Practices:

```text
https://developers.google.com/apps-script/guides/support/best-practices
```

Google Apps Script Quotas:

```text
https://developers.google.com/apps-script/guides/services/quotas
```

---

# 72. KẾT LUẬN

Không nên tiếp tục mô hình hiện tại:

```text
NEW
-> PREPARING
-> PACKING
-> SERVING
-> QR
-> COMPLETED
```

vì nó trộn:

```text
kitchen
fulfillment
payment
table occupancy
```

Target phải là:

```text
QR Bàn / Staff POS
      -> TableSession
      -> Order/Batch
      -> KitchenStatus
      -> FulfillmentStatus

Order/Check
      -> Payment(s)
      -> Paid Receipt
      -> Loyalty Ledger
      -> Daily Report Aggregate
```

Thứ tự refactor tối ưu:

```text
P0 Runtime Stability
-> P1 Ordering + Table QR
-> P2 KDS
-> P3 Payments
-> P4 Loyalty
-> P5 Reports/Performance
-> P6 Admin/Tasks
```

Đây là hướng ít phá source nhất, đồng thời sửa đúng các điểm người dùng cảm nhận tệ nhất hiện nay: **bấm không mở, QR bàn sai context, tạo đơn thiếu logic, KDS lẫn payment, QR thanh toán không đáng tin, loyalty sai và báo cáo không chuẩn.**