import {HttpError, boundedString} from '../shared/contracts.mjs';

const ALLOWED_CHANNELS = [
  '6a9a28c0065799be4684eacd', // YouTube Shorts (manga illlya)
  '6ac376a86a5c39ccb61d85e4', // TikTok (Triết Lý Sống Sâu - trietlysongsau)
  '6a985593065799be4674eed4', // TikTok legacy (datnguyentien470)
  '6a985567065799be4674ee3b'  // Facebook Reels (Cái đẹp là để ngắm)
];

export function createPublicationIntent(sql, requestId, user, body) {
  const req = sql.exec('SELECT * FROM web_requests WHERE id=? OR display_id=?', requestId, requestId).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu video');
  if (req.is_legacy) throw new HttpError(400, 'Không thể đăng lại bài lịch sử V001');
  if (req.production_state !== 'review') {
    throw new HttpError(400, 'Chỉ có thể tạo đợt đăng khi video đã hoàn tất và đang ở trạng thái chờ duyệt');
  }

  const publicationKey = boundedString(body.publicationKey, 'Publication Key', 128);
  const channelIds = Array.isArray(body.channelIds) ? body.channelIds : [];
  if (!channelIds.length) throw new HttpError(400, 'Vui lòng chọn ít nhất 1 kênh để đăng');
  if (channelIds.length > ALLOWED_CHANNELS.length || new Set(channelIds).size !== channelIds.length) {
    throw new HttpError(400, 'Danh sách kênh bị lặp hoặc quá dài');
  }
  for (const cid of channelIds) {
    if (!ALLOWED_CHANNELS.includes(cid)) {
      throw new HttpError(400, `Kênh không hợp lệ: ${cid}`);
    }
  }

  // Deduplication check by publicationKey
  const existing = sql.exec('SELECT * FROM web_publications WHERE publication_key=?', publicationKey).toArray()[0];
  if (existing) {
    if (existing.request_id !== req.id) throw new HttpError(409, 'Khóa xuất bản thuộc yêu cầu khác');
    const channels = sql.exec('SELECT * FROM web_publication_channels WHERE publication_id=?', existing.id).toArray();
    if (JSON.stringify([...channels.map(c => c.channel_id)].sort()) !== JSON.stringify([...channelIds].sort())) {
      throw new HttpError(409, 'Khóa xuất bản đã dùng với danh sách kênh khác');
    }
    return {publication: existing, channels, duplicate: true};
  }

  if (body.expectedReviewRevision !== req.review_revision) {
    throw new HttpError(409, 'Phiên bản duyệt đã thay đổi; hãy tải lại video trước khi đăng');
  }
  // A new random browser key must not replay the same video on the same channel.
  for (const cid of channelIds) {
    const previous = sql.exec(`SELECT c.state FROM web_publication_channels c
      JOIN web_publications p ON p.id=c.publication_id
      WHERE p.request_id=? AND c.channel_id=? LIMIT 1`, req.id, cid).toArray()[0];
    if (previous) throw new HttpError(409, 'Kênh này đã có đợt đăng; hãy kiểm tra biên nhận hoặc dùng thử lại an toàn');
  }

  const now = Date.now();
  const pubId = crypto.randomUUID();

  // Snapshot immutable state of the approved content
  const snapshot = {
    title: req.title,
    caption: req.caption || req.title,
    hashtags: req.hashtags || '',
    driveId: req.drive_id,
    driveUrl: req.drive_url,
    scheduledAtBangkok: body.scheduledAtBangkok || null,
    channelIds
  };

  sql.exec(
    `INSERT INTO web_publications (
      id, request_id, publication_key, review_revision, snapshot_json, approved_by, approved_at
    ) VALUES (?,?,?,?,?,?,?)`,
    pubId, req.id, publicationKey, req.review_revision, JSON.stringify(snapshot), user.username, now
  );

  for (const cid of channelIds) {
    sql.exec(
      `INSERT INTO web_publication_channels (
        publication_id, channel_id, state
      ) VALUES (?,?,?)`,
      pubId, cid, 'ready'
    );
  }

  sql.exec(
    'INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), req.id, 'publication_intent_created', user.username,
    JSON.stringify({pubId, channelCount: channelIds.length}), now
  );

  const createdPub = sql.exec('SELECT * FROM web_publications WHERE id=?', pubId).toArray()[0];
  const channels = sql.exec('SELECT * FROM web_publication_channels WHERE publication_id=?', pubId).toArray();

  return {publication: createdPub, channels, duplicate: false};
}

