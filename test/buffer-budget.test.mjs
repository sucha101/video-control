import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BufferBudget, BufferRateLimitError, parseBufferHeaders} from '../local/buffer-budget.mjs';
import {createBufferPost, getBufferPost} from '../local/buffer.mjs';

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'buffer-budget-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return new BufferBudget({file: path.join(directory, 'ledger.json'), ...overrides});
}

test('parses joined policies with spaces, daily/monthly windows and HTTP-date Retry-After', () => {
  const now = Date.parse('2026-10-05T00:00:00Z');
  const parsed = parseBufferHeaders(new Headers({
    RateLimit: '"100-in-15min"; r=98; t=897, "250-in-1day";r=0;t=86397, "3000-in-30days"; r=0; t=696980',
    'Retry-After': 'Mon, 05 Oct 2026 00:01:00 GMT'
  }), now);
  assert.equal(parsed.policies.length, 3);
  assert.equal(parsed.policies[2].resetAt, now + 696980000);
  assert.equal(parsed.retryAt, now + 60000);
});

test('429 persists longest exhausted cooldown across a new process instance; no network while blocked', async t => {
  const now = 1800000000000;
  const budget = await fixture(t, {now: () => now});
  let calls = 0;
  await assert.rejects(budget.request('write', async () => {
    calls++;
    return new Response('{}', {status: 429, headers: {'Retry-After': '60', RateLimit: '"250-in-1day"; r=0; t=86400, "3000-in-30days"; r=0; t=2592000'}});
  }), err => err instanceof BufferRateLimitError && err.retryAt === now + 2592000000);
  const restarted = new BufferBudget({file: budget.file, now: () => now + 600000});
  await assert.rejects(restarted.request('write', async () => { calls++; }), BufferRateLimitError);
  assert.equal(calls, 1);
});

test('automated read cap leaves writes available and survives restart', async t => {
  const now = 1800000000000;
  const budget = await fixture(t, {now: () => now, maxReadsPerDay: 1});
  await budget.request('read', async () => new Response('{}'));
  const restarted = new BufferBudget({file: budget.file, now: () => now, maxReadsPerDay: 1});
  await assert.rejects(restarted.request('read', async () => {throw new Error('must not fetch');}), BufferRateLimitError);
  await restarted.request('write', async () => new Response('{}'));
});

test('server low quota reserves reads for actual posting; zero on successful response blocks writes', async t => {
  const now = 1800000000000;
  const budget = await fixture(t, {now: () => now});
  await budget.request('read', async () => new Response('{}', {headers: {RateLimit: '"250-in-1day"; r=10; t=600'}}));
  await assert.rejects(budget.request('read', async () => {throw new Error('must not fetch');}), BufferRateLimitError);
  await budget.request('write', async () => new Response('{}', {headers: {RateLimit: '"250-in-1day"; r=0; t=500'}}));
  await assert.rejects(budget.request('write', async () => {throw new Error('must not fetch');}), BufferRateLimitError);
});

test('read and mutation adapters use the same gate and cannot call fetch after cooldown', async t => {
  const budget = await fixture(t);
  await budget.request('read', async () => new Response('{}', {headers: {RateLimit: '"250-in-1day";r=0;t=86400'}}));
  const fetchImpl = async () => {throw new Error('network must not run');};
  await assert.rejects(getBufferPost({apiKey: 'offline-test', postId: 'post', budget, fetchImpl}), BufferRateLimitError);
  await assert.rejects(createBufferPost({apiKey: 'offline-test', channel: {id: 'channel'}, input: {mediaUrl: 'https://example.test/video.mp4'}, budget, fetchImpl}), BufferRateLimitError);
});

test('concurrent instances serialize reservation so quota cannot be overspent', async t => {
  const now = 1800000000000;
  const budget = await fixture(t, {now: () => now, maxRequestsPerDay: 1});
  const other = new BufferBudget({file: budget.file, now: () => now, maxRequestsPerDay: 1});
  let calls = 0;
  const results = await Promise.allSettled([budget, other].map(instance => instance.request('write', async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 20)); return new Response('{}');
  })));
  assert.equal(calls, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});

test('local rolling monthly cap and manually seeded cooldown survive restart', async t => {
  let now = 1800000000000;
  const budget = await fixture(t, {now: () => now, maxRequestsPerMonth: 1});
  await budget.request('write', async () => new Response('{}'));
  now += 2 * 86400000;
  await assert.rejects(budget.request('write', async () => {throw new Error('must not fetch');}), BufferRateLimitError);
  const later = now + 31 * 86400000;
  await budget.deferUntil(later);
  const restarted = new BufferBudget({file: budget.file, now: () => now});
  assert.equal(await restarted.cooldown('write'), later);
});
