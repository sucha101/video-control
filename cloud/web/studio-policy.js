export const STATE_LABELS = {
  waiting: {text: 'Đang chờ máy', badgeClass: 'badge-waiting'},
  producing: {text: 'Đang dựng video', badgeClass: 'badge-producing'},
  review: {text: 'Chờ duyệt video', badgeClass: 'badge-review'},
  completed: {text: 'Đã hoàn tất (lịch sử)', badgeClass: 'badge-review'},
  cancelled: {text: 'Đã hủy', badgeClass: 'badge-cancelled'},
  needs_review: {text: 'Cần kiểm tra', badgeClass: 'badge-needs_review'}
};

export const SKILL_NAMES = {
  'viet-tiktok-story-video': 'Kể chuyện TikTok',
  'drama-mascot-video': 'Linh vật Drama'
};

export const AGENT_NAMES = {codex: 'Codex (OpenAI)', antigravity: 'Antigravity (Google)'};

export function requestStateLabel(req) {
  if (req.publication_state === 'sent') return {text: 'Đã đăng các kênh đã chọn', badgeClass: 'badge-review'};
  if (req.publication_state === 'accepted') return {text: 'Buffer đã nhận, chờ xác nhận đăng', badgeClass: 'badge-producing'};
  if (req.publication_state === 'publishing') return {text: 'Đang xử lý xuất bản', badgeClass: 'badge-producing'};
  return STATE_LABELS[req.production_state] || {text: req.production_state, badgeClass: 'badge-waiting'};
}

export function canRetryReceipt(receipt) {
  return !receipt.buffer_id && (receipt.channel_state === 'ready' ||
    (receipt.channel_state === 'failed_confirmed' && /(?:^|\D)429(?:\D|$)/.test(receipt.error_code || '')));
}

export function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function driveVideoId(req) {
  const url = safeHttpsUrl(req.drive_url);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.hostname !== 'drive.google.com') return null;
  return /^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(parsed.pathname)?.[1] || null;
}

export function canonicalSubmissionPayload(raw = {}) {
  const title = String(raw.title || '').trim();
  const script = String(raw.script || '').trim();
  const skill = String(raw.skill || 'viet-tiktok-story-video');
  const agentProvider = String(raw.agentProvider || 'codex');
  const voice = String(raw.voice || '').trim();
  const notes = String(raw.notes || '').trim();
  return {
    title,
    script,
    skill,
    agentProvider,
    ...(voice ? {voice} : {}),
    ...(notes ? {notes} : {})
  };
}

export function submissionIntent(previous, username, payload) {
  const signature = JSON.stringify([username, payload]);
  if (previous?.signature === signature) return previous;
  return {signature, key: `web-${crypto.randomUUID()}`};
}
