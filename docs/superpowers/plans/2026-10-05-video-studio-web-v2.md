# Video Studio Web: kế hoạch triển khai đã rà soát

Ngày 05/10/2026. Đây là kế hoạch cho phần **chưa làm**. V001 đã có video/Drive/Buffer/Sheet bằng luồng cũ; web chưa chạy. Bản này thay kế hoạch ngắn cùng ngày.

## 1. Kết quả cần đạt và luồng thật

```text
Điện thoại → Web Cloudflare → SQLite Durable Object (yêu cầu, trạng thái, biên nhận)
                                 ↑                         ↓
Người dùng nhắn Codex → Helper trên Windows → skill + ảnh/TTS/Remotion → Drive
                                      ↓                            ↓
                                  Sheet mirror                Web duyệt video
                                                                    ↓
                                                     User xác nhận → Buffer
```

1. Hai tài khoản riêng nhập kịch bản, chọn `viet-tiktok-story-video` hoặc `drama-mascot-video`, gửi bài trên điện thoại. Web lưu bài và chờ.
2. Web không tự mở phiên Codex. Khi muốn làm, chủ hệ thống nhắn trong chat: **“Xử lý các bài đang chờ trên Video Studio”**. Codex dùng helper để nhận bài, đọc SKILL.md tương ứng, tạo ảnh/giọng, render và trả kết quả. Không có agent nền tự đọc skill trong bản này.
3. Máy Windows phải bật trong lúc dựng, upload, đồng bộ Sheet hoặc gửi Buffer. Khi máy tắt, điện thoại vẫn nhập/xem được bài; không hứa công việc local chạy tiếp.
4. Video xong thì người dùng xem MP4, sửa caption, chọn kênh/giờ, bấm xác nhận. Không tự đăng ngay sau render. Mỗi kênh YouTube/TikTok/Facebook có kết quả riêng.
5. V001 là lịch sử đọc; không được render hoặc đăng lại. Định nghĩa hoàn thành cần một video **mới** đi trọn luồng web.

## 2. Đối chiếu mã hiện tại: bốn chỗ phải sửa trước khi mở web

| Vị trí | Đã thấy trong mã | Hệ quả và việc làm |
|---|---|---|
| `cloud/worker.mjs` và `cloud/queue.mjs` | Cả hai lớp đều yêu cầu runner Bearer trên `/api/*` | Web không thể dùng cookie nếu chỉ sửa Worker ngoài; tách route và auth ở **cả hai** lớp. Cookie web không gọi được runner API, Bearer runner không là phiên web |
| `local/runner.mjs` phần `handlePublish` | `publishChannels` nhận `save: async()=>{}` và `fence: async()=>{}` | Có cửa đăng trùng khi timeout/restart. Phải lưu intent/Buffer ID vào DO trước/sau mỗi lời gọi, không dựa Sheet làm receipt đầu tiên |
| `local/google.mjs` | `updateRow` ghi nguyên A:P | Có thể ghi đè ô được sửa tay. Web dùng cập nhật các range cụ thể và phát hiện xung đột |
| `local/runner.mjs` | Ghép `drive.google.com/uc?export=download` | Chưa chứng minh Buffer tải được MP4 trực tiếp. Cần kiểm tra byte MP4 từ phía ngoài trước khi cho đăng |

Ngoài ra `cloud/queue.mjs` đang log nguyên payload webhook; xóa log này. `STOP.cmd` chỉ xóa lock, chưa dừng process; phải quản lý PID thật. Không đưa các sửa đổi đang có trong worktree vào commit web ngoài phạm vi và không in/commit `.dev.vars`, `secrets.json`, `google.json`.

## 3. Nguồn dữ liệu, mã V và Google Sheet

**Durable Object là nguồn chính cho bài web.** Sheet là bản theo dõi. Hàng nhập trực tiếp trên Sheet vẫn thuộc luồng cũ; chưa tự chạy sang queue web. Không được để một hàng vừa do scan cũ vừa do web điều khiển.

