# Video Studio: audit and module refactor, 2026-10-05

## Verified changes

| Module | Findings and changes |
| --- | --- |
| local/buffer-budget.mjs | New shared persisted ledger for CLI/watcher; rolling local ceilings 60 reads/day, 200 total/day, 2500 total/30 days; server Retry-After and RateLimit windows override local schedule; reserves provider quota for writes. |
| local/buffer.mjs | All Buffer requests pass budget gate, 20s timeout, typed outcomes; abort probe response body; existing provider ID prevents another create regardless of sending/scheduled status. |
| local/studio-publisher.mjs | Extracted from CLI; one channel per claim, persisted create intent and receipt before cloud acknowledgment; ambiguous outcomes held for review; read-only cooldown does not block write allowance. |
| cloud/web-publications.mjs | Claims fenced to worker, one channel, 5min expiry; no automatic replay after expired uncertain send; polling reserved and scheduled 1h/2h/4h/6h; immutable review revision and duplicate intent safeguards. |
| local/studio-sync.mjs | Extracted sync; one initial Sheet read per batch, refresh after append to locate actual row; missing result rows/unknown events are retried instead of acknowledged as complete. |
| cloud/web-store.mjs and queue.mjs | Atomic production claims, incrementing fences, expiry checks; sync receipt requires claim token and worker; exponential outbox retry. |
| local/video-studio-client.mjs | Tracks claim tokens/fences, includes worker on poll reservation, 20s cloud request timeout. |
| local/studio-watcher.mjs | Direct module calls replace spawning CLI and parsing stdout; singleton lock, persisted notification IDs, 60s cloud cycles; removes competing Zalo getUpdates receiver. |
| local/zalo-poller.mjs | Handles singleton update payload, cursor persisted, bounded network calls; submits commands to real cloud queue instead of mutating runner.queue during another job. |
| local/runner.mjs | Reject overlapping execution; abort on lost heartbeat; validate IDs; journal and file lock for legacy publication; prevent legacy mode/publish from bypassing Web ownership marker. |
| local/google.mjs | Coalesces concurrent token refresh within process, token timeout, removes unused imports. |
| cloud/web-auth.mjs | Stable CSRF per session across tabs, malformed cookie handling, expired login lock reset, expired session cleanup. |
| cloud/web/studio-policy.js and app.js | Extracted UI policy; stable submit key, saves caption before intent, revision checks, stale response guards, pagination, corrected publication filter, visible/authenticated health checks, safe preview URLs. |
| V002 publication summary | All Buffer-accepted channels now show “Buffer đã nhận, chờ xác nhận đăng”. “Đã đăng” is reserved for receipts where every selected channel reports sent. This distinguishes provider acceptance from confirmed publication. |
| local/google.mjs and runner.mjs | Drive uploads now query the server-confirmed offset, send 8 MiB resumable chunks, recover a lost final response, persist session/file checkpoint keyed to the input fingerprint, and resume permission verification without creating another file. Expired/unknown sessions fail closed for reconciliation. |
| local/stop-runners.ps1 | STOP validates PID belongs to expected Node command before termination, supports runner and watcher. |

## Evidence

- Full offline suite: 41/41 pass. Additional focused runner/delivery rerun: 6/6 pass after final review corrections.
- New tests cover quota restart/concurrency, no fetch while blocked, stale fences, expired leases, duplicate claims, lost cloud acknowledgment after Buffer creation, missing Sheet rows, multi-tab CSRF, and stable UI submission keys.
- Wrangler dry build passed; deployment completed, version `fac786c2-feef-4f38-8505-e3ffb50813e2`.
- Follow-up deployment completed, version `6ab5ae52-50a5-4bd9-9b84-b7a335c5992d`; live page reload showed V002 as “Buffer đã nhận, chờ xác nhận đăng”.
- Real Buffer calls/publications and real Zalo test messages were not used as test fixtures.
- Current read-only V002 detail showed all three channels as “Buffer đã nhận” with no published state/link. The owner reports the posts are live; a Buffer confirmation is still pending, so the interface now labels this state accurately instead of claiming either success or failure.
- Persistent cooldown seeded from previously observed Buffer reset: 2026-10-06 16:57:19 Asia/Bangkok. No quota probe was sent.

## Operating limits and remaining follow-up

1. V003 legacy `attempting` rows without a lease/Buffer ID are ambiguous. Do not reset automatically; reconcile provider history first.
2. If a Buffer create succeeds but cloud acknowledgment is lost until its claim expires, local journal retains the provider ID and prevents recreation. Updating the held cloud receipt still requires reconciliation; the journal is not a full automatic reconciliation service.
3. Limits are shared with other integrations. This local ledger bounds this installation; external clients can consume provider quota, so server headers remain authoritative.
4. Drive now resumes from Drive's acknowledged byte offset and persists the upload session/file ID keyed to the content fingerprint. The recovery implementation has not yet been exercised by a real interrupted upload; expired sessions deliberately stop for reconciliation.
5. Legacy Sheet handlers still have whole-row updates and no cross-system transaction. Concurrent manual edits can conflict; migrate them to field-specific updates and immutable ownership records in a separate focused change.
6. Notification delivery is not exactly-once: a crash between send and saving notification ID can duplicate a notification. Zalo command cursor currently prioritizes avoiding replay and is not a transactional inbox.
7. Rendering/image generation still follows configured skills and supported capabilities. This audit does not turn manual Codex production into unattended AI image generation.
8. Stale local process locks require PID verification before removal; automatic stale-lock reclamation is deliberately limited.

Existing unrelated dirty files and user helper scripts were preserved. This audit is scoped to Video Studio orchestration; it does not certify every Remotion project in the repository.
