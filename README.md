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

### Nhiều Worker — mỗi Worker một thư mục

Mỗi Worker nối vào thư mục riêng của nó trên GitHub; mọi thư mục có **cùng code**, chỉ khác `wrangler.toml`:

- **Worker con** (`ttgdyh`, `tv`, …): `name = "<tên Worker>"` và `[triggers] crons = []` — **không có lịch riêng**.
- **Worker `tccb`** (chính): là Worker **duy nhất có lịch**, kèm các khối `[[services]] WARM_<tên>` trỏ tới từng Worker con.

Lý do: gói Cloudflare miễn phí chỉ cho **5 lịch (Cron) cho cả tài khoản**; 25 Worker mỗi cái một lịch sẽ deploy lỗi. Nay cứ 5 phút trong giờ làm việc, `tccb` đánh thức Apps Script của mình **và của mọi Worker con** (kết nối nội bộ Cloudflare, không mở ra Internet). Một Worker con lỗi hay chưa tồn tại không làm hỏng việc đánh thức các Worker khác.

**Cập nhật code:** chép `apps-script/`, `public/`, `src/`, `README.md` vào thư mục của từng Worker. `wrangler.toml` của mỗi thư mục chỉ cần thay một lần (bản trong gói tải về đã đúng tên).

**Thêm Worker mới tên `abc`:**
1. Tạo Worker `abc` trên Cloudflare, nối vào thư mục `abc` (Deploy command mặc định `npx wrangler deploy`). Thư mục `abc` dùng `wrangler.toml` của một Worker con, sửa `name = "abc"`.
2. Đặt `APPS_SCRIPT_URL` (link Web App của bản sao Google Sheet tương ứng) và `PROXY_KEY` cho Worker `abc`.
3. Trong `wrangler.toml` của **tccb**, thêm:
   ```toml
   [[services]]
   binding = "WARM_abc"
   service = "abc"
   entrypoint = "Warm"
   ```

> ⚠️ Riêng `Code.gs` thì **mỗi bản sao Google Sheet phải dán lại và Deploy → New version** (Apps Script không tự cập nhật theo GitHub). Nếu quên, giao diện hiện **dải vàng "Apps Script của bản này là bản cũ"** ở đầu trang để biết ngay bản nào chưa cập nhật.

### Chạy thử trên máy (tùy chọn)

```bash
cp .dev.vars.example .dev.vars   # rồi điền URL + PROXY_KEY thật
npx wrangler dev
```

---

## Phiếu đánh giá mới (từ tháng 10/2026) — mẫu chính thức

Từ **tháng đánh giá 10/2026** app dùng phiếu *"Tiêu chí đánh giá hiệu quả công việc hàng tháng đối với VC, NLĐ khối hành chính, hỗ trợ, phục vụ"* (mẫu chính thức). Các tháng trước vẫn dùng phiếu cũ (ai nộp bù tháng 9 vẫn ra phiếu cũ). Mốc này nằm ở `FORM_V2_FROM` trong `apps-script/Code.gs` **và** `public/index.html` — đổi thì đổi cả hai.

- **Nội dung tiêu chí ghi nguyên văn** theo mẫu chính thức.
- **Chấm đúng chỗ phiếu ghi điểm, mọi mục bước 0,5** (từ 0 đến điểm tối đa của mục):
  - 1.1 – 1.5: mỗi tiêu chí 0 → 2 (khoản trừ của 1.4 trừ vào 2 điểm của 1.4)
  - 2.1: 3 ý × (0 → 1) · 2.2: ý "thường xuyên" 0 → 2 + ý "đột xuất" 0 → 1 · 2.3: 2 ý × (0 → 1) · 2.4: 2 ý × (0 → 1)
  - 3.1 (0 → 4), 3.2 (0 → 3), 3.3 (0 → 3) — ai cũng tự chấm 3.3
  - Phần II giữ nguyên, mỗi mức có ghi kèm % tương ứng
- **Điểm thưởng:** tối đa đủ 7 điểm (Phòng TCCB chốt không áp giới hạn 10% KPI; dòng ghi chú trên phiếu vẫn giữ nguyên văn). Đề xuất > 0 thì bắt buộc mô tả cách làm hay & minh chứng. Tổng sau cộng tối đa 100.
- **Xếp loại chỉ theo tổng điểm** (đã cộng thưởng, tối đa 100): A+ ≥ 90 · A 70–<90 · B 50–<70 · C < 50. Không hạ xếp loại theo điểm phần II. Đạt A+ thì **bắt buộc ghi căn cứ xác nhận vượt mức**. Cột *Ghi chú xếp loại* trong sheet được giữ để không lệch cấu trúc, nay luôn để trống.
- **Ô ghi chú** (mô tả thưởng, căn cứ vượt mức) tối đa **100 từ**, có bộ đếm.
- **Trưởng đơn vị** nhập *Thưởng công nhận* (0 → mức đề xuất; để trống = công nhận đúng đề xuất); Điểm TĐV và xếp loại tự tính lại, vẫn sửa tay được.
- **Dữ liệu** lưu ở sheet `DuLieuDanhGia_KPI` (tự tạo khi có phiếu đầu tiên); sheet `DuLieuDanhGia` cũ giữ nguyên. Lịch sử cá nhân hiện cả hai; báo cáo/xuất Excel/CSV tháng nào theo mẫu tháng đó. (Sheet `DuLieuDanhGia_V2` nếu có là dữ liệu thử của bản nháp — xóa được.)

