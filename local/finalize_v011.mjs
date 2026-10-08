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

  const requestId = 'dcbf734c-fa75-4590-827b-166d50b617fa';
  const leaseToken = '62d511fe-d18c-415f-bec8-d03bcbc3b021';
  const videoPath = 'D:/remotion/tasks/video-bot/jobs/studio/V011/V011.mp4';
  const fileName = 'V011 - BẢN LĨNH CẮT LỖ TRONG CUỘC SỐNG.mp4';

  console.log('1. Đang tải video lên Google Drive...');
  const driveClient = new GoogleDriveClient({
    folderId: config.driveFolderId || '13wJbXO3Y6SPNi3iH3JDLBokkb900Je-v',
    credentialsPath: 'C:/Users/ADMIN/.codex/video-bot/google.json'
  });

  const uploadResult = await driveClient.uploadResumable({
    filePath: videoPath,
    fileName,
    requestId: 'V011',
    inputRevision: '1',
    onProgress: (p) => {
      if (p.percentage) console.log(`   Tiến độ tải Drive: ${p.percentage}%`);
    }
  });

  console.log('   Tải lên thành công! Drive ID:', uploadResult.id);
  console.log('   Link Drive:', uploadResult.driveUrl);

  const caption = 'Thà đau một lần rồi thôi, còn hơn âm ỉ rỉ máu cả đời. Dũng cảm buông tay đúng lúc không phải hèn nhát, mà là sự tỉnh táo để tự cứu lấy mình! ⚓ #thuctinh #catlo #dungkhi #phattrienbanthan #tamlyhoc';
  const hashtags = '#thuctinh #baihoccuocsong #catlo #phattrienbanthan #tamlyhoc #daoly #truongthanh #dungkhibuongtay';

  console.log('2. Đang gửi kết quả về Video Studio API...');
  const res = await studio.sendResult(requestId, leaseToken, {
    driveId: uploadResult.id,
    driveUrl: uploadResult.driveUrl,
    caption,
    hashtags
  });
  console.log('   Video Studio API phản hồi:', res);

  const manifestPath = path.resolve('C:/Users/ADMIN/.codex/video-bot/manifests/V011.json');
  await atomicJSON(manifestPath, {
    id: requestId,
    displayId: 'V011',
    status: 'completed',
    completedAt: Date.now(),
    driveId: uploadResult.id,
    driveUrl: uploadResult.driveUrl
  });

  console.log('\n🎉 Hoàn tất V011 100%!');
}

main().catch(err => {
  console.error('Lỗi finalize V011:', err);
  process.exit(1);
});
