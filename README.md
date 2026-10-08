# Phiếu tự đánh giá VC-NLĐ — Đại học Y Dược TP. HCM

Web app đánh giá hiệu quả công việc hằng tháng cho VC-NLĐ khối hành chính, hỗ trợ, phục vụ.

```
Trình duyệt ──► Cloudflare Worker (src/worker.js)
                     │  /        → file tĩnh public/index.html
                     │  POST /api
                     ▼
               src/api.js  ── thêm PROXY_KEY + IP người dùng
                     │
                     ▼
               Google Apps Script Web App (apps-script/Code.gs)
                     │
                     ▼
               Google Sheets (DanhSachNhanSu, DuLieuDanhGia, LichSuDangNhap)
```

Google Sheets vẫn là nơi lưu dữ liệu. Apps Script chỉ còn làm API; giao diện chạy trên Cloudflare.

## Cấu trúc thư mục

| Đường dẫn | Nội dung |
|---|---|
| `public/index.html` | Toàn bộ giao diện (HTML + CSS + JS) |
| `public/_headers` | Header bảo mật cho file tĩnh |
| `src/worker.js` | Điểm vào Worker: `/api` → proxy, còn lại → file tĩnh |
| `src/api.js` | Proxy `/api` → Apps Script |
| `apps-script/Code.gs` | Backend, dán vào Apps Script của file Google Sheets |
| `wrangler.toml` | Cấu hình Cloudflare Worker |

---

## Bước 1 — Cập nhật Google Apps Script

1. Mở file Google Sheets → **Tiện ích mở rộng → Apps Script**.
2. Thay toàn bộ nội dung `Code.gs` bằng file `apps-script/Code.gs` trong repo này.
3. **Xóa file `Index.html`** trong Apps Script (giao diện giờ nằm trên Cloudflare).
4. Vào **Project Settings (⚙️) → Script properties → Add script property**:
   - `PROXY_KEY` = một chuỗi bí mật dài, ví dụ tạo bằng https://www.uuidgenerator.net (ghi lại để dùng ở Bước 3).
5. Chạy các hàm quản trị **một lần** (chọn tên hàm trên thanh công cụ → ▶ Run, cấp quyền khi được hỏi):
   - `backfillMsnv` — điền cột **Y (MSNV)** cho các phiếu cũ. Hàm sẽ liệt kê những dòng trùng tên không tự xác định được; điền tay MSNV cho các dòng đó.
   - `fixThangDanhGia` — chuẩn hóa cột B về dạng `MM-YYYY`.
6. **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Bấm Deploy, sao chép **Web app URL** (dạng `https://script.google.com/macros/s/.../exec`).

> Khi sửa `Code.gs` sau này: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. URL giữ nguyên.

## Bước 2 — Đưa code lên GitHub

```bash
cd vcnld-danhgia
git init -b main
git add .
git commit -m "Phiếu tự đánh giá VC-NLĐ — Cloudflare Pages + Apps Script"
git remote add origin https://github.com/<tai-khoan>/vcnld-danhgia.git
git push -u origin main
```

(Tạo repo trống `vcnld-danhgia` trên GitHub trước, nên để **Private**.)

## Bước 3 — Triển khai lên Cloudflare (Workers)

1. Mở `wrangler.toml`, sửa dòng `name = "vcnld-danhgia"` cho **trùng tên Worker** trên Cloudflare, rồi commit và push.
2. Vào https://dash.cloudflare.com → **Workers & Pages → Create → Import a repository** → chọn repo.
   - *Build command*: để trống
   - *Deploy command*: `npx wrangler deploy` (mặc định)
3. Vào Worker → **Settings → Variables and Secrets → Add**:
   - `APPS_SCRIPT_URL` = Web app URL ở Bước 1.6 (kiểu *Text*)
   - `PROXY_KEY` = cùng chuỗi đã đặt ở Bước 1.4 (kiểu **Secret**)
4. Vào **Deployments** → chạy lại bản build (hoặc push một commit mới). Trang chạy tại `https://<ten-worker>.<tai-khoan>.workers.dev`; có thể gắn tên miền riêng ở **Settings → Domains & Routes**.

Từ đó mỗi lần `git push` lên nhánh `main`, Cloudflare tự triển khai lại. `wrangler.toml` có `keep_vars = true` nên các biến đặt trên dashboard không bị xóa khi deploy.

### Chạy thử trên máy (tùy chọn)

```bash
cp .dev.vars.example .dev.vars   # rồi điền URL + PROXY_KEY thật
npx wrangler dev
```

---

## Đăng nhập 2 lớp (OTP qua email) cho Trưởng đơn vị & HR

Người có vai trò **Trưởng đơn vị** hoặc **HR** (ở bất kỳ đơn vị nào) sau khi nhập mã số/CCCD sẽ nhận **mã OTP 6 số qua email**. Nhập đúng mã mới vào được hệ thống. VC-NLĐ thường vẫn chỉ cần mã số.

- Mã hiệu lực 5 phút, dùng 1 lần; sai 5 lần phải đăng nhập lại; gửi lại mã sau 120 giây (tối đa 3 lần).
- Mỗi tài khoản tối đa 6 email OTP / 15 phút (chống spam hộp thư).
- Email OTP ghi rõ thời gian, thiết bị, IP, vị trí. Nếu Trưởng đơn vị nhận email mà không phải mình đăng nhập thì biết ngay có người dùng trộm CCCD.
- Phiên đăng nhập cũ của Trưởng đơn vị/HR (cấp trước khi bật OTP) tự bị từ chối, buộc đăng nhập lại.

**Cài đặt (làm 1 lần):**