export function getPublications(sql, requestId) {
  const pubs = sql.exec('SELECT * FROM web_publications WHERE request_id=? ORDER BY approved_at DESC', requestId).toArray();
  const result = [];
  for (const pub of pubs) {
    const channels = sql.exec('SELECT * FROM web_publication_channels WHERE publication_id=?', pub.id).toArray();
    result.push({
      ...pub,
      snapshot: JSON.parse(pub.snapshot_json || '{}'),
      channels
    });
  }
  return result;
}

export function claimPublicationChannels(sql, workerId, limit = 5) {
  if (!workerId) throw new HttpError(400, 'Thiếu workerId');
  const now = Date.now();
  // Expired sends have an unknown provider outcome. Never automatically recreate them.
  sql.exec(`UPDATE web_publication_channels SET state='needs_review',
    error_code='Lease gửi hết hạn; cần đối soát Buffer trước khi gửi lại'
    WHERE state='attempting' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?`, now);
  const rows = sql.exec(
    `SELECT c.*, p.request_id, p.snapshot_json
     FROM web_publication_channels c
     JOIN web_publications p ON c.publication_id = p.id
     WHERE c.state = 'ready'
     ORDER BY p.approved_at, c.channel_id
     LIMIT 1`
  ).toArray();

  for (const row of rows) {
    sql.exec(
      `UPDATE web_publication_channels SET state='attempting', worker_id=?,
       fence_epoch=fence_epoch+1, lease_expires_at=? WHERE publication_id=? AND channel_id=?`,
      workerId, now + 300000, row.publication_id, row.channel_id
    );
    row.worker_id = workerId;
    row.fence_epoch += 1;
    row.lease_expires_at = now + 300000;
    row.state = 'attempting';
  }

  return rows.map(r => ({
    ...r,
    snapshot: JSON.parse(r.snapshot_json || '{}')
  }));
}

export function updatePublicationChannelResult(sql, {publicationId, channelId, workerId, fenceEpoch, bufferId, bufferStatus, externalLink, errorCode, state, lastPolledAt}) {
  const row = sql.exec('SELECT * FROM web_publication_channels WHERE publication_id=? AND channel_id=?', publicationId, channelId).toArray()[0];
  if (!row) throw new HttpError(404, 'Không tìm thấy biên nhận kênh');
  if (!workerId || row.worker_id !== workerId || row.fence_epoch !== fenceEpoch) {
    throw new HttpError(409, 'Biên nhận không thuộc lượt xử lý này');
  }
  if (!['attempting', 'accepted'].includes(row.state) || row.lease_expires_at <= Date.now()) {
    throw new HttpError(409, 'Lượt xử lý đã kết thúc hoặc hết hạn');
  }
  if (!['accepted', 'sent', 'failed_confirmed', 'needs_review', 'ready'].includes(state)) {
    throw new HttpError(400, 'Trạng thái xuất bản không hợp lệ');
  }
  if (state === 'ready' && (row.buffer_id || !/(?:^|\D)429(?:\D|$)/.test(errorCode || ''))) {
    throw new HttpError(409, 'Chỉ trả về chờ khi Buffer xác nhận từ chối do hạn mức');
  }
  if (['accepted', 'sent'].includes(state) && !(bufferId || row.buffer_id)) {
    throw new HttpError(400, 'Thiếu ID bài Buffer');
  }
  if (row.buffer_id && bufferId && row.buffer_id !== bufferId) throw new HttpError(409, 'ID Buffer không được thay đổi');
  const now = Date.now();
  const nextPoll = state === 'accepted' ? now + Math.min(6 * 3600000, 3600000 * 2 ** Math.min(row.poll_count || 0, 3)) : null;
  sql.exec(
    `UPDATE web_publication_channels SET
      buffer_id = COALESCE(?, buffer_id),
      buffer_status = COALESCE(?, buffer_status),
      external_link = COALESCE(?, external_link),
      error_code = ?,
      state = ?,
      last_polled_at = COALESCE(?, last_polled_at),
      next_poll_at = ?,
      accepted_at = COALESCE(accepted_at, ?),
      lease_expires_at = NULL,
      worker_id = NULL
     WHERE publication_id = ? AND channel_id = ?`,
    bufferId || null,
    bufferStatus || null,
    externalLink || null,
    errorCode || null,
    state,
    row.state === 'accepted' ? now : lastPolledAt || null,
    nextPoll,
    ['accepted', 'sent'].includes(state) ? now : null,
    publicationId,
    channelId
  );
  return {ok: true};
}

