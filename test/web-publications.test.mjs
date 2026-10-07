import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateUsersJson} from '../local/setup-web-users.mjs';
import {VideoStudioClient} from '../local/video-studio-client.mjs';
import {probeMediaUrl, formatDownloadUrl, createBufferPost, getBufferPost} from '../local/buffer.mjs';
import {DatabaseSync} from 'node:sqlite';
import {ensureWebSchema} from '../cloud/web-store.mjs';
import {createPublicationIntent, claimPublicationChannels, updatePublicationChannelResult, getPollablePublicationChannels} from '../cloud/web-publications.mjs';

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
    sourcefile: 'test-publications-entry.mjs'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false
})).outputFiles[0].text;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'web-pubs-test-'));
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'web-pubs-test',
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

  t.after(async () => {
    await mf.dispose();
    await rm(directory, {recursive: true, force: true});
  });

  return {fetchApi, runnerClient};
}

test('P4 Unit: probeMediaUrl validates MP4, 200/206, and rejects HTML login/quota', async () => {
  // Test valid MP4 stream
  const mockValidFetch = async () => new Response(new Uint8Array(1024), {
    status: 206,
    headers: {'content-type': 'video/mp4', 'content-length': '1024'}
  });
  const res1 = await probeMediaUrl('https://example.com/video.mp4', {fetchImpl: mockValidFetch});
  assert.equal(res1.ok, true);
  assert.equal(res1.contentType, 'video/mp4');

  // Test HTML response (e.g. Drive cookie login page or quota exceeded)
  const mockHtmlFetch = async () => new Response('<html>Login to continue</html>', {
    status: 200,
    headers: {'content-type': 'text/html; charset=utf-8'}
  });
  const res2 = await probeMediaUrl('https://drive.google.com/uc?export=download&id=xxx', {fetchImpl: mockHtmlFetch});
  assert.equal(res2.ok, false);
  assert.match(res2.reason, /không trả về MP4/);

  // Test 404 Not Found
  const mock404Fetch = async () => new Response('Not found', {status: 404});
  const res3 = await probeMediaUrl('https://example.com/notfound.mp4', {fetchImpl: mock404Fetch});
  assert.equal(res3.ok, false);

  // Test download URL formatting
  assert.equal(formatDownloadUrl('abc123id', null), 'https://drive.google.com/uc?export=download&id=abc123id');
  assert.equal(formatDownloadUrl(null, 'https://drive.google.com/file/d/xyz987id/view'), 'https://drive.google.com/uc?export=download&id=xyz987id');
});

