# Video Studio Delivery Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gián đoạn upload/đồng bộ/ghi biên nhận không làm mất kết quả hoặc tạo video/bài đăng trùng; UI nhận được lý do chờ và bằng chứng trạng thái.

**Architecture:** Checkpoint local giữ identity file và kết quả external, DO giữ intent/receipt/fence, Sheet là mirror cho dữ liệu web. Đối soát đi qua lượt xử lý riêng có lease và quyền; không reset receipt chưa rõ kết quả rồi gửi lại.

**Tech Stack:** Node >=22 ESM, filesystem atomic JSON và lock hiện có, Google Drive/Sheets HTTP APIs, Buffer budget hiện có, SQLite Durable Object.

**Spec:** `docs/superpowers/specs/2026-10-05-video-studio-ux-reliability.md`; kết nối UI theo `2026-10-05-video-studio-navigation-ux.md` Task4/6.

## Global Constraints

- Không gọi provider API thật hoặc tạo publication thật để chạy test.
- Test dùng privateRoot/jobRoot/temp config và ledger riêng; production credentials không được đưa vào fixture.
- Không ghi secret/token/session URI lên cloud hoặc log; session URI chỉ ở private checkpoint.
- Một publication có ID Buffer thì không create lại. Không tự reset các `attempting` cũ của V003.
- Ràng buộc media bằng checksum MP4, không chỉ fingerprint của kịch bản.
- Sheet không phải giao dịch nguyên tử với cloud; sự cố sync không đảo trạng thái đăng đã thành công.
- Callback external side effect phải có fence/expiry và signal; không bỏ qua lỗi heartbeat hoặc quyền Drive.
- V001 read-only, bảng/migration additive, dữ liệu và helper của người dùng giữ nguyên.

## Task 1: Hoàn thiện và kiểm chứng upload phục hồi

**Files:** Create `tools/video-bot/local/drive-upload.mjs`, `test/drive-upload.test.mjs`; modify `local/google.mjs`, `local/runner.mjs`, `local/manifest.mjs` dưới `tools/video-bot`.

**Interfaces:**

```js
mediaIdentity(filePath); // Promise<{sha256,byteLength,mtimeMs}>
resumeDriveUpload({filePath,fileName,folderId,checkpoint,
  getAccessToken,fetchImpl,persistCheckpoint,fence,signal});
// Promise<{id,name,driveUrl}>
// Checkpoint: {schemaVersion:1,requestId,inputRevision,mediaSha256,byteLength,
//  phase:'initialized'|'uploading'|'uploaded'|'shared',
//  sessionUri?,committedOffset?,driveFileId?,driveFileName?,updatedAt}
```

`GoogleDriveClient.uploadResumable` giữ API public hiện có và delegate module mới. Hàm getAccessToken được gọi lại khi cần token theo thời gian; không lấy một token rồi giả định mọi lượt resume còn hạn.

- [ ] Ghi fixture fetch có các lượt response, không nối mạng. Test các kịch bản với assertions cụ thể:

```js
// Đã có driveFileId: chỉ đọc metadata/quyền; không khởi tạo upload session.
assert.equal(requests.filter(r => r.url.includes('uploadType=resumable')).length, 0);
// Drive đã nhận 8MiB: request PUT tiếp có Content-Range bắt đầu đúng byte.
assert.equal(nextChunk.headers['Content-Range'], `bytes 8388608-${end}/${byteLength}`);
// Response cuối bị mất: resume probe200 khôi phục đúng ID; không POST tạo file khác.
assert.equal(result.id, 'existing-file');
assert.equal(createRequests, 0);
```

- [ ] Thêm test MP4 đổi bytes nhưng cùng script: checksum khác phải từ chối resume trước PUT. Hash bằng stream, stat trước/sau hash để phát hiện file đang bị thay trong lúc tính.
- [ ] Xử lý checkpoint có driveFileId trước mọi khởi tạo/probe session. Tra metadata file hiện có; nếu 404, giữ record và needs_review, không âm thầm upload file mới. Đây cũng sửa cửa hiện tại có fileId nhưng thiếu sessionUri vẫn khởi tạo một session thừa.
- [ ] Session active: probe status PUT với Content-Range `bytes */total`, lấy offset Range do server xác nhận. Chunks8MiB; non-final chunk bội256KiB. 308 không có Range nghĩa chưa xác nhận byte; kiểm tra offset trong [0,total]. Chunk308 đã nhận hết total nhưng chưa có metadata phải probe thêm một lượt, không giả định complete.
- [ ] Probe200/201 lưu fileId trước khi cấp quyền. Timeout/5xx giữ checkpoint, không tự create; session404/410 đưa needs_review để đối soát. Checkpoint cũ thiếu mediaSha256 chỉ nâng cấp khi có bằng chứng file chưa đổi, còn lại giữ review.
- [ ] Kiểm tra/cấp quyền đọc theo cấu hình đã được người dùng cho phép; lưu phase riêng. Lỗi permission giữ fileId và sửa quyền qua file đã có. Giới hạn trang permissions và không tạo permission lặp trên retry.
- [ ] Dùng signal kết hợp job abort và timeout; stream.destroy trong cleanup, fence trước mỗi chunk và trước cập nhật external permission. Abort/lease mất ngăn chunk tiếp theo.
- [ ] Run test fake-response + runner upload integration. Chỉ sau gate này mới kiểm tra upload bị ngắt trong môi trường test khi có file test được chỉ định; không dùng V001/V002/V003 để tạo thêm bản.

