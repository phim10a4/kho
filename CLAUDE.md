# CLAUDE.md – App KHO PHÚC XUÂN

Tài liệu bàn giao cho Claude Code. Đọc hết file này trước khi sửa bất cứ thứ gì.

## 1. Người dùng & cách làm việc
- Chủ dự án: **Hoàng** (Phúc Xuân Foods). Trả lời **bằng tiếng Việt**, ngắn gọn, thẳng vào việc.
- Hoàng làm theo kiểu "vibe coding": **không đọc code từng dòng** → luôn giải thích bằng lời thường, tự test kỹ, báo kết quả.
- Thích: **code đầy đủ** (không đưa diff), **khối CONFIG** ở đầu file để dễ chỉnh, làm việc qua GitHub để đổi máy vẫn làm tiếp được.
- Người dùng cuối: nhân viên kho, **có người lớn tuổi** → chữ to, nút to, ít bước, không bắt gõ nhiều.
- Trước khi đổi giao diện lớn: **đưa ảnh phương án cho Hoàng chọn trước** rồi mới áp dụng.

## 2. Bài toán
Trước đây nhân viên nhắn nhập/xuất kho vào nhóm Zalo "KHO PHÚC XUÂN", Hoàng phải chép tay vào Google Sheet **QUẢN LÝ KHO**.
App này cho nhân viên tự nhập phiếu **nhập / xuất** (nhiều món một lần), sửa/xoá phiếu, và **xem tồn kho** theo kho.
Kiểm kê, chuyển kho: chưa làm (ít dùng, làm sau nếu cần).

## 3. Kiến trúc
```
Điện thoại ──► https://phim10a4.github.io/kho   (GitHub Pages: index.html + sw.js + manifest + icon)
                  │  fetch POST {fn, args} (Content-Type text/plain → không preflight CORS)
                  ▼
            Apps Script web app (doPost)  ──►  Google Sheet "QUẢN LÝ KHO"
            (link cũ script.google.com/.../exec vẫn chạy giao diện HtmlService – dùng song song)
```
- **Repo GitHub:** `phim10a4/kho` (PUBLIC – bắt buộc để dùng GitHub Pages miễn phí). Pages phục vụ từ nhánh `main`, thư mục gốc.
  → Không commit dữ liệu, mật khẩu, PIN, ID Google Sheet vào repo.
- **Apps Script:** project gắn với file sheet, tên "Quản lý kho".
  - Web app deployment ID (giữ nguyên, đừng tạo deployment mới, nếu không link chết):
    `AKfycbyjAKzg8t_4_2D_jHlin4Ywbt0KBjnqOG-7WGBj6qN3HdtPbDWP2ZvjYaWKm2oB5-QuEg`
  - Chạy dưới tài khoản Hoàng, quyền truy cập "Bất kỳ ai" (không cần đăng nhập). Bảo vệ bằng **mã PIN** (sheet CAI_DAT ô D2) – server kiểm PIN ở mọi API.
- `index.html` (web) và `apps-script/KhoAppUI.html` (giao diện cũ trong Apps Script) **gần như giống nhau**; khác ở: hàm `call()` (fetch ↔ google.script.run), thẻ meta/manifest, đăng ký service worker. Sửa giao diện thì **sửa cả hai** (hoặc chỉ web nếu Hoàng bỏ link cũ).

