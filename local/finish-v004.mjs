import path from 'node:path';
import { loadConfig, privateRoot } from './config.mjs';
import { GoogleDriveClient } from './google.mjs';
import { VideoStudioClient } from './video-studio-client.mjs';
import { readJSON, atomicJSON } from './manifest.mjs';
import { sendZaloMessage } from './zalo-notify.mjs';

async function main() {
  const config = await loadConfig({ secrets: true });
  const studio = new VideoStudioClient({
    cloudUrl: config.cloudUrl,
    runnerToken: config.secrets.runnerToken,
    workerId: config.workerId,
  });

  const requestId = '2bb5e43e-cc3a-475b-99de-b95946340a99';
  const displayId = 'V004';
  const inputRevision = 1;

  console.log('🔄 Đang claim request V004 để lấy leaseToken mới...');
  const claimRes = await studio.claimRequest(requestId);
  const leaseToken = claimRes.leaseToken;
  console.log('🔑 LeaseToken mới:', leaseToken);

  const jobDir = path.resolve(config.jobRoot, 'studio', displayId);
  const videoPath = 'D:\\remotion\\tasks\\video-bot\\jobs\\studio\\V004\\V004.mp4';
  const manifestFile = path.join(privateRoot, 'manifests', `${displayId}.json`);
  const checkpointFile = path.join(jobDir, 'drive-upload.json');
  // Clean checkpoint for new upload
  const checkpoint = {};

  console.log('🚀 Đang bắt đầu heartbeat và upload video V004 lên Google Drive...');

  let heartbeatStopped = false;
  const heartbeatTimer = setInterval(async () => {
    if (heartbeatStopped) return;
    try {
      await studio.sendHeartbeat(requestId, leaseToken, 'Đang tải video lên Google Drive');
      console.log('💓 Heartbeat sent');
    } catch (e) {
      console.warn('⚠️ Heartbeat warning:', e.message);
    }
  }, 20000);

  try {
    const drive = new GoogleDriveClient({
      folderId: config.driveFolderId,
      credentialsPath: config.googleCredentials,
    });

    const fence = async () => {
      await studio.sendHeartbeat(requestId, leaseToken, 'Đang tải video lên Drive');
    };

    const uploaded = await drive.uploadResumable({
      filePath: videoPath,
      fileName: `${displayId}-CANG-TRUONG-THANH-CANG-LUOI-GIAI-THICH.mp4`,
      checkpoint,
      requestId,
      inputRevision,
      fence,
      persistCheckpoint: state => atomicJSON(checkpointFile, state),
    });

    console.log('✅ Uploaded to Google Drive successfully:', uploaded);

    const caption = `Nghịch lý của sự trưởng thành là bạn nhận ra mình chẳng còn muốn tranh luận đúng sai nữa. Ném đá xuống bùn thì đá chìm, mà mình lại lấm lem. 🤫 Bạn đã từng cố giải thích đến kiệt sức chưa? 👇 #thuctinh #baihoccuocsong #phattrienbanthan #daoly #tamlyhoc`;
    const hashtags = `#thuctinh #baihoccuocsong #phattrienbanthan #tamlyhoc #daoly #truongthanh #kienthuc #ngunggiaithich`;

    console.log('📤 Submitting result to Studio API...');
    const resultRes = await studio.sendResult(requestId, leaseToken, {
      driveId: uploaded.id,
      driveUrl: uploaded.driveUrl,
      caption,
      hashtags,
    });
    console.log('🎉 sendResult response:', resultRes);

    await atomicJSON(manifestFile, {
      id: requestId,
      displayId,
      title: 'CÀNG TRƯỞNG THÀNH, CÀNG LƯỜI GIẢI THÍCH',
      skill: 'viet-tiktok-story-video',
      agentProvider: 'codex',
      status: 'completed',
      driveId: uploaded.id,
      driveUrl: uploaded.driveUrl,
      completedAt: Date.now(),
    });

    try {
      await sendZaloMessage(`✅ Video ${displayId} đã dựng xong! Mời bạn xem và duyệt trên Video Studio:\n${uploaded.driveUrl}`);
    } catch (zErr) {
      console.warn('Zalo notify warning:', zErr.message);
    }

    console.log('🏆 TOÀN BỘ QUY TRÌNH V004 ĐÃ HOÀN TẤT!');
  } finally {
    heartbeatStopped = true;
    clearInterval(heartbeatTimer);
  }
}

main().catch(err => {
  console.error('❌ Lỗi khi upload & hoàn tất V004:', err);
  process.exit(1);
});
