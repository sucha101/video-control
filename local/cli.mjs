import path from 'node:path';
import {loadConfig, requireConnections, privateRoot} from './config.mjs';
import {lock, atomicJSON, readJSON} from './manifest.mjs';
import {QueueClient} from './queue-client.mjs';
import {Runner} from './runner.mjs';
import {runDoctor} from './setup.mjs';
import {startLoopbackOAuth} from './google.mjs';

const cmd = process.argv[2] || 'start';

async function main() {
  switch (cmd) {
    case 'doctor': {
      const {allOk} = await runDoctor();
      process.exit(allOk ? 0 : 1);
      break;
    }

    case 'connect-google': {
      console.log('Khởi chạy xác thực Google OAuth...');
      const config = await loadConfig();
      const clientFile = process.argv[3] || config.googleClientFile || path.join(privateRoot, 'client_secret.json');
      const outputFile = config.googleCredentials;
      await startLoopbackOAuth({clientFile, outputFile});
      console.log('Xác thực hoàn tất!');
      break;
    }

    case 'setup': {
      console.log('=== THIẾT LẬP CẤU HÌNH LOCAL ===');
      const config = await loadConfig({secrets: true});
      console.log(`Thư mục lưu trữ bí mật: ${privateRoot}`);
      console.log(`Cloud URL: ${config.cloudUrl || '(Chưa cấu hình)'}`);
      console.log(`Sheet ID: ${config.sheetId}`);
      console.log(`Drive Folder ID: ${config.driveFolderId}`);
      console.log('\nĐể kiểm tra toàn bộ thành phần, chạy: npm run doctor');
      break;
    }

    case 'start': {
      const config = await loadConfig({secrets: true});
      try {
        requireConnections(config);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        console.log('Vui lòng kiểm tra cấu hình hoặc chạy: npm run doctor');
        process.exit(1);
      }

      console.log(`🚀 Bắt đầu Local Runner (Worker ID: ${config.workerId})...`);
      const lockPath = path.join(privateRoot, 'runner.lock');
      let unlock;
      try {
        unlock = await lock(lockPath);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }

      const queueClient = new QueueClient({
        cloudUrl: config.cloudUrl,
        secrets: config.secrets,
        workerId: config.workerId
      });

      const runner = new Runner({
        config,
        queueClient
      });

      let poller;
      if (config.secrets?.zaloBotToken) {
        const {ZaloPoller} = await import('./zalo-poller.mjs');
        poller = new ZaloPoller({
          botToken: config.secrets.zaloBotToken,
          pairingCode: config.secrets.pairingCode,
          runner
        });
        poller.start().catch(err => console.error('Zalo Poller error:', err));
      }

      let running = true;
      const cleanup = async () => {
        if (!running) return;
        running = false;
        console.log('\nĐang dừng runner...');
        if (poller) poller.stop();
        if (unlock) await unlock().catch(() => {});
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      while (running) {
        try {
          const job = await queueClient.claim();
          if (job) {
            console.log(`\n[${new Date().toLocaleTimeString()}] Nhận job: ${job.id} (${job.type})`);
            await runner.executeJob(job);
            console.log(`[${new Date().toLocaleTimeString()}] Hoàn tất job: ${job.id}`);
          }
        } catch (err) {
          console.error(`Lỗi trong chu kỳ polling: ${err.message}`);
        }

        await new Promise(r => setTimeout(r, config.pollMs || 5000));
      }
      break;
    }

    case 'studio:pending': {
      const config = await loadConfig({secrets: true});
      const {VideoStudioClient} = await import('./video-studio-client.mjs');
      const studio = new VideoStudioClient({
        cloudUrl: config.cloudUrl,
        runnerToken: config.secrets.runnerToken,
        workerId: config.workerId
      });
      const list = await studio.getPendingRequests();
      if (!list.length) {
        console.log('✅ Không có yêu cầu nào đang chờ xử lý.');
        break;
      }
      console.log(`\n📋 Có ${list.length} yêu cầu đang chờ dựng video:`);
      console.table(list.map(r => ({
        Mã: r.display_id,
        Tiêu_đề: r.title.slice(0, 30),
        Skill: r.skill,
        Giọng: r.voice || 'Mặc định',
        Thời_gian: new Date(r.created_at).toLocaleTimeString('vi-VN')
      })));
      break;
    }

    case 'studio:claim': {
      const targetId = process.argv[3];
      if (!targetId) {
        console.error('❌ Vui lòng cung cấp mã hoặc ID (VD: node local/cli.mjs studio:claim V002)');
        process.exit(1);
      }
      const config = await loadConfig({secrets: true});
      const {VideoStudioClient} = await import('./video-studio-client.mjs');
      const studio = new VideoStudioClient({
        cloudUrl: config.cloudUrl,
        runnerToken: config.secrets.runnerToken,
        workerId: config.workerId
      });
      console.log(`Đang nhận yêu cầu ${targetId}...`);
      const res = await studio.claimRequest(targetId);
      console.log(`\n✅ ĐÃ NHẬN VIỆC THÀNH CÔNG!`);
      console.log(`Mã: ${res.request.display_id}`);
      console.log(`Tiêu đề: ${res.request.title}`);
      console.log(`Skill: ${res.request.skill}`);
      console.log(`Thời hạn lease: ${new Date(res.expiresAt).toLocaleTimeString('vi-VN')}`);
      
      const manifestDir = path.join(privateRoot, 'manifests');
      const manifestFile = path.join(manifestDir, `${res.request.display_id}.json`);
      await atomicJSON(manifestFile, {
        id: res.request.id,
        displayId: res.request.display_id,
        leaseToken: res.leaseToken,
        skill: res.request.skill,
        title: res.request.title,
        script: res.request.script,
        voice: res.request.voice,
        inputRevision: res.request.input_revision,
        claimedAt: Date.now(),
        expiresAt: res.expiresAt,
        status: 'claimed'
      });
      console.log(`\nĐã lưu manifest tại: ${manifestFile}`);
      console.log(`Nội dung kịch bản:\n----------------------------------------\n${res.request.script}\n----------------------------------------`);
      break;
    }

    case 'studio:result': {
      const targetId = process.argv[3];
      const driveId = process.argv[4];
      const driveUrl = process.argv[5];
      const caption = process.argv[6] || '';
      if (!targetId || !driveId || !driveUrl) {
        console.error('❌ Cú pháp: node local/cli.mjs studio:result <MÃ> <DRIVE_ID> <DRIVE_URL> [CAPTION]');
        process.exit(1);
      }
      const config = await loadConfig({secrets: true});
      if (!/^V[0-9]+$/i.test(targetId)) throw new Error('Mã video không hợp lệ');
      const manifestFile = path.join(privateRoot, 'manifests', `${targetId}.json`);
      const manifest = await readJSON(manifestFile, null);
      if (!manifest || !manifest.leaseToken) {
        console.error(`❌ Không tìm thấy leaseToken cho ${targetId} trong ${manifestFile}`);
        process.exit(1);
      }
      const {VideoStudioClient} = await import('./video-studio-client.mjs');
      const studio = new VideoStudioClient({
        cloudUrl: config.cloudUrl,
        runnerToken: config.secrets.runnerToken,
        workerId: config.workerId
      });
      console.log(`Đang gửi kết quả cho ${targetId}...`);
      await studio.sendResult(manifest.id, manifest.leaseToken, {
        driveId,
        driveUrl,
        caption
      });
      manifest.status = 'completed';
      manifest.driveId = driveId;
      manifest.driveUrl = driveUrl;
      await atomicJSON(manifestFile, manifest);
      console.log(`✅ Đã gửi kết quả thành công! Video đã chuyển sang trạng thái "Chờ duyệt video" trên Web.`);

      try {
        const {sendZaloMessage} = await import('./zalo-notify.mjs');
        await sendZaloMessage(`🎬 [Video Studio] Video ${targetId} "${manifest.title}" đã dựng hoàn tất!\n👉 Mời bạn vào xem thử và duyệt đăng tại: ${config.cloudUrl}`);
      } catch {}
      break;
    }

    case 'studio:sync': {
      const config = await loadConfig({secrets: true});
      const {VideoStudioClient} = await import('./video-studio-client.mjs');
      const studio = new VideoStudioClient({
        cloudUrl: config.cloudUrl,
        runnerToken: config.secrets.runnerToken,
        workerId: config.workerId
      });
      const {runStudioSync} = await import('./studio-sync.mjs');
      console.log(await runStudioSync({config, studio}));
      break;
      }
    case 'studio:publish': {
      const config = await loadConfig({secrets: true});
      const {VideoStudioClient} = await import('./video-studio-client.mjs');
      const {runStudioPublicationCycle} = await import('./studio-publisher.mjs');
      const studio = new VideoStudioClient({cloudUrl: config.cloudUrl, runnerToken: config.secrets.runnerToken, workerId: config.workerId});
      console.log(await runStudioPublicationCycle({config, studio}));
      break;
    }

    default:
      console.log(`Lệnh không rõ: ${cmd}. Hỗ trợ: start, doctor, setup, connect-google, studio:pending, studio:claim, studio:result, studio:sync, studio:publish`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
  process.exit(1);
});
