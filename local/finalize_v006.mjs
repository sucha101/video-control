import path from 'node:path';
import {loadConfig} from './config.mjs';
import {GoogleDriveClient} from './google.mjs';
import {VideoStudioClient} from './video-studio-client.mjs';
import {atomicJSON, readJSON} from './manifest.mjs';

async function main() {
  const config = await loadConfig({secrets: true});
  const studio = new VideoStudioClient({
    cloudUrl: config.cloudUrl,
    runnerToken: config.secrets.runnerToken,
    workerId: config.workerId
  });

  const manifestPath = path.resolve('C:/Users/ADMIN/.codex/video-bot/manifests/V006.json');
  const manifest = await readJSON(manifestPath, {});

  const requestId = manifest.id || '8b2726f6-b72b-4267-be45-8c0353b9406b';
  const leaseToken = manifest.leaseToken || 'a91b65de-7874-4a08-9ee5-2e58b3cd91b0';
  const videoPath = 'D:/remotion/tasks/video-bot/jobs/studio/V006/V006.mp4';
  const fileName = 'V006 - QUẢN TRỊ CẢM XÚC - NGHỆ THUẬT GIỮ CÁI ĐẦU LẠNH.mp4';

  console.log('1. Đang tải video lên Google Drive...');
  const driveClient = new GoogleDriveClient({
    folderId: config.driveFolderId || '13wJbXO3Y6SPNi3iH3JDLBokkb900Je-v',
    credentialsPath: 'C:/Users/ADMIN/.codex/video-bot/google.json'
  });

  const uploadResult = await driveClient.uploadResumable({
    filePath: videoPath,
    fileName,
    requestId: 'V006',
    inputRevision: '1',
    onProgress: (p) => {
      if (p.percentage) console.log(`   Tiến độ tải Drive: ${p.percentage}%`);
    }
  });

  console.log('   Tải lên thành công! Drive ID:', uploadResult.id);
  console.log('   Link Drive:', uploadResult.driveUrl);

  const caption = 'Đừng để một phút nóng giận hủy hoại công sức cả đời. Kẻ mạnh thực sự không phải kẻ đánh thắng người khác, mà là kẻ kiểm soát được chính mình. 🧘‍♂️ #thuctinh #quanlycamxuc #phattrienbanthan #daoly #tamlyhoc';
  const hashtags = '#thuctinh #baihoccuocsong #quanlycamxuc #phattrienbanthan #tamlyhoc #daoly #diemtinh #tuchucamxuc';

  console.log('2. Đang gửi kết quả về Video Studio API...');
  const res = await studio.sendResult(requestId, leaseToken, {
    driveId: uploadResult.id,
    driveUrl: uploadResult.driveUrl,
    caption,
    hashtags
  });
  console.log('   Video Studio API phản hồi:', res);

  manifest.status = 'completed';
  manifest.completedAt = Date.now();
  manifest.driveId = uploadResult.id;
  manifest.driveUrl = uploadResult.driveUrl;
  await atomicJSON(manifestPath, manifest);

  console.log('\n🎉 Hoàn tất V006 100%!');
}

main().catch(err => {
  console.error('Lỗi finalize V006:', err);
  process.exit(1);
});
