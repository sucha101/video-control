# Video Studio Navigation and UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi màn hình có URL riêng, Back/Forward/F5 đúng, phiên đăng nhập và nháp ổn định, trạng thái video chỉ dẫn được hành động tiếp theo.

**Architecture:** Giữ frontend JavaScript ESM hiện có; tách router, API/session, draft và các view theo trách nhiệm. Cloud cung cấp view model trạng thái chung; UI đọc dữ liệu cloud, không kiểm tra Buffer trực tiếp.

**Tech Stack:** Vanilla JavaScript ESM, History API, Cloudflare Worker/SQLite Durable Object, Node >=22, bộ Node test và Miniflare sẵn có.

**Spec:** `docs/superpowers/specs/2026-10-05-video-studio-ux-reliability.md`.

## Global Constraints

- Một tên miền; đường dẫn theo spec, không tạo subdomain cho từng màn hình.
- Cookie 30 ngày hiện có; không lưu token/password trong localStorage.
- DO identity `personal-v1` giữ nguyên; migration chỉ cộng thêm; V001 chỉ đọc.
- Giữ quyền collaborator hiện có; thao tác đối soát chưa rõ kết quả do owner xử lý.
- UI chỉ đọc cloud; không gọi Buffer khi điều hướng/refresh.
- Mọi sửa đổi phải giữ idempotency, review revision và bảo vệ biên nhận đã có ID.
- Không đăng video/gửi tin thật để làm kiểm thử; không log credentials.
- Giao diện dùng palette/typography hiện có; nút chạm >=44px, 320px không tràn ngang.
- Phải giữ nguyên các thay đổi đang dirty ngoài phạm vi task; commit chỉ file task đã rà diff.

## Phân chia module

Tất cả đường dẫn sau tính từ root worktree `C:/Users/ADMIN/.codex/worktrees/zalo-video-bot/remotion`.

| File | Trách nhiệm |
| --- | --- |
| `tools/video-bot/cloud/web/router.js` mới | Parse/build URL, history, route events; không gọi API/đổi auth. |
| `tools/video-bot/cloud/web/api-client.js` mới | HTTP JSON, timeout, lỗi có status/code; không tự chuyển màn hình. |
| `tools/video-bot/cloud/web/session.js` mới | Bootstrap/guest/network distinction, return URL, logout/tab restore. |
| `tools/video-bot/cloud/web/drafts.js` mới | Draft bền vững theo tài khoản và video; không gửi dữ liệu lên server. |
| `tools/video-bot/cloud/web/feedback.js` mới | Inline/toast/focus và thông báo accessible. |
| `tools/video-bot/cloud/web/views/{list,create,detail,publish,system}.js` mới dần theo task | Mỗi view render/mount/unmount của màn đó. |
| `tools/video-bot/shared/publication-summary.mjs` mới | Tổng hợp biên nhận; list/detail dùng cùng chính sách. |
| `tools/video-bot/cloud/web/app.js` sửa | Composition root: khởi tạo module, xác thực rồi render route. |
| `tools/video-bot/cloud/{worker,queue,web-store}.mjs` sửa | Fallback đúng route, dữ liệu summary/health; không chuyển auth logic vào router. |

Không tách đồng loạt mọi dòng app.js: mỗi task chuyển phần trách nhiệm mình cần và bỏ đường cũ tương ứng, tránh hai router/timer chạy song song.

## Task 1: URL riêng và lịch sử trình duyệt

**Files:** Create `cloud/web/router.js`, `test/studio-router.test.mjs`; modify `cloud/web/app.js`, `cloud/web/index.html`, `cloud/worker.mjs` dưới `tools/video-bot`.

**Interfaces:**

```js
// Route shape
// {name:'login'|'list'|'create'|'detail'|'publish'|'system'|'notFound',
//  displayId?:string, status?:string, next?:string}
parseRoute(url, origin);                 // Route
routeHref(route);                        // string đường dẫn nội bộ chuẩn
createRouter({window, onRoute});          // {start,navigate,stop}
// navigate(route,{replace:false,reason:'link'}), onRoute(route,{reason})
```

