# Zalo điều khiển workflow video

User approved on 2026-10-03: cloud receives Zalo commands while Windows is off, persists queued work, Windows executes when online. Original Sheet/Drive/skill workflow remains the data and production contract. This is a personal bot, not a public execution service.

## Components and scope

- Self-contained `tools/video-bot/` package; do not edit existing Remotion sources/package.json. Runtime uses existing `D:/remotion` resources read-only where possible and per-job workspaces for new compositions/assets.
- Cloudflare Worker `zalo-video-control`, SQLite-backed Durable Object `VideoQueue` stores owner pairing, deduplicated inbound messages, durable jobs, leases, worker presence and notification outbox. No AI/media processing in Worker.
- Node >=22 local runner polls HTTPS cloud endpoint, executes one job at a time, stores atomic checkpoints and a single-process lock. Starts only after configuration; boot/startup installation is an explicit setup command.
- Codex CLI invoked with argument arrays and stdin (no shell interpolation), `--json`, `--output-schema`, per-job working directory and bounded permissions. Agent reads only the allowlisted selected skill. Saved CLI auth may be reused; external image tools and Google/Buffer auth are separate connections.
- Google adapter supports local credentials from an authorized-user or service-account JSON file; provide an installed-app OAuth setup command for user consent on loopback. Sheets values API read/write uses RAW, Drive upload streams resumable MP4. Never make files public automatically. Optional media relay base URL configured only after URL verification.
- Buffer is the sole new publishing adapter. Keep legacy Publisher/Workers unchanged; do not send to both. Buffer adapter must use current official schema, required channel metadata and distinguish accepted/scheduled from published. External publishing disabled until configured. Never retry an ambiguous createPost request automatically.

## Fixed user resources

Sheet ID `1MJU-AxH_7dTMcOdi3CM0QkWusT03lSlsWT1qL37ceVw`, tab `Trang tính1`, A:P as documented in `D:/remotion/tasks/plan.md`.
Drive folder ID `13wJbXO3Y6SPNi3iH3JDLBokkb900Je-v`.
Skills: `viet-tiktok-story-video` -> `C:/Users/ADMIN/.codex/skills/viet-tiktok-story-video/SKILL.md`; `drama-mascot-video` -> `C:/Users/ADMIN/.gemini/config/skills/drama-mascot-video/SKILL.md`.
Timezone Asia/Bangkok (+07:00); explicit scheduling input is `YYYY-MM-DD HH:mm` or timezone-aware ISO8601.
Eligibility: script nonempty, registered skill, approval exactly `ổn`, status empty or `Chờ tạo`. Missing publishing mode defaults to `Chỉ tạo video`. Publishing additionally requires approval `ổn`, mode `Tự đăng`, completed valid MP4, caption, Drive file ID and verified reachable media URL.

## Zalo commands

Personal/private chats only. One-time `/pair CODE` binds sender+chat, code then cannot bind another owner. Subsequent commands only accept bound sender+chat.
`/help`; `/status [JOB_ID]`; `/scan` and phrase `làm các bài đã duyệt`; `/run VIDEO_ID`; `/new SKILL` followed by newline title and newline script; `/approve VIDEO_ID`; `/skill VIDEO_ID SKILL`; `/mode VIDEO_ID video|auto`; `/publish VIDEO_ID [YYYY-MM-DD HH:mm]`; `/cancel JOB_ID`; `/retry JOB_ID` for failed/needs-review jobs. Parser must reject unknown skills, missing IDs, malformed commands and all generic terminal commands.
Cloud queued job types: `scan`, `produce`, `add_row`, `approve`, `set_skill`, `set_mode`, `publish`. Cloud enqueue acknowledges saved work even if PC is offline, never claims a video is created merely because command was saved.

## API contract v1

