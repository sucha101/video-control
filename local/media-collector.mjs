import path from 'node:path';
import {writeFile, mkdir, access} from 'node:fs/promises';
import {spawn} from 'node:child_process';

/**
 * Kiểm tra file có tồn tại và hợp lệ không
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tải file từ direct URL qua fetch
 */
async function downloadDirectMedia(url, outputPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1000) throw new Error('File tải về quá nhỏ hoặc không hợp lệ');
  await writeFile(outputPath, buffer);
  return outputPath;
}

/**
 * Trích xuất đoạn video ngắn (3-5s) từ video gốc bằng ffmpeg
 */
export async function trimVideoClip({inputPath, outputPath, startSec = 0, durationSec = 4}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-ss', String(startSec),
      '-i', inputPath,
      '-t', String(durationSec),
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-an',
      outputPath
    ];

    const proc = spawn('ffmpeg', args, {windowsHide: true});
    let stderr = '';
    proc.stderr?.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg trim clip lỗi (${code}): ${stderr}`));
    });
  });
}

/**
 * Module chính: Thu thập và kiểm định tư liệu thật
 */
export async function collectMediaForScenes({
  scenes,
  referenceUrls = [],
  outputDir,
  fallbackSeedDir = 'D:/remotion/assets/stickman-seed'
}) {
  await mkdir(outputDir, {recursive: true});
  const collectedAssets = [];

  console.log(`[Media Collector] Đang thu thập tư liệu cho ${scenes.length} cảnh từ ${referenceUrls.length} nguồn...`);

  // Duyệt qua từng cảnh
  for (let i = 0; i < scenes.length; i++) {
    const sceneNum = i + 1;
    const targetFile = path.join(outputDir, `scene_${String(sceneNum).padStart(2, '0')}.png`);

    // 1. Nếu đã có file sẵn trong thư mục, giữ lại
    if (await fileExists(targetFile)) {
      collectedAssets.push({scene: sceneNum, path: targetFile, source: 'existing'});
      continue;
    }

    let resolved = false;

    // 2. Thử tải từ referenceUrls nếu có URL trực tiếp ảnh/video
    if (referenceUrls[i] && /^https?:\/\/.+/i.test(referenceUrls[i])) {
      const url = referenceUrls[i];
      try {
        console.log(`[Media Collector] Đang tải tư liệu cảnh ${sceneNum} từ: ${url}`);
        await downloadDirectMedia(url, targetFile);
        collectedAssets.push({scene: sceneNum, path: targetFile, source: 'downloaded'});
        resolved = true;
      } catch (err) {
        console.warn(`[Media Collector] Không tải được URL cảnh ${sceneNum} (${err.message}). Kích hoạt fallback.`);
      }
    }

    // 3. Fallback: Nếu không tải được hoặc không có link, dùng kho phôi seed chuẩn
    if (!resolved) {
      const seedFile = path.join(fallbackSeedDir, `scene_${String(sceneNum).padStart(2, '0')}.png`);
      if (await fileExists(seedFile)) {
        const {copyFile} = await import('node:fs/promises');
        await copyFile(seedFile, targetFile);
        collectedAssets.push({scene: sceneNum, path: targetFile, source: 'fallback_seed'});
        resolved = true;
      }
    }

    if (!resolved) {
      console.warn(`[Media Collector] Cảnh ${sceneNum} chưa có hình ảnh/clip, cần bổ sung.`);
    }
  }

  return {
    collectedAssets,
    total: collectedAssets.length,
    isComplete: collectedAssets.length >= scenes.length
  };
}