Trước khi mở tạo bài, helper đọc Sheet, xác định số V cao nhất. Nhập V001 thành `legacy_readonly`, khóa theo mã và Drive ID; lấy Buffer ID/link **đã xác minh**. Nếu không có receipt, hiện “Chưa xác minh” chứ không gửi lại. Một transaction lưu bộ đếm mã kế tiếp; ID nội bộ UUID và mã hiển thị do server cấp (V002 nếu V001 là mã cao nhất). Chạy import hai lần vẫn chỉ có một bản ghi V001.

Với bài web mới, A mã; B/C/D tiêu đề/kịch bản/skill; E trạng thái duyệt; F trạng thái dựng; G/H/I giọng/tư liệu/ghi chú; J Drive; K/L caption/hashtag; M “Duyệt trên web”; N lịch; O receipt từng kênh; P lỗi. Lưu `sheet_row_number`, mã A và checksum phần web sở hữu. Khi đồng bộ, đọc lại hàng: nếu mã/ô web sở hữu đã đổi tay, ghi `sheet_conflict`, chờ người quản trị giải quyết, không ghi đè âm thầm. Hàng legacy không được sửa bởi web.

Append chỉ một lần theo `request_id`; nếu response mất, tìm mã trước khi append lại. Về sau dùng `values.batchUpdate` cho từng dải ô thay đổi, không ghi cả A:P. Có outbox lưu revision và retry sync riêng; lỗi Sheet không làm lại render hoặc Buffer. [Google Sheets values.batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate).

## 4. Tài khoản, phiên và ranh giới quyền

