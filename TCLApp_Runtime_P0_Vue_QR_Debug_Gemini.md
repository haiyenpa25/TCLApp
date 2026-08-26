# TCLApp — Phân tích lỗi Vue/QR Runtime P0 & Prompt sửa cho Gemini

**Repository:** https://github.com/haiyenpa25/TCLApp  
**Mục tiêu:** xác định lỗi khiến Vue không mount, QR lỗi, toast hiển thị raw `{{ }}`, modal hoạt động bất thường; đồng thời đưa ra phạm vi sửa P0 rõ ràng để Gemini Code xử lý trước khi tiếp tục phát triển chức năng.

---

# 1. Kết luận nhanh

Ảnh lỗi cho thấy đây **không phải lỗi QR đơn thuần**.

Các dấu hiệu:

```text
{{ toast.icon || 'info' }}
{{ toast.message }}
```

đang hiển thị nguyên văn.

Ảnh QR cũng bị vỡ do binding Vue:

```html
<img :src="shopOfficialQR">
```

không được Vue xử lý.

Điều này cho thấy:

```text
Vue chưa mount / JavaScript bootstrap bị lỗi
        ↓
Vue directive không chạy
        ↓
{{ }} hiện nguyên văn
        ↓
:src không bind
        ↓
@click / v-if / computed / state không hoạt động đúng
```

Console trước đó cũng đã báo:

```text
Uncaught SyntaxError: Invalid or unexpected token
```

Đây là lỗi P0 cần xử lý trước toàn bộ logic POS/KDS/Payment.

---

# 2. Lỗi P0-01 — Vue frontend không mount

Triệu chứng hiện tại:

```text
{{ toast.message }}
```

xuất hiện trực tiếp trên giao diện.

Trong Vue bình thường, template này phải được render thành giá trị thật.

Nếu Vue không mount:

```html
{{ toast.message }}
```

sẽ bị browser hiển thị nguyên văn.

Tương tự:

```html
<img :src="shopOfficialQR">
```

browser không hiểu `:src`, nên ảnh không có URL hợp lệ.

## Kết luận

Cần tìm chính xác lỗi JavaScript xảy ra **trước khi `.mount('#app')` chạy**.

---

# 3. Lỗi P0-02 — Vue engine đang bị nhét trực tiếp vào `index.html`

Source hiện tại có cấu trúc kiểu:

```html
<script>
/* VUE 3 INLINED ENGINE */

... một khối minified rất lớn ...

function launchVueApp() {
   ...
}
</script>
```

Đây là cấu trúc rất khó duy trì trên Apps Script.

Chỉ cần một ký tự sai trong khối minified:

```text
SyntaxError
   ↓
toàn bộ script block dừng parse
   ↓
launchVueApp() không được khai báo/chạy
   ↓
Vue không mount
```

## Khuyến nghị P0

Không tiếp tục nhét nguyên runtime Vue minified vào file `index.html` khổng lồ.

Thiết lập một đường load Vue rõ ràng và có kiểm tra:

```text
Vue loaded
↓
Vue version OK
↓
launchVueApp()
↓
mount #app
↓
remove v-cloak/preloader
```

---

# 4. Lỗi P0-03 — Có code Vue nằm sau `</html>`

Source hiện tại có cấu trúc sai:

```html
</script>
</body>
</html>

<!-- vẫn còn Vue UI ở dưới -->
<div v-if="...">
   ...
</div>
```

Đây là lỗi HTML nghiêm trọng.

Browser có thể tự sửa DOM theo cách không dự đoán được.

## Hậu quả có thể gặp

- component nằm ngoài `#app`;
- `v-if` không hoạt động;
- `{{ }}` hiện raw;
- layout sai;
- event không bind;
- khó debug.

## Rule bắt buộc

Sau:

```html
</html>
```

không được có:

```html
<div>
<script>
<style>
```

hoặc bất kỳ UI nào khác.

---

# 5. Lỗi P0-04 — Vue modal/toast có `display:none` cứng

Một số component đang dùng:

```html
v-if="..."
style="display:none;"
```

Đây là logic mâu thuẫn.

Vue nói:

```text
render component
```

nhưng inline CSS lại nói:

```text
display:none
```

## Không được dùng pattern này

```html
<div v-if="showModal" style="display:none;">
```

## Cách đúng

Dùng:

```html
<div v-if="showModal">
```