- [ ] Ghi test route thuần trước khi thay app. Các case cần có:

```js
const origin = 'https://zalo-video-control.datnthe.workers.dev';
assert.equal(parseRoute('/studio/new', origin).name, 'create');
assert.deepEqual(parseRoute('/studio/videos/V002', origin), {name:'detail',displayId:'V002'});
assert.equal(parseRoute('/studio?status=review', origin).status, 'review');
assert.equal(parseRoute('/studio/videos/not-a-video', origin).name, 'notFound');
assert.equal(routeHref({name:'publish',displayId:'V002'}), '/studio/videos/V002/publish');
```

- [ ] Implement parser với URL class; chỉ cho filter `all/waiting/producing/review/publishing/sent/needs_review`. Chấp nhận display ID `/^V\d+$/i`, chuẩn hóa uppercase bằng replace. URL lạ trả notFound. Không đưa script/title vào URL.
- [ ] Thay `switchView` bằng render view không đụng history. Router gọi `history.pushState({videoStudio:true,route},'',routeHref(route))` khi click điều hướng; `popstate` parse `window.location.href` rồi render, không push thêm.
- [ ] Start router trên URL hiện tại; đăng nhập thành công/chuẩn hóa path dùng replace. Link điều hướng có href thật; chỉ intercept click trái không modifier, để Ctrl+click/open tab hoạt động.
- [ ] Lưu scrollY + filter/cursor theo history entry; Back về list khôi phục trang đã tải và focus link vừa mở. Đổi route cập nhật document.title và focus heading; không ép scroll0 khi restore.
- [ ] Worker fallback chỉ áp dụng navigation HTML thuộc route Studio/login; `/api/*` vẫn trả API 401/404 JSON, asset JS/CSS không tồn tại vẫn 404. Không biến mọi URL không có dấu chấm thành trang Studio.
- [ ] Kiểm tra trình duyệt: list → create → Back=list → Forward=create; list → V002 → Back=list; F5/direct URL tại create/V002; URL lạ; mở V002 tab mới. Kiểm tra guest và authenticated riêng.

**Gate:** URL thể hiện đúng màn hình ở cả desktop/điện thoại, không để lại entry login sau login thành công; chưa sửa thiết kế form ở task này.

## Task 2: Phân biệt hết phiên với lỗi mạng

**Files:** Create `cloud/web/api-client.js`, `cloud/web/session.js`, `test/studio-session.test.mjs`; modify `cloud/web/app.js`, `cloud/queue.mjs`, `cloud/web/index.html`; extend `test/web-auth.test.mjs`.

**Interfaces:**

```js
createApiClient({fetchImpl, getCsrf, timeoutMs:20000}); // {request}
// Error có {status:number|null, code:string, retryable:boolean}
createSessionController({api, router, draftStore, onState});
// {bootstrap,signIn,signOut,revalidate,dispose}
// onState({status:'checking'|'authenticated'|'guest'|'unavailable',user,csrfToken,expiresAt})
safeReturnPath(value, origin); // routeHref của route private hợp lệ hoặc '/studio'
```

- [ ] API module không gọi showLoginView; lỗi fetch/timeout có status=null, 5xx là lỗi dịch vụ, 401 là auth. API session trả thêm expiresAt từ DB; giữ no-store và cookie HttpOnly.
- [ ] Viết các kiểm thử hành vi:

```js
// Kết quả bootstrap mất mạng giữ URL; không render guest.
assert.equal((await session.bootstrap()).status, 'unavailable');
assert.equal(location.pathname, '/studio/videos/V002');
assert.equal(safeReturnPath('https://other.example/', origin), '/studio');
assert.equal(safeReturnPath('//other.example/', origin), '/studio');
assert.equal(safeReturnPath('/studio/videos/V002', origin), '/studio/videos/V002');
```

