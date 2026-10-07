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

  const requestId = '9b1b51f7-0b63-4b39-9bc8-9f061bb376d2';
  const leaseToken = 'a3f250bc-68d3-464a-ab9c-8ca66657db07';
  const videoPath = 'D:/remotion/tasks/video-bot/jobs/studio/V007/V007.mp4';
  const fileName = 'V007 - NGHỆ THUẬT BUÔNG BỎ KỲ VỌNG.mp4';

  console.log('1. Đang tải video lên Google Drive...');
  const driveClient = new GoogleDriveClient({
    folderId: config.driveFolderId || '13wJbXO3Y6SPNi3iH3JDLBokkb900Je-v',
    credentialsPath: 'C:/Users/ADMIN/.codex/video-bot/google.json'
  });

  const uploadResult = await driveClient.uploadResumable({
    filePath: videoPath,
    fileName,
    requestId: 'V007',
    inputRevision: '1',
    onProgress: (p) => {
      if (p.percentage) console.log(`   Tiến độ tải Drive: ${p.percentage}%`);
    }
  });

  console.log('   Tải lên thành công! Drive ID:', uploadResult.id);
  console.log('   Link Drive:', uploadResult.driveUrl);

  const caption = 'Thứ làm bạn tổn thương không phải người khác, mà là sự kỳ vọng quá mức của chính bạn. Nắm chặt than hồng thì người phỏng tay là mình. 🍃 #thuctinh #buongbo #kyvong #phattrienbanthan #tamlyhoc';
  const hashtags = '#thuctinh #baihoccuocsong #buongbo #phattrienbanthan #tamlyhoc #daoly #kyvong #binhyen';

  console.log('2. Đang gửi kết quả về Video Studio API...');
  const res = await studio.sendResult(requestId, leaseToken, {
    driveId: uploadResult.id,
    driveUrl: uploadResult.driveUrl,
    caption,
    hashtags
  });
  console.log('   Video Studio API phản hồi:', res);

  const manifestPath = path.resolve('C:/Users/ADMIN/.codex/video-bot/manifests/V007.json');
  await atomicJSON(manifestPath, {
    id: requestId,
    displayId: 'V007',
    status: 'completed',
    completedAt: Date.now(),
    driveId: uploadResult.id,
    driveUrl: uploadResult.driveUrl
  });

  console.log('\n🎉 Hoàn tất V007 100%!');
}

main().catch(err => {
  console.error('Lỗi finalize V007:', err);
  process.exit(1);
});