1. Sheet `DanhSachNhanSu`: thêm cột tiêu đề **`Email`**, điền email cho mọi dòng có `TRUONG DON VI` = `x` hoặc `hr`. *Ai chưa có email sẽ không đăng nhập được.*
2. Dán `apps-script/Code.gs` mới vào Apps Script.
3. Chạy hàm **`testOtpEmail`** (▶ Run) → cấp quyền **gửi email** khi được hỏi → kiểm tra hộp thư của chính mình.
4. Chạy hàm **`checkMissingEmails`** để xem còn ai thiếu email.
5. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
6. Push code lên GitHub để Cloudflare triển khai lại `public/index.html` và `src/api.js`.

> Email gửi từ tài khoản Google đang sở hữu script. Hạn mức: tài khoản Gmail thường ~100 email/ngày, Google Workspace ~1.500 email/ngày.

### Lịch sử đăng nhập (sheet `LichSuDangNhap`)

Mỗi lần đăng nhập, sai mã, gửi/gửi lại OTP, sai OTP… đều được ghi với các cột:

`Thời gian · MSNV/CCCD · Họ tên · Đơn vị · Vai trò · Trạng thái · Chi tiết · IP · Vị trí (ước tính) · Nhà mạng · Tên thiết bị · Loại thiết bị · Hệ điều hành · Trình duyệt · Màn hình · Ngôn ngữ · Múi giờ · User-Agent · Mã phiên`

- *Mã phiên* giống nhau ở các dòng "Đã gửi OTP" → "Sai OTP" → "Thành công (OTP)" của cùng một lượt đăng nhập.
- *Tên thiết bị*: Android dùng Chrome/Edge/Cốc Cốc/Zalo thường hiện đúng mã máy (vd. `Samsung SM-S918B`). iPhone/iPad chỉ hiện `iPhone`/`iPad`; máy tính chỉ hiện hệ điều hành. Trình duyệt không cho web đọc tên máy tính do người dùng đặt.
- *Vị trí* ước tính theo IP (cấp thành phố), do Cloudflare cung cấp.
- Hàng tiêu đề cũ (6 cột) tự được mở rộng ở lần ghi đầu tiên; dữ liệu cũ giữ nguyên.

## Thay đổi so với bản cũ

**Chọn tháng**
- Bỏ `<input type="month">` (Safari cũ, Firefox desktop… không hiển thị được, người dùng phải gõ tay nên sai định dạng).
- Thay bằng 2 ô chọn **Tháng / Năm**, chạy trên mọi trình duyệt; các tháng tương lai bị khóa.
- Backend chuẩn hóa mọi kiểu tháng (`09-2026`, `9/2026`, `2026-09`, ô bị Sheets đổi thành ngày…) về `MM-YYYY`, nên dữ liệu cũ gõ sai vẫn được nhận đúng.

**Dữ liệu**
- Chặn gửi trùng ở backend (có khóa `LockService`), không chỉ kiểm tra ở giao diện.
- Nhận diện người dùng theo **MSNV** (cột Y mới) thay vì họ tên → hai người trùng tên không còn bị lẫn phiếu/lịch sử.
- Trưởng đơn vị lưu điểm: kiểm tra lại đúng người, đúng đơn vị, đúng tháng trước khi ghi; nếu sheet đã bị sắp xếp/xóa dòng thì tự tìm lại dòng đúng.
- Điểm 0 hiển thị là `0` (trước đây bị trống).
- Backend tự tính lại điểm và kiểm tra từng mức điểm hợp lệ; họ tên/đơn vị lấy từ phiên đăng nhập, không tin dữ liệu gửi lên.

**Bảo mật**
- Đăng nhập cấp token có chữ ký (hết hạn sau 8 giờ); mọi thao tác đều kiểm tra token và vai trò ở backend. Dữ liệu toàn trường và xuất báo cáo chỉ dành cho vai trò HR; bảng chấm chỉ dành cho Trưởng đơn vị của chính đơn vị đó.
- Apps Script chỉ nhận yêu cầu có `PROXY_KEY` (chỉ Cloudflare biết).
- Khóa đăng nhập 15 phút sau 10 lần nhập sai mã số từ cùng một IP.
- Mọi dữ liệu hiển thị đều được escape (ghi chú có dấu `"`, `<`… không làm vỡ giao diện).

**Chức năng**
- Trưởng đơn vị và HR có thêm trang **Tự đánh giá** và **Kết quả & lịch sử** của chính mình.
- Bỏ cột "Chức danh" luôn trống trong file CSV; CSV và Excel dùng cùng bộ cột.
- Có thể đăng nhập bằng CCCD mất số 0 ở đầu (do Sheets lưu dạng số).
- Tải lại trang không bị đăng xuất (phiên lưu trong tab trình duyệt).

## Xử lý sự cố

| Thông báo | Cách xử lý |
|---|---|
| *Máy chủ chưa cấu hình APPS_SCRIPT_URL / PROXY_KEY* | Thêm biến ở Worker → Settings → Variables and Secrets |
| Build báo tên Worker không khớp | Sửa `name` trong `wrangler.toml` cho trùng tên Worker trên dashboard |
| *Máy chủ chưa cấu hình PROXY_KEY (Script properties)* | Thêm `PROXY_KEY` ở Apps Script (Bước 1.4) |
| *Không có quyền truy cập* | `PROXY_KEY` hai bên chưa trùng nhau |
| *Apps Script không trả về JSON* | Sai URL Web App, hoặc chưa đặt *Who has access = Anyone* |
| Sửa `Code.gs` nhưng không thấy thay đổi | Chưa tạo **New version** khi deploy |