- [ ] Bootstrap đọc session trước khi render dữ liệu riêng. Valid session render route yêu cầu; unauthenticated replace tới `/login?next=...`; unavailable có nút Thử lại và giữ URL/nháp. Không show login vì 5xx.
- [ ] SignIn success replace entry login bằng next đã kiểm tra. Người đang login mở `/login` được chuyển đến next/list. 401 của form login chỉ là lỗi nhập mật khẩu; 401 của request private làm session revalidate rồi render guest khi xác nhận.
- [ ] Xử lý `pageshow` với persisted, `visibilitychange` và BroadcastChannel logout. Coalesce revalidation; quay lại tab trong <60s không tạo kiểm tra trùng nếu phiên chưa có tín hiệu invalidation. Không broadcast token.
- [ ] Logout endpoint kiểm tra Origin/CSRF như POST private khác trước khi revoke. Client chỉ clear session/UI sau server revoke thành công; nếu lỗi mạng, giải thích chưa hoàn tất logout. Sau logout thành công, các tab khác hide dữ liệu và giữ draft theo username để chính tài khoản đó phục hồi.
- [ ] Test browser Back/Forward qua entry login cũ, F5, mở 2 tab, đóng/mở browser với cookie còn hạn; mất mạng lúc bootstrap khác với session expiry; logout tabA rồi Back ở tabB. Không bẫy Back ngăn thoát website.

**Gate:** Nhập mật khẩu lại chỉ khi server xác nhận cần login. Nhấn Back trong app không làm logout; mất mạng không xóa draft hoặc return URL.

## Task 3: Lưu nháp và gửi kịch bản không mất nội dung

**Files:** Create `cloud/web/drafts.js`, `cloud/web/views/create.js`, `test/studio-drafts.test.mjs`; modify `app.js`, `index.html`, `app.css`.

**Interfaces:**

```js
createDraftStore({storage, now:Date.now}); // {read,save,remove}
// key: username + kind ('script'|'caption') + displayId (caption)
// value: {schemaVersion:1,updatedAt,payload,submissionKey?,payloadSignature?}
mountCreateView({root,api,router,draftStore,user,onFeedback}); // cleanup()
```

- [ ] Store không lưu password/cookie/CSRF; key có username, TTL7ngày. Debounce save500ms trên input, flush khi navigation/pagehide. Storage exception tạo feedback “Nháp chưa lưu trên thiết bị”.
- [ ] Test draft userA không được đọc dưới userB; expiry7ngày; lỗi quota storage không xóa form; submission key vẫn giữ khi POST response mất và sau reload.
- [ ] Khi tạo màn, hiện “Có bản nháp lưu lúc …” và lựa chọn khôi phục/xóa. Sau load draft cập nhật bộ đếm/radio đúng. Khi session hết hạn, giữ bản nháp bằng username đã biết, không khôi phục cho user khác.
- [ ] Payload không đổi dùng cùng clientSubmissionKey; thay nội dung tạo intent mới. Submission key cùng draft phải được lưu trước POST. Mất response giữ draft/key và hiện nút thử lại; không tự gửi POST theo timer.
- [ ] POST trả request thành công → xóa đúng draft đã gửi → router.navigate(detail với displayId). Nếu người dùng đã sửa nháp mới trong lúc request chờ, giữ nháp mới. Bỏ redirect timer 3s và thông báo sai rằng gửi form đã khởi động AI.
- [ ] Caption draft lưu theo video/reviewRevision. Khi revision server đổi, hiển thị xung đột và giữ bản local để so sánh; không auto ghi đè caption server.

**Gate:** Script không mất qua Back/F5/mất mạng/hết phiên; thử lại cùng bài chỉ tạo một request; user thấy mã bài và biết bước xử lý cùng Codex.

## Task 4: Một trạng thái thống nhất cho list/detail/kết quả

**Files:** Create `shared/publication-summary.mjs`, `test/publication-summary.test.mjs`; modify `cloud/web-store.mjs`, `cloud/web-publications.mjs`, `cloud/web/studio-policy.js`, `cloud/web/views/{list,detail}.js`, `app.js`.

