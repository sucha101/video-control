# Video Studio UX and Reliability — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện trải nghiệm như một web có nhiều trang và giữ công việc an toàn qua lỗi mạng, đóng máy, giới hạn API và đồng bộ trễ.

**Architecture:** Một origin với router rõ ràng, session độc lập route, draft theo người dùng và view model trạng thái chung. Phần local dùng checkpoint media, outbox và receipt reconciliation để phục hồi dữ liệu external mà không tạo lại tác vụ chưa rõ kết quả.

**Tech Stack:** JavaScript ESM, History API, Cloudflare Worker + SQLite Durable Object, Node >=22, Google Drive/Sheets, Buffer, Zalo và Remotion/TTS đang có.

**Spec:** [Đặc tả bổ sung](../specs/2026-10-05-video-studio-ux-reliability.md).

## Global Constraints

- V001 giữ read-only, DO identity `personal-v1` giữ nguyên, migration additive.
- Giữ palette/typography đã chọn; sửa logic/feedback trước thay đổi trang trí.
- Giữ session cookie30ngày; không lưu password/token ở localStorage.
- Mọi retry phải giữ idempotency và biên nhận đã có ID; không auto reset V003 unknown.
- UI đọc cloud, không gọi provider theo mỗi lượt mở trang/refresh.
- Không dùng publication/video thật hay token production để làm test.
- Tôn trọng dirty work hiện có; chỉ commit phần đã review, không xóa helper vì chưa được gọi ở một nhánh.
- Dựng video hiện vẫn cần máy Windows bật và phiên xử lý với Codex; online watcher không đồng nghĩa AI đang dựng.

## Đánh giá hiện tại

Phần tạo request, dựng, lưu Drive và gửi Buffer đã có cơ sở vận hành. Những vấn đề UX người dùng gặp là lỗi sản phẩm cần sửa: URL không đại diện màn hình, browser history thiếu entry và lỗi kiểm tra phiên bị xem như logout. Chưa có căn cứ để coi việc thay toàn bộ framework là cần thiết.

Các bản audit trước đã giảm rủi ro gọi API dày và đăng trùng. Tuy nhiên, 41 test đạt là bằng chứng cho các ca đã được viết, không phải chứng nhận đầy đủ toàn bộ UX hay cơ chế resume mới. Tách ba mức bằng chứng trong release note: đã đọc code, đã test offline, đã kiểm tra vận hành thật.

| Ưu tiên | Vấn đề | Việc cần làm | Căn cứ |
| --- | --- | --- | --- |
| P0 | Chưa đủ bằng chứng cho resume Drive mới | Checksum MP4, fileId-first, interruption tests | Resume hiện mới syntax checked, fingerprint là nội dung kịch bản. |
| P1 | Back/F5 và deep link không đúng | Router cho create/detail/publish; restore history | switchView gộp về studio, popstate gộp về list. |
| P1 | Mạng lỗi đưa về login | Auth checking/guest/unavailable; login replace; page restore | initSession catch mọi lỗi gọi showLoginView. |
| P1 | Có thể mất nháp | Lưu script/caption theo username, stable key qua reload | Draft hiện chủ yếu ở memory. |
| P1 | Bài đã gửi nhưng UI khó hiểu | Shared receipt summary, partial/error/checkAt | accepted khác sent; V003 unknown không nên giống đang xử lý bình thường. |
| P2 | Form/feedback/mobile chưa đủ thuận tiện | Action chính rõ, ít alert, links thật, focus/scroll | Navigation/card chủ yếu button/div, create redirect timer. |
| P2 | Chưa biết bài đang chờ máy/quota/sync | Trang system đọc snapshot có timestamp | Health15phút có thể còn xanh dù watcher tắt. |
| P2 | Sheet/local/cloud lệch nhau sau lỗi | Narrow writes, checkpoint và reconcile receipt | Whole-row writes, kết quả cloud ack có thể mất sau external success. |
| P2 | Tin Zalo/lệnh sau restart | Inbox/dedupe/cursor và lifecycle lock | Cursor hiện advance trước enqueue. |

Back về login có thể xảy ra do history cũ hoặc session bootstrap failure. Plan yêu cầu tái hiện cả hai; không sửa bằng thủ thuật ép Back luôn quay về studio.

## Hai kế hoạch triển khai độc lập

1. [Điều hướng, phiên và UX](2026-10-05-video-studio-navigation-ux.md): 6 task, có route/session/draft/state/publish/system và browser acceptance.
2. [Phục hồi Drive, Sheet, Buffer, Zalo](2026-10-05-video-studio-delivery-recovery.md): 4 task, có checkpoint media, narrow writes, reconciliation và inbox.

Hai nhánh dùng chung contract `publicationSummary` và system snapshot trong spec. Mỗi task có file ownership và interfaces; engineer mới đọc spec rồi task có thể triển khai mà không cần lịch sử chat.

## Thứ tự triển khai

### Gate 0 — khóa baseline và lỗ hổng phục hồi còn lại

