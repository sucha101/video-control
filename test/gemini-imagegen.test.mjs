import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateSceneImages} from '../local/gemini-imagegen.mjs';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('Gemini image generation writes ordered 9:16 PNG scenes without exposing key', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-imagegen-'));
  const calls = [];
  try {
    const images = await generateSceneImages({
      scenes: [{id: 1, prompt: 'A gentle story illustration'}, {id: 2, prompt: 'A hopeful ending'}],
      outputDir: root, apiKey: 'test-secret-value', fetchImpl: async (url, options) => {
        calls.push({url, headers: options.headers, body: JSON.parse(options.body)});
        return {ok: true, json: async () => ({output_image: {data: png.toString('base64')}})};
      }
    });
    assert.equal(images.length, 2);
    assert.match(images[0].path, /scene-01\.png$/);
    assert.match(images[1].path, /scene-02\.png$/);
    assert.deepEqual(await readFile(images[0].path), png);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers['x-goog-api-key'], 'test-secret-value');
    assert.equal(calls[0].body.response_format.aspect_ratio, '9:16');
    assert.match(calls[0].body.input[0].text, /No text/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('Gemini image generation rejects an API error without retrying permanent errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'video-imagegen-error-'));
  let calls = 0;
  try {
    await assert.rejects(generateSceneImages({
      scenes: [{id: 1, prompt: 'One frame'}], outputDir: root, apiKey: 'test-secret-value',
      fetchImpl: async () => { calls++; return {ok: false, status: 400, json: async () => ({error: {message: 'invalid model'}})}; }
    }), /Gemini image API lỗi: invalid model/);
    assert.equal(calls, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
