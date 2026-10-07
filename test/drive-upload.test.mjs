import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {GoogleDriveClient} from '../local/google.mjs';
import {Runner} from '../local/runner.mjs';

const upload = await import('../local/drive-upload.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const {mediaIdentity, resumeDriveUpload} = upload;
const sessionUri = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=private-test-session';
const chunkSize = 8 * 1024 * 1024;
const json = data => Response.json(data);
const incomplete = range => new Response(null, {status: 308, headers: range === undefined ? {} : {Range: range}});
const file = {id: 'existing-file', name: 'fixture.mp4'};
const shared = () => json({permissions: [{type: 'anyone', role: 'reader'}]});

async function fixture(t, size = 37) {
  const root = await mkdtemp(path.join(tmpdir(), 'drive-recovery-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const filePath = path.join(root, 'fixture.mp4');
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  await writeFile(filePath, bytes);
  return {root, filePath, bytes};
}

function scripted(steps) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, options = {}) => {
      const request = {url: String(url), ...options};
      requests.push(request);
      if (options.body?.[Symbol.asyncIterator]) {
        const parts = [];
        for await (const part of options.body) parts.push(part);
        request.bytes = Buffer.concat(parts);
      }
      assert.ok(steps.length, `Unexpected request: ${options.method || 'GET'}`);
      const step = steps.shift();
      return typeof step === 'function' ? step(request) : step;
    }
  };
}

async function args(t, steps, size, extra = {}) {
  const fixtureData = await fixture(t, size);
  const fake = scripted(steps);
  const saves = [];
  return {...fixtureData, ...fake, saves, args: {
    filePath: fixtureData.filePath, fileName: file.name, folderId: 'test-folder',
    requestId: 'fixture-request', inputRevision: 'same-script', checkpoint: {},
    getAccessToken: async () => 'fake-token', fetchImpl: fake.fetchImpl,
    persistCheckpoint: async state => saves.push(structuredClone(state)), ...extra
  }};
}

async function active(f, extra = {}) {
  const identity = await mediaIdentity(f.filePath);
  Object.assign(f.args.checkpoint, {
    schemaVersion: 1, requestId: 'fixture-request', inputRevision: 'same-script',
    mediaSha256: identity.sha256, byteLength: identity.byteLength,
    phase: 'uploading', sessionUri, committedOffset: 0, ...extra
  });
}

test('exports streamed identity and resumable recovery helpers', () => {
  assert.equal(typeof mediaIdentity, 'function');
  assert.equal(typeof resumeDriveUpload, 'function');
});

test('streamed SHA-256 binds the byte length and rejects a file changed while hashing', async t => {
  const f = await fixture(t);
  const identity = await mediaIdentity(f.filePath);
  assert.equal(identity.sha256, crypto.createHash('sha256').update(f.bytes).digest('hex'));
  assert.equal(identity.byteLength, f.bytes.length);
  let statCount = 0;
  await assert.rejects(mediaIdentity(f.filePath, {statImpl: async p => {
    if (++statCount === 2) await writeFile(p, Buffer.concat([f.bytes, Buffer.from('changed')]));
    return stat(p);
  }}), /changed|thay đổi/i);
});

test('known file ID is handled first without session initialization or probe', async t => {
  const f = await args(t, [json(file), shared()]);
  await active(f, {driveFileId: file.id, sessionUri: 'invalid-old-session'});
  const result = await resumeDriveUpload(f.args);
  assert.equal(result.id, file.id);
  assert.equal(f.requests.filter(r => r.url.includes('uploadType=resumable')).length, 0);
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 0);
  assert.equal(f.args.checkpoint.phase, 'shared');
});

test('missing known file stays in review and never creates a replacement', async t => {
  const f = await args(t, [new Response(null, {status: 404})]);
  await active(f, {driveFileId: file.id});
  await assert.rejects(resumeDriveUpload(f.args), /kiểm tra|review/i);
  assert.equal(f.args.checkpoint.driveFileId, file.id);
  assert.equal(f.args.checkpoint.needsReview, true);
  assert.equal(f.requests.length, 1);
});

test('probe offset resumes at the exact next byte using aligned 8 MiB chunks', async t => {
  const total = 2 * chunkSize + 17;
  const f = await args(t, [incomplete(`bytes=0-${chunkSize - 1}`), incomplete(`bytes=0-${2 * chunkSize - 1}`), json(file), shared()], total);
  await active(f, {committedOffset: 3});
  await resumeDriveUpload(f.args);
  assert.equal(f.requests[1].headers['Content-Range'], `bytes ${chunkSize}-${2 * chunkSize - 1}/${total}`);
  assert.equal(f.requests[1].bytes.length, chunkSize);
  assert.equal(f.requests[1].bytes.length % (256 * 1024), 0);
  assert.deepEqual(f.requests[1].bytes, f.bytes.subarray(chunkSize, 2 * chunkSize));
  assert.deepEqual(f.requests[2].bytes, f.bytes.subarray(2 * chunkSize));
  assert.equal(f.args.checkpoint.committedOffset, total);
});