- Hai user `owner`, `collaborator`; cả hai tạo/xem/sửa bài chờ và duyệt đăng. Chỉ owner quản lý tài khoản, cấu hình, giải quyết bài có kết quả Buffer không rõ. Không đăng ký công khai.
- Lệnh setup local nhận mật khẩu qua prompt ẩn, tạo salt ngẫu nhiên và PBKDF2-SHA256 hash. Worker secret `WEB_USERS_JSON` chỉ chứa username, role, salt, iterations, hash; không dùng `WEB_OWNER_PASSWORD` plaintext như kế hoạch cũ. Không dán mật khẩu vào chat. Đổi mật khẩu làm tăng `auth_epoch` và thu hồi phiên cũ.
- Cookie `__Host-vs_session`: random 32 bytes, `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`. DO chỉ lưu SHA-256 token, user/role, CSRF hash, hạn và epoch. Logout xóa phiên. Không lưu token ở `localStorage`.
- POST/PATCH/DELETE web cần `Origin` đúng và `X-CSRF-Token`. Rate limit đăng nhập theo username + IP bucket; cùng lỗi chung khi sai user/sai pass. Private API `Cache-Control: no-store`. Không CORS wildcard. Frontend dùng `textContent`, CSP chặn inline script và không đưa credential runner/Google/Buffer/Zalo vào JS.
- `worker.mjs` định tuyến `/api/web/*` theo cookie, `/api/runner/studio/*` và `/api/jobs*` theo Bearer, `/zalo/webhook` theo secret hiện có. DO tự xác minh đúng loại auth lần nữa. Không nhận header “trusted user” trực tiếp từ browser.
- Drive mới không cấp `anyone:writer`. Nếu Buffer cần file public, chỉ cấp `anyone:reader` cho đúng MP4 sau khi xác nhận đăng; không đổi quyền V001 trong migration. [Google Drive sharing](https://developers.google.com/workspace/drive/api/guides/manage-sharing).

## 5. Schema, trạng thái và chống xung đột

Migration SQLite DO **cộng thêm**, đánh version, không xóa bảng `jobs/inbound/outbox/metadata` cũ. Giao dịch cấp mã, claim, tạo publication và transition dùng `transactionSync` để rollback khi lỗi. [Cloudflare SQLite DO](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

| Bảng mới | Cột/ràng buộc chính |
|---|---|
| `web_sessions`, `web_login_attempts` | token hash PK, user/role, CSRF hash, expiry/epoch; bucket login + số lần/hạn khóa |
| `web_requests` | UUID PK, `display_id` UNIQUE, `(created_by,client_submission_key)` UNIQUE, title/script/skill/options, input/review revision, input hash, production state, Drive ID/URL, caption/hashtags, actor/timestamps, legacy flag |
| `web_production_claims` | `request_id` UNIQUE, worker ID, lease token hash, fence epoch, input revision, expires/progress |
| `web_publications` | ID PK, `(request_id,publication_key)` UNIQUE, review revision, snapshot bất biến gồm Drive/caption/hashtags/kênh/lịch, approved actor/time |
| `web_publication_channels` | `(publication_id,channel_id)` PK, attempt state/time, Buffer ID UNIQUE nullable, Buffer status, externalLink, last poll, error code, fence epoch |
| `web_sync_outbox`, `web_events` | outbox unique theo request/kind/revision, retry; nhật ký transition đã lọc secret |

**Revision input** tăng khi sửa tiêu đề, kịch bản, skill, giọng, URL hoặc ghi chú. Chỉ sửa khi `waiting`; claim đóng băng revision. **Revision review** tăng khi sửa caption/hashtag; mỗi lần bấm đăng chụp snapshot riêng. PATCH gửi `expectedRevision`; lệch trả 409 cùng dữ liệu mới để UI cho người dùng so sánh.

Sản xuất: `waiting → producing → review`; có `cancelled` từ waiting; `producing → needs_review` nếu mất lease/kết quả không rõ. `needs_review` không tự chạy lại: kiểm tra manifest/Drive trước, owner hoặc Codex nhận lại thủ công. Có 180 giây lease, heartbeat khoảng 25 giây, fence epoch; helper mất lease phải dừng side effect.

Từng kênh: `ready → attempting → accepted/scheduled → sent` hoặc `failed_confirmed`. Timeout, mất response, crash sau gọi API tạo `needs_review`, **không tự retry**. “Đã đăng” chỉ khi Buffer xác nhận `sent`; link chỉ khi Buffer có `externalLink`. Buffer API có `createPost` và Post `externalLink`; enum/status cụ thể phải đọc lại khi code. [Buffer API](https://developers.buffer.com/reference.html).

## 6. API v1 dự kiến

Response: `{data,requestId}` hoặc `{error:{code,message,field?},requestId}`; 401 chưa login, 403 thiếu quyền/CSRF, 409 revision/idempotency, 413 body lớn, 422 validation. Không lộ stack. GET list có cursor `(updated_at,id)`, 20/mặc định, tối đa 50.

| Route | Quyền | Hành vi |
|---|---|---|
| `POST /api/web/login`, `POST /api/web/logout`, `GET /api/web/session` | browser | phiên/CSRF |
| `POST /api/web/requests` | cả hai | title, script, skill, options, `clientSubmissionKey`; cùng key/payload trả cùng V ID, khác payload 409 |
| `GET /api/web/requests?state=&cursor=`, `GET /api/web/requests/:id` | cả hai | list/detail; không trả lease/secret |
| `PATCH /api/web/requests/:id`, `POST .../:id/cancel` | cả hai | sửa/hủy chờ dựng với input revision |
| `PATCH /api/web/requests/:id/review` | cả hai | caption/hashtags và review revision |
| `POST /api/web/requests/:id/publications` | cả hai | `publicationKey`, expected review revision, channel IDs, immediate/scheduled local time; lưu snapshot và intent atomically |
| `GET /api/web/requests/:id/publications`, `GET /api/web/health` | cả hai | status từng kênh, thời điểm heartbeat; không ghi “Codex đang chạy” từ heartbeat runner |
| `GET /api/runner/studio/requests?state=waiting`, `POST .../:id/claim`, `POST .../:id/heartbeat`, `POST .../:id/progress`, `POST .../:id/result` | Bearer local | handoff/lease/fence/result production |
| `POST /api/runner/studio/publications/claim`, `POST .../:id/begin`, `POST .../:id/complete`, `POST .../:id/uncertain` | Bearer local | từng kênh Buffer, receipt bền vững |
| `POST /api/runner/studio/sync/claim`, `POST .../complete` | Bearer local | Sheet outbox |

Giới hạn dự kiến: title 1–160 ký tự, script 1–30.000, notes 2.000, caption 2.200, tối đa 20 HTTPS reference URLs, JSON body 64 KiB; skill đúng allow-list. Kiểm tra giới hạn từng kênh lúc tích hợp, không tự cắt caption. Giờ lịch nhập `YYYY-MM-DDTHH:mm` theo `Asia/Bangkok`, server đổi UTC và trả lại cả hai để xác nhận; cấm giờ đã qua.

## 7. Codex thực hiện bài như thế nào

1. User gửi form; UI trả mã Vxxx và câu “Đã lưu. Nhắn Codex xử lý các bài đang chờ khi sẵn sàng.” Không có nút giả “Khởi động Codex”.
2. Khi được nhắn, Codex chạy lệnh mới `node tools/video-bot/local/cli.mjs studio:pending`; thấy danh sách mã, tiêu đề, skill, revision. Chọn theo mã user nêu hoặc theo thời gian.
3. `studio:claim Vxxx` nhận snapshot và lease, helper giữ heartbeat trong suốt công việc. Skill key tra trong `local/config.mjs`: hai file SKILL.md địa phương đã được user chỉ định. Web không truyền tùy ý đường dẫn file.
4. Codex theo skill: scene plan, ảnh/footage, VieNeu-TTS, phụ đề, Remotion; lưu manifest job riêng gồm request ID/revision/skill, asset path và hash, render status, upload session/Drive file ID. Ghi atomic, không log lease token/session URI. Nếu thiếu khả năng tạo ảnh tự động, Codex làm trong phiên chat và báo đúng trạng thái, không coi web là agent nền.
5. `ffprobe` xác minh MP4 9:16, H.264/AAC, thời lượng/fps; xem mẫu để kiểm tra màn đen, âm rỗng, phụ đề ra ngoài khung. Upload resumable; nếu timeout, tra manifest và Drive ID trước khi upload lại. Gửi result gồm Drive ID/link, thông số, caption/hashtags và revision. Stale lease/result bị 409; nếu upload xong nhưng cloud lỗi, chuyển `needs_review` và giữ checkpoint, không tạo file mù.
6. Web chuyển `review`; user xem MP4. Yêu cầu sửa video tạo render attempt mới có chủ ý, không âm thầm thay file đã gửi Buffer.

## 8. Buffer: đường media và chống đăng trùng

Drive `/view` là trang xem, `uc?export=download` hiện chỉ là chuỗi code ghép. Trước khi bật nút đăng, local probe URL media từ ngữ cảnh không có cookie Google: giới hạn redirect, HTTP 200/206, byte MP4/Content-Type, kích thước hợp lý, không phải HTML login/quota. Nếu không đạt, chặn đăng và hiện “Video chưa sẵn sàng cho Buffer”. Nếu Drive không cho URL ổn định, cần nguồn media chỉ đọc riêng (ví dụ R2) **sau khi** cấu hình/chi phí được xác định; không giả là đã có. Drive vẫn là bản gốc.

Khi user xác nhận, DO lưu immutable snapshot và row từng kênh **trước** runner claim. Unique publication key chống double click. Runner ghi `attempting` vào DO trước network call, kiểm tra lease/fence, gọi Buffer `createPost`; nhận ID là ghi ngay vào DO rồi mới làm kênh tiếp. Thay callbacks `save/fence` rỗng ở runner; Sheet chỉ đồng bộ về sau. Nếu response xác nhận validation fail thì `failed_confirmed`; nếu timeout/crash/không có ID thì `needs_review`. Owner tra Buffer theo kênh, thời gian, nội dung để gắn ID hoặc xác nhận chưa có trước khi retry bằng thao tác thủ công. Không hứa exactly-once khi provider chưa có idempotency key chứng minh.

Có Buffer ID rồi thì poll `post(id)` để cập nhật accepted/scheduled/sending/sent/failed và `externalLink`. Hai kênh đã thành công không mất receipt khi kênh thứ ba lỗi. Caption sửa sau khi tạo intent không đổi bài đã gửi. Bản đầu ẩn thao tác tạo đợt đăng thứ hai cho cùng video để tránh duplicate. [Buffer reference](https://developers.buffer.com/reference.html).

## 9. UI/UX cụ thể

Hướng thị giác đã chọn: “sổ gọi cảnh”, nền `#F4F1E9`, chữ `#182A31`, coral `#C84E3A`, Be Vietnam Pro. Mobile: thanh dưới “Video”/“Tạo video”; desktop: thanh bên và nội dung giới hạn rộng. Nút chạm ít nhất 48px, nhãn trường luôn thấy, focus rõ, tương phản WCAG AA, reduced motion. Cloudflare Worker có thể phục vụ static assets qua `assets.directory`/binding `ASSETS` và `run_worker_first` để giữ route API. [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/).

| Màn | Nội dung chính | Trạng thái cần thiết |
|---|---|---|
| Login | username/pass, lỗi chung | loading, khóa tạm, hết phiên |
| Danh sách | tiêu đề, skill, bước tiếp theo, lúc cập nhật; lọc Chờ/Đang làm/Cần duyệt/Đã gửi/Cần kiểm tra | rỗng, loading, mất mạng, PC offline, phân trang |
| Tạo | title, textarea script lớn, 2 skill có mô tả, voice/reference/notes tùy chọn, nút Gửi cố định dễ chạm | đếm ký tự, lỗi từng ô, giữ nháp khi lỗi, cùng submission key khi retry |
| Chi tiết | trục Yêu cầu → Codex → Duyệt → Buffer; script, actor, preview 9:16/Drive fallback, caption/hashtag | lease mất, Drive không xem được, stale revision |
| Xác nhận | MP4/caption cuối, từng kênh, ngay/lịch giờ UTC+7, nút xác nhận | URL media fail, kênh chưa nối, giờ cũ, đang gửi |
| Kết quả | status riêng mỗi kênh, link bài khi có, lỗi Sheet riêng | một kênh lỗi, Buffer chưa `sent`, cần owner kiểm tra |

Copy bắt buộc: waiting “Đã lưu — nhắn Codex xử lý”; producing “Codex đang dựng trên máy ở nhà”; review “Video xong — cần bạn xem và duyệt”; accepted “Buffer đã nhận — đang chờ đăng”; sent “Đã đăng”; needs_review “Cần kiểm tra trước khi thử lại”. Heartbeat chỉ ghi “Máy dựng kết nối lúc …”, không suy luận Codex đang chạy.

## 10. Các pha triển khai và gate

### P0. Khóa hiện trạng

- [ ] Backup DO/Sheet/config; xác minh V001 Drive ID/Buffer IDs; `git status` trước sửa, không động vào secret hoặc thay đổi chưa commit của luồng cũ.
- [ ] Tạo Worker test có DO riêng. Xóa raw webhook log, sửa STOP quản lý đúng PID và lock stale.
- **Gate:** `/zalo/webhook`, `/api/jobs`, `/api/claim`, alarm/outbox cũ vẫn chạy; không token trong log.

### P1. Web shell + auth + schema

**File:** `cloud/worker.mjs`, `cloud/queue.mjs`, `cloud/wrangler.jsonc`; mới `cloud/web-auth.mjs`, `cloud/web-store.mjs`, `web/index.html`, `web/app.css`, `web/app.js`, `local/setup-web-users.mjs`.

- [ ] Static assets và route tách auth outer/DO; migration versioned cộng bảng; setup 2 hash, session/CSRF/rate limit/logout/rotation.
- [ ] Màn login và khung UI có private no-store/CSP/escaping.
- **Gate:** mobile login được hai tài khoản; guest không đọc bài; cookie web không gọi runner và Bearer runner không thành web session.

### P2. Yêu cầu + Sheet mirror

**File:** mới `cloud/web-requests.mjs`, `local/video-studio-client.mjs`; sửa `local/google.mjs`, `local/cli.mjs`, `web/*`.

- [ ] Import V001 idempotent, cấp mã V kế tiếp trong transaction; create/list/detail/edit/cancel có revision/idempotency/validation.
- [ ] Sheet outbox append-once, kiểm tra mã, batchUpdate range cụ thể, phát hiện conflict; UI form/danh sách/chi tiết.
- **Gate:** POST lặp tạo một mã V mới và một Sheet row; V001 không có nút dựng/đăng; sửa cùng lúc trả 409, không mất chữ.

### P3. Codex handoff + video

**File:** `local/{cli,video-studio-client,manifest,google}.mjs`, `cloud/web-requests.mjs`, `web/app.js`.

- [ ] `studio:pending/claim/heartbeat/progress/result`, checkpoint, ffprobe, Drive upload/resume, preview/caption, yêu cầu sửa.
- **Gate:** hai helper claim chỉ một thắng; stale result 409; upload xong nhưng cloud lỗi không tạo file Drive thứ hai; video thật xem được trên mobile.

### P4. Duyệt + Buffer

**File:** mới `cloud/web-publications.mjs`; sửa `local/{buffer,runner,google}.mjs`, `web/*`.

- [ ] Probe media, nguồn media nếu Drive fail; confirmation snapshot; per-channel intent/receipt/fence/poll; loại callback rỗng.
- [ ] Test fake Buffer cho double-click, timeout, crash trước/sau API, lỗi 1/3 kênh, lịch UTC+7. Sau đó thử một bài thật có chủ ý trên kênh test trước ba kênh thật.
- **Gate:** timeout luôn `needs_review`, không auto retry; UI chỉ báo đăng khi Buffer `sent`; receipt từng kênh giữ nguyên dù Sheet lỗi.

### P5. Deploy và vận hành

**File:** `README.md`, `SETUP.cmd`, `START.cmd`, `STOP.cmd`, test API/adapter/UI.

- [ ] Staging smoke test route cũ, production backup/migration/deploy; rollback code không xóa bảng mới.
- [ ] Setup secret bằng prompt kín trên máy user; hướng dẫn thao tác điện thoại → chat Codex → PC runner → duyệt → Buffer; cách giải quyết Buffer unclear/Sheet conflict/password rotation.
- [ ] Đi trọn một bài mới và lưu bằng chứng đã che secret: web ID/revisions, skill, ffprobe, Drive ID, Buffer IDs/status/externalLinks, Sheet row.
- **Gate:** tắt/mở PC không mất bài/receipt; Zalo cũ không bị phá; không cần dùng Zalo cho web.

## 11. Ma trận lỗi tối thiểu

| Ca | Bắt buộc |
|---|---|
| Network gửi lại POST | một request, một V ID, một Sheet row |
| Hai người sửa script | người sau 409, thấy bản mới |
| Sheet ô web bị sửa tay | sync conflict, không ghi đè |
| PC tắt nhiều ngày | web còn bài, không nói đang dựng; mở lại chỉ xử lý intent hợp lệ |
| Hai helper claim | một lease; lease cũ không ghi result |
| Upload thành công, cloud timeout | checkpoint giữ Drive ID, không upload mù |
| Buffer timeout sau create | `needs_review`, không gọi create lần hai tự động |
| Buffer 2/3 kênh thành công | giữ hai ID/link; kênh lỗi riêng |
| Buffer accepted rồi sent | UI chuyển đúng và chỉ hiện link khi có |
| Đổi caption sau publish intent | snapshot cũ giữ nguyên |
| Guest/cookie gọi runner | 401/403, không lộ data |
| Zalo/legacy queue | không hồi quy |

## 12. Cổng kiểm tra còn mở khi bắt tay triển khai

1. Buffer `post(id)`, status enums, metadata/video/scheduling của 3 channel phải xác minh với API thực và adapter. Không test giao diện bằng cách đăng công khai.
2. URL MP4 Buffer tải được là điều kiện chặn P4. Nếu cần R2/object storage, ghi chi phí/cấu hình và kiểm chứng bằng một video test trước khi mở đăng thật.
3. Kiểm tra Sheet A:P, tab, mã V cao nhất, hàng còn sửa tay và receipt V001. Kiểm tra quyền folder/file Drive; nếu V001 đang `writer` công khai, báo và xử lý riêng, không âm thầm đổi trong migration.
4. Hai skill cần có trên PC tại đường dẫn cấu hình; quá trình tạo ảnh vẫn cần Codex trong chat ở bản này.

**Hoàn thành** nghĩa là một bài mới đi từ web → Codex đúng skill → MP4/Drive thật → người dùng duyệt trên điện thoại → Buffer từng kênh có receipt và trạng thái đối chiếu API → Sheet mirror cùng mã, qua cả các ca lỗi trên. V001 một mình không đạt tiêu chí.