## Bảng tổng hợp chi thu nhập tăng thêm (HR)

Trang **Dashboard** của HR có nút **🏛️ Bảng tổng hợp chi thu nhập tăng thêm (mẫu TCCB, .xlsx)**: chọn tháng → bấm nút → chọn phạm vi, ngày lập, tên người ký → tải file Excel **đúng mẫu** "Kết quả đánh giá T9.2026" (quốc hiệu, tiêu đề theo tháng, 14 cột, nhóm theo Đơn vị, khối chữ ký, khổ ngang A4, lặp tiêu đề cột khi in).

- **Danh sách:** mặc định *Mức A* = người được Trưởng đơn vị xếp **A+ hoặc A**; hoặc chọn *Tất cả người đã nộp*. Phiếu chưa được TĐV đánh giá không vào danh sách mức A (có thông báo số lượng).
- **Nguồn cột:** Chức danh ← cột `CD/CV`, Bộ môn ← cột `DonVi`, Đơn vị ← cột `ĐƠN VỊ` của `DanhSachNhanSu`; *Hiệu trưởng phê duyệt* điền sẵn bằng xếp loại của TĐV (sửa tay trong file nếu khác). *Ý kiến của cá nhân* = căn cứ vượt mức (A+) và mô tả cách làm hay (nếu có đề xuất thưởng).
- **Khối chữ ký:** mỗi người ký (Người lập bảng · Phòng TCCB · Hiệu trưởng) có ô chọn — bỏ chọn thì khối đó (chức danh + họ tên) không in ra file; bỏ cả ba thì file không có phần chữ ký.
- File được tạo ngay trên trình duyệt (thư viện ExcelJS tải từ CDN khi bấm nút); tên người ký và các ô chọn được nhớ cho lần sau.

## Hai loại phiếu trong một ứng dụng (bản gộp 2026.10.30)

Một ứng dụng dùng cho cả **giảng viên, nghiên cứu viên, trợ giảng** (phiếu `GV`) và **khối hành chính, hỗ trợ, phục vụ** (phiếu `HCHTPV`). Hai mẫu phiếu cùng cấu trúc điểm (`V2_KEYS`), chỉ khác chữ tiêu chí; nội dung từng mẫu ghi nguyên văn như hai ứng dụng trước (`V2_FORM_HCHTPV`, `V2_FORM_GV` trong `public/index.html`).

**Vị trí đánh giá.** Mỗi dòng trong `DanhSachNhanSu` là một *vị trí đánh giá* = (người, đơn vị, loại phiếu). Thêm cột **`LoaiPhieu`** với giá trị `GV` hoặc `HCHTPV` (để trống = `HCHTPV`). Một người kiêm nhiệm thì có nhiều dòng, mỗi dòng một vị trí:

| MSNV | HoTen | DonVi | TRUONG DON VI | LoaiPhieu |
|---|---|---|---|---|
| 002 | Nguyễn Đức Tuấn | Bộ môn X | | GV |
| 002 | Nguyễn Đức Tuấn | Bộ môn X | x | HCHTPV |
| 002 | Nguyễn Đức Tuấn | Trường Dược | x | HCHTPV |

- Mỗi vị trí nộp **một phiếu mỗi tháng**. Khóa chống nộp trùng là *mã số + đơn vị + **loại phiếu** + tháng*, nên phiếu `GV` và phiếu `HCHTPV` cùng một bộ môn không chặn nhau.
- Đăng nhập: người có nhiều vị trí chọn vị trí; về sau dùng **🔄 Chuyển đơn vị**. Trang **Tự đánh giá** hiện thêm danh sách *"Các phiếu của Thầy/Cô tháng …"*, mỗi vị trí đánh dấu ✅ đã nộp / ⏳ chưa nộp và có nút chuyển nhanh, để không ai bỏ sót phiếu kiêm nhiệm.
- Lịch sử cá nhân, bảng chấm của Trưởng đơn vị và báo cáo HR đều có nhãn/cột **Loại phiếu**. Một người có hai phiếu trong cùng đơn vị thì hiện thành hai dòng, điểm Trưởng đơn vị chấm vào đúng từng phiếu.
- Bảng tổng hợp chi thu nhập tăng thêm (TCCB) có ô chọn **Loại phiếu**: cả hai / chỉ HCHTPV / chỉ GV; tiêu đề và tên file đổi theo.
- Dữ liệu vẫn lưu ở `DuLieuDanhGia_KPI`, thêm **cột cuối "Loại phiếu"** (cột 37). Dòng cũ để trống được hiểu là `HCHTPV`. Phiếu tháng trước 10/2026 (mẫu cũ) không phân loại.