export function getPollablePublicationChannels(sql, limit = 5, workerId) {
  if (!workerId) throw new HttpError(400, 'Thiếu workerId để đối soát');
  const now = Date.now();
  const rows = sql.exec(
    `SELECT c.*, p.request_id
     FROM web_publication_channels c
     JOIN web_publications p ON c.publication_id = p.id
     WHERE c.state='accepted' AND c.buffer_id IS NOT NULL
       AND (c.next_poll_at IS NULL OR c.next_poll_at<=?)
       AND (c.lease_expires_at IS NULL OR c.lease_expires_at<=?)
     ORDER BY COALESCE(c.next_poll_at,0), p.approved_at
     LIMIT ?`,
    now, now,
    Math.min(Math.max(Number(limit) || 1, 1), 5)
  ).toArray();
  for (const row of rows) {
    sql.exec(`UPDATE web_publication_channels SET worker_id=?, fence_epoch=fence_epoch+1,
      lease_expires_at=?, last_polled_at=?, next_poll_at=?, poll_count=poll_count+1
      WHERE publication_id=? AND channel_id=?`,
      workerId, now + 300000, now, now + 3600000, row.publication_id, row.channel_id);
    row.worker_id = workerId;
    row.fence_epoch += 1;
    row.lease_expires_at = now + 300000;
  }
  return rows;
}

export function retryPublicationChannels(sql, requestId, channelIds) {
  const req = sql.exec('SELECT id FROM web_requests WHERE id=? OR display_id=?', requestId, requestId).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy video');
  if (!Array.isArray(channelIds) || channelIds.length === 0 || channelIds.length > ALLOWED_CHANNELS.length ||
      new Set(channelIds).size !== channelIds.length || channelIds.some(id => !ALLOWED_CHANNELS.includes(id))) {
    throw new HttpError(400, 'Hãy chọn ít nhất một kênh hợp lệ để thử lại');
  }

  const pub = sql.exec('SELECT id FROM web_publications WHERE request_id=? ORDER BY approved_at DESC LIMIT 1', req.id).toArray()[0];
  if (!pub) throw new HttpError(404, 'Không tìm thấy đợt xuất bản nào để thử lại');

  const rows = sql.exec('SELECT channel_id, state, buffer_id, error_code FROM web_publication_channels WHERE publication_id=?', pub.id).toArray();
  for (const channelId of channelIds) {
    const row = rows.find(item => item.channel_id === channelId);
    if (!row) throw new HttpError(400, 'Kênh đã chọn không thuộc đợt đăng này');
    const rateLimited = row.state === 'failed_confirmed' && /(?:^|\D)429(?:\D|$)/.test(row.error_code || '');
    if (row.buffer_id || (row.state !== 'ready' && !rateLimited && row.state !== 'failed_confirmed')) {
      throw new HttpError(409, 'Có kênh đã gửi hoặc chưa rõ kết quả; cần kiểm tra Buffer trước khi thử lại');
    }
  }

  for (const channelId of channelIds) {
    sql.exec(
      `UPDATE web_publication_channels SET state='ready', error_code=NULL
       WHERE publication_id=? AND channel_id=?`,
      pub.id, channelId
    );
  }

  return {ok: true, publicationId: pub.id, channelIds};
}

const CHANNEL_METADATA_CONFIG = {
  '6a9a28c0065799be4684eacd': {service: 'youtube', categoryId: '24', privacy: 'public'},
  '6ac376a86a5c39ccb61d85e4': {service: 'tiktok'},
  '6a985593065799be4674eed4': {service: 'tiktok'},
  '6a985567065799be4674ee3b': {service: 'facebook', type: 'reel'}
};