## 4. Cấu trúc thư mục
| Đường dẫn | Vai trò |
|---|---|
| `index.html` | App chạy trên GitHub Pages (UI + logic phía máy, CONFIG `API_URL`, `UI`) |
| `sw.js` | Service worker: lưu sẵn app để mở khi mất mạng; **tăng `VERSION` mỗi lần phát hành** để máy hiện "Có bản mới" |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`, `favicon.png` | Cài như app trên màn hình chính |
| `apps-script/KhoApp.gs` | Server: `doGet` (UI cũ), `doPost` (API cho web), các `khoApi_*`, ghi/đọc sheet |
| `apps-script/KhoAppUI.html` | UI cũ chạy trong Apps Script (HtmlService) |
| `design/` | 3 phương án giao diện đã đưa Hoàng chọn (đã chọn **A – Thương hiệu xanh**), logo |
| `tests/` | Giả lập app bằng jsdom (không cần mạng) |

Project Apps Script còn **các file cũ không thuộc app** (KetchuyenTonkho.gs, TaoIDNhapXuat.gs, CapnhatTonkho.gs, InNhanDan.gs, PrintDialog.html, appsscript.json) – chưa có trong repo. Xem mục 8 trước khi dùng clasp.

## 5. Google Sheet "QUẢN LÝ KHO" (locale **vi_VN**)
| Sheet | App dùng thế nào |
|---|---|
| **Tồn Kho** | Danh mục hàng: B tên, C ĐVT, D phân loại, E mã; dữ liệu từ dòng 4. Cột F–O là số liệu tĩnh do script cũ `updateStaticInventoryReport` ghi theo lịch – app **không** đọc. |
| **Nhập kho / Xuất kho** | Dòng 4 trở đi. App đọc/ghi cột **A** ID, **C** ngày, **E** tên, **G** SL, **H** ghi chú (NCC / lý do), **I** người, **J** kho. **B, D, F là ARRAYFORMULA ở dòng 3 – tuyệt đối không ghi vào.** |
| **Chuyển Kho** | Chỉ đọc để tính tồn: E tên, G SL, H từ kho, I đến kho |
| **CAI_DAT** | App tạo nếu thiếu. A người dùng, B kho, C lý do xuất (gợi ý), D2 mã PIN. Cache 2 phút. |
| **LICH_SU_APP** | Nhật ký tạo/sửa/xoá (chỉ ghi thêm, không đọc lại). Xoá thoải mái. |

## 6. Quyết định & bẫy đã gặp (QUAN TRỌNG)
1. **Locale vi_VN:** công thức trong sheet dùng dấu phẩy thập phân. Ghi `=20.5+3` → `#ERROR!`. Vì vậy số thập phân trong công thức được viết dạng **`(205/10)`** (không phụ thuộc locale), ví dụ `=2+3*(16/10)`. `kho_qtyText_` đọc ngược lại để hiển thị `2+3×1,6`.
2. **Cột A (ID) có sẵn hàng nghìn mã `XK…/NK…` trống** (rác AppSheet cũ, tới ~dòng 3280 ở Xuất kho). → `kho_lastDataRow_` chỉ dựa vào **cột E (Tên hàng)**. Đừng đổi lại.
3. **Nhập kho có ~1.074 dòng rác AppSheet (dòng 4–1077)** có tên nhưng không có SL → app bỏ qua khi tính, phiếu mới nằm sau dòng 1077. Chưa dọn (chờ Hoàng đồng ý).
4. Script cũ có trigger `recordEntry`/`recordExit` (onChange) – chỉ xử lý ID bắt đầu `NK-`/`XK-`; ID app là `PN…/PX…` nên không đụng nhau.
5. ARRAYFORMULA dòng 3 từng giới hạn `D4:D1995` → `kho_fixOpenRanges_` đổi thành dải mở `D4:D`.
6. **Chống ghi trùng:** mã phiếu do **điện thoại tạo** (`PN|PX` + `yyMMdd-HHmmss` + 4 ký tự). Server: tạo mới mà mã đã có → bỏ qua; sửa phiếu cũ (`CU|ngày|kho`) dùng `newKey` để gửi lại vẫn an toàn; xoá không thấy → coi là xong.
7. **Lỗi dữ liệu** trả về có tiền tố `KHO|` → máy KHÔNG gửi lại; lỗi khác (mạng, timeout, lock) → giữ trong hàng chờ, 20 giây thử lại.
8. Dòng không có mã app (nhập tay trong sheet) được gom thành "phiếu cũ" theo **ngày + kho** (key `CU|yyyy-MM-dd|KHO`).
9. Mã **DV000008** bị dùng chung cho ~98 mặt hàng → app tính tồn theo **tên hàng**, không theo mã.
10. Dời dòng bằng `Range.copyTo` từng làm **mất công thức ô SL** → nếu phải dời dòng, ghi lại công thức bằng `setValue('=...')` và kiểm tra.
11. GitHub chặn (CSP) trang github.com fetch ra ngoài – lần đầu đã phải chuyển file qua Drive + clipboard. **Giờ dùng git/clasp, không cần mẹo đó nữa.**
12. Font **Be Vietnam Pro** từ Google Fonts; mất mạng thì dùng font máy (sw.js có cache font).
13. Màu thương hiệu: `--brand:#43933c`, `--brand-d:#2f6b33`, `--brand-l:#5dac43`, nền `#f3f7f2`. Phiếu nhập = xanh, phiếu xuất = cam.