và chỉ giữ:

```css
[v-cloak] {
  display: none !important;
}
```

để chống flash trước khi Vue mount.

---

# 6. Lỗi P0-05 — Toast raw chứng minh template không được Vue compile

Nếu app Vue chạy đúng:

```html
{{ toast.message }}
```

không bao giờ xuất hiện trên UI.

Vì vậy đây là một chỉ báo rất mạnh:

```text
Vue chưa mount
hoặc
script parse fail trước khi mount
```

Không nên mất thời gian sửa toast riêng.

Phải sửa bootstrap runtime.

---

# 7. Lỗi P0-06 — QR lỗi chỉ là hậu quả

QR modal đang dùng Vue binding:

```html
<img :src="shopOfficialQR">
```

Nếu Vue chết:

```text
:src
```

không được convert thành:

```text
src="https://..."
```

nên browser chỉ hiện icon ảnh lỗi + alt text.

## Kết luận

Không nên sửa ảnh QR trước.

Sửa Vue runtime trước.

---

# 8. Lỗi logic QR khác cần sửa sau P0

Frontend hiện có QR/tài khoản hardcode song song với settings backend.

Điều này tạo hai nguồn dữ liệu thanh toán:

```text
Frontend hardcode QR
+
Backend BANK_ID / ACCOUNT_NO / ACCOUNT_NAME
```

Đây là rủi ro production.

## Target

Chỉ còn một nguồn:

```text
Payment Settings
     ↓
Backend
     ↓
Dynamic VietQR
```

Không hardcode QR/tài khoản ở frontend.

Nhưng phần này là **P1/P2**, không nên sửa cùng P0 runtime.

---

# 9. Cần kiểm tra GitHub source và Apps Script deployment có cùng phiên bản không

Có dấu hiệu cho thấy:

```text
GitHub main
≠
Apps Script source
≠
Web App deployment /exec
```

Vì một số behavior thực tế không hoàn toàn khớp source GitHub.

## Cần kiểm soát pipeline

```text
Local/GitHub
↓
clasp push
↓
Apps Script source
↓
Deployment Version
↓
/exec
```

Sau khi sửa phải đảm bảo deploy đúng version mới.

---

# 10. P0 — Phạm vi sửa bắt buộc

Gemini chỉ sửa runtime trước.

## P0.1

Tìm chính xác JavaScript syntax error:

```text
Invalid or unexpected token
```

Không patch bằng cách che lỗi.

---

## P0.2

Thiết lập một đường Vue bootstrap đáng tin cậy.

Ví dụ flow:

```text
load Vue
↓
if (!window.Vue) show bootstrap error
↓
log Vue.version
↓
launchVueApp()
↓
mount('#app')
↓
verify mounted
```

---

## P0.3

Xóa toàn bộ:

```html
style="display:none;"
```

khỏi các element được Vue quản lý bằng:

```text
v-if
v-show
```

---

## P0.4

Di chuyển/xóa toàn bộ code nằm sau:

```html
</body>
</html>
```

---

## P0.5

Đảm bảo toàn bộ Vue UI nằm bên trong:

```html
<div id="app">
```

---

## P0.6

Giữ `[v-cloak]` làm cơ chế ẩn pre-mount duy nhất.

---

## P0.7

Thêm error diagnostics.

Ví dụ:

```js
window.onerror = ...
window.onunhandledrejection = ...
```

Log tối thiểu:

```text
[BOOT] Vue loading
[BOOT] Vue version
[BOOT] mount starting
[BOOT] mount success
[BOOT] mount failure
```

---

## P0.8

Nếu Vue load/mount thất bại, hiển thị lỗi rõ trên màn hình.

Không để:

```text
màn hình trống
```

hoặc raw template.

---

## P0.9

Không dùng mock fallback trong production.

Backend lỗi phải:

```text
show error
allow retry
preserve user state
```

Không:

```text
backend lỗi
→ load fake data
```

---

## P0.10

Thêm syntax validation trước deploy.

Không deploy nếu:

```text
HTML/JS parse fail
```

---

# 11. Acceptance Criteria P0

P0 chỉ được coi là hoàn tất khi tất cả điều kiện sau PASS:

- [ ] Không còn `Uncaught SyntaxError`.
- [ ] Vue load thành công.
- [ ] Có log Vue version.
- [ ] `#app` mount thành công.
- [ ] Không thấy raw `{{ ... }}`.
- [ ] `:src` bindings hoạt động.
- [ ] QR image bind đúng.
- [ ] Toast hiển thị message thật.
- [ ] Product customization modal mở được.
- [ ] Cart drawer/modal mở được.
- [ ] Checkout modal mở được.
- [ ] Receipt modal mở được.
- [ ] Không có `style="display:none"` đè `v-if/v-show`.
- [ ] Không có code sau `</html>`.
- [ ] Toàn bộ template Vue nằm trong `#app`.
- [ ] Backend/GAS failure hiện lỗi rõ.
- [ ] Không fallback mock data trong production.
- [ ] GitHub revision và Apps Script deployment được xác minh cùng version.

---

# 12. Những thứ CHƯA được làm trong P0

Không được sửa đồng thời:

```text
POS workflow
Order logic
KDS logic
Payment flow
Loyalty
CRM
Report
Database redesign
```

Lý do:

```text
Runtime chưa ổn
→ mọi feature test đều không đáng tin
```

---

# 13. Prompt đưa thẳng cho Gemini Code

```text
STOP ALL FEATURE DEVELOPMENT.

Repository:
https://github.com/haiyenpa25/TCLApp

Current production symptom:
- Vue expressions such as {{ toast.message }} are rendered literally.
- :src="shopOfficialQR" is not bound, so the QR image is broken.
- Previous browser console reports:
  Uncaught SyntaxError: Invalid or unexpected token.

MISSION:
Fix TCLApp runtime P0 only.

Required audit:

1. Find the exact JavaScript syntax error that prevents Vue from mounting.
2. Do not patch around the error.
3. Review the manually inlined Vue minified engine inside index.html.
4. Establish one reliable Vue loading/bootstrap path.
5. Ensure launchVueApp() executes only after Vue exists.
6. Log:
   - Vue loaded
   - Vue version
   - app mount started
   - app mount successful
   - mount failure
7. Remove all inline style="display:none" from elements controlled by v-if/v-show.
8. Move/remove ALL content currently located after </body> / </html>.
9. Ensure every Vue template is inside #app.
10. Keep [v-cloak] only for pre-mount hiding.
11. Add visible bootstrap error UI if Vue fails.
12. Add window.onerror and unhandledrejection diagnostics.
13. Do NOT modify POS/KDS/payment/business logic in this phase.
14. Do NOT use production mock fallback.
15. Run JavaScript/HTML syntax validation before deployment.
16. Verify the Apps Script deployed /exec revision is the same revision as GitHub.
17. Do not continue to another phase until all P0 acceptance tests pass.

Acceptance criteria:

- No raw {{ }} is visible.
- No broken :src binding.
- No Uncaught SyntaxError.
- Vue #app mounts successfully.
- QR modal opens/closes through Vue state.
- Toast renders actual message.
- Product customization modal opens.
- Cart modal opens.
- Checkout modal opens.
- Receipt modal opens.
- No HTML exists after </html>.
- No inline display:none overrides Vue visibility.
- GAS failures are visibly reported.
- Production does not silently switch to mock data.

After P0 passes:

STOP.

Report:
- exact root cause;
- changed files;
- changed line ranges;
- syntax/runtime test results;
- deployment version verified;
- remaining known risks.

Do NOT start POS/KDS/payment refactoring until review approval.
```

---

# 14. Thứ tự xử lý đề nghị

```text
1. SyntaxError
2. Vue bootstrap
3. HTML structure
4. v-if/display:none conflicts
5. Visible error handling
6. Deployment/version verification
7. Smoke test
8. STOP
```

Sau khi runtime ổn mới tiếp tục:

```text
Ordering
↓
Table QR
↓
KDS
↓
Payments
↓
Loyalty
↓
Reports
```

---

# 15. Kết luận

Lỗi hiện tại không nên được xem là:

```text
"QR không hiển thị"
```

Mà phải xem là:

```text
"Vue application runtime không được mount đúng"
```

QR chỉ là một trong nhiều hậu quả.

Các dấu hiệu quan trọng:

```text
raw {{ }}
broken :src
modal bất thường
SyntaxError
```

đều chỉ về cùng một lớp lỗi:

```text
JavaScript/Vue bootstrap P0
```

Vì vậy phải đóng băng feature development cho tới khi runtime P0 PASS.