Public `GET /health` returns minimal `{ok:true,version:1}`. `POST /zalo/webhook` accepts official Zalo body `{ok:true,result:{event_name:'message.text.received',message:{from:{id,is_bot},chat:{id,chat_type:'PRIVATE'},text,message_id,date}}}` and verifies `X-Bot-Api-Secret-Token`. Zalo verification probe bodies must return 200 without pairing/queuing.
Runner endpoints require `Authorization: Bearer RUNNER_TOKEN`; never accept missing/empty configured auth. Responses JSON, errors `{error:string}` with meaningful 4xx.
- `POST /api/claim {workerId}` -> `{job:null|Job}`.
- `POST /api/jobs {dedupeKey,type,payload,sourceJobId?}` -> `{job:Job,duplicate:boolean}`. Validate known types, payload and limits.
- `GET /api/jobs` -> `{jobs:Job[],worker:{lastSeenAt,online}}`, summaries bounded.
- `POST /api/jobs/:id/heartbeat {workerId,leaseToken,summary?}` -> `{ok:true,cancelRequested,leaseExpiresAt}`; presence refreshed by claim.
- `POST /api/jobs/:id/complete {workerId,leaseToken,result:{message,videoId?,driveUrl?,publishing?}}` -> `{ok:true}`.
- `POST /api/jobs/:id/fail {workerId,leaseToken,error,needsReview?}` -> `{ok:true}`.
`Job`: `{id,type,payload,status,createdAt,updatedAt,attempt,workerId?,leaseToken?,leaseExpiresAt?,cancelRequested?,result?,error?}`. Lease tokens only exposed to authenticated runner; redact from Zalo output/list summaries. Each claim uses fresh fencing token. At most one live leased job for this personal queue. Default lease 180000ms, heartbeat <=30000ms; lost/expired lease aborts subprocess and prevents upload/publish/completion. Expired active jobs become `needs_review` for explicit retry; queued offline jobs remain queued. Attempt increments only on claim. Completed jobs never retry.
Message replay dedup key = sender+chat+message_id, immutable event collision rejected. SQL/KV storage persisted before webhook acknowledgement; transactions serialize pairing, dedup and claiming. Outbox + alarms send Vietnamese notifications through official `sendMessage`; retry notification independently of executing work. Track latest stage and completion; no secret-bearing errors/URLs in messages.

## Local execution

Scan identifies all eligible rows, assigns stable unique ID if needed, enqueues produce jobs with input fingerprint dedupe. Row updates locate unique ID afresh and verify fingerprint before each sensitive change; duplicate IDs require review. Do not write into the wrong row after sorting.
New rows default Chờ duyệt/Chờ tạo/Chỉ tạo video. `/approve` is explicit human approval. Produce checkpoints snapshot inputs, Codex thread ID, agent result, verified media, Drive upload ID, sheet completion and per-channel publishing attempt IDs. Atomic manifest writes permit safe recovery. Unknown/ambiguous external result becomes review, never automatic repost.
Agent result schema: `status` ready_for_upload|needs_input|failed, `videoPath`, `caption`, `hashtags`, `qualityReportPath`, `message`. All artifact realpaths inside job folder. Read skill fully, complete required storyboard/media/voice/captions and quality gates; a slideshow shortcut that violates skill is not success. Missing image tool/TTS returns needs_input. Runner validates file size, ffprobe H.264/AAC, 9:16 and audio before upload, plus explicit quality evidence. Re-read approval/input before upload and publish. After upload write J/K/L/F (Hoàn tất) and P on correct ID. Failures leave files/checkpoints, F=Lỗi or Cần kiểm tra with clear P.
Publish writes O with each accepted Buffer ID/status; never labels accepted or scheduled as Đã đăng. Persist an intent before POST; persist response before next channel. Timeout/transport failure after send = unknown -> review, preventing automatic duplicate. Known mutation errors recorded individually; do not re-send channels already accepted. Future schedule +07 converted to UTC.
Cancellation sets cancelRequested, heartbeat sees it, child terminated with Windows process-tree handling, checkpoints retained and row marked Cần kiểm tra if started. Never append command text to a shell string. Child environment excludes bot/Google/Buffer secrets. Config/credentials/logs ignored in Git; logs redact known secrets and API URLs with bot token.

## Verification and delivery

Node built-in tests + real Miniflare Durable Object integration: auth, owner pairing, webhook duplicates, concurrent claims, leases/stale fencing, cancellation, offline persistence/restart and outbox failures. Runner tests: queue interaction, input changes, row sorting, duplicate IDs, missing output, cancellation subprocess, crash checkpoints, ambiguous upload/publishing and no double post. Use mock external APIs; do not post real social content or write test rows into user Sheet.
Run a local end-to-end example while simulated runner offline, start runner with fake Google/producer/publisher, assert persisted queue produces once and result returns. Produce operator README (Vietnamese), `.env.example`, configuration/setup commands, doctor, Windows START/STOP/optional startup tasks. Missing credentials must be reported individually, not silently simulated. Cloud deploy and Zalo setWebhook require real user Bot Token + Wrangler authorization; Google auth requires user consent; media provider and Buffer auth required for those stages. Complete all local code and verifications before requesting final required account actions.

Sources: https://docs.zaloplatforms.com/docs/BOT/webhook ; https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook ; https://docs.zaloplatforms.com/docs/BOT/apis/sendMessage ; https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/ ; https://learn.chatgpt.com/docs/non-interactive-mode ; https://developers.buffer.com/examples/create-video-post.html .
