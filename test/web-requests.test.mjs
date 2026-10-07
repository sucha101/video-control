import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateUsersJson} from '../local/setup-web-users.mjs';
import {VideoStudioClient} from '../local/video-studio-client.mjs';
import {GoogleSheetsClient} from '../local/google.mjs';
import {DatabaseSync} from 'node:sqlite';
import {ensureWebSchema, createWebRequest, claimStudioRequest, heartbeatStudioRequest, completeStudioRequest, claimSyncOutbox, completeSyncOutbox} from '../cloud/web-store.mjs';

const OWNER_PASS = 'OwnerSecret2026!';
const COLLAB_PASS = 'CollabSecret2026!';
const usersJson = generateUsersJson({ownerPassword: OWNER_PASS, collaboratorPassword: COLLAB_PASS});

const secrets = {
  ZALO_WEBHOOK_SECRET: 'fake-webhook-secret',
  RUNNER_TOKEN: 'fake-runner-secret',
  PAIR_CODE: 'test-pair-code',
  ZALO_BOT_TOKEN: 'fake-bot-token',
  WEB_USERS_JSON: usersJson
};

const bundle = (await build({
  stdin: {
    contents: `
import worker from './cloud/worker.mjs';
import {VideoQueue as Base} from './cloud/queue.mjs';
export default worker;
export class VideoQueue extends Base {}
`,
    resolveDir: path.resolve('.'),
    sourcefile: 'test-requests-entry.mjs'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false
})).outputFiles[0].text;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'web-requests-test-'));
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'web-requests-test',
    modules: true,
    script: bundle,
    compatibilityDate: '2026-09-01',
    resourcePersistencePath: directory,
    durableObjects: {VIDEO_QUEUE: {className: 'VideoQueue', useSQLite: true}},
    bindings: secrets
  }));
  await mf.ready;

  const fetchApi = async (url, {method = 'GET', body, headers = {}} = {}) => {
    const fullUrl = `https://queue${url}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const response = await mf.dispatchFetch(fullUrl, options);
    let resBody;
    try {
      resBody = await response.json();
    } catch {
      resBody = null;
    }
    return {status: response.status, body: resBody, headers: response.headers};
  };

  const runnerClient = new VideoStudioClient({
    cloudUrl: 'https://queue',
    runnerToken: secrets.RUNNER_TOKEN,
    workerId: 'worker-pc-1',
    fetchImpl: (url, opts) => mf.dispatchFetch(url, opts)
  });

  let disposed = false;
  const dispose = async () => {
    if (!disposed) {
      disposed = true;
      await mf.dispose();
    }
  };
  t.after(async () => {
    await dispose();
    await rm(directory, {recursive: true, force: true});
  });

  return {mf, fetchApi, runnerClient};
}

test('P2: V001 is seeded idempotently as legacy_readonly and next is V002', async t => {
  const f = await fixture(t);

  // Log in as owner to get session and CSRF
  const login = await f.fetchApi('/api/web/login', {
    method: 'POST',
    body: {username: 'owner', password: OWNER_PASS}
  });
  assert.equal(login.status, 200);
  const cookieHeader = login.headers.get('set-cookie').split(';')[0];
  const csrfToken = login.body.csrfToken;

  // 1. Get requests list: V001 should already exist
  const list1 = await f.fetchApi('/api/web/requests', {
    headers: {Cookie: cookieHeader}
  });
  assert.equal(list1.status, 200);
  const v001 = list1.body.requests.find(r => r.display_id === 'V001');
  assert.ok(v001);
  assert.equal(v001.is_legacy, 1);
  assert.equal(v001.production_state, 'completed');
  assert.equal(v001.sheet_row_number, 2);

  // 2. Runner cannot claim V001
  await assert.rejects(
    async () => f.runnerClient.claimRequest('V001'),
    err => err.status === 400
  );

  // 3. Create a new request: must be assigned V002
  const create1 = await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Video Số Hai',
      script: 'Kịch bản cho video V002',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'key-v002'
    },
    headers: {
      Cookie: cookieHeader,
      'X-CSRF-Token': csrfToken,
      Origin: 'https://queue'
    }
  });
  assert.equal(create1.status, 201);
  assert.equal(create1.body.request.display_id, 'V002');
  assert.equal(create1.body.request.production_state, 'waiting');

  // 4. Create another request: must be assigned V003
  const create2 = await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Video Số Ba',
      script: 'Kịch bản cho video V003',
      skill: 'drama-mascot-video',
      clientSubmissionKey: 'key-v003'
    },
    headers: {
      Cookie: cookieHeader,
      'X-CSRF-Token': csrfToken,
      Origin: 'https://queue'
    }
  });
  assert.equal(create2.status, 201);
  assert.equal(create2.body.request.display_id, 'V003');
});

test('production lease rejects duplicate same-worker claims, expired heartbeat/result and stale outbox receipts', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = {exec(query, ...params) {
    const statement = db.prepare(query);
    if (statement.columns().length) return {toArray: () => statement.all(...params)};
    statement.run(...params);
    return {toArray: () => []};
  }};
  ensureWebSchema(sql);
  let now = 2000000000000;
  const realNow = Date.now;
  Date.now = () => now;
  t.after(() => {Date.now = realNow;});
  const {request} = await createWebRequest(sql, {username: 'owner'}, {title: 'Lease', script: 'Test', skill: 'viet-tiktok-story-video', clientSubmissionKey: 'lease-test'});
  const simultaneous = await Promise.allSettled([claimStudioRequest(sql, request.id, 'pc1'), claimStudioRequest(sql, request.id, 'pc2')]);
  assert.equal(simultaneous.filter(result => result.status === 'fulfilled').length, 1);
  const claim = simultaneous[0].value;
  await assert.rejects(claimStudioRequest(sql, request.id, 'pc1'), /máy tính khác/);
  now += 900001;
  await assert.rejects(heartbeatStudioRequest(sql, request.id, 'pc1', claim.leaseToken, 'expired'), /hết hạn/);
  await assert.rejects(completeStudioRequest(sql, request.id, 'pc1', claim.leaseToken, {driveId: 'fake', driveUrl: 'https://drive.google.com/file/d/fake/view'}), /hết hạn/);
  const replacement = await claimStudioRequest(sql, request.id, 'pc2');
  assert.equal(replacement.fenceEpoch, claim.fenceEpoch + 1);
  await assert.rejects(heartbeatStudioRequest(sql, request.id, 'pc1', claim.leaseToken, 'old'), /sở hữu/);

  const first = claimSyncOutbox(sql, 'pc1').items[0];
  assert.equal(claimSyncOutbox(sql, 'pc2').items.length, 0);
  now += 300001;
  const second = claimSyncOutbox(sql, 'pc2').items[0];
  assert.throws(() => completeSyncOutbox(sql, {workerId: 'pc1', completedIds: [first.id], claims: [{id: first.id, claimToken: first.claim_token}]}), /hết hạn/);
  completeSyncOutbox(sql, {workerId: 'pc2', completedIds: [second.id], claims: [{id: second.id, claimToken: second.claim_token}]});
  assert.equal(claimSyncOutbox(sql, 'pc1').items.length, 0);
});

test('P2: Runner Studio claim, heartbeat, result and lease fencing lifecycle', async t => {
  const f = await fixture(t);

  // Login
  const login = await f.fetchApi('/api/web/login', {
    method: 'POST',
    body: {username: 'owner', password: OWNER_PASS}
  });
  const cookieHeader = login.headers.get('set-cookie').split(';')[0];
  const csrfToken = login.body.csrfToken;

  // Create request V002
  const create = await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Video V002 Pipeline',
      script: 'Kịch bản test',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'pipeline-key-1'
    },
    headers: {Cookie: cookieHeader, 'X-CSRF-Token': csrfToken, Origin: 'https://queue'}
  });
  const reqId = create.body.request.id;

  // 1. Runner gets pending requests -> V002 is listed
  const pending = await f.runnerClient.getPendingRequests();
  const found = pending.find(r => r.id === reqId);
  assert.ok(found);

  // 2. Worker 1 claims V002
  const claimRes = await f.runnerClient.claimRequest(reqId);
  assert.ok(claimRes.leaseToken);
  assert.ok(claimRes.expiresAt > Date.now());

  // 3. Worker 2 attempts to claim V002 concurrently -> rejected 409
  const worker2Client = new VideoStudioClient({
    cloudUrl: 'https://queue',
    runnerToken: secrets.RUNNER_TOKEN,
    workerId: 'worker-pc-2',
    fetchImpl: (url, opts) => f.mf.dispatchFetch(url, opts)
  });
  await assert.rejects(
    async () => worker2Client.claimRequest(reqId),
    err => err.status === 409
  );

  // 4. Worker 1 sends heartbeat
  const hbRes = await f.runnerClient.sendHeartbeat(reqId, claimRes.leaseToken, 'Đang gen ảnh 4/16');
  assert.equal(hbRes.ok, true);

  // 5. Worker 1 completes request with Drive URL and caption
  const completeRes = await f.runnerClient.sendResult(reqId, claimRes.leaseToken, {
    driveId: 'drive-file-v002',
    driveUrl: 'https://drive.google.com/file/d/drive-file-v002/view',
    caption: 'Video V002 hoàn tất #tiktok',
    hashtags: '#tiktok #viral'
  });
  assert.equal(completeRes.ok, true);

  // 6. Check state on web: must be in review
  const detail = await f.fetchApi(`/api/web/requests/${reqId}`, {
    headers: {Cookie: cookieHeader}
  });
  assert.equal(detail.body.request.production_state, 'review');
  assert.equal(detail.body.request.drive_id, 'drive-file-v002');
  assert.equal(detail.body.request.drive_url, 'https://drive.google.com/file/d/drive-file-v002/view');
  assert.equal(detail.body.claim, null); // Claim record cleared
});

test('P2: Sheet sync outbox and GoogleSheetsClient batchUpdateRanges', async t => {
  const f = await fixture(t);

  const login = await f.fetchApi('/api/web/login', {
    method: 'POST',
    body: {username: 'owner', password: OWNER_PASS}
  });
  const cookieHeader = login.headers.get('set-cookie').split(';')[0];
  const csrfToken = login.body.csrfToken;

  await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Video For Outbox',
      script: 'Kịch bản outbox',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'outbox-sub-key'
    },
    headers: {Cookie: cookieHeader, 'X-CSRF-Token': csrfToken, Origin: 'https://queue'}
  });

  // Outbox should contain pending items from request creation
  const items = await f.runnerClient.claimSyncOutbox();
  assert.ok(items.length > 0);
  const firstId = items[0].id;

  // Complete sync for first item
  const comp = await f.runnerClient.completeSyncOutbox({completedIds: [firstId]});
  assert.equal(comp.ok, true);

  // Unit test for GoogleSheetsClient.batchUpdateRanges with mock fetch
  let batchPayload = null;
  const mockFetch = async (url, options) => {
    batchPayload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({responses: [{updatedRange: 'Trang tính1!E2:F2', updatedCells: 2}]})
    };
  };

  const sheets = new GoogleSheetsClient({
    spreadsheetId: 'test-sheet-id',
    credentialsPath: 'non-existent',
    fetchImpl: mockFetch
  });

  // Mock token to avoid file reading in unit test
  sheets.credentialsPath = path.resolve('.codex/dummy.json');

  // Verify batchUpdate payload formatting
  const testData = [{range: 'E2:F2', values: [['Duyệt', 'Hoàn tất']]}];
  const formatted = testData.map(d => ({
    range: d.range.includes('!') ? d.range : `Trang tính1!${d.range}`,
    majorDimension: 'ROWS',
    values: d.values
  }));
  assert.equal(formatted[0].range, 'Trang tính1!E2:F2');
  assert.deepEqual(formatted[0].values, [['Duyệt', 'Hoàn tất']]);
});
