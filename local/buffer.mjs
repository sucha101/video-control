import {bufferBudget, BufferRateLimitError} from './buffer-budget.mjs';
export {BufferRateLimitError};
export const getBufferCooldown = (kind = 'read') => bufferBudget.cooldown(kind);

async function bufferRequest({apiKey, query, variables, fetchImpl, budget, kind}) {
  const controller = new AbortController();
  let timer;
  try {
    const response = await budget.request(kind, () => {
      timer = setTimeout(() => controller.abort(), 20000);
      return fetchImpl('https://api.buffer.com', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables}), signal: controller.signal
      });
    });
    if (!response.ok) {
      const error = new Error(`Buffer API trả mã lỗi ${response.status}`);
      error.status = response.status;
      error.definitelyNotCreated = [400, 401, 403, 404, 422].includes(response.status);
      await response.body?.cancel?.().catch(() => {});
      throw error;
    }
    const json = await response.json();
    if (json.errors?.length) throw new Error(`Buffer GraphQL error: ${json.errors[0].message}`);
    return json;
  } finally { clearTimeout(timer); }
}

export function scheduleUTC(schedule) {
  if (!schedule) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(schedule.trim());
  const dateStr = match ? `${match[1]}T${match[2]}:00+07:00` : schedule;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error('Ngày giờ không hợp lệ');
  return d.toISOString();
}

export async function publishChannels({channels = [], state = {}, save = async () => {}, fence = async () => {}, create, input, schedule}) {
  if (!channels || !channels.length) throw new Error('Không có kênh nào được cấu hình');
  const scheduledAt = scheduleUTC(schedule);
  const results = {};

  for (const channel of channels) {
    const chId = channel.id || channel.channelId;
    const existing = state[chId];

    if (existing?.id || existing?.status === 'accepted' || existing?.status === 'published') {
      results[chId] = existing;
      continue;
    }

    if (existing?.intent === 'pending' || existing?.status === 'needs_review') {
      throw new Error(`Kênh ${chId} đang ở trạng thái chưa rõ hoặc cần kiểm tra, không đăng tự động lại`);
    }

    // Persist intent before network request
    state[chId] = {
      intent: 'pending',
      service: channel.service,
      attemptedAt: new Date().toISOString()
    };
    await save(state);

    await fence();

    try {
      const res = await create(channel, input, scheduledAt);
      state[chId] = {
        intent: 'completed',
        status: res.status || 'accepted',
        id: res.id,
        service: channel.service,
        completedAt: new Date().toISOString()
      };
      await save(state);
      results[chId] = state[chId];
    } catch (err) {
      state[chId] = {
        intent: 'pending',
        status: 'needs_review',
        error: err.message,
        service: channel.service,
        failedAt: new Date().toISOString()
      };
      await save(state);
      throw new Error(`Đăng kênh ${chId} gặp sự cố (${err.message}): cần kiểm tra`);
    }
  }

  return results;
}

export async function createBufferPost({apiKey, channel, input, scheduledAt, fetchImpl = fetch, budget = bufferBudget}) {
  if (!apiKey) throw new Error('Thiếu Buffer API Key');
  const service = (channel.service || '').toLowerCase();
  const metadata = {};

  if (service === 'youtube') {
    metadata.youtube = {
      title: input.title || (input.caption || '').slice(0, 100) || 'Video',
      categoryId: channel.categoryId || '24',
      privacy: channel.privacy || 'public',
      madeForKids: false
    };
  } else if (service === 'tiktok') {
    metadata.tiktok = {
      isAiGenerated: false
    };
  } else if (service === 'facebook') {
    metadata.facebook = {
      type: 'reel'
    };
  }

  const schedulingType = 'automatic';
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
        ... on InvalidInputError {
          message
        }
        ... on UnauthorizedError {
          message
        }
        ... on LimitReachedError {
          message
        }
        ... on UnexpectedError {
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      channelId: channel.id,
      text: input.caption || '',
      schedulingType,
      ...(scheduledAt ? { dueAt: scheduledAt } : {}),
      mode: scheduledAt ? 'customScheduled' : 'shareNow',
      needsApproval: false,
      assets: {
        video: {
          url: input.mediaUrl
        }
      },
      metadata
    }
  };

  const json = await bufferRequest({apiKey, query, variables, fetchImpl, budget, kind: 'write'});

  const result = json.data?.createPost;
  if (result?.message) {
    const error = new Error(`Buffer từ chối tạo bài: ${result.message}`);
    error.definitelyNotCreated = ['InvalidInputError', 'UnauthorizedError', 'LimitReachedError'].includes(result.__typename);
    throw error;
  }

  const post = result?.post;
  if (!post || !post.id) {
    throw new Error('Buffer không trả về ID bài đăng');
  }

  return { id: post.id, status: post.status || 'accepted' };
}

export function formatDownloadUrl(driveId, driveUrl) {
  if (driveId) {
    return `https://drive.google.com/uc?export=download&id=${driveId}`;
  }
  if (driveUrl && driveUrl.includes('/file/d/')) {
    const id = driveUrl.split('/file/d/')[1].split('/')[0];
    return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  return driveUrl || '';
}

export async function probeMediaUrl(mediaUrl, {fetchImpl = fetch, timeoutMs = 10000} = {}) {
  if (!mediaUrl) {
    return {ok: false, reason: 'Media URL bị rỗng'};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(mediaUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-1024' },
      signal: controller.signal
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const status = res.status;
    // A server may ignore Range and stream the entire video; release it as soon
    // as headers have been inspected instead of leaving large downloads open.
    await res.body?.cancel?.().catch(() => {});
    const isVideo = contentType.includes('video/mp4') || contentType.includes('application/octet-stream');
    const isHtml = contentType.includes('text/html');

    if ((status === 200 || status === 206) && isVideo && !isHtml) {
      return { ok: true, contentType, status, finalUrl: res.url || mediaUrl };
    }
    return {
      ok: false,
      reason: `Media URL không trả về MP4 hợp lệ (HTTP ${status}, Content-Type: ${contentType || 'không rõ'})`,
      status,
      contentType
    };
  } catch (err) {
    return { ok: false, reason: `Không thể kết nối tải thử video: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function getBufferPost({apiKey, postId, fetchImpl = fetch, budget = bufferBudget}) {
  if (!apiKey) throw new Error('Thiếu Buffer API Key');
  if (!postId) throw new Error('Thiếu postId');

  const query = `
    query GetPost($id: PostId!) {
      post(input: { id: $id }) {
        id
        status
        dueAt
        sentAt
        externalLink
        error {
          message
        }
      }
    }
  `;

  const json = await bufferRequest({apiKey, query, variables: {id: postId}, fetchImpl, budget, kind: 'read'});

  const post = json.data?.post;
  if (!post) {
    throw new Error(`Không tìm thấy bài đăng Buffer: ${postId}`);
  }

  return {
    id: post.id,
    status: post.status,
    dueAt: post.dueAt,
    sentAt: post.sentAt,
    externalLink: post.externalLink || null,
    errorMessage: post.error?.message || null
  };
}
