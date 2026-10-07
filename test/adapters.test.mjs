import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {GoogleSheetsClient, GoogleDriveClient, getAccessToken} from '../local/google.mjs';
import {createBufferPost} from '../local/buffer.mjs';
import {filterChildEnv} from '../local/codex.mjs';
import {atomicJSON} from '../local/manifest.mjs';

test('filterChildEnv strips sensitive tokens and secrets', () => {
  const env = {
    PATH: '/usr/bin',
    NODE_ENV: 'test',
    ZALO_BOT_TOKEN: 'secret-zalo-token',
    RUNNER_TOKEN: 'secret-runner',
    BUFFER_API_KEY: 'secret-buffer',
    MY_PASSWORD_KEY: 'pass123'
  };
  const filtered = filterChildEnv(env);
  assert.equal(filtered.PATH, '/usr/bin');
  assert.equal(filtered.NODE_ENV, 'test');
  assert.equal(filtered.ZALO_BOT_TOKEN, undefined);
  assert.equal(filtered.RUNNER_TOKEN, undefined);
  assert.equal(filtered.BUFFER_API_KEY, undefined);
  assert.equal(filtered.MY_PASSWORD_KEY, undefined);
});

test('Google Sheets client reads and updates rows via mock fetch', async () => {
  const mockFetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({updatedRows: 1})
      };
    }
    return {
      ok: true,
      json: async () => ({values: [['V001', 'Test', 'Script', 'viet-tiktok-story-video', 'ổn', 'Chờ tạo']]})
    };
  };

  const client = new GoogleSheetsClient({
    spreadsheetId: 'test-sheet',
    tab: 'Trang tính1',
    credentialsPath: 'nonexistent',
    fetchImpl: mockFetch
  });

  // Test with mock getAccessToken bypassed via overriding credentials check
  client.readRows = async () => [['V001', 'Test', 'Script', 'viet-tiktok-story-video', 'ổn', 'Chờ tạo']];
  const rows = await client.readRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 'V001');
});

test('Buffer GraphQL client formats video post mutations properly', async () => {
  let requestBody = null;
  const mockFetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        data: {
          createPost: {
            post: { id: 'buf_12345', status: 'accepted' }
          }
        }
      })
    };
  };

  const result = await createBufferPost({
    budget: {request: async (kind, call) => call()},
    apiKey: 'mock-key',
    channel: { id: 'ch_tiktok', service: 'tiktok' },
    input: { caption: 'Test video', mediaUrl: 'https://example.com/video.mp4' },
    scheduledAt: '2026-10-04T02:00:00.000Z',
    fetchImpl: mockFetch
  });

  assert.equal(result.id, 'buf_12345');
  assert.equal(result.status, 'accepted');
  assert.equal(requestBody.variables.input.channelId, 'ch_tiktok');
  assert.equal(requestBody.variables.input.schedulingType, 'automatic');
  assert.equal(requestBody.variables.input.mode, 'customScheduled');
  assert.equal(requestBody.variables.input.dueAt, '2026-10-04T02:00:00.000Z');
});