## 7. Tính năng hiện có (bản web v1 / Apps Script bản 52)
- Trang chủ: logo, người dùng, trạng thái đồng bộ, thống kê hôm nay (phiếu nhập/xuất, số mặt hàng còn tồn), 4 ô: Nhập / Xuất / Tồn kho / Phiếu đã ghi.
- Phiếu: Ngày + Kho (select) cùng hàng → danh sách món → **+ THÊM HÀNG** mở màn chọn hàng toàn trang (chỉ ô tìm kiếm, tìm không dấu) → **bàn phím kiểu máy tính** (AC % ⌫ ÷ × − + 00 , =; `%` theo kiểu máy tính điện thoại: `100−5%`=95) → ghi chú/NCC ở cuối (xuất có gợi ý lý do).
- Lưu tức thì vào **hàng chờ trên máy** (localStorage `khoapp_outbox`), gửi nền; mất mạng vẫn lưu, tự gửi lại; nháp phiếu tự lưu.
- Hiện tồn theo kho ngay lúc nhập; **xuất vượt tồn chỉ cảnh báo đỏ, vẫn cho lưu** (xem việc tồn đọng).
- Phiếu đã ghi: lọc, tìm, sửa, xoá (kể cả phiếu đang chờ gửi / bị lỗi).
- Tồn kho: theo kho, chỉ hàng còn tồn, bấm xem lịch sử món (cần mạng).

## 8. Quy trình phát hành
### Web (GitHub Pages)
1. Sửa `index.html` (và `sw.js` nếu cần), **tăng `VERSION` trong sw.js**.
2. `git add -A && git commit -m "..." && git push` → Pages tự cập nhật sau ~1 phút.
3. Mở https://phim10a4.github.io/kho kiểm tra; điện thoại sẽ hiện "🔄 Có bản mới".

### Apps Script (dùng clasp)
- Cài: `npm i -g @google/clasp` → `clasp login` (Hoàng tự đăng nhập Google).
- **LẦN ĐẦU – BẮT BUỘC `clasp pull` trước:** `clasp push` sẽ **xoá trên server mọi file không có ở máy** (các script cũ của Hoàng!). Quy trình:
  1. `cd apps-script && clasp clone <SCRIPT_ID> --rootDir .` (Script ID lấy trong Apps Script → Cài đặt dự án; **không commit `.clasp.json` lên repo public** – đã có trong .gitignore).
  2. Kiểm tra thư mục đã có đủ: KetchuyenTonkho.gs, TaoIDNhapXuat.gs, CapnhatTonkho.gs, InNhanDan.gs, PrintDialog.html, appsscript.json, KhoApp.gs, KhoAppUI.html. So `KhoApp.gs` với bản trong repo.
- Phát hành: `clasp push` → `clasp deploy -i AKfycbyjAKzg8t_4_2D_jHlin4Ywbt0KBjnqOG-7WGBj6qN3HdtPbDWP2ZvjYaWKm2oB5-QuEg -d "mô tả"` (giữ nguyên deployment ID).
- Hàm tiện ích: `khoXoaBoNhoTam()` – xoá cache CAI_DAT/danh mục để app thấy thay đổi ngay.

### Test
- `cd tests && npm i && node sim.js` – giả lập app trong jsdom với server giả (mất mạng, gửi lại, bàn phím, chống trùng).
- Test thật: tạo phiếu ghi chú "TEST APP - se xoa" ở **KHO 19**, kiểm tra sheet, rồi **xoá bằng app** và kiểm tra lại đã sạch.

## 9. Việc còn tồn đọng
- [ ] **Xuất vượt tồn:** Hoàng chưa chọn: (1) giữ cảnh báo, (2) hỏi lại trước khi lưu + đánh dấu trong LICH_SU_APP (Claude đề xuất), (3) chặn hẳn.
- [ ] Dọn ~1.074 dòng rác AppSheet ở Nhập kho (dòng 4–1077) và mã ID trống ở cột A Xuất kho – cần Hoàng đồng ý, sao lưu trước.
- [ ] Mã hàng trùng DV000008 (~98 món) – đề xuất cấp mã riêng.
- [ ] LICH_SU_APP còn vài dòng test – Hoàng tự xoá được.
- [ ] Ý tưởng: đối chiếu tin nhắn nhóm Zalo "KHO PHÚC XUÂN" với phiếu trong app để bắt món bị bỏ sót.
- [ ] Lâu dài: chuyển Apps Script sang tài khoản Google của công ty (hiện chạy bằng tài khoản cá nhân).
- [ ] Tuỳ chọn: tên miền riêng (vd kho.phucxuan.vn) cho GitHub Pages.
