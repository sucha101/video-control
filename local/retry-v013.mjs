import {loadConfig} from './config.mjs';
import {VideoStudioClient} from './video-studio-client.mjs';
import {produceStudioRequest} from './studio-producer.mjs';

async function main() {
  const config = await loadConfig();
  const studio = new VideoStudioClient({
    cloudUrl: config.cloudUrl,
    runnerToken: config.secrets.runnerToken,
    workerId: config.workerId
  });

  console.log('[Retry V013] Đang claim yêu cầu V013...');
  const claim = await studio.claimRequest('V013');
  console.log('[Retry V013] Đã claim thành công V013:', claim.request?.title);

  console.log('[Retry V013] Bắt đầu sản xuất V013 với Antigravity...');
  await produceStudioRequest({config, studio, claim});
  console.log('[Retry V013] Hoàn tất chu kỳ dựng V013!');
}

main().catch(err => {
  console.error('[Retry V013] Lỗi:', err);
  process.exit(1);
});