### Cài đặt (làm 1 lần)

1. Dán `apps-script/Code.gs` mới vào Apps Script → **Deploy → Manage deployments → ✏️ → New version → Deploy**.
2. Chạy hàm **`setupLoaiPhieu`**: thêm cột `LoaiPhieu` vào `DanhSachNhanSu` và cột "Loại phiếu" vào `DuLieuDanhGia_KPI`, ô trống điền `HCHTPV` (chạy lại an toàn, không ghi đè ô đã có).
3. Sửa cột `LoaiPhieu` = `GV` cho các dòng giảng viên / nghiên cứu viên / trợ giảng. Với người kiêm nhiệm, thêm dòng cho từng vị trí như bảng trên.
4. Chạy hàm **`listMultiRole`** để xem danh sách người có nhiều vị trí và rà soát lần cuối.
5. Push `public/index.html` lên GitHub để Cloudflare triển khai lại. Chân trang phải hiện *phiên bản 2026.10.30*; nếu Apps Script chưa cập nhật, trang hiện dải vàng cảnh báo.

> Muốn chuyển dữ liệu từ một bản dggv cũ sang bản gộp: dán các dòng `DanhSachNhanSu` và `DuLieuDanhGia_KPI` của dggv vào Sheet của bản gộp (hai sheet cùng cấu trúc cột) rồi đặt cột `LoaiPhieu` = `GV` cho các dòng vừa dán. Sau đó có thể ngừng Worker dggv.

## Ai chấm phiếu của ai (cột `NguoiCham`)

Mỗi vị trí đánh giá trong `DanhSachNhanSu` có thêm cột **`NguoiCham`** = MSNV của người chấm phiếu đó (hàm `setupLoaiPhieu` tự thêm cột). Áp dụng cho phiếu từ tháng 10/2026; phiếu cũ vẫn chấm theo đơn vị.

1. Ô `NguoiCham` có MSNV hợp lệ → **chỉ người đó** thấy và chấm phiếu này. Người chấm phải có ít nhất một dòng `TRUONG DON VI` = `x` (hoặc `hr`) để vào được trang chấm sau khi xác thực OTP.
   - Cột tùy chọn **`DonViCham`** gắn phiếu với một vị trí của người chấm: ghi tên đơn vị (đúng như cột `DonVi`, vd. `Trường Dược`) thì phiếu **chỉ hiện khi người chấm đang ở vị trí Trưởng đơn vị của đơn vị đó**. Để trống thì hiện ở mọi vị trí Trưởng đơn vị của người chấm. Ghi sai (người chấm không phải Trưởng đơn vị ở đó) thì bị bỏ qua.
2. Ô `NguoiCham` trống → **Trưởng đơn vị** (`x`) của đơn vị đó chấm, trừ chính chủ phiếu, và **chỉ khi đang ở đúng vị trí của đơn vị đó**.
3. Không còn ai đủ điều kiện (vd. chủ phiếu là Trưởng đơn vị duy nhất của đơn vị) → **HR** chấm, ở mục *Chấm phiếu được giao* trên menu HR.
4. **Không ai chấm phiếu của chính mình.** Kiểm tra ở máy chủ khi xem và khi lưu.

Bảng chấm hiển thị cột **Đơn vị** vì một người chấm có thể chấm phiếu của nhiều đơn vị; một người có hai phiếu (hai vị trí) hiện thành hai dòng và điểm ghi đúng từng phiếu. Mỗi lần lưu, MSNV người chấm được ghi vào cột cuối **"Người chấm (MSNV)"** của `DuLieuDanhGia_KPI`.

Ví dụ để ông Tuấn ở vị trí *Hiệu trưởng Trường Dược* chỉ thấy các Trưởng đơn vị được giao, còn ở vị trí *Trưởng bộ môn X* chỉ thấy người của Bộ môn X: ghi `DonViCham` = `Trường Dược` cho các dòng `NguoiCham` = MSNV ông Tuấn dưới đây.

Cô Tươi (Trưởng phòng QTTH) → `NguoiCham` = MSNV ông Tuấn; ông Hải (Trưởng bộ môn và Phó hiệu trưởng) → cả hai dòng `NguoiCham` = MSNV ông Tuấn; hai dòng Trưởng đơn vị của ông Tuấn → `NguoiCham` = MSNV người của Phòng TCCB (hoặc cấp trên) để Phó hiệu trưởng cùng đơn vị không chấm phiếu của Hiệu trưởng.

