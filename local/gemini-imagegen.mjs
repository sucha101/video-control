import {mkdir, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

function findImageData(payload) {
  if (typeof payload?.output_image?.data === 'string') return payload.output_image.data;
  for (const item of payload?.steps || []) {
    for (const block of item?.content || []) {
      if (block?.type === 'image' && typeof block.data === 'string') return block.data;
    }
  }
  return null;
}

async function requestImage({prompt, apiKey, model, signal, fetchImpl}) {
  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-goog-api-key': apiKey},
    body: JSON.stringify({
      model,
      input: [{type: 'text', text: prompt}],
      response_format: {type: 'image', mime_type: 'image/png', aspect_ratio: '9:16', image_size: '1K'}
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    const error = new Error(`Gemini image API lỗi: ${message}`);
    error.status = response.status;
    throw error;
  }
  const data = findImageData(payload);
  if (!data) throw new Error('Gemini phản hồi thành công nhưng không có dữ liệu ảnh');
  const image = Buffer.from(data, 'base64');
  if (image.length < 8 || image.readUInt32BE(0) !== 0x89504e47) throw new Error('Gemini trả ảnh PNG không hợp lệ');
  return image;
}

export async function generateSceneImages({
  scenes, outputDir, apiKey, model = 'gemini-3.1-flash-lite-image', maxImages = 16,
  signal, fetchImpl = fetch
}) {
  if (!apiKey) throw new Error('Thiếu Gemini API key');
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > maxImages || scenes.length > 16) {
    throw new Error(`Số lượng ảnh phải từ 1 đến ${Math.min(maxImages, 16)}`);
  }
  await mkdir(outputDir, {recursive: true});
  const results = [];
  for (const [index, scene] of scenes.entries()) {
    signal?.throwIfAborted();
    const prompt = `${scene.prompt}\n\nOutput one clean vertical 9:16 illustration frame for a short-form video. No text, captions, lettering, logos, or watermarks.`;
    let image;
    try {
      image = await requestImage({prompt, apiKey, model, signal, fetchImpl});
    } catch (error) {
      if (error.status !== 429 && error.status < 500) throw error;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2500);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, {once: true});
      });
      signal?.throwIfAborted();
      image = await requestImage({prompt, apiKey, model, signal, fetchImpl});
    }
    const fileName = `scene-${String(index + 1).padStart(2, '0')}.png`;
    const filePath = path.join(outputDir, fileName);
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, image, {mode: 0o600});
    await rename(temporary, filePath);
    results.push({id: scene.id, path: filePath, bytes: image.length});
  }
  return results;
}