test('lost final response is recovered by probe using the existing ID without another create', async t => {
  const f = await args(t, [incomplete(), () => {throw new Error(`network lost at ${sessionUri}`);}, json(file), shared()]);
  await active(f);
  await assert.rejects(resumeDriveUpload(f.args), error => !error.message.includes(sessionUri) && /retry|tiếp tục/i.test(error.message));
  assert.equal(f.args.checkpoint.sessionUri, sessionUri);
  const result = await resumeDriveUpload(f.args);
  assert.equal(result.id, file.id);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});

test('changed MP4 under the same script fingerprint is rejected before any PUT', async t => {
  const f = await args(t, []);
  await active(f, {inputFingerprint: 'same-script'});
  await writeFile(f.filePath, Buffer.alloc(f.bytes.length, 99));
  await assert.rejects(resumeDriveUpload(f.args), /checksum|thay đổi|hash/i);
  assert.equal(f.requests.length, 0);
  assert.equal(f.args.checkpoint.needsReview, true);
});

test('acknowledged changed bytes remain quarantined after original local bytes are restored', async t => {
  const f = await args(t, [], chunkSize + 17);
  await active(f);
  const requests = [];
  let changedChunkSent = false;
  f.args.fetchImpl = async (url, options = {}) => {
    const request = {url: String(url), ...options};
    requests.push(request);
    if (options.headers['Content-Range'] === `bytes */${f.bytes.length}`) {
      return incomplete(changedChunkSent ? `bytes=0-${chunkSize - 1}` : undefined);
    }
    if (options.body?.[Symbol.asyncIterator]) {
      if (!changedChunkSent) await writeFile(f.filePath, Buffer.alloc(f.bytes.length, 99));
      const parts = [];
      for await (const bytes of options.body) parts.push(bytes);
      request.bytes = Buffer.concat(parts);
      if (!changedChunkSent) {
        assert.deepEqual(request.bytes, Buffer.alloc(chunkSize, 99));
        changedChunkSent = true;
        return incomplete(`bytes=0-${chunkSize - 1}`);
      }
      return json(file);
    }
    return shared();
  };
  await assert.rejects(resumeDriveUpload(f.args), /thay đổi/);
  assert.equal(f.args.checkpoint.committedOffset, chunkSize);
  assert.equal(f.args.checkpoint.needsReview, true);
  await writeFile(f.filePath, f.bytes);
  // Reload the durable checkpoint to exercise recovery across a process restart.
  f.args.checkpoint = structuredClone(f.saves.at(-1));
  const requestCount = requests.length;
  await assert.rejects(resumeDriveUpload(f.args), /quarantine|toàn vẹn|kiểm tra/i);
  assert.equal(requests.length, requestCount, 'retry must not probe, upload, or change permissions');
  assert.equal(f.args.checkpoint.needsReview, true);
  assert.ok(f.args.checkpoint.integrityQuarantine);
});

for (const evidence of ['missing-checksum', 'wrong-checksum', 'wrong-length']) {
  test(`known file integrity quarantine is retained with ${evidence} metadata`, async t => {
    const f = await args(t, []);
    await active(f, {driveFileId: file.id, needsReview: true});
    const intended = {mediaSha256: f.args.checkpoint.mediaSha256, byteLength: f.bytes.length};
    f.args.checkpoint.integrityQuarantine = {...intended, detectedAt: '2026-10-05T00:00:00.000Z'};
    const remote = {...file, size: String(f.bytes.length), sha256Checksum: intended.mediaSha256};
    if (evidence === 'missing-checksum') delete remote.sha256Checksum;
    if (evidence === 'wrong-checksum') remote.sha256Checksum = '0'.repeat(64);
    if (evidence === 'wrong-length') remote.size = String(f.bytes.length + 1);
    const fake = scripted([json(remote), shared()]);
    f.args.fetchImpl = fake.fetchImpl;
    await assert.rejects(resumeDriveUpload(f.args), /quarantine|toàn vẹn|kiểm tra/i);
    assert.equal(fake.requests.length, 1, 'unproven file must not reach permissions');
    assert.deepEqual(f.args.checkpoint.integrityQuarantine, {...intended, detectedAt: '2026-10-05T00:00:00.000Z'});
    assert.equal(f.args.checkpoint.needsReview, true);
  });
}