**Interfaces:**

```js
summarizePublications(channels); // {state,total,sent,accepted,ready,attention,lastCheckedAt,nextCheckAt}
// state: null|'pending'|'accepted'|'partial'|'sent'|'needs_review'|'failed'
// channels: [{channelId,state,bufferId,bufferStatus,lastPolledAt,nextPollAt,errorCode}]
// API list/detail: publicationSummary cùng cấu trúc, không dùng hai CASE SQL khác nhau.
```

- [ ] Định nghĩa truth table và test:

```js
const summary = summarizePublications;
assert.equal(summary([{state:'accepted'}, {state:'accepted'}]).state, 'accepted');
assert.equal(summary([{state:'sent'}, {state:'accepted'}]).state, 'partial');
assert.equal(summary([{state:'sent'}, {state:'needs_review'}]).state, 'needs_review');
assert.equal(summary([{state:'sent'}, {state:'sent'}]).state, 'sent');
assert.equal(summary([{state:'failed_confirmed'}]).state, 'failed');
```

- [ ] Tính summary trong một module chung, ưu tiên needs_review/failed cần hành động; có sent nhưng còn chờ giữ sent count, không che biên nhận thành công. Query batch theo request IDs list để tránh N+1 SQL không cần thiết; detail dùng cùng hàm. Không expose worker lease/hash.
- [ ] `bufferStatus==='sent'` ở dữ liệu lịch sử có bufferId nhưng state accepted được chuẩn hóa cục bộ sang sent bằng migration có audit event; không cần gọi API để biết lại dữ liệu đã lưu. Trường hợp chỉ có accepted và người dùng báo đã thấy bài: giữ provider-unconfirmed cho tới đối soát, không suy diễn.
- [ ] List/filter dùng summary và query params đồng nhất. Trang chi tiết có hai nhóm “Dựng video”/“Đăng lên nền tảng”; từng kênh có state và checkedAt. V003 legacy attempting không có lease được trình bày needs_review, không reset thành ready.
- [ ] Bỏ lời nhắc “chọn kênh xuất bản” sau khi đã tạo intent. Trang accepted chỉ dẫn chờ cập nhật; sent hiển thị x/n và link nếu có; thiếu link không biến sent thành chưa đăng.
- [ ] UI refresh đọc cloud, throttle5s theo request; active detail pending refresh60s và dừng hidden/logout/terminal. Health/list/detail timers có cleanup khi unmount.
- [ ] Phân biệt thời điểm thử kiểm tra với thời điểm nhận bằng chứng provider: rate gate chặn fetch hoặc network timeout không cập nhật lastCheckedAt như thể Buffer vừa xác nhận trạng thái. Test blocked fetchCount=0 và lastCheckedAt giữ nguyên.

**Gate:** V002/V003 và fixture partial/failed/legacy thể hiện chính xác bằng chứng; list, detail và filter không mâu thuẫn.

## Task 5: Xác nhận đăng và feedback phù hợp trên điện thoại

**Files:** Create `cloud/web/views/publish.js`, `cloud/web/feedback.js`; modify `app.js`, `index.html`, `app.css`, `test/studio-ui.test.mjs`.

**Interfaces:**

```js
mountPublishView({root,request,receipts,api,router,onFeedback}); // cleanup()
notify({kind:'success'|'error'|'info',message,action?});
// submit giữ publicationKey ổn định theo immutable snapshot + reviewRevision + channels + schedule.
```

