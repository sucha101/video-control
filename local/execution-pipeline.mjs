import path from 'node:path';
import {writeFile, cp, mkdir, readdir} from 'node:fs/promises';
import {runVieNeuTTS} from './vieneu-tts-runner.mjs';
import {generateCaptions} from './caption-generator.mjs';
import {renderStoryVideo} from './remotion-runner.mjs';
import {generateSceneImages} from './gemini-imagegen.mjs';
import {collectMediaForScenes} from './media-collector.mjs';
import {loadCheckpoint, saveCheckpoint, isStepCompleted} from './checkpoint-manager.mjs';

/**
 * Tự động bóc tách các dòng thoại (VO) từ văn bản kịch bản
 */
export function extractScriptLines(scriptText) {
  if (!scriptText) return [];
  const lines = scriptText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const voLines = [];
  const numberedRegex = /^(\d{1,2})[\.\:\-\)]\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(numberedRegex);
    if (match) {
      const content = match[2].trim();
      if (!content.startsWith('[') && !content.startsWith('Cảnh')) {
        voLines.push(content);
      }
    }
  }

  if (voLines.length === 0) {
    for (const line of lines) {
      if (line.startsWith('[') || line.startsWith('#') || line.startsWith('Cảnh') || line.startsWith('B1.') || line.startsWith('B2.')) {
        continue;
      }
      if (line.length >= 10) {
        voLines.push(line);
      }
    }
  }

  // Số cảnh co giãn linh hoạt theo kịch bản (tối đa 30)
  return voLines.slice(0, 30);
}

/**
 * Pipeline thực thi tự động chuẩn SOP Vxxx (Idempotent + Revision-aware)
 */