test('P4 E2E: Publication lifecycle, V001 protection, multi-channel state isolation and receipt polling', async t => {
  const {fetchApi, runnerClient} = await fixture(t);

  // 1. Log in as collaborator
  const login = await fetchApi('/api/web/login', {
    method: 'POST',
    body: {username: 'collaborator', password: COLLAB_PASS}
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  const csrfToken = login.body.csrfToken;
  const webHeaders = {Cookie: cookie, 'X-CSRF-Token': csrfToken};

  // 2. V001 is protected: cannot create publication intent
  const pubV001 = await fetchApi('/api/web/requests/V001/publications', {
    method: 'POST',
    headers: webHeaders,
    body: {
      channelIds: ['6a9a28c0065799be4684eacd'],
      publicationKey: 'pub-v001-test'
    }
  });
  assert.equal(pubV001.status, 400);
  assert.match(pubV001.body.error, /Không thể đăng lại bài lịch sử V001/);

  // 3. Create a new request (V002)
  const reqRes = await fetchApi('/api/web/requests', {
    method: 'POST',
    headers: webHeaders,
    body: {
      title: 'Video du lịch Hà Giang',
      script: 'Đèo Mã Pí Lèng hùng vĩ với dòng sông Nho Quế xanh biếc...',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'client-key-v002'
    }
  });
  assert.equal(reqRes.status, 201);
  const v002Id = reqRes.body.request.id;

  // 4. Try to publish before production completes (state = waiting)
  const prematurePub = await fetchApi(`/api/web/requests/${v002Id}/publications`, {
    method: 'POST',
    headers: webHeaders,
    body: {
      channelIds: ['6a9a28c0065799be4684eacd'],
      publicationKey: 'pub-premature'
    }
  });
  assert.equal(prematurePub.status, 400);
  assert.match(prematurePub.body.error, /Chỉ có thể tạo đợt đăng khi video đã hoàn tất/);

  // 5. Runner claims V002 and completes production
  const claimRes = await runnerClient.claimRequest(v002Id);
  assert.ok(claimRes.leaseToken);
  assert.ok(claimRes.expiresAt > Date.now());
  await runnerClient.sendResult(v002Id, claimRes.leaseToken, {
    driveId: 'drive-file-abc',
    driveUrl: 'https://drive.google.com/file/d/drive-file-abc/view',
    caption: 'Hà Giang mùa hoa tam giác mạch #hagiang #dulich',
    hashtags: '#vietnam'
  });

  // Verify V002 is now in 'review' state
  const detailRes = await fetchApi(`/api/web/requests/${v002Id}`, {headers: webHeaders});
  assert.equal(detailRes.body.request.production_state, 'review');

  // 6. Web submits publication intent for 3 channels (YouTube, TikTok, Facebook)
  const channels = [
    '6a9a28c0065799be4684eacd', // YouTube
    '6a985593065799be4674eed4', // TikTok
    '6a985567065799be4674ee3b'  // Facebook
  ];
  const pubIntent = await fetchApi(`/api/web/requests/${v002Id}/publications`, {
    method: 'POST',
    headers: webHeaders,
    body: {
      channelIds: channels,
      publicationKey: 'pub-key-v002-rev1',
      expectedReviewRevision: 1,
      scheduledAtBangkok: '2026-10-06 18:00'
    }
  });
  assert.equal(pubIntent.status, 201);
  assert.equal(pubIntent.body.duplicate, false);
  assert.equal(pubIntent.body.channels.length, 3);
  const pubId = pubIntent.body.publication.id;

  // 7. Test deduplication: identical publicationKey returns 200 duplicate: true
  const dupIntent = await fetchApi(`/api/web/requests/${v002Id}/publications`, {
    method: 'POST',
    headers: webHeaders,
    body: {
      channelIds: channels,
      publicationKey: 'pub-key-v002-rev1'
    }
  });
  assert.equal(dupIntent.status, 200);
  assert.equal(dupIntent.body.duplicate, true);

  // 8. Runner claims ready publication channels
  const claimedChannels = [];
  for (let index = 0; index < 3; index++) claimedChannels.push(...await runnerClient.claimPublicationChannels(5));
  claimedChannels.sort((a, b) => channels.indexOf(a.channel_id) - channels.indexOf(b.channel_id));
  assert.equal(claimedChannels.length, 3);
  assert.equal(claimedChannels[0].snapshot.title, 'Video du lịch Hà Giang');
  assert.equal(claimedChannels[0].snapshot.driveId, 'drive-file-abc');

  // 9. Simulate independent multi-channel outcomes:
  // - Channel 0 (YouTube): Success -> 'accepted' with bufferId
  await runnerClient.sendPublicationResult({
    publicationId: pubId,
    channelId: claimedChannels[0].channel_id,
    bufferId: 'buf-post-yt-123',
    bufferStatus: 'sent',
    externalLink: 'https://youtube.com/shorts/sample123',
    state: 'sent'
  });

  // - Channel 1 (TikTok): Validation rejection -> 'failed_confirmed'
  await runnerClient.sendPublicationResult({
    publicationId: pubId,
    channelId: claimedChannels[1].channel_id,
    errorCode: 'Buffer API trả mã lỗi 429',
    state: 'failed_confirmed'
  });

  // - Channel 2 (Facebook): Network timeout -> 'needs_review' (no auto duplicate retry)
  await runnerClient.sendPublicationResult({
    publicationId: pubId,
    channelId: claimedChannels[2].channel_id,
    errorCode: 'Connection timeout after 15s to Buffer API',
    state: 'needs_review'
  });

  // 10. Check detail endpoint: all 3 receipts are preserved independently
  const updatedDetail = await fetchApi(`/api/web/requests/${v002Id}`, {headers: webHeaders});
  const receipts = updatedDetail.body.publications;
  assert.equal(receipts.length, 3);

  const ytReceipt = receipts.find(r => r.channel_id === channels[0]);
  assert.equal(ytReceipt.channel_state, 'sent');
  assert.equal(ytReceipt.buffer_id, 'buf-post-yt-123');

  const ttReceipt = receipts.find(r => r.channel_id === channels[1]);
  assert.equal(ttReceipt.channel_state, 'failed_confirmed');
  assert.match(ttReceipt.error_code, /429/);

  const fbReceipt = receipts.find(r => r.channel_id === channels[2]);
  assert.equal(fbReceipt.channel_state, 'needs_review');
  assert.match(fbReceipt.error_code, /timeout/);

  // 11. Pollable channels query: only 'accepted' channel is returned for polling
  const pollable = await runnerClient.getPollablePublicationChannels(10);
  assert.equal(pollable.length, 0);

  // 12. Simulate polling outcome: Buffer published YouTube post!

  // Verify YouTube is now 'sent' with externalLink
  const finalDetail = await fetchApi(`/api/web/requests/${v002Id}`, {headers: webHeaders});
  const finalYt = finalDetail.body.publications.find(r => r.channel_id === channels[0]);
  assert.equal(finalYt.channel_state, 'sent');
  assert.equal(finalYt.external_link, 'https://youtube.com/shorts/sample123');

  // The retry button must affect only explicitly selected, safe channels.
  const retryPath = `/api/web/requests/${v002Id}/publications/retry`;
  const missingSelection = await fetchApi(retryPath, {method: 'POST', headers: webHeaders, body: {}});
  assert.equal(missingSelection.status, 400);

  const unsafeSelection = await fetchApi(retryPath, {
    method: 'POST', headers: webHeaders, body: {channelIds: [channels[0], channels[1]]}
  });
  assert.equal(unsafeSelection.status, 409);

  const ambiguousSelection = await fetchApi(retryPath, {
    method: 'POST', headers: webHeaders, body: {channelIds: [channels[2]]}
  });
  assert.equal(ambiguousSelection.status, 409);

  const selectedRetry = await fetchApi(retryPath, {
    method: 'POST', headers: webHeaders, body: {channelIds: [channels[1]]}
  });
  assert.equal(selectedRetry.status, 200);
  assert.deepEqual(selectedRetry.body.channelIds, [channels[1]]);
  const afterRetry = await fetchApi(`/api/web/requests/${v002Id}`, {headers: webHeaders});
  const byChannel = Object.fromEntries(afterRetry.body.publications.map(r => [r.channel_id, r]));
  assert.equal(byChannel[channels[0]].channel_state, 'sent');
  assert.equal(byChannel[channels[1]].channel_state, 'ready');
  assert.equal(byChannel[channels[2]].channel_state, 'needs_review');
});

function memorySql(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = {exec(query, ...params) {
    const statement = db.prepare(query);
    if (statement.columns().length) return {toArray: () => statement.all(...params)};
    statement.run(...params);
    return {toArray: () => []};
  }};
  ensureWebSchema(sql);
  sql.exec("UPDATE web_requests SET is_legacy=0, production_state='review', display_id='V002' WHERE id='v001-legacy-import'");
  return sql;
}

test('publication claims one channel, fences workers, bounds polls and never retries expired ambiguous sends', t => {
  const sql = memorySql(t);
  let now = 2000000000000;
  const realNow = Date.now;
  Date.now = () => now;
  t.after(() => {Date.now = realNow;});
  const ids = ['6a9a28c0065799be4684eacd', '6ac376a86a5c39ccb61d85e4'];
  const pub = createPublicationIntent(sql, 'V002', {username: 'owner'}, {publicationKey: 'safe-key', channelIds: ids, expectedReviewRevision: 1});
  assert.throws(() => createPublicationIntent(sql, 'V002', {username: 'owner'}, {publicationKey: 'different-key', channelIds: ids, expectedReviewRevision: 1}), /đã có đợt đăng/);
  const claim = claimPublicationChannels(sql, 'pc-1', 20);
  assert.equal(claim.length, 1);
  const channel = claim[0];
  const payload = {publicationId: pub.publication.id, channelId: channel.channel_id, workerId: 'pc-1', fenceEpoch: channel.fence_epoch, bufferId: 'buf-1', state: 'accepted'};
  assert.throws(() => updatePublicationChannelResult(sql, {...payload, workerId: 'pc-2'}), /không thuộc/);
  updatePublicationChannelResult(sql, payload);
  assert.equal(getPollablePublicationChannels(sql, 10, 'pc-1').length, 0);
  now += 3600001;
  const polls = getPollablePublicationChannels(sql, 10, 'pc-1');
  assert.equal(polls.length, 1);
  assert.equal(getPollablePublicationChannels(sql, 10, 'pc-2').length, 0);
  assert.throws(() => updatePublicationChannelResult(sql, payload), /không thuộc/);
  updatePublicationChannelResult(sql, {...payload, fenceEpoch: polls[0].fence_epoch});
  now += 3600001;
  assert.equal(getPollablePublicationChannels(sql, 10, 'pc-1').length, 0); // second poll is two hours away
  const other = claimPublicationChannels(sql, 'pc-1')[0];
  now += 300001;
  assert.equal(claimPublicationChannels(sql, 'pc-2').length, 0);
  assert.equal(sql.exec('SELECT state FROM web_publication_channels WHERE channel_id=?', other.channel_id).toArray()[0].state, 'needs_review');
  assert.throws(() => updatePublicationChannelResult(sql, {publicationId: pub.publication.id, channelId: other.channel_id, workerId: 'pc-1', fenceEpoch: other.fence_epoch, state: 'ready', errorCode: '429'}), /kết thúc/);
});
