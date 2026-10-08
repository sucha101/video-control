import {loadConfig} from './config.mjs';
import {VideoStudioClient} from './video-studio-client.mjs';
import {produceStudioRequest} from './studio-producer.mjs';
import {writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const jobDir = 'D:/remotion/tasks/video-bot/jobs/studio/V013';

  // 1. Reset checkpoint để buộc render lại với chuẩn Drama Mascot
  const checkpoint = {
    step: 'media_collected',
    requestId: 'V013',
    inputRevision: 1,
    updatedAt: Date.now(),
    data: {
      linesCount: 10,
      durations: {
        "1": 5.36,
        "2": 5.72,
        "3": 6.88,
        "4": 5.6,
        "5": 7.18,
        "6": 5.16,
        "7": 6.18,
        "8": 5.42,
        "9": 6.3,
        "10": 6.3
      }
    }
  };
  await writeFile(path.join(jobDir, 'checkpoint.json'), JSON.stringify(checkpoint, null, 2), 'utf8');

  // Xóa checkpoint upload cũ nếu có để re-upload video mới
  try {
    await unlink(path.join(jobDir, 'drive-upload.json'));
  } catch {}

  const config = await loadConfig();
  const studio = new VideoStudioClient({
    cloudUrl: config.cloudUrl,
    runnerToken: config.secrets.runnerToken,
    workerId: config.workerId
  });

  console.log('[Rerender V013] Đang claim yêu cầu V013...');
  const claim = await studio.claimRequest('V013');
  console.log('[Rerender V013] Đã claim:', claim.request?.title);

  console.log('[Rerender V013] Bắt đầu render Drama Mascot Video theo chuẩn SOP mới...');
  await produceStudioRequest({config, studio, claim});
  console.log('[Rerender V013] Hoàn tất render và upload Drama Mascot Video V013!');
}

main().catch(err => {
  console.error('[Rerender V013] Lỗi:', err);
  process.exit(1);
});