**Gate:** Không trộn bytes từ hai bản render, một kết quả server thành công vẫn được phục hồi sau mất response, fileId đã biết không dẫn đến upload mới. Update audit ghi rõ loại kiểm thử đã chạy, không dùng “crash-safe” nếu chưa có bằng chứng tương ứng.

## Task 2: Sheet sync chỉ ghi cột được sở hữu

**Files:** Create `local/sheet-sync.mjs`, `test/sheet-sync.test.mjs`; modify `local/runner.mjs`, `local/google.mjs`, `local/studio-sync.mjs`, `cloud/web-store.mjs` dưới `tools/video-bot`.

**Interfaces:**

```js
resolveSheetRow(rows,displayId); // {rowIndex,row}; error nếu không có/trùng ID
planSheetUpdates({displayId,kind,payload,rowIndex}); // [{range,values}]
syncSheetEvent({sheets,event,expectedOwnership}); // {syncedAt,rowIndex}
// Ownership cloud: {requestId,displayId,origin:'web'|'legacy'}
```

- [ ] Liệt kê ownership cột: API approve→E, skill→D, mode→M, produce status/error→F/P, result→F/J:L/P, publication receipts→O. Không dùng updateRow A:P cho thay đổi một trạng thái.
- [ ] Test fake Sheet: sửa title/script trong khi runner chờ kết quả không bị ghi đè khi update F/J:L; sort lại rows giữa hai event vẫn tìm đúng ID; duplicate/missing ID giữ outbox failed, không ack complete.
- [ ] Web-owned rows không dùng marker M làm bằng chứng ownership duy nhất vì người dùng sửa được. Registry/cloud origin quyết định đường xử lý; Sheet web là mirror, chỉnh caption/script trên web. Legacy rows giữ luồng hiện có với kiểm tra ID/revision.
- [ ] Outbox append request trước result: sau append lấy updatedRange hoặc đọc lại để tìm actual row, không đoán rows.length+2. Event không nhận diện được không được ack; lỗi map hiển thị trên system snapshot.
- [ ] Lookup ID mới nhất trước narrow write; kiểm tra ID lại sau write. Nếu phát hiện row di chuyển trong cửa sổ write, giữ conflict để người dùng kiểm tra và sync lại từ source cloud; không tự rollback nội dung người dùng. Ghi rõ Sheets không có CAS cho thao tác người dùng sort; không hứa loại bỏ hoàn toàn race chỉ bằng lookup.
- [ ] Sử dụng claimToken/worker hiện có khi complete outbox; worker stale không xóa event. Idempotent request-created với ID đã tồn tại không append lại. Test crash sau append trước cloud ack rồi retry vẫn một hàng.

**Gate:** Title/script thủ công không bị whole-row rewrite; một lỗi Sheet không làm video/Buffer receipt chuyển lùi hoặc mất biên nhận.

## Task 3: Phục hồi receipt đã có và đối soát trường hợp chưa rõ

**Files:** Create `local/publication-reconcile.mjs`, `test/publication-reconcile.test.mjs`; modify `local/studio-publisher.mjs`, `local/video-studio-client.mjs`, `cloud/{queue,web-publications,web-store}.mjs` dưới `tools/video-bot`.

**Interfaces:**

```js
reconcileKnownDelivery({studio,budget,delivery,getPost});
// delivery={publicationId,channelId,bufferId,snapshotHash,attemptedAt}
// POST /api/runner/studio/publications/reconcile/claim:
// {workerId,publicationId,channelId} -> {fenceEpoch,leaseExpiresAt,receipt}
// POST /api/runner/studio/publications/reconcile/result:
// {workerId,fenceEpoch,publicationId,channelId,bufferId,bufferStatus,externalLink,observedAt}
```

