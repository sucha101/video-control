import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runStudioPublicationCycle} from '../local/studio-publisher.mjs';
import {runStudioSync} from '../local/studio-sync.mjs';

test('Buffer success survives lost cloud receipt; retry does not create twice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-delivery-'));
  let calls = 0, results = 0;
  const config = {channels: [{id: 'channel', service: 'tiktok'}], secrets: {bufferApiKey: 'test'}};
  const studio = {claimPublicationChannels: async () => [{publication_id: 'pub', channel_id: 'channel', snapshot: {driveId: 'drive'}}],
    sendPublicationResult: async result => { results++; assert.equal(result.bufferId, 'post'); if (results === 1) throw new Error('lost cloud response'); },
    getPollablePublicationChannels: async () => []};
  const args = {root, config, studio, cooldown: async () => 0, probe: async () => ({ok: true}), create: async () => {calls++; return {id: 'post', status: 'pending'};}};
  try {
    await assert.rejects(runStudioPublicationCycle(args), /lost cloud/);
    await runStudioPublicationCycle(args);
    assert.equal(calls, 1);
    assert.equal(results, 2);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('Buffer acceptance sends one Zalo confirmation after the cloud receipt is saved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-zalo-receipt-'));
  let creates = 0, results = 0;
  const messages = [];
  const item = {publication_id: 'pub', channel_id: 'channel',
    snapshot: {title: 'Bẫy người tốt', driveId: 'drive', scheduledAtBangkok: '2026-10-06T18:30'}};
  const config = {channels: [{id: 'channel', service: 'youtube', name: 'YouTube Shorts'}], secrets: {bufferApiKey: 'test'}};
  const studio = {
    claimPublicationChannels: async () => [item],
    sendPublicationResult: async () => { results++; if (results === 1) throw new Error('lost cloud response'); },
    getPollablePublicationChannels: async () => []
  };
  const args = {root, config, studio, cooldown: async () => 0, probe: async () => ({ok: true}),
    create: async () => { creates++; return {id: 'post', status: 'scheduled'}; },
    notify: async message => { messages.push(message); return true; }};
  try {
    await assert.rejects(runStudioPublicationCycle(args), /lost cloud/);
    assert.deepEqual(messages, []);
    await runStudioPublicationCycle(args);
    await runStudioPublicationCycle(args);
    assert.equal(creates, 1);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Buffer đã nhận/);
    assert.match(messages[0], /Bẫy người tốt/);
    assert.match(messages[0], /YouTube Shorts/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('failed Zalo delivery is retried without recreating the Buffer post', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-zalo-retry-'));
  let creates = 0, attempts = 0, claims = 0;
  const item = {publication_id: 'pub', channel_id: 'channel',
    snapshot: {title: 'Bẫy người tốt', driveId: 'drive'}};
  const config = {channels: [{id: 'channel', service: 'youtube', name: 'YouTube Shorts'}], secrets: {bufferApiKey: 'test'}};
  const studio = {
    claimPublicationChannels: async () => ++claims === 1 ? [item] : [],
    sendPublicationResult: async () => {},
    getPollablePublicationChannels: async () => []
  };
  const args = {root, config, studio, cooldown: async () => 0, probe: async () => ({ok: true}),
    create: async () => { creates++; return {id: 'post', status: 'scheduled'}; },
    notify: async () => ++attempts > 1};
  try {
    await runStudioPublicationCycle(args);
    await runStudioPublicationCycle(args);
    assert.equal(creates, 1);
    assert.equal(attempts, 2);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('known cooldown does not even claim publication work', async () => {
  let claimed = 0;
  const result = await runStudioPublicationCycle({config: {secrets: {bufferApiKey: 'test'}},
    studio: {claimPublicationChannels: async () => {claimed++;}}, cooldown: async () => 12345});
  assert.equal(claimed, 0); assert.equal(result.nextCheckAt, 12345);
});

test('sync reads once and retains missing rows and unknown events for retry', async () => {
  let reads = 0, receipt;
  await runStudioSync({config: {}, studio: {
    claimSyncOutbox: async () => [{id: 'missing', kind: 'production_completed', payload: '{"displayId":"V002"}'},
      {id: 'unknown', kind: 'other', payload: '{"displayId":"V001"}'}],
    completeSyncOutbox: async result => {receipt = result;}
  }, sheets: {readRows: async () => {reads++; return [['V001']];}}});
  assert.equal(reads, 1);
  assert.deepEqual(receipt.completedIds, []);
  assert.deepEqual(receipt.failedIds, ['missing', 'unknown']);
});