test('matching completed Drive checksum and size can release integrity quarantine', async t => {
  const f = await args(t, []);
  await active(f, {driveFileId: file.id, needsReview: true});
  const intended = {mediaSha256: f.args.checkpoint.mediaSha256, byteLength: f.bytes.length};
  f.args.checkpoint.integrityQuarantine = {...intended, detectedAt: '2026-10-05T00:00:00.000Z'};
  const fake = scripted([json({...file, sha256Checksum: intended.mediaSha256, size: String(intended.byteLength)}), shared()]);
  f.args.fetchImpl = fake.fetchImpl;
  assert.equal((await resumeDriveUpload(f.args)).id, file.id);
  assert.equal(f.args.checkpoint.integrityQuarantine, null);
  assert.equal(f.args.checkpoint.needsReview, false);
  assert.equal(f.args.checkpoint.phase, 'shared');
  assert.equal(fake.requests.filter(r => r.method === 'PUT' || r.method === 'POST').length, 0);
});

test('legacy script fingerprint alone cannot authorize resuming bytes', async t => {
  const f = await args(t, []);
  Object.assign(f.args.checkpoint, {sessionUri, inputFingerprint: 'same-script', fileSize: f.bytes.length});
  await assert.rejects(resumeDriveUpload(f.args), /kiểm tra|review/i);
  assert.equal(f.requests.length, 0);
  assert.equal(f.args.checkpoint.mediaSha256, undefined);
});

test('legacy file ID can use matching remote checksum as migration evidence', async t => {
  const f = await args(t, []);
  Object.assign(f.args.checkpoint, {driveFileId: file.id, inputFingerprint: 'same-script'});
  const fake = scripted([json({...file, size: String(f.bytes.length), sha256Checksum: crypto.createHash('sha256').update(f.bytes).digest('hex')}), shared()]);
  f.args.fetchImpl = fake.fetchImpl;
  await resumeDriveUpload(f.args);
  assert.equal(f.args.checkpoint.schemaVersion, 1);
  assert.equal(f.args.checkpoint.mediaSha256.length, 64);
  assert.equal(fake.requests.length, 2);
});

test('absent probe Range means zero confirmed bytes', async t => {
  const f = await args(t, [incomplete(), json(file), shared()]);
  await active(f, {committedOffset: 12});
  await resumeDriveUpload(f.args);
  assert.equal(f.requests[1].headers['Content-Range'], `bytes 0-${f.bytes.length - 1}/${f.bytes.length}`);
});

for (const range of ['garbage', 'bytes=7-10', 'bytes=0-999', 'bytes=0-9007199254740992']) {
  test(`invalid probe Range ${range} refuses sending bytes`, async t => {
    const f = await args(t, [incomplete(range)]);
    await active(f);
    await assert.rejects(resumeDriveUpload(f.args), /offset|Range/i);
    assert.equal(f.requests.length, 1);
  });
}

test('chunk 308 confirming all bytes probes again to obtain file metadata', async t => {
  const f = await args(t, [incomplete(), incomplete('bytes=0-36'), json(file), shared()]);
  await active(f);
  assert.equal((await resumeDriveUpload(f.args)).id, file.id);
  assert.equal(f.requests[2].headers['Content-Range'], 'bytes */37');
});

test('absent chunk Range cannot loop or assume successful completion', async t => {
  const f = await args(t, [incomplete(), incomplete()]);
  await active(f);
  await assert.rejects(resumeDriveUpload(f.args), /offset|confirmed|xác nhận/i);
  assert.equal(f.requests.length, 2);
  assert.equal(f.args.checkpoint.driveFileId, undefined);
});

for (const status of [404, 410, 503]) {
  test(`session ${status} preserves identity and never starts a new session`, async t => {
    const f = await args(t, [new Response(null, {status})]);
    await active(f);
    await assert.rejects(resumeDriveUpload(f.args));
    assert.equal(f.args.checkpoint.sessionUri, sessionUri);
    assert.equal(f.args.checkpoint.needsReview, status !== 503);
    assert.equal(f.requests.length, 1);
  });
}