**Cài đặt:** dán `Code.gs` mới, tạo phiên bản mới; chạy `setupLoaiPhieu` (thêm cột `NguoiCham` và tiêu đề cột mới ở sheet phiếu); điền cột `NguoiCham`; chạy **`checkNguoiCham`** để rà (ai chỉ định sai, ai là Trưởng đơn vị chưa có người chấm). Chạy lại bất cứ lúc nào.

## Người làm việc ở nhiều đơn vị

- Mỗi **vị trí đánh giá** (đơn vị + loại phiếu) đánh giá riêng: kiểm tra "đã gửi" theo *mã số + đơn vị + loại phiếu + tháng* (gửi ở vị trí A vẫn gửi được ở vị trí B; gửi lại ở A thì bị chặn). Lịch sử cá nhân hiện tất cả các vị trí.
- Nút **🔄 Chuyển đơn vị** (trên menu trái và cạnh dòng "Đơn vị" ở trang Tự đánh giá) — chỉ hiện với người có từ 2 vị trí/vai trò trở lên. Chuyển không cần đăng xuất; đã xác thực OTP lúc đăng nhập thì không phải nhập lại. Mỗi lần chuyển được ghi vào `LichSuDangNhap` (trạng thái "🔄 Chuyển đơn vị").

## Tốc độ

- **Đọc ít dữ liệu:** backend dùng *TextFinder* của Sheets để tìm đúng dòng cần (theo MSNV, theo tháng) thay vì đọc cả sheet — đăng nhập, kiểm tra đã nộp, lịch sử, bảng Trưởng đơn vị, dashboard HR đều chỉ đọc phần liên quan. Lưu bảng chấm ghi một lần cho cả nhóm dòng.
- **Ít lần gọi máy chủ:** sau đăng nhập trang tải trước lịch sử cá nhân → chọn tháng hiện kết quả ngay; Trưởng đơn vị chọn tháng là dữ liệu đơn vị được tải trước, bảng chấm và thống kê dùng chung.
- **Giữ Apps Script "ấm":** Worker `tccb` có `[triggers] crons` — 5 phút/lần trong 7h–19h (giờ VN) gọi nhẹ Apps Script của cả 25 đơn vị để tránh phải chờ Google khởi động lại. Có thể chỉnh giờ trong `crons` (giờ UTC).
- Phần chậm còn lại chủ yếu là thời gian Google chạy Apps Script (~1–2 giây/lần) và gửi email OTP (~1–2 giây) — không rút ngắn thêm được bằng code.

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
| Build báo tên Worker không khớp | Sửa `name` trong `wrangler.toml` của thư mục đó cho trùng tên Worker trên dashboard |
| Build của `tccb` báo lỗi service binding | Một tên trong các khối `WARM_` chưa có Worker trên Cloudflare — tạo Worker đó trước, hoặc xóa khối `WARM_` của nó |
| Build báo vượt giới hạn Cron (*exceeded … cron triggers*) | Worker con nào đó còn `wrangler.toml` cũ có lịch — thay bằng bản có `crons = []` |
| *Máy chủ chưa cấu hình PROXY_KEY (Script properties)* | Thêm `PROXY_KEY` ở Apps Script (Bước 1.4) |
| *Không có quyền truy cập* | `PROXY_KEY` hai bên chưa trùng nhau |
| *Apps Script không trả về JSON* | Sai URL Web App, hoặc chưa đặt *Who has access = Anyone* |
| Sửa `Code.gs` nhưng không thấy thay đổi | Chưa tạo **New version** khi deploy |
| Dải vàng *"Apps Script của bản này là bản cũ"* | Dán `Code.gs` mới vào bản sao Google Sheet của Worker đó → Deploy → Manage deployments → ✏️ → **New version** |
| *Máy chủ trả dữ liệu không đúng dạng* | Giao diện và Apps Script lệch phiên bản — cập nhật `Code.gs` như dòng trên. Phiếu đã gửi vẫn được lưu; xem ở "Kết quả & lịch sử" |
| Chân trang hiện phiên bản | Dòng "phiên bản 2026.10.17" cuối trang cho biết giao diện đang chạy bản nào; nếu thấy bản cũ, nhấn Ctrl+F5 |

**Tự bảo vệ dữ liệu:** sheet mới tạo trong Google Sheets mặc định chỉ có 1000 dòng × 26 cột. Từ bản 2026.10.17, Apps Script tự nới thêm dòng/cột trước khi ghi (phiếu mới cần 36 cột, báo cáo 34 cột), nên không còn lỗi khi số phiếu vượt 1000 hoặc sheet thiếu cột.
