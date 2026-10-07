# Video Studio Web Implementation Plan

> **Bản này đã được thay thế:** xem [kế hoạch rà soát chi tiết](2026-10-05-video-studio-web-v2.md). Bản cũ không còn là tài liệu triển khai vì thiếu ranh giới auth ở Durable Object, lưu biên nhận Buffer bền vững và xử lý xung đột Google Sheet.

> **For agentic workers:** Execute inline using `superpowers:executing-plans`; keep tasks in order and preserve existing user changes in the video-bot worktree.

**Goal:** Build a private mobile-first Video Studio web app where two users can submit story-video requests, ask Codex to process them, review returned videos, and explicitly publish through Buffer.

**Architecture:** Serve static HTML/CSS/JS from the existing Cloudflare Worker. Add private web-session and request/publication state to the existing SQLite Durable Object, with a separate user API and the existing bearer-protected local runner bridge. The web records and reviews work; Codex is invoked by the user in chat to produce it on the local PC.

**Tech Stack:** Cloudflare Worker/SQLite Durable Objects, Wrangler 4.147.0, Node.js 22+, static HTML/CSS/JS, existing Google Sheets/Drive and Buffer adapters.

**Spec:** `docs/superpowers/specs/2026-10-05-video-studio-web-design.md`; visual system: `tools/video-bot/DESIGN.md`; surface behavior: `tools/video-bot/.impeccable/surfaces/video-studio.md`.

## Global Constraints

- The user-facing interface is Vietnamese and mobile-first; touch targets are at least 48px high.
- The approved visual direction is a small crew's “sổ gọi cảnh”: paper `#F4F1E9`, ink `#182A31`, coral `#C84E3A`, Be Vietnam Pro.
- No public signup; owner and collaborator use separate private accounts.
- Web submission stores a request and does not start Codex. The owner invokes Codex from chat.
- Production and each channel's publication status are independent; Buffer `sent` status plus external link is required to show “Đã đăng”.
- Ambiguous Buffer results become `needs_review`, never an automatic retry.
- Never expose credentials in frontend assets, URLs, or routine logs. Only grant Drive reader access when needed for user viewing or an explicitly approved Buffer publication.
- Preserve existing Worker webhook and runner API behavior; additive migration only.

---

### Task 1: Serve the Video Studio shell

**Files:**
- Create: `tools/video-bot/web/index.html`
- Create: `tools/video-bot/web/app.css`
- Create: `tools/video-bot/web/app.js`
- Modify: `tools/video-bot/cloud/wrangler.jsonc`
- Modify: `tools/video-bot/cloud/worker.mjs`

**Interfaces:**
- Worker routes known API/webhook paths to their handlers; `GET /` and static asset requests go to `env.ASSETS.fetch(request)`.
- The frontend uses `fetch('/api/web/session')` to learn the active user and `fetch('/api/web/requests')` for the list.

- [ ] Configure Worker static assets at `web/` with binding `ASSETS` and `run_worker_first: true` so existing API and webhook handlers keep precedence.
- [ ] Create semantic Vietnamese HTML shell with two destinations, “Video” and “Tạo video”, and a polite live region for network feedback.
- [ ] Apply the approved call-sheet visual tokens, shot-list rows, mobile bottom navigation, desktop side navigation, visible form labels, and reduced-motion behavior.
- [ ] Add loading, empty, disconnected, and sign-in views with plain recovery actions; do not show sample content as real jobs.
- [ ] Keep JavaScript limited to view state and API requests; render user content with `textContent`.

### Task 2: Add private web sessions and role checks

**Files:**
- Create: `tools/video-bot/cloud/web-auth.mjs`
- Modify: `tools/video-bot/cloud/queue.mjs`
- Modify: `tools/video-bot/cloud/worker.mjs`
- Modify: `tools/video-bot/cloud/wrangler.jsonc`
- Modify: `tools/video-bot/README.md`

**Interfaces:**
- `POST /api/web/login` accepts `{username, password}` and returns `{user:{username,role},csrfToken}` with a Secure HttpOnly session cookie.
- `GET /api/web/session` returns the current user and CSRF token or `401`.
- `POST /api/web/logout` revokes the server-side session.
- Worker secrets `WEB_OWNER_PASSWORD` and `WEB_COLLABORATOR_PASSWORD` provision two usernames/roles; there is no password or role field in browser configuration.
- Mutating web requests require same-origin checks and the session CSRF token.

- [ ] Add an additive Durable Object table for hashed session IDs, roles, CSRF hashes, expiry, and failed-login rate limits; do not store plain session tokens or passwords.
- [ ] Compare configured passwords with a constant-time check and use a per-session cryptographic random token; cookies use `HttpOnly; Secure; SameSite=Strict; Path=/`.
- [ ] Bound login failures by username and client address, return the same public error for unknown users and wrong passwords, and never log secrets.
- [ ] Require authentication on all `/api/web/*` request data; preserve current runner bearer and Zalo webhook auth paths.
- [ ] Document exact `wrangler secret put` commands without asking the user to paste account passwords into chat.

### Task 3: Persist requests and provide Codex's manual handoff

**Files:**
- Create: `tools/video-bot/cloud/web-requests.mjs`
- Create: `tools/video-bot/local/video-studio-client.mjs`
- Modify: `tools/video-bot/cloud/queue.mjs`
- Modify: `tools/video-bot/cloud/worker.mjs`
- Modify: `tools/video-bot/local/cli.mjs`
- Modify: `tools/video-bot/local/config.mjs`
- Modify: `tools/video-bot/web/app.js`