test('permission response lost after creation retries by listing without duplication', async t => {
  const f = await args(t, [incomplete(), json(file), json({permissions: []}), () => {throw new Error('permission response lost');}, json(file), shared()]);
  await active(f);
  await assert.rejects(resumeDriveUpload(f.args));
  assert.equal(f.args.checkpoint.driveFileId, file.id);
  assert.equal(f.args.checkpoint.phase, 'uploaded');
  assert.equal((await resumeDriveUpload(f.args)).id, file.id);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('paginated permission lookup preserves an existing public reader', async t => {
  const f = await args(t, [json(file), json({permissions: [], nextPageToken: 'page2'}), shared()]);
  await active(f, {driveFileId: file.id});
  await resumeDriveUpload(f.args);
  assert.ok(f.requests[2].url.includes('pageToken=page2'));
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});

test('fresh upload persists media identity and session before sending a chunk', async t => {
  const f = await args(t, [new Response(null, {status: 200, headers: {Location: sessionUri}}), incomplete(), request => {
    assert.ok(f.saves.some(s => s.sessionUri === sessionUri && s.mediaSha256));
    assert.equal(request.headers['Content-Range'], 'bytes 0-36/37');
    return json(file);
  }, shared()]);
  let tokens = 0;
  f.args.getAccessToken = async () => `token-${++tokens}`;
  await resumeDriveUpload(f.args);
  assert.equal(f.args.checkpoint.schemaVersion, 1);
  assert.equal(f.args.checkpoint.requestId, 'fixture-request');
  assert.equal(f.args.checkpoint.inputRevision, 'same-script');
  assert.ok(f.saves.some(s => s.phase === 'uploaded' && s.driveFileId === file.id));
  assert.equal(tokens, f.requests.length);
});

test('fencing error prevents the next chunk and keeps the original error', async t => {
  const leaseError = new Error('lease lost');
  const f = await args(t, [incomplete(), incomplete(`bytes=0-${chunkSize - 1}`)], chunkSize + 17);
  await active(f);
  let checks = 0;
  f.args.fence = async () => {if (++checks === 2) throw leaseError;};
  await assert.rejects(resumeDriveUpload(f.args), error => error === leaseError);
  assert.equal(f.requests.length, 2);
});

test('fencing before permission mutation does not hide lease loss', async t => {
  const leaseError = new Error('lease lost while sharing');
  const f = await args(t, [json(file), json({permissions: []})]);
  await active(f, {driveFileId: file.id});
  f.args.fence = async () => {throw leaseError;};
  await assert.rejects(resumeDriveUpload(f.args), error => error === leaseError);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});

test('cancellation after first chunk prevents the next chunk', async t => {
  const controller = new AbortController();
  const f = await args(t, [incomplete(), () => {
    controller.abort(new Error('job cancelled'));
    return incomplete(`bytes=0-${chunkSize - 1}`);
  }], chunkSize + 17, {signal: controller.signal});
  await active(f);
  await assert.rejects(resumeDriveUpload(f.args), /job cancelled/);
  assert.equal(f.requests.length, 2);
});

test('public Google adapter delegates checkpoint persistence without changing legacy callbacks', async t => {
  const f = await fixture(t);
  const credentialsPath = path.join(f.root, 'fake-credentials.json');
  await writeFile(credentialsPath, JSON.stringify({type: 'authorized_user', access_token: 'fake-token', expiry_date: Date.now() + 3600000}));
  const fake = scripted([new Response(null, {headers: {Location: sessionUri}}), incomplete(), json(file), shared()]);
  const client = new GoogleDriveClient({folderId: 'fixture-folder', credentialsPath, fetchImpl: fake.fetchImpl});
  const checkpoint = {};
  const sessions = [], progress = [], saved = [];
  const result = await client.uploadResumable({filePath: f.filePath, checkpoint,
    onSessionCreated: async uri => sessions.push(uri),
    onProgress: async value => progress.push(value),
    persistCheckpoint: async value => saved.push(structuredClone(value))});
  assert.equal(result.id, file.id);
  assert.deepEqual(sessions, [sessionUri]);
  assert.ok(progress.some(p => p.driveFileId === file.id));
  assert.equal(checkpoint.phase, 'shared');
  assert.ok(saved.some(s => s.mediaSha256 && !s.sessionUri));
});

test('runner upload integration saves private media checkpoint and threads fencing and cancellation', async t => {
  const f = await fixture(t);
  let heartbeatCalls = 0;
  const runner = new Runner({config: {jobRoot: f.root},
    queueClient: {heartbeat: async () => {heartbeatCalls++; return {}; }}, sheetsClient: {},
    driveClient: {uploadResumable: async options => {
      assert.equal(options.signal, runner.abortController.signal);
      await options.fence();
      await options.persistCheckpoint({schemaVersion: 1, requestId: 'V999', inputRevision: 'script-revision', mediaSha256: 'fixture-hash', byteLength: 37, phase: 'uploaded', driveFileId: file.id});
      return {...file, driveUrl: `https://drive.google.com/file/d/${file.id}/view`};
    }}});
  runner.abortController = new AbortController();
  const result = await runner.uploadDriveMedia({job: {id: 'job'}, jobDir: f.root, videoId: 'V999', inputRevision: 'script-revision', filePath: f.filePath, fileName: file.name});
  assert.equal(result.id, file.id);
  const checkpoint = JSON.parse(await readFile(path.join(f.root, 'drive-upload.json'), 'utf8'));
  assert.equal(checkpoint.mediaSha256, 'fixture-hash');
  assert.ok(heartbeatCalls > 0);
});