- [ ] Ghi git status, bản deploy đang hoạt động và trạng thái V001/V002/V003 bằng đọc dữ liệu đã có, không probe Buffer đang cooldown.
- [ ] Phân biệt đã sửa với chưa xác minh; checkpoint hiện có được backup trong private directory. Không đưa secret vào tài liệu backup của repo.
- [ ] Thực hiện delivery Task1 checksum/fileId-first và fake interruption tests trước khi dựa vào resume cho một job mới.

### Gate 1 — URL, Back/Forward/F5 và login

- [ ] Thực hiện navigation Task1/2, review riêng router và auth. Không để router cũ/timer cũ cùng chạy.
- [ ] Nghiệm thu list → create → Back/Forward; list → detail → Back; direct URL và F5; mất mạng khác hết phiên; login giữ return URL.
- [ ] Gate không đạt thì chưa mở rộng UI publish/system; sửa đúng failure route/session trước.

### Gate 2 — không mất nội dung và trạng thái chỉ dẫn đúng

- [ ] Thực hiện navigation Task3/4. Draft sau reload thử lại không tạo request trùng; list/detail/filter cùng summary.
- [ ] V002 provider-confirmed sent đã có trong dữ liệu cũ được khôi phục bằng local proof; các kênh vẫn chỉ accepted được hiện chờ xác nhận.
- [ ] V003 các kênh unknown được thể hiện cần kiểm tra; không thay thành ready để làm badge đẹp hơn.

### Gate 3 — dùng thuận tiện trên điện thoại

- [ ] Thực hiện navigation Task5/6: confirmation page riêng, CTA và error cụ thể, keyboard/focus/320px, system snapshot rõ.
- [ ] Refresh UI không tạo call Buffer. Deadline quota không hardcode; máy kết nối khác với đang render.

### Gate 4 — phục hồi công việc toàn luồng

- [ ] Thực hiện delivery Task2/3/4. Narrow write không đè nội dung khác; crash sau external success không tạo bài mới; lệnh Zalo offline không mất.
- [ ] Đối soát V003 bằng biên nhận từng kênh khi có dữ liệu/quota thích hợp. Nếu chưa đủ bằng chứng thì giữ needs_review và ghi lý do; không tuyên bố V003 đã đăng hoặc chưa đăng dựa trên giả định.

### Gate 5 — release và theo dõi

- [ ] Tests theo risk của task, browser staging cho các hành vi history/auth/draft; full suite một lượt sau integration.
- [ ] Deploy additive theo gate, có version/rollback và kiểm tra deep links sau deploy. HTML/asset version tránh cache trộn mã.
- [ ] Restart process cần thiết sau gate đạt, hidden, có cooldown ledger và kiểm tra singleton. Release note ghi phạm vi xác minh và phần còn chưa xác minh provider.

## Tiêu chí nghiệm thu người dùng

| Hành động | Kết quả phải thấy |
| --- | --- |
| Bấm Tạo video | URL `/studio/new`, tab “Tạo video”; Back trở về danh sách. |
| Mở V002 | URL `/studio/videos/V002`; share/open link có thể tới đúng video sau login. |
| F5 tại V002 hoặc form mới | Phục hồi đúng màn hình; nháp còn nguyên. |
| Mạng tắt khi kiểm tra phiên | Thông báo mất kết nối và Thử lại; không khẳng định đã logout. |
| Session còn hạn, bấm Back qua history login | Không yêu cầu nhập mật khẩu lại chỉ vì history; không tạo vòng redirect. |
| Session hết hạn rồi login | Quay lại trang yêu cầu, draft/dirty caption vẫn còn cho đúng tài khoản. |
| Gửi script, mất response, thử lại | Một mã Vxxx duy nhất và cùng request, không hai video. |
| Buffer đã nhận nhưng chưa sent | Nhãn chờ xác nhận, có checkedAt/nextCheckAt và status từng kênh. |
| Một kênh đã sent, một kênh lỗi | Hiện số thành công và lỗi riêng; không đăng lại kênh có ID. |
| Upload ngắt/crash sau final response | Tiếp tục đúng MP4 hoặc khôi phục fileId; không tạo file thứ hai tự động. |
| Ngắt máy local | Cloud vẫn nhận/lưu script; UI giải thích chờ máy và nguồn lastSeen. |
| Mở 2 tab rồi logout | Tab còn lại không tiếp tục hiển thị/đổi dữ liệu phiên đã revoke. |

## Phân công khi triển khai

Root giữ spec/contracts/release. Một agent nhận router/session/UX; một agent nhận Drive/Sheet/reconciliation; agent thứ ba làm review và kiểm tra độc lập sau mỗi gate. File chung `queue.mjs`, `web-store.mjs`, `app.js` phải có một người sửa chính theo task; người khác gửi patch/review để tránh chồng sửa.

Đây là kế hoạch mới cho công việc chưa hoàn thiện; lượt lập kế hoạch chỉ tạo tài liệu, không đổi code hoặc trạng thái production.
