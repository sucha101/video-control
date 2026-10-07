import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, Response as MFResponse, convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {QueueClient} from '../local/queue-client.mjs';
import {Runner} from '../local/runner.mjs';

const secrets = {
  ZALO_WEBHOOK_SECRET: 'e2e-webhook-secret',
  RUNNER_TOKEN: 'e2e-runner-token',
  PAIR_CODE: 'e2e-pair-code',
  ZALO_BOT_TOKEN: 'e2e-bot-token'
};

const bundle = (await build({
  stdin: {
    contents: `
      import worker from './cloud/worker.mjs';
      import {VideoQueue} from './cloud/queue.mjs';
      export default worker;
      export {VideoQueue};
    `,
    resolveDir: path.resolve('.'),
    sourcefile: 'e2e-entry.mjs'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false
})).outputFiles[0].text;

test('E2E: offline command backlog processed by local runner on startup', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zalo-e2e-'));
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'e2e-test',
    modules: true,
    script: bundle,
    compatibilityDate: '2026-09-01',
    resourcePersistencePath: directory,
    durableObjects: {VIDEO_QUEUE: {className: 'VideoQueue', useSQLite: true}},
    bindings: secrets,
    outboundService: async request => {
      return MFResponse.json({ok: true});
    }
  }));
  await mf.ready;

  t.after(async () => {
    await mf.dispose();
    await rm(directory, {recursive: true, force: true});
  });

  const sendWebhook = async (text, msgId) => {
    const res = await mf.dispatchFetch('https://queue/zalo/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Api-Secret-Token': secrets.ZALO_WEBHOOK_SECRET
      },
      body: JSON.stringify({
        ok: true,
        result: {
          event_name: 'message.text.received',
          message: {
            from: {id: 'user-e2e', is_bot: false},
            chat: {id: 'chat-e2e', chat_type: 'PRIVATE'},
            text,
            message_id: msgId,
            date: Date.now()
          }
        }
      })
    });
    return res.json();
  };

  // 1. Pair owner
  const pairRes = await sendWebhook('/pair e2e-pair-code', 'm1');
  assert.equal(pairRes.ok, true);

  // 2. User sends command while PC is offline
  const runRes = await sendWebhook('/run V001', 'm2');
  assert.equal(runRes.ok, true);

  // 3. Verify job is queued in cloud
  const listRes = await mf.dispatchFetch('https://queue/api/jobs', {
    headers: {Authorization: `Bearer ${secrets.RUNNER_TOKEN}`}
  });
  const listBody = await listRes.json();
  assert.equal(listBody.jobs.length, 1);
  assert.equal(listBody.jobs[0].status, 'queued');
  assert.equal(listBody.jobs[0].type, 'produce');
  assert.equal(listBody.jobs[0].payload.videoId, 'V001');

  // 4. Local Runner comes online
  const mockFetch = (url, opts) => mf.dispatchFetch(url, opts);
  const queueClient = new QueueClient({
    cloudUrl: 'https://queue',
    secrets: {runnerToken: secrets.RUNNER_TOKEN},
    workerId: 'test-pc',
    fetchImpl: mockFetch
  });

  const mockRows = [
    ['V001', 'Tiêu đề E2E', 'Kịch bản câu chuyện', 'viet-tiktok-story-video', 'ổn', 'Chờ tạo', '', '', '', '', '', '', 'Chỉ tạo video', '', '', '']
  ];

  const mockSheets = {
    readRows: async () => JSON.parse(JSON.stringify(mockRows)),
    updateRow: async (idx, vals) => { mockRows[idx] = vals; },
    appendRow: async (vals) => { mockRows.push(vals); }
  };

  const mockDrive = {
    uploadResumable: async () => ({
      id: 'drive_file_e2e_123',
      name: 'V001.mp4',
      driveUrl: 'https://drive.google.com/file/d/drive_file_e2e_123/view'
    })
  };

  const jobRoot = await mkdtemp(path.join(tmpdir(), 'zalo-jobs-'));
  t.after(async () => {
    await rm(jobRoot, {recursive: true, force: true});
  });

  const runner = new Runner({
    config: {
      sheetId: 'sheet-e2e',
      sheetTab: 'Trang tính1',
      driveFolderId: 'drive-folder-e2e',
      jobRoot,
      heartbeatMs: 60000,
      skills: {'viet-tiktok-story-video': 'C:/fake/skill.md'}
    },
    queueClient,
    sheetsClient: mockSheets,
    driveClient: mockDrive
  });

  // Runner claims and executes job
  const claimedJob = await queueClient.claim();
  assert.ok(claimedJob);
  assert.equal(claimedJob.payload.videoId, 'V001');

  await runner.executeJob(claimedJob);

  // Missing local Gemini credentials should leave this request in review with a clear setup instruction.
  assert.equal(mockRows[0][5], 'Cần kiểm tra');
  assert.ok(mockRows[0][15].includes('Gemini API key'));

  // Verify cloud job status is needs_review
  const checkRes = await mf.dispatchFetch('https://queue/api/jobs', {
    headers: {Authorization: `Bearer ${secrets.RUNNER_TOKEN}`}
  });
  const checkBody = await checkRes.json();
  assert.equal(checkBody.jobs[0].status, 'needs_review');
});
