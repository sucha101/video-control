import path from 'node:path';
import {privateRoot} from './config.mjs';
import {atomicJSON, readJSON, lock} from './manifest.mjs';
import {createBufferPost, getBufferPost, getBufferCooldown, probeMediaUrl, formatDownloadUrl, scheduleUTC} from './buffer.mjs';

// One process owns publication delivery; an uncertain create is never replayed.
export async function runStudioPublicationCycle({config, studio, root = privateRoot,
  create = createBufferPost, getPost = getBufferPost, cooldown = getBufferCooldown, probe = probeMediaUrl,
  notify = async () => false}) {
  const summary = {acceptedCount: 0, sentCount: 0};
  if (!config.secrets?.bufferApiKey) return summary;
  const blocked = await cooldown('write');
  if (blocked) return {...summary, nextCheckAt: blocked};
  let release;
  try { release = await lock(path.join(root, 'publisher.lock')); }
  catch { return summary; }
  const journalPath = path.join(root, 'publication-deliveries.json');
  try {
    const journal = await readJSON(journalPath, {});
    const deliverZaloNotices = async () => {
      for (const [key, entry] of Object.entries(journal)) {
        if (entry.result?.state !== 'accepted' || !entry.cloudAcknowledged || !entry.notificationMessage || entry.zaloNotified) continue;
        try {
          if (await notify(entry.notificationMessage) !== false) {
            entry.zaloNotified = true;
            await atomicJSON(journalPath, journal);
          }
        } catch (err) {
          console.warn('[Publisher] Không gửi được thông báo Zalo:', err.message);
        }
      }
    };
    // Retry a missed notification without repeating the external Buffer create.
    await deliverZaloNotices();
    const items = await studio.claimPublicationChannels(1);
    for (const item of items) {
      const key = `${item.publication_id}:${item.channel_id}`;
      const report = result => studio.sendPublicationResult({publicationId: item.publication_id, channelId: item.channel_id, ...result});
      if (journal[key]) {
        await report(journal[key].result || {state: 'needs_review', errorCode: 'Lần gửi trước chưa có kết quả chắc chắn; cần kiểm tra Buffer'});
        if (journal[key].result?.state === 'accepted' && !journal[key].cloudAcknowledged) {
          journal[key].cloudAcknowledged = true;
          await atomicJSON(journalPath, journal);
        }
        await deliverZaloNotices();
        continue;
      }
      const snapshot = item.snapshot;
      const channel = config.channels?.find(c => (c.id || c.channelId) === item.channel_id);
      if (!channel?.service) {
        await report({state: 'failed_confirmed', errorCode: 'Kênh chưa có cấu hình service hợp lệ'});
        continue;
      }
      const mediaUrl = formatDownloadUrl(snapshot.driveId, snapshot.driveUrl);
      const media = await probe(mediaUrl);
      if (!media.ok) { await report({state: 'failed_confirmed', errorCode: media.reason}); continue; }
      const scheduledAt = snapshot.scheduledAtBangkok ? scheduleUTC(snapshot.scheduledAtBangkok) : undefined;
      journal[key] = {attemptedAt: Date.now()};
      await atomicJSON(journalPath, journal);
      let result;
      try {
        const post = await create({apiKey: config.secrets.bufferApiKey, channel: {...channel, id: item.channel_id},
          input: {title: snapshot.title, caption: `${snapshot.caption || ''} ${snapshot.hashtags || ''}`.trim(), mediaUrl}, scheduledAt});
        result = {state: 'accepted', bufferId: post.id, bufferStatus: post.status};
        summary.acceptedCount++;
      } catch (err) {
        const limited = Boolean(err.retryAt) || err.status === 429;
        result = {state: limited ? 'ready' : err.definitelyNotCreated ? 'failed_confirmed' : 'needs_review',
          errorCode: limited ? 'Buffer 429: đang chờ hạn mức hồi phục' : err.message};
        if (limited) summary.nextCheckAt = err.retryAt;
      }
      // Persist successful IDs before acknowledging cloud. Cloud failure must not create again.
      if (result.state === 'ready' || result.state === 'failed_confirmed') delete journal[key];
      else {
        journal[key].result = result;
        if (result.state === 'accepted') {
          const title = String(snapshot.title || item.request_id || 'video').slice(0, 160);
          const channelName = String(channel.name || channel.label || channel.service || 'mạng xã hội').slice(0, 80);
          const schedule = snapshot.scheduledAtBangkok
            ? `\nLịch đăng: ${snapshot.scheduledAtBangkok} (giờ Việt Nam).`
            : '\nĐang được Buffer xử lý để đăng ngay.';
          journal[key].notificationMessage = `✅ Buffer đã nhận bài “${title}” cho kênh ${channelName}.${schedule}`;
          journal[key].zaloNotified = false;
        }
      }
      await atomicJSON(journalPath, journal);
      await report(result);
      if (result.state === 'accepted') {
        journal[key].cloudAcknowledged = true;
        await atomicJSON(journalPath, journal);
      }
      await deliverZaloNotices();
      if (summary.nextCheckAt) return summary;
    }
    const pollBlocked = await cooldown('read');
    if (pollBlocked) return {...summary, nextPollAt: pollBlocked};
    for (const item of await studio.getPollablePublicationChannels(1)) {
      let result;
      try {
        const post = await getPost({apiKey: config.secrets.bufferApiKey, postId: item.buffer_id});
        const state = post.status === 'sent' ? 'sent' : post.status === 'failed' ? 'failed_confirmed' : 'accepted';
        result = {state, bufferId: post.id, bufferStatus: post.status, externalLink: post.externalLink, lastPolledAt: Date.now()};
        if (state === 'sent') summary.sentCount++;
      } catch (err) {
        result = {state: 'accepted', bufferId: item.buffer_id, errorCode: err.message, lastPolledAt: Date.now()};
        if (err.retryAt) summary.nextPollAt = err.retryAt;
      }
      await studio.sendPublicationResult({publicationId: item.publication_id, channelId: item.channel_id, ...result});
    }
    return summary;
  } finally { await release(); }
}