- [ ] Giữ journal theo publication/channel và snapshotHash. Mất cloud ack rồi lease hết hạn hiện làm receipt needs_review; module reconcile chỉ gắn lại ID đã được journal biết, không đi qua createPost.
- [ ] Cloud reconciliation claim dùng tx, epoch mới và lease5min; nếu receipt đã có cùng ID thì idempotent, ID khác409. Nếu receipt terminal sent không ghi lùi. Result ghi source/actor/time trong audit event; kiểm tra fences như đường publication thường.
- [ ] Nếu provider đã trả status sent trong journal/DB, chuyển sent dựa trên bằng chứng đã có; không query lại chỉ để xác nhận cùng dữ kiện. Nếu cần getPost, qua read budget; cooldown chặn fetch mà vẫn giữ reconciliation job cho sau.
- [ ] Test createCount vẫn1 sau các crash: sau provider success trước journal save là unknown không recreate; sau journal save trước cloud ack khôi phục cùngID; sau cloud complete trước client response không đổiID/terminalstate.
- [ ] V003 không có journal ID: cần owner đối soát từng kênh. UI hiển thị channel/thời điểm/title snapshot và hướng dẫn tìm biên nhận. Có ID xác minh được thì attach qua audited reconciliation; chưa có bằng chứng thì tiếp tục needs_review. Không triển khai nút “reset tất cả đang gửi”.
- [ ] Refresh UI hoặc nhận thông báo không quét tất cả post histories. Thao tác đọc provider tối đa theo budget60reads/day hiện có, reserve writes và lịch1h/2h/4h/6h; không hardcode reset time.

**Gate:** Đồng bộ trễ được sửa từ biên nhận đã biết, không phát sinh create; owner hiểu kênh nào cần kiểm tra, không phải xem log/token.

## Task 4: Zalo, lifecycle và công việc bị gián đoạn

**Files:** Create `local/zalo-inbox.mjs`, `test/zalo-inbox.test.mjs`; modify `local/zalo-poller.mjs`, `local/manifest.mjs`, `local/studio-watcher.mjs`, `local/cli.mjs`, `local/stop-runners.ps1`, `cloud/queue.mjs` dưới `tools/video-bot`.

**Interfaces:**

```js
acceptZaloUpdate({update,authorize,enqueue,inboxStore}); // processed|ignored|retry
// inbox record: {updateKey,status:'received'|'queued'|'ignored',cloudJobId?}
// cursor advance chỉ sau queued/ignored bền vững, không sau received.
```

- [ ] Hiện poller lưu cursor trước parse/enqueue; nếu enqueue lỗi thì mất lệnh. Ghi inbox updateKey trước, enqueue cùng dedupeKey, nhận cloud ack rồi mới lưu queued và advancecursor. Help/pair/untrusted có policy xử lý và rate limit riêng.
- [ ] Test cloud accept lệnh nhưng response mất: retry sameupdate không tạo job2. Enqueue offline: cursor không bỏ qua lệnh, restart còn retry; singleton payload và array payload xử lý giống nhau.
- [ ] Chỉ một consumer getUpdates cho bot; dùng process lock và không tự ghép owner từ người nhắn bất kỳ. Vẫn xác thực allowed sender trước submit lệnh có side effect.
- [ ] Publisher/watch singleton locks phải lưu pid/start identity; stale lock chỉ xóa khi xác minh process cũ đã chết. STOP không giải phóng job đang live như thể đã hoàn tất; shutdown graceful báo interrupted/checkpoint, force stop giữ unknown external outcomes.
- [ ] Notification outbox dùng eventId và gửi sau thay đổi trạng thái bền vững. Giữ failed delivery để retry với backoff; chấp nhận khả năng tin lặp khi response gửi tin mất nếu provider không có idempotency. Copy đúng “Buffer đã nhận” khác “Đã đăng”.
- [ ] Test sleep/stop/restart bằng fake clocks/fake queue; không gửi tin Zalo thật. Report console chỉ eventId/code đã làm sạch.

**Gate:** Lệnh không bị mất chỉ vì cloud tạm ngắt; restart không create lại unknown operation; thông báo phản ánh trạng thái đã lưu.

## Review và release

- [ ] Task độc lập được review và targeted test trước khi đổi process đang trực ban. Full suite chỉ chạy sau tích hợp hoặc có regression mới.
- [ ] Backup checkpoint/receipt metadata trước migration; không copy secrets vào docs/repo.
- [ ] Cloud additive deploy trước client sử dụng endpoint mới; sửa cả hai phía tương thích trong cùng release window. Nếu thiếu endpoint, client hold retry/reconcile; không fallback sang create.
- [ ] Restart watcher/local runner hidden sau khi gate đạt và cooldown được nạp; kiểm tra một process quản lý mỗi nhiệm vụ và log startup sạch.
- [ ] Update system snapshot với pending/error/checkAt. Release note ghi điều gì đã xác minh offline và điều gì còn cần thực nghiệm provider.

## Nguồn đối chiếu giao thức

Google mô tả status query và resume dựa trên response server cho resumable uploads; chunk non-final cần bội256KiB. [Google Drive: Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

Buffer quy định rate limits và header hồi hạn; ứng dụng cần tôn trọng cửa sổ quota account đã nhận từ server. [Buffer: Rate Limits](https://developers.buffer.com/guides/api-limits.html).
