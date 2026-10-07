import path from 'node:path';
import {loadConfig} from './config.mjs';
import {GoogleDriveClient} from './google.mjs';
import {VideoStudioClient} from './video-studio-client.mjs';
import {atomicJSON} from './manifest.mjs';

async function main() {
  const config = await loadConfig({secrets: true});
  const studio = new VideoStudioClient({
    cloudUrl: config.cloudUrl,
    runnerToken: config.secrets.runnerToken,
    workerId: config.workerId
  });

  const requestId = '5d1e0bf3-f0cf-48f5-8a04-453c76a28914';
  const leaseToken = '8b40ff29-f989-404e-8d51-2ff2e0acfb1c';
  const videoPath = 'D:/remotion/tasks/video-bot/jobs/studio/V009/V009.mp4';
  const fileName = 'V009 - CHỮ TÍN VÀ PHẨM GIÁ CON NGƯỜI.mp4';

  console.log('1. Đang tải video lên Google Drive...');
  const driveClient = new GoogleDriveClient({
    folderId: config.driveFolderId || '13wJbXO3Y6SPNi3iH3JDLBokkb900Je-v',
    credentialsPath: 'C:/Users/ADMIN/.codex/video-bot/google.json'
  });

  const uploadResult = await driveClient.uploadResumable({
    filePath: videoPath,
    fileName,
    requestId: 'V009',
    inputRevision: '1',
    onProgress: (p) => {
      if (p.percentage) console.log(`   Tiến độ tải Drive: ${p.percentage}%`);
    }
  });

  console.log('   Tải lên thành công! Drive ID:', uploadResult.id);
  console.log('   Link Drive:', uploadResult.driveUrl);

  const caption = 'Món nợ đắt nhất đời người là Niềm Tin. Mất tiền có thể kiếm lại, chứ mất Tín rồi thì vĩnh viễn không bao giờ mua lại được danh dự! 💎 #thuctinh #chutin #danhdu #phattrienbanthan #tamlyhoc';
  const hashtags = '#thuctinh #baihoccuocsong #chutin #phattrienbanthan #tamlyhoc #daoly #uytin #danhdu';

  console.log('2. Đang gửi kết quả về Video Studio API...');
  const res = await studio.sendResult(requestId, leaseToken, {
    driveId: uploadResult.id,
    driveUrl: uploadResult.driveUrl,
    caption,
    hashtags
  });
  console.log('   Video Studio API phản hồi:', res);

  const manifestPath = path.resolve('C:/Users/ADMIN/.codex/video-bot/manifests/V009.json');
  await atomicJSON(manifestPath, {
    id: requestId,
    displayId: 'V009',
    status: 'completed',
    completedAt: Date.now(),
    driveId: uploadResult.id,
    driveUrl: uploadResult.driveUrl
  });

  console.log('\n🎉 Hoàn tất V009 100%!');
}

main().catch(err => {
  console.error('Lỗi finalize V009:', err);
  process.exit(1);
});