export async function dispatchPublicationToBuffer(sql, env, pubId) {
  const apiKey = env.BUFFER_API_KEY;
  if (!apiKey) {
    console.warn('[Buffer Dispatch] BUFFER_API_KEY not configured in Worker environment.');
    return;
  }

  const pub = sql.exec('SELECT * FROM web_publications WHERE id=?', pubId).toArray()[0];
  if (!pub) return;

  const snapshot = JSON.parse(pub.snapshot_json || '{}');
  const mediaUrl = snapshot.driveId
    ? `https://drive.google.com/uc?export=download&id=${snapshot.driveId}`
    : (snapshot.driveUrl || '');

  if (!mediaUrl) {
    console.error('[Buffer Dispatch] No media URL or driveId in snapshot');
    return;
  }

  // Check scheduled time
  let dueAt = undefined;
  let mode = 'shareNow';
  if (snapshot.scheduledAtBangkok) {
    const raw = snapshot.scheduledAtBangkok.trim();
    const dateStr = raw.includes('T') ? (raw.endsWith('+07:00') ? raw : `${raw}:00+07:00`) : `${raw.replace(' ', 'T')}:00+07:00`;
    const dt = new Date(dateStr);
    // Buffer requires scheduled time to be in the future (at least 2 minutes ahead)
    if (!isNaN(dt.getTime()) && dt.getTime() > Date.now() + 120000) {
      dueAt = dt.toISOString();
      mode = 'customScheduled';
    } else {
      console.warn(`[Buffer Dispatch] Scheduled time ${raw} is in past/near future; falling back to shareNow.`);
    }
  }

  const channels = sql.exec("SELECT * FROM web_publication_channels WHERE publication_id=? AND state='ready'", pubId).toArray();

  for (const ch of channels) {
    const chConfig = CHANNEL_METADATA_CONFIG[ch.channel_id] || {};
    const service = chConfig.service || '';
    const metadata = {};

    if (service === 'youtube') {
      metadata.youtube = {
        title: (snapshot.title || snapshot.caption || 'Video').slice(0, 100),
        categoryId: chConfig.categoryId || '24',
        privacy: chConfig.privacy || 'public',
        madeForKids: false
      };
    } else if (service === 'tiktok') {
      metadata.tiktok = { isAiGenerated: false };
    } else if (service === 'facebook') {
      metadata.facebook = { type: 'reel' };
    }

    const query = `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post {
              id
              status
            }
          }
          ... on InvalidInputError { message }
          ... on UnauthorizedError { message }
          ... on LimitReachedError { message }
          ... on UnexpectedError { message }
        }
      }
    `;

    const variables = {
      input: {
        channelId: ch.channel_id,
        text: snapshot.caption || '',
        schedulingType: 'automatic',
        ...(dueAt ? { dueAt } : {}),
        mode,
        needsApproval: false,
        assets: {
          video: { url: mediaUrl }
        },
        metadata
      }
    };

    try {
      const resp = await fetch('https://api.buffer.com', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({query, variables})
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const resJson = await resp.json();
      if (resJson.errors?.length) {
        throw new Error(resJson.errors[0].message);
      }

      const createResult = resJson.data?.createPost;
      if (createResult?.message) {
        throw new Error(createResult.message);
      }

      const post = createResult?.post;
      if (!post || !post.id) {
        throw new Error('Buffer returned no post ID');
      }

      const now = Date.now();
      sql.exec(
        `UPDATE web_publication_channels SET
          state = 'accepted',
          buffer_id = ?,
          buffer_status = ?,
          accepted_at = ?,
          error_code = NULL
         WHERE publication_id = ? AND channel_id = ?`,
        post.id, post.status || 'accepted', now, pubId, ch.channel_id
      );
    } catch (err) {
      console.error(`[Buffer Dispatch] Failed to post channel ${ch.channel_id}:`, err.message);
      sql.exec(
        `UPDATE web_publication_channels SET
          state = 'failed_confirmed',
          error_code = ?
         WHERE publication_id = ? AND channel_id = ?`,
        err.message, pubId, ch.channel_id
      );
    }
  }
}
