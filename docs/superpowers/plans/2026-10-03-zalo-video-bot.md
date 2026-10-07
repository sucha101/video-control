# Zalo Video Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement task-by-task. User approved the local-runner/cloud-queue design on 2026-10-03. Continue implementation without re-requesting design approval.

**Goal:** User controls skill-selected videos via Zalo; queued requests survive Windows being offline.
**Architecture:** Cloudflare webhook routes to one SQLite Durable Object queue/outbox. Local Node runner claims work, uses Google adapters and Codex CLI, uploads valid video and optionally sends to configured Buffer channels.
**Tech Stack:** Node >=22 ES modules, node:test, Cloudflare Worker/Durable Objects, Wrangler, Miniflare, Google auth library, Codex CLI, existing Remotion/FFmpeg/VieNeu-TTS.
**Spec:** docs/superpowers/specs/2026-10-03-zalo-video-bot-design.md

## Global Constraints

- Self-contained `tools/video-bot/` package; do not edit existing Remotion sources/package.json.
- Personal/private chats only; pair owner with one-time code, validate Zalo webhook secret and runner bearer token.
- Preserve queued work when PC is offline; never execute duplicate claims/webhooks or auto retry ambiguous social posts.
- No live publication or test mutation of user Sheet/Drive during tests. No secrets printed, committed, or put in Sheet.
- Primary media renderer workspace `D:/remotion`; allowlisted skills and pinned user Sheet/folder per spec.

## Task 1: Durable cloud control and queue

**Files:** tools/video-bot/package.json, package-lock.json, .gitignore, cloud/wrangler.jsonc, cloud/worker.mjs, cloud/queue.mjs, shared/commands.mjs, shared/contracts.mjs, test/cloud.test.mjs, test/commands.test.mjs.
**Consumes:** Spec API contract v1 and official Zalo envelope.
**Produces:** Worker endpoints specified in spec; command `{type,payload}`; Job JSON contract; package scripts `test`, `cloud:dev`, `cloud:deploy`.

- [ ] Write failing parser/authorization tests. Parser export `parseCommand(text)` returns `{type,payload}` or throws readable user error. Example:
```js
assert.deepEqual(parseCommand('/run V001'), {type:'produce',payload:{videoId:'V001'}});
assert.throws(() => parseCommand('/run V001 & del C:/'), /lệnh|ID|không/i);
```
- [ ] Run `node --test test/commands.test.mjs`, observe expected failure before implementation.
- [ ] Implement bounded command parser and shared Job helpers; test official envelope not alternative SDK envelope.
- [ ] Add real Miniflare tests for owner pairing, duplicate webhook, concurrent claim, offline durable restart, expired fence token and alarm outbox retry. Claim invariant:
```js
const claims=await Promise.all([claim('pc-a'),claim('pc-b')]);
assert.equal(claims.filter(x=>x.job).length,1);
```
- [ ] Implement Worker/DO using transactional persistent storage, pairing+auth, one lease, explicit review on expiry, safe outbox. Persist before acknowledge.
- [ ] `npm test` and `npx wrangler deploy --dry-run --outdir .state/cloud-build`; report outputs and commit only own files. Never deploy real cloud worker during implementation tests.

## Task 2: Local runner, adapters and operator setup

**Files:** tools/video-bot/local/{config,queue-client,manifest,runner,codex,google,buffer,media,cli,setup}.mjs; tools/video-bot/shared/agent-result.schema.json; tools/video-bot/test/{runner,adapters,e2e}.test.mjs; tools/video-bot/.env.example, README.md, START.cmd, STOP.cmd, SETUP.cmd; optional scripts for startup. Task 2 may edit shared contracts/package scripts only to implement compatible interfaces, document any such change.
**Consumes:** Worker API v1; `parseCommand`; cloud Job `{id,type,payload,attempt,leaseToken,leaseExpiresAt}`.
**Produces:** `npm run doctor`, `npm start`, `npm run setup`, `npm run connect:google`, `npm run cloud:configure`, optional Windows startup installer, real adapter modules and local E2E test.

- [ ] Write failing meaningful tests using fake HTTP Google/queue/producer/Buffer servers: input change cancels side effect; sorted/duplicate row IDs; at most one Codex child; malformed result cannot mark Hoàn tất; ambiguous Buffer response cannot retry.
- [ ] Implement local config with ignored files, secure setup and clear doctor. Google OAuth loopback reads installed-app client JSON and saves authorized-user credentials; supports service account credentials too. Pin resource IDs in `.env.example`.
- [ ] Implement typed/fixed argument Codex subprocess + schema + event capture + abort handling; child gets only required local env, no service credentials. Checkpoint output and verify artifacts before upload; returns needs_input when required image capabilities unavailable. Do not claim all app tools are inherited by CLI.
- [ ] Implement Google Sheets RAW operations with stable ID lookup/rechecks and streaming resumable Drive uploads/checkpoint recovery. Before external writes recheck approval and fingerprint. Add verified source support for media relay URLs without silently changing permissions.
- [ ] Implement official Buffer create video post inputs/per-channel metadata, +07 scheduling and per-channel intent journal. Record accepted vs published precisely; unknown results need human review. Posting enabled only with configured channel auth and row approval/mode.
- [ ] Implement scan/add/approve/skill/mode/produce/publish job handling, safe lock, persistent checkpoints, heartbeat and cancellation; local runner fetches commands when online. Local fake producer E2E must exercise actual cloud API with offline backlog then completion.
- [ ] Add Vietnamese setup README + scripts for Windows launch/stop and opt-in startup. SETUP UI only loopback, no external secret telemetry. Cloud configure pushes secrets via Wrangler stdin and registers Zalo webhook only on explicit operator command after prerequisites succeed.
- [ ] `npm test`, `npm run doctor`, `npx wrangler deploy --dry-run --outdir .state/cloud-build`; report exact output. Commit only new package docs/files.

## Task 3: Integration/review and connection readiness

- [ ] Review combined diff against spec including concurrency, side-effect fencing, secret handling, cancellation and offline queue persistence.
- [ ] Fix concrete findings through implementer, run covering tests.
- [ ] Run local end-to-end + doctor on actual user machine paths, verify CLI authentication and media tool availability without production jobs.
- [ ] Report actual missing account connections and provide one local setup surface. Keep user token out of chat. Deploy/register only with real credentials and authorized scope. Verify webhook and owner handshake when user supplies config locally.
- [ ] Update original workflow plan/config to reflect actual implementation/readiness; do not label live bot ready merely because local tests pass.
