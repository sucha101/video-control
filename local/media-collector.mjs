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
 * Thu thập bằng chứng thật bằng Python Playwright + Bing Images
 */
async function runPythonEvidenceCollector(jobDir, referenceUrls = []) {
  const scriptPath = path.resolve('local/media_evidence_collector.py');
  return new Promise((resolve) => {
    const args = [scriptPath, jobDir];
    const proc = spawn('python', args, {
      windowsHide: true,
      env: {...process.env, PYTHONIOENCODING: 'utf-8'}
    });
    let output = '';
    proc.stdout?.on('data', d => output += d.toString());
    proc.stderr?.on('data', d => output += d.toString());
    proc.on('close', code => {
      console.log(`[Python Evidence Collector] Kết thúc (code ${code}):\n${output}`);
      resolve(code === 0);
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
  jobDir,
  requireRealEvidence = false,
  fallbackSeedDir = 'D:/remotion/assets/stickman-seed'
}) {
  await mkdir(outputDir, {recursive: true});
  const collectedAssets = [];
  const missingScenes = [];

  console.log(`[Media Collector] Đang thu thập tư liệu cho ${scenes.length} cảnh từ ${referenceUrls.length} nguồn...`);

  // Với Drama: Sử dụng Python Playwright & CDN Extractor để lấy ảnh thật từ link bài viết / Web
  if (requireRealEvidence && jobDir) {
    console.log('[Media Collector] Kích hoạt chế độ thu thập bằng chứng thật (Playwright + Web Evidence)...');
    await runPythonEvidenceCollector(jobDir, referenceUrls);
  }

  for (let i = 0; i < scenes.length; i++) {
    const sceneNum = i + 1;
    const targetFile = path.join(outputDir, `scene_${String(sceneNum).padStart(2, '0')}.png`);

    // 1. Nếu đã có file sẵn trong thư mục
    if (await fileExists(targetFile)) {
      collectedAssets.push({scene: sceneNum, path: targetFile, source: 'existing'});
      continue;
    }

    let resolved = false;

    // 2. Tải từ referenceUrls nếu là file ảnh trực tiếp
    if (referenceUrls[i] && /^https?:\/\/.+\.(png|jpg|jpeg|webp)$/i.test(referenceUrls[i])) {
      const url = referenceUrls[i];
      try {
        console.log(`[Media Collector] Đang tải tư liệu cảnh ${sceneNum} từ: ${url}`);
        await downloadDirectMedia(url, targetFile);
        collectedAssets.push({scene: sceneNum, path: targetFile, source: 'downloaded'});
        resolved = true;
      } catch (err) {
        console.warn(`[Media Collector] Không tải được URL cảnh ${sceneNum} (${err.message}).`);
      }
    }

    // 3. Xử lý khi thiếu tư liệu
    if (!resolved) {
      if (requireRealEvidence) {
        // Tuyệt đối KHÔNG bao giờ dùng ảnh stickman cho Drama
        console.warn(`[Media Collector] Cảnh ${sceneNum} chưa có tư liệu thật.`);
        missingScenes.push(sceneNum);
      } else {
        // Chỉ dùng phôi Stickman cho Story đạo lý/tâm lý
        const seedFile = path.join(fallbackSeedDir, `scene_${String(sceneNum).padStart(2, '0')}.png`);
        if (await fileExists(seedFile)) {
          const {copyFile} = await import('node:fs/promises');
          await copyFile(seedFile, targetFile);
          collectedAssets.push({scene: sceneNum, path: targetFile, source: 'fallback_seed'});
          resolved = true;
        } else {
          missingScenes.push(sceneNum);
        }
      }
    }
  }

  const isComplete = missingScenes.length === 0;

  return {
    collectedAssets,
    missingScenes,
    total: collectedAssets.length,
    isComplete,
    message: isComplete 
      ? 'Đã thu thập đủ tư liệu cho tất cả các cảnh'
      : `Thiếu tư liệu thật cho các cảnh: ${missingScenes.join(', ')}. Cần bổ sung nguồn tham khảo.`
  };
}
