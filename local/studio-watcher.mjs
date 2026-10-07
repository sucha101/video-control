import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {loadConfig, privateRoot} from './config.mjs';
import {VideoStudioClient} from './video-studio-client.mjs';
import {sendZaloMessage} from './zalo-notify.mjs';
import {readJSON, atomicJSON, lock} from './manifest.mjs';
import {runStudioPublicationCycle} from './studio-publisher.mjs';
import {runStudioSync} from './studio-sync.mjs';
import {runStudioProductionCycle} from './studio-producer.mjs';

async function main() {
  const config = await loadConfig({secrets: true});
  const release = await lock(path.join(privateRoot, 'studio-watcher.lock'));
  const studio = new VideoStudioClient({cloudUrl: config.cloudUrl,
    runnerToken: config.secrets.runnerToken, workerId: config.workerId});
  const seenFile = path.join(privateRoot, 'studio-notified-requests.json');
  const seenPending = new Set(await readJSON(seenFile, []));
  let stopped = false;
  const productionAbort = new AbortController();
  const stop = () => { stopped = true; productionAbort.abort(new Error('Video Studio watcher stopped')); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let nextPendingAt = 0;
  let nextPublishAt = 0;
  let nextHeartbeatAt = 0;
  let nextSyncAt = 0;
  let nextProduceAt = 0;
  let productionTask = null;
  console.log(`[Watcher] Trực ban Video Studio (${config.workerId}).`);
  try {
    while (!stopped) {
      const now = Date.now();
      if (now >= nextHeartbeatAt) {
        nextHeartbeatAt = now + 25000;
        try {
          const manifestDir = path.join(privateRoot, 'manifests');
          for (const file of await readdir(manifestDir).catch(() => [])) {
            if (!file.endsWith('.json')) continue;
            const item = await readJSON(path.join(manifestDir, file), null);
            if (item?.status === 'claimed' && item.leaseToken && (item.id || item.displayId)) {
              await studio.sendHeartbeat(item.id || item.displayId, item.leaseToken, 'Đang dựng video V006');
            }
          }
        } catch (err) { console.warn('[Watcher] Không gia hạn được công việc:', err.message); }
      }
      if (now >= nextPendingAt) {
        nextPendingAt = now + 60000;
        try {
          for (const item of await studio.getPendingRequests()) {
            if (seenPending.has(item.id)) continue;
            const sent = await sendZaloMessage(`📝 Video Studio nhận kịch bản ${item.display_id}: "${item.title}". Đang chờ xử lý.`);
            if (sent) {
              seenPending.add(item.id);
              await atomicJSON(seenFile, [...seenPending].slice(-1000));
            }
          }
        } catch (err) { console.warn('[Watcher] Không đọc được hàng đợi:', err.message); }
      }
      if (now >= nextProduceAt && !productionTask) {
        nextProduceAt = now + 60000;
        productionTask = runStudioProductionCycle({config, studio, signal: productionAbort.signal})
          .then(result => { if (result.processed) console.log(`[Watcher] Đã hoàn tất chu kỳ dựng ${result.processed}.`); })
          .catch(err => console.warn('[Watcher] Không thể xử lý yêu cầu dựng video:', err.message))
          .finally(() => { productionTask = null; });
      }
      if (now >= nextPublishAt) {
        nextPublishAt = now + 60000;
        try {
          // Publisher chooses due receipts; shared budget bounds all Buffer calls.
          const result = await runStudioPublicationCycle({config, studio, notify: sendZaloMessage});
          if (result?.nextCheckAt) nextPublishAt = Math.max(nextPublishAt, result.nextCheckAt);
        } catch (err) {
          if (err.retryAt) nextPublishAt = Math.max(nextPublishAt, err.retryAt);
          else nextPublishAt = now + 180000;
          console.warn('[Watcher] Tạm dừng chu kỳ xuất bản:', err.message);
        }
      }
      if (now >= nextSyncAt) {
        nextSyncAt = now + 60000;
        try { await runStudioSync({config, studio}); }
        catch (err) {
          nextSyncAt = now + 180000;
          console.warn('[Watcher] Chưa đồng bộ được Sheet:', err.message);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    await productionTask?.catch(() => {});
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await release();
  }
}

main().catch(err => {
  console.error('[Watcher] Không thể chạy:', err.message);
  process.exitCode = 1;
});