**Interfaces:**
- `POST /api/web/requests` accepts `{title,script,skill,voice?,references?,notes?}` and returns a stable request UUID, display ID, and `waiting` state.
- `GET /api/web/requests?state=` returns at most 100 user-visible request summaries; `GET /api/web/requests/:id` returns one request and its safe production metadata.
- `PATCH /api/web/requests/:id` edits only a waiting request and requires the current revision.
- Bearer-protected `GET /api/runner/requests?state=waiting` lists requests for an explicit Codex tool invocation; it never claims automatically.
- `POST /api/runner/requests/:id/claim` returns the request snapshot, current skill key, lease token, and expiry. `POST /api/runner/requests/:id/heartbeat` extends a valid lease. `POST /api/runner/requests/:id/result` attaches verified Drive/video metadata and moves the request to `review`.
- Local module exports `listWaitingRequests()`, `claimRequest(id)`, `heartbeatRequest(claim)`, and `submitRequestResult(claim,result)`; CLI command `studio:pending` prints safe request summaries for Codex, while Codex itself is only started by the user in chat.

- [ ] Add additive SQLite tables for request snapshots, monotonically generated display IDs, revision hashes, claim leases, and state timestamps. Import existing V001 as completed metadata by Drive ID so it cannot be produced or published again.
- [ ] Enforce skill allow-list, script/title length bounds, HTTPS reference URLs, and required field checks at the Worker boundary.
- [ ] Create idempotent request submission using a client-generated submission ID; duplicate retries return the same request.
- [ ] Restrict edits to `waiting`; a claim freezes its revision. A changed revision cannot accept a stale production result.
- [ ] Add runner-authorized claim/heartbeat/result endpoints with a lease, fencing token, and `needs_review` on expiry.
- [ ] Add the local helper command that only lists/claims on invocation; document the exact prompt phrase the user can send to Codex, with skill paths resolved from local config and never accepted as arbitrary filesystem paths from web input.
- [ ] Connect create/list/detail/edit UI to the APIs and preserve form contents through validation or connection errors.

### Task 4: Review the video and schedule publication safely

**Files:**
- Create: `tools/video-bot/cloud/web-publications.mjs`
- Modify: `tools/video-bot/cloud/queue.mjs`
- Modify: `tools/video-bot/cloud/worker.mjs`
- Modify: `tools/video-bot/local/runner.mjs`
- Modify: `tools/video-bot/local/buffer.mjs`
- Modify: `tools/video-bot/web/app.js`

**Interfaces:**
- `PATCH /api/web/requests/:id/review` updates caption/hashtags at a new review revision.
- `POST /api/web/requests/:id/publications` accepts `{publicationKey,channelIds,scheduleLocal}` after an explicit confirmation; local times use Asia/Bangkok and return one publication ID with one item per channel.
- Local runner claim returns a channel item and immutable snapshot; `begin`, `complete`, and `needs-review` transitions require the current lease token.
- Completed channel items return Buffer ID, provider status, and `externalLink` when Buffer exposes one.

- [ ] Require request state `review`, a Drive file ID, nonempty caption, valid connected channel IDs, and a future schedule if supplied.
- [ ] Store publication key and per-channel items transactionally before the local runner receives them; repeat confirmation with the same key returns existing items.
- [ ] Persist each channel's pending intent before calling Buffer; after timeout, keep that channel in `needs_review` and do not create again automatically.
- [ ] Save returned Buffer post IDs and `sending`/`sent` status before syncing to Sheet; poll by Buffer post ID for final status and public post link.
- [ ] Fix `publishChannels` call sites so durable save/fence callbacks cannot be no-ops for real publication.
- [ ] Confirm before any public Drive permission change; only grant viewer access to the MP4 required for the selected Buffer publication, never writer access.
- [ ] Build the review page around the 9:16 preview, editable caption/hashtags, per-channel status, and an explicit channel/schedule confirmation control.

### Task 5: Synchronize Google Sheets and publish operator setup

**Files:**
- Modify: `tools/video-bot/local/runner.mjs`
- Modify: `tools/video-bot/local/google.mjs`
- Modify: `tools/video-bot/cloud/web-requests.mjs`
- Modify: `tools/video-bot/README.md`
- Modify: `tools/video-bot/SETUP.cmd`

**Interfaces:**
- A local `syncRequestToSheet(request)` mirrors approved, completed, caption, hashtags, Drive URL, and per-channel receipts to the existing columns.
- Sheet sync failures are recorded for retry by request ID and do not undo cloud request or publication state.
- Setup docs explain one-time account secrets, running the Worker locally, deploying it, starting the PC runner, and the manual Codex processing step.

- [ ] Map web request fields to the existing A:P Sheet columns; preserve manual Sheet fields not owned by Video Studio.
- [ ] Write Drive URL and caption/hashtags after production; write each Buffer receipt/status per channel after publication transitions.
- [ ] Store retryable sync work durably and deduplicate it by request revision; never repeat production or Buffer post creation to repair a Sheet update.
- [ ] Update README and setup scripts with web URL, the two private accounts, startup/shutdown commands, and PC offline behavior.
- [ ] Keep existing Zalo/queue docs accurate and state clearly that the website does not launch a Codex session.

---

## Plan self-review

- The design spec's three screens, two roles, manual Codex handoff, Drive result, Buffer review, per-channel status, offline queue, and Sheet mirror each map to a task above.
- V001 import is included before ID generation to prevent replay.
- Publishing ambiguity is represented per channel and cannot be retried blindly.
- The Cloudflare Worker and local runner retain separate authentication boundaries.
- No new UI is exposed as production until account secrets are installed by the owner.