export async function runExecutionPipeline({
  requestId,
  inputRevision,
  jobDir,
  displayId,
  title,
  script,
  skill = 'viet-tiktok-story-video',
  voice = 'tinhtri',
  referenceUrls = [],
  notes = '',
  config = {},
  signal,
  onProgress
}) {
  await mkdir(jobDir, {recursive: true});
  const audioDir = path.join(jobDir, 'assets', 'audio', 'vo');
  const scenesDir = path.join(jobDir, 'assets', 'scenes');
  await mkdir(audioDir, {recursive: true});
  await mkdir(scenesDir, {recursive: true});

  // Tải Checkpoint gắn với requestId và inputRevision
  const checkpoint = await loadCheckpoint(jobDir, {requestId, inputRevision});
  console.log(`[Pipeline] Xử lý ${displayId} (Revision: ${inputRevision || 1}, Checkpoint: ${checkpoint.step})`);

  // 1. Phân tích kịch bản
  let lines = extractScriptLines(script);
  if (lines.length === 0) {
    throw new Error('Kịch bản chưa có các câu thoại phân cảnh để dựng video');
  }

  console.log(`[Pipeline] Đã trích xuất ${lines.length} câu thoại cho ${displayId}.`);
  await saveCheckpoint(jobDir, 'script_ready', {requestId, inputRevision, linesCount: lines.length});

  // 2. Chạy VieNeu-TTS
  let durations;
  if (isStepCompleted(checkpoint, 'tts_done')) {
    console.log(`[Pipeline] Đã có TTS từ checkpoint hợp lệ cho ${displayId}. Bỏ qua bước sinh âm thanh.`);
    const rawDurations = await (await import('node:fs/promises')).readFile(path.join(jobDir, 'durations.json'), 'utf8');
    durations = JSON.parse(rawDurations);
  } else {
    console.log(`[Pipeline] Đang chạy VieNeu-TTS (${voice})...`);
    const ttsResult = await runVieNeuTTS({
      lines,
      outputDir: audioDir,
      voice,
      ttsRoot: config.ttsRoot || 'D:/viet tts/VieNeu-TTS',
      signal,
      onProgress
    });
    durations = ttsResult.durations;
    await writeFile(path.join(jobDir, 'durations.json'), JSON.stringify(durations, null, 2), 'utf8');
    await saveCheckpoint(jobDir, 'tts_done', {requestId, inputRevision, durations});
  }

  // 3. Tạo captions.json
  console.log('[Pipeline] Đang tạo captions.json căn nhịp safe-zone...');
  const captions = generateCaptions({lines, durations});
  await writeFile(path.join(jobDir, 'captions.json'), JSON.stringify(captions, null, 2), 'utf8');

  // 4. Thu thập & kiểm định tư liệu hình ảnh
  if (!isStepCompleted(checkpoint, 'media_collected')) {
    console.log('[Pipeline] Đang thu thập và kiểm định tư liệu hình ảnh...');

    if (skill === 'drama-mascot-video') {
      // Yêu cầu tư liệu thật cho Drama, không tự ý fake
      const mediaResult = await collectMediaForScenes({
        scenes: lines.map((_, idx) => ({id: idx + 1})),
        referenceUrls,
        outputDir: scenesDir,
        requireRealEvidence: referenceUrls.length > 0
      });

      if (!mediaResult.isComplete && referenceUrls.length > 0) {
        return {
          status: 'needs_input',
          message: mediaResult.message,
          videoPath: '',
          caption: title,
          hashtags: []
        };
      }
      console.log(`[Pipeline] Đã thu thập tư liệu Drama: ${mediaResult.total}/${lines.length} cảnh.`);
    } else {
      // Nhánh Story: Dùng API hoặc kho phôi Stickman Seed
      const existingScenes = await readdir(scenesDir).catch(() => []);
      const hasImages = existingScenes.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).length >= lines.length;

      if (!hasImages) {
        const apiKey = config.secrets?.geminiApiKey;
        let generated = false;

        if (apiKey) {
          try {
            console.log('[Pipeline] Đang sinh ảnh bằng Gemini Image API...');
            const scenesPrompt = lines.map((l, idx) => ({
              id: idx + 1,
              prompt: `Simple 2D cartoon explainer style stickman character in blue hoodie, ${l}, clean bold outlines, dark moody blue background, neon accents, vertical 9:16 portrait`
            }));
            await generateSceneImages({
              scenes: scenesPrompt,
              outputDir: scenesDir,
              apiKey,
              model: config.geminiImageModel || 'gemini-3.1-flash-lite-image',
              signal
            });
            generated = true;
          } catch (err) {
            console.warn(`[Pipeline] Không thể sinh ảnh qua API (${err.message}). Dùng kho phôi seed dự phòng.`);
          }
        }

        if (!generated) {
          const seedDir = 'D:/remotion/assets/stickman-seed';
          const seedFiles = await readdir(seedDir).catch(() => []);
          for (let i = 1; i <= lines.length; i++) {
            const seedName = `scene_${String(i).padStart(2, '0')}.png`;
            const targetName = `scene_${String(i).padStart(2, '0')}.png`;
            if (seedFiles.includes(seedName)) {
              await cp(path.join(seedDir, seedName), path.join(scenesDir, targetName));
            }
          }
          console.log(`[Pipeline] Đã nạp ${lines.length} ảnh phôi minh họa chuẩn.`);
        }
      }
    }
    await saveCheckpoint(jobDir, 'media_collected', {requestId, inputRevision});
  }

  // 5. Render Remotion
  let renderResult;
  if (isStepCompleted(checkpoint, 'rendered')) {
    console.log(`[Pipeline] Đã có file MP4 từ checkpoint trước cho ${displayId}. Bỏ qua render.`);
    renderResult = {videoPath: path.join(jobDir, `${displayId}.mp4`), displayId};
  } else {
    console.log(`[Pipeline] Đang kích hoạt Remotion render cho ${displayId}...`);
    renderResult = await renderStoryVideo({
      jobDir,
      displayId,
      title,
      remotionRoot: config.resourceRoot || 'D:/remotion',
      signal,
      onProgress
    });
    console.log(`[Pipeline] Render thành công! Video: ${renderResult.videoPath}`);
    await saveCheckpoint(jobDir, 'rendered', {requestId, inputRevision, videoPath: renderResult.videoPath});
  }

  // 6. Caption & Hashtags phù hợp
  let caption = `${title}. Thấu hiểu quy luật cuộc sống để tâm luôn bình an và tỉnh táo vững bước! #thuctinh #trietly #baihoccuocsong #phattrienbanthan`;
  let hashtags = ['#thuctinh', '#trietly', '#baihoccuocsong', '#phattrienbanthan', '#tiktokvietnam'];

  if (skill === 'drama-mascot-video') {
    caption = `🚨 CẬP NHẬT: ${title}. Sự thật đằng sau câu chuyện khiến dư luận xôn xao! #drama #tintuc #bantin #hot #xuhuong`;
    hashtags = ['#drama', '#tintuc', '#bantin', '#xuhuong', '#tiktokvietnam'];
  }

  await saveCheckpoint(jobDir, 'completed', {requestId, inputRevision, videoPath: renderResult.videoPath});

  return {
    status: 'ready_for_upload',
    videoPath: renderResult.videoPath,
    caption,
    hashtags,
    qualityReportPath: path.join(jobDir, 'quality-report.json'),
    message: `Đã hoàn tất sản xuất tự động cho ${displayId}`
  };
}