- [ ] Dùng route publish để trình bày caption snapshot, preview, ba checkbox mặc định và lựa chọn ngay/lịch. Người dùng Back về detail; không gửi lệnh chỉ vì mở URL publish.
- [ ] Nếu caption dirty, lưu với expectedReviewRevision trước khi tạo intent; receipt đã có/unknown chặn recreate theo policy backend. Lịch phải đúng UTC+7 và ở tương lai, server validate lại. Error field chỉ ra lỗi cụ thể, không cắt caption âm thầm.
- [ ] Đổi card clickable-div thành anchor chính có heading; dùng button thật cho action, aria-current nav, aria-live feedback. Thay alert success thường xuyên, giữ confirmation có nội dung đáng duyệt.
- [ ] Form ưu tiên title/script/skill, tùy chọn thu gọn. Sticky submit trên mobile phải chừa safe-area, không che bàn phím hoặc cuối textarea. Preview có link Drive fallback và state lỗi tải.
- [ ] Kiểm tra 320/390/768/1024/1440px, bàn phím Tab/Enter, zoom200%, nútBack hệ điều hành Android; tập trung độ dài kịch bản/caption thực tế và nhãn dài tiếng Việt.

**Gate:** Người dùng thấy chính xác nội dung/kênh/giờ trước khi xác nhận; doubleclick/Back lúc request chờ không tạo thêm intent; lỗi không làm mất dữ liệu.

## Task 6: Trang hệ thống và tín hiệu vận hành có thể tin được

**Files:** Create `cloud/web/views/system.js`; modify `cloud/queue.mjs`, `cloud/web-store.mjs`, `local/studio-watcher.mjs`, `local/video-studio-client.mjs`, `app.js`, `index.html`.

**Interfaces:**

```js
// Runner snapshot gửi cloud, không có token/file private:
{observedAt, workerId, presence:'connected', activeStage:null,
 buffer:{readBlockedUntil,writeBlockedUntil,lastProviderCheckAt},
 sheet:{pendingCount,lastSyncAt,lastErrorCode},
 zalo:{configured,lastDeliveryAt}, drive:{lastUploadAt,lastErrorCode}}
// GET /api/web/system trả snapshot đã lưu + serverNow + isStale.
```

- [ ] Thêm runtime snapshot additive lưu DO; runner gửi tối đa mỗi60s/khi đổi trạng thái quan trọng. Đọc system/health chỉ đọc snapshot, không gọi Buffer/Drive/Zalo để “health check”.
- [ ] Presence threshold180s với watcher heartbeat60s; hiện lastSeen và “chưa rõ kết nối” khi snapshot cũ. activeStage chỉ ghi khi công việc thực báo về, không tự suy từ online.
- [ ] Trang system hiện chờ máy, chờ quota, Sheet chưa sync và lần Zalo delivery. Phân biệt configured với verified/last success. Nếu chưa có timestamp, ghi “Chưa xác minh”, không dùng banner khẳng định liên kết thành công tĩnh.
- [ ] Snapshot Buffer chỉ hiển thị deadline đã ghi nhận + observedAt, không suy quota của tất cả integration ngoài từ ledger local. Lỗi kỹ thuật có message đã làm sạch, không lộ session URI/token.
- [ ] Test 500 lượt GET health/system chỉ đọc storage, provider-fetch counter=0; ngắt watcher đổi UI trong ngưỡng <=180s+chu kỳ refresh60s; restart hiển thị dữ liệu hợp lệ tiếp theo.

**Gate:** UI giải thích tại sao bài chưa tiến triển mà không tiêu thụ quota dịch vụ.

## Gate cuối và triển khai

- [ ] Run targeted Node tests cho module thay đổi và bộ test hiện có một lần sau tích hợp; dùng budget/config test riêng, không chạm ledger production.
- [ ] Thực hiện ma trận browser Task1/2/5 với app staging và fixture; lưu bằng chứng route/view/session/draft.
- [ ] Build dry-run, deploy theo từng gate; giữ bản trước để rollback nếu route/API mất tương thích. Asset entry/module có version từ build để tránh cache trộn phiên bản; HTML no-cache, private API no-store.
- [ ] Sau deploy đọc `/studio/new`/`/studio/videos/V002` từ trình duyệt đang login, kiểm tra route/status/Back/F5. Không bấm đăng thật trong smoke check.
- [ ] Ghi phiên bản triển khai, test đã chạy và trường hợp còn chưa xác minh vào audit report.
