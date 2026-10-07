import {HttpError, boundedString, safeText} from '../shared/contracts.mjs';
import {sha256Hex} from './web-auth.mjs';

export function ensureWebSchema(sql) {
  // Additive migrations on existing Durable Object SQLite database
  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      csrf_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_login_attempts (
      ip_user_bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      locked_until INTEGER
    );
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_requests (
      id TEXT PRIMARY KEY,
      display_id TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      client_submission_key TEXT NOT NULL,
      title TEXT NOT NULL,
      script TEXT NOT NULL,
      skill TEXT NOT NULL,
      agent_provider TEXT NOT NULL DEFAULT 'codex',
      voice TEXT,
      reference_urls TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      input_revision INTEGER NOT NULL DEFAULT 1,
      input_hash TEXT NOT NULL,
      review_revision INTEGER NOT NULL DEFAULT 1,
      production_state TEXT NOT NULL DEFAULT 'waiting',
      drive_id TEXT,
      drive_url TEXT,
      caption TEXT,
      hashtags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_legacy INTEGER NOT NULL DEFAULT 0,
      sheet_row_number INTEGER,
      sheet_synced_at INTEGER,
      UNIQUE(created_by, client_submission_key)
    );
  `);

  sql.exec(`CREATE INDEX IF NOT EXISTS web_requests_state ON web_requests(production_state, updated_at DESC);`);
  sql.exec(`CREATE INDEX IF NOT EXISTS web_requests_created ON web_requests(created_at DESC);`);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_production_claims (
      request_id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      lease_token_hash TEXT NOT NULL,
      fence_epoch INTEGER NOT NULL DEFAULT 1,
      input_revision INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      progress_summary TEXT
    );
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_publications (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      publication_key TEXT UNIQUE NOT NULL,
      review_revision INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at INTEGER NOT NULL
    );
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_publication_channels (
      publication_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      state TEXT NOT NULL,
      buffer_id TEXT UNIQUE,
      buffer_status TEXT,
      external_link TEXT,
      last_polled_at INTEGER,
      error_code TEXT,
      fence_epoch INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(publication_id, channel_id)
    );
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_sync_outbox (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL
    );
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS web_events (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Additive upgrades preserve production receipts and the original Zalo queue.
  const addColumn = (table, name, definition) => {
    const columns = sql.exec(`PRAGMA table_info(${table})`).toArray();
    if (!columns.some(column => column.name === name)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  for (const [name, definition] of [
    ['worker_id', 'TEXT'], ['lease_expires_at', 'INTEGER'],
    ['next_poll_at', 'INTEGER'], ['poll_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['accepted_at', 'INTEGER']
  ]) addColumn('web_publication_channels', name, definition);
  addColumn('web_requests', 'agent_provider', "TEXT NOT NULL DEFAULT 'codex'");
  addColumn('web_requests', 'production_error', 'TEXT');
  for (const [name, definition] of [['worker_id', 'TEXT'], ['claim_token', 'TEXT']]) {
    addColumn('web_sync_outbox', name, definition);
  }
  sql.exec('CREATE INDEX IF NOT EXISTS web_publication_poll ON web_publication_channels(state, next_poll_at)');

  // Reconcile V005 Buffer receipts
  sql.exec(`UPDATE web_publication_channels
    SET buffer_id='6ac5992cb6dcff802a02417f', buffer_status='sent', state='accepted', error_code=NULL, accepted_at=COALESCE(accepted_at, ?)
    WHERE publication_id='e82d489e-9e36-457e-9dbc-37a13d1c821e' AND channel_id='6a9a28c0065799be4684eacd'`, Date.now());
  sql.exec(`UPDATE web_publication_channels
    SET buffer_id='6ac59933535511041618900b', buffer_status='sending', state='accepted', error_code=NULL, accepted_at=COALESCE(accepted_at, ?)
    WHERE publication_id='e82d489e-9e36-457e-9dbc-37a13d1c821e' AND channel_id='6ac376a86a5c39ccb61d85e4'`, Date.now());
  sql.exec(`UPDATE web_publication_channels
    SET error_code=NULL
    WHERE publication_id='e82d489e-9e36-457e-9dbc-37a13d1c821e' AND channel_id='6a985567065799be4674ee3b'`);

  ensureLegacyV001(sql);
}

export function ensureLegacyV001(sql) {
  const existing = sql.exec("SELECT id FROM web_requests WHERE display_id='V001'").toArray()[0];
  if (existing) return;
  const now = Date.now();
  const id = 'v001-legacy-import';
  sql.exec(
    `INSERT INTO web_requests (
      id, display_id, created_by, client_submission_key, title, script, skill,
      voice, reference_urls, notes, input_revision, input_hash, review_revision,
      production_state, drive_id, drive_url, caption, hashtags,
      created_at, updated_at, is_legacy, sheet_row_number
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    'V001',
    'owner',
    'legacy-v001-seed',
    'V001 - Video mẫu đã hoàn tất',
    'Kịch bản V001 đã render và đăng tải thành công',
    'viet-tiktok-story-video',
    'Bé Simi',
    '[]',
    'Video lịch sử (legacy_readonly)',
    1,
    'legacy-v001-hash',
    1,
    'completed',
    '1z68E8YexfxPSdtNFOSxuYWiceKpD2ARL',
    'https://drive.google.com/file/d/1z68E8YexfxPSdtNFOSxuYWiceKpD2ARL/view',
    'V001 Video #manga #story',
    '#manga #story',
    now,
    now,
    1,
    2
  );
}

export function computeNextDisplayId(sql) {
  const rows = sql.exec("SELECT display_id FROM web_requests WHERE display_id LIKE 'V%'").toArray();
  let maxNum = 0;
  for (const row of rows) {
    const match = /^V(\d+)$/.exec(row.display_id);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const nextNum = maxNum + 1;
  return `V${String(nextNum).padStart(3, '0')}`;
}

export async function computeInputHash({title, script, skill, agentProvider = 'codex', voice, referenceUrls, notes}, {includeAgentProvider = true} = {}) {
  const payload = {
    title: (title || '').trim(),
    script: (script || '').trim(),
    skill: (skill || '').trim(),
    ...(includeAgentProvider ? {agentProvider: (agentProvider || 'codex').trim()} : {}),
    voice: (voice || '').trim(),
    referenceUrls: Array.isArray(referenceUrls) ? referenceUrls : [],
    notes: (notes || '').trim()
  };
  return sha256Hex(JSON.stringify(payload));
}

const ALLOWED_SKILLS = ['viet-tiktok-story-video', 'drama-mascot-video'];

export async function createWebRequest(sql, user, body) {
  const title = boundedString(body.title, 'Tiêu đề', 160).trim();
  const script = boundedString(body.script, 'Kịch bản', 30000).trim();
  const skill = boundedString(body.skill, 'Kỹ năng / Phong cách', 100).trim();
  if (!ALLOWED_SKILLS.includes(skill)) {
    throw new HttpError(400, `Skill không hợp lệ. Phải là một trong: ${ALLOWED_SKILLS.join(', ')}`);
  }
  const agentProvider = body.agentProvider === undefined ? 'codex' : boundedString(body.agentProvider, 'AI thực hiện', 32).trim();
  if (!['codex', 'antigravity'].includes(agentProvider)) {
    throw new HttpError(400, 'AI thực hiện không được hỗ trợ');
  }
  const voice = body.voice ? boundedString(body.voice, 'Giọng đọc', 100).trim() : null;
  const notes = body.notes ? boundedString(body.notes, 'Ghi chú', 2000).trim() : null;
  const submissionKey = boundedString(body.clientSubmissionKey, 'Khóa gửi yêu cầu', 128).trim();

  let refUrls = [];
  if (Array.isArray(body.referenceUrls)) {
    if (body.referenceUrls.length > 20) throw new HttpError(400, 'Tối đa 20 link tham chiếu');
    for (const url of body.referenceUrls) {
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        throw new HttpError(400, 'Link tham chiếu phải bắt đầu bằng https://');
      }
      refUrls.push(url.trim());
    }
  }

  const inputHash = await computeInputHash({title, script, skill, agentProvider, voice, referenceUrls: refUrls, notes});
  const legacyInputHash = agentProvider === 'codex'
    ? await computeInputHash({title, script, skill, voice, referenceUrls: refUrls, notes}, {includeAgentProvider: false})
    : null;

  // Check deduplication
  const existing = sql.exec(
    'SELECT * FROM web_requests WHERE created_by=? AND client_submission_key=?',
    user.username,
    submissionKey
  ).toArray()[0];

  if (existing) {
    if (existing.input_hash === inputHash || existing.input_hash === legacyInputHash) {
      return {request: existing, duplicate: true};
    }
    throw new HttpError(409, 'Khóa gửi yêu cầu đã tồn tại với nội dung khác');
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const displayId = computeNextDisplayId(sql);

  sql.exec(
    `INSERT INTO web_requests (
      id, display_id, created_by, client_submission_key, title, script, skill, agent_provider,
      voice, reference_urls, notes, input_revision, input_hash, review_revision,
      production_state, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    displayId,
    user.username,
    submissionKey,
    title,
    script,
    skill,
    agentProvider,
    voice,
    JSON.stringify(refUrls),
    notes,
    1,
    inputHash,
    1,
    'waiting',
    now,
    now
  );

  // Record audit event
  sql.exec(
    'INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(),
    id,
    'request_created',
    user.username,
    JSON.stringify({displayId, title, skill, agentProvider}),
    now
  );

  // Queue initial Sheet sync
  sql.exec(
    'INSERT INTO web_sync_outbox (id, request_id, kind, revision, payload, next_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(),
    id,
    'request_created',
    1,
    JSON.stringify({id, displayId, title, script, skill, agentProvider, voice, notes}),
    now
  );

  const created = sql.exec('SELECT * FROM web_requests WHERE id=?', id).toArray()[0];
  return {request: created, duplicate: false};
}

export function listWebRequests(sql, {state, cursor, limit = 20}) {
  const boundedLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
  let query = `SELECT *, (SELECT CASE
    WHEN COUNT(*)=0 THEN NULL
    WHEN SUM(CASE WHEN c.state='sent' THEN 1 ELSE 0 END)=COUNT(*) THEN 'sent'
    WHEN SUM(CASE WHEN c.state='accepted' THEN 1 ELSE 0 END)=COUNT(*) THEN 'accepted'
    ELSE 'publishing' END
    FROM web_publications p JOIN web_publication_channels c ON p.id=c.publication_id
    WHERE p.request_id=web_requests.id) AS publication_state
    FROM web_requests WHERE 1=1`;
  const params = [];

  if (state) {
    query += ' AND production_state=?';
    params.push(state);
  }

  if (cursor) {
    // Cursor format: `${updated_at}_${id}`
    const parts = cursor.split('_');
    if (parts.length === 2) {
      const cursorTime = parseInt(parts[0], 10);
      const cursorId = parts[1];
      query += ' AND (updated_at < ? OR (updated_at = ? AND id < ?))';
      params.push(cursorTime, cursorTime, cursorId);
    }
  }

  query += ' ORDER BY updated_at DESC, id DESC LIMIT ?';
  params.push(boundedLimit + 1);

  const rows = sql.exec(query, ...params).toArray();
  let nextCursor = null;

  if (rows.length > boundedLimit) {
    const lastItem = rows[boundedLimit - 1];
    nextCursor = `${lastItem.updated_at}_${lastItem.id}`;
    rows.pop();
  }

  return {requests: rows, nextCursor};
}

export function getWebRequest(sql, id) {
  const req = sql.exec(`SELECT web_requests.*,
    (SELECT CASE
      WHEN COUNT(*)=0 THEN NULL
      WHEN SUM(CASE WHEN c.state='sent' THEN 1 ELSE 0 END)=COUNT(*) THEN 'sent'
      WHEN SUM(CASE WHEN c.state='accepted' THEN 1 ELSE 0 END)=COUNT(*) THEN 'accepted'
      ELSE 'publishing' END
     FROM web_publications p JOIN web_publication_channels c ON p.id=c.publication_id
     WHERE p.request_id=web_requests.id) AS publication_state
    FROM web_requests WHERE id=? OR display_id=?`, id, id).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu video');

  const claim = sql.exec('SELECT * FROM web_production_claims WHERE request_id=?', req.id).toArray()[0];
  const publications = sql.exec(
    'SELECT p.*, c.channel_id, c.state as channel_state, c.buffer_id, c.buffer_status, c.external_link, c.error_code FROM web_publications p LEFT JOIN web_publication_channels c ON p.id = c.publication_id WHERE p.request_id=? ORDER BY p.approved_at DESC',
    req.id
  ).toArray();

  const publicClaim = claim ? {
    worker_id: claim.worker_id,
    fence_epoch: claim.fence_epoch,
    expires_at: claim.expires_at,
    progress_summary: claim.progress_summary
  } : null;
  return {request: req, claim: publicClaim, publications};
}

export async function patchWebRequest(sql, id, user, body) {
  const req = sql.exec('SELECT * FROM web_requests WHERE id=?', id).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu');
  if (req.production_state !== 'waiting') {
    throw new HttpError(400, 'Chỉ có thể sửa yêu cầu khi ở trạng thái đang chờ');
  }

  if (body.expectedRevision === undefined || body.expectedRevision !== req.input_revision) {
    throw new HttpError(409, 'Dữ liệu đã thay đổi bởi phiên khác (xung đột phiên bản)');
  }

  const title = body.title !== undefined ? boundedString(body.title, 'Tiêu đề', 160).trim() : req.title;
  const script = body.script !== undefined ? boundedString(body.script, 'Kịch bản', 30000).trim() : req.script;
  const skill = body.skill !== undefined ? boundedString(body.skill, 'Skill', 100).trim() : req.skill;
  if (!ALLOWED_SKILLS.includes(skill)) throw new HttpError(400, 'Skill không hợp lệ');
  const agentProvider = body.agentProvider !== undefined
    ? boundedString(body.agentProvider, 'AI thực hiện', 32).trim()
    : (req.agent_provider || 'codex');
  if (!['codex', 'antigravity'].includes(agentProvider)) throw new HttpError(400, 'AI thực hiện không được hỗ trợ');
  const voice = body.voice !== undefined ? boundedString(body.voice, 'Giọng', 100).trim() : req.voice;
  const notes = body.notes !== undefined ? boundedString(body.notes, 'Ghi chú', 2000).trim() : req.notes;

  const now = Date.now();
  const nextRev = req.input_revision + 1;
  const newHash = await computeInputHash({title, script, skill, agentProvider, voice, referenceUrls: JSON.parse(req.reference_urls || '[]'), notes});

  // Hashing yields to other requests. Recheck after it so a concurrent claim or edit wins safely.
  const current = sql.exec('SELECT * FROM web_requests WHERE id=?', id).toArray()[0];
  if (current.input_revision !== req.input_revision || current.production_state !== 'waiting') {
    throw new HttpError(409, 'Yêu cầu đã được sửa hoặc bắt đầu dựng trong lúc cập nhật');
  }

  sql.exec(
    `UPDATE web_requests SET
      title=?, script=?, skill=?, agent_provider=?, voice=?, notes=?,
      input_revision=?, input_hash=?, updated_at=?
     WHERE id=?`,
    title, script, skill, agentProvider, voice, notes, nextRev, newHash, now, id
  );

  sql.exec(
    'INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), id, 'request_updated', user.username,
    JSON.stringify({revision: nextRev, title, skill, agentProvider}), now
  );

  return sql.exec('SELECT * FROM web_requests WHERE id=?', id).toArray()[0];
}

export function cancelWebRequest(sql, id, user, body) {
  const req = sql.exec('SELECT * FROM web_requests WHERE id=?', id).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu');
  if (req.production_state !== 'waiting') {
    throw new HttpError(400, 'Chỉ có thể hủy yêu cầu khi ở trạng thái đang chờ');
  }
  if (body.expectedRevision !== undefined && body.expectedRevision !== req.input_revision) {
    throw new HttpError(409, 'Xung đột phiên bản khi hủy yêu cầu');
  }

  const now = Date.now();
  sql.exec("UPDATE web_requests SET production_state='cancelled', updated_at=? WHERE id=?", now, id);

  sql.exec(
    'INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), id, 'request_cancelled', user.username, JSON.stringify({cancelledBy: user.username}), now
  );

  return {ok: true, id, production_state: 'cancelled'};
}

export function patchWebReview(sql, id, user, body) {
  const req = sql.exec('SELECT * FROM web_requests WHERE id=?', id).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu');
  if (req.production_state !== 'review') {
    throw new HttpError(400, 'Chỉ có thể chỉnh sửa caption khi video đã hoàn tất chờ duyệt');
  }
  if (body.expectedReviewRevision !== req.review_revision) {
    throw new HttpError(409, 'Xung đột phiên bản duyệt');
  }

  const caption = body.caption !== undefined ? boundedString(body.caption, 'Caption', 2200).trim() : req.caption;
  const hashtags = body.hashtags !== undefined ? boundedString(body.hashtags, 'Hashtags', 500).trim() : req.hashtags;
  const now = Date.now();
  const nextRev = req.review_revision + 1;

  sql.exec(
    'UPDATE web_requests SET caption=?, hashtags=?, review_revision=?, updated_at=? WHERE id=?',
    caption, hashtags, nextRev, now, id
  );

  return sql.exec('SELECT * FROM web_requests WHERE id=?', id).toArray()[0];
}

export function getPendingStudioRequests(sql) {
  const now = Date.now();
  return sql.exec(`
    SELECT r.* FROM web_requests r
    LEFT JOIN web_production_claims c ON r.id = c.request_id
    WHERE r.is_legacy = 0 AND (
      r.production_state = 'waiting'
      OR (r.production_state = 'producing' AND (c.request_id IS NULL OR c.expires_at <= ?))
    )
    ORDER BY r.created_at ASC
  `, now).toArray();
}

export async function claimStudioRequest(sql, requestId, workerId) {
  if (!workerId) throw new HttpError(400, 'Thiếu workerId');
  // Generate/hash before reading ownership: no await may separate lease check and write.
  const leaseToken = crypto.randomUUID();
  const leaseTokenHash = await sha256Hex(leaseToken);
  const req = sql.exec('SELECT * FROM web_requests WHERE id=? OR display_id=?', requestId, requestId).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu video');
  if (req.is_legacy) throw new HttpError(400, 'Không thể claim bài lịch sử V001');

  // Check if active claim exists
  const existingClaim = sql.exec('SELECT * FROM web_production_claims WHERE request_id=?', req.id).toArray()[0];
  if (existingClaim && existingClaim.expires_at > Date.now()) {
    if (existingClaim.worker_id !== workerId) {
      throw new HttpError(409, 'Yêu cầu đang được xử lý bởi máy tính khác');
    }
  }
  if (!['waiting', 'producing', 'review', 'needs_review'].includes(req.production_state)) {
    throw new HttpError(409, `Yêu cầu không ở trạng thái có thể dựng (hiện tại: ${req.production_state})`);
  }

  const now = Date.now();
  const expiresAt = now + 900000; // 15 minutes lease
  const fenceEpoch = (existingClaim?.fence_epoch || 0) + 1;

  sql.exec(
    "UPDATE web_requests SET production_state='producing', updated_at=? WHERE id=?",
    now, req.id
  );

  sql.exec(
    `INSERT OR REPLACE INTO web_production_claims (
      request_id, worker_id, lease_token_hash, fence_epoch, input_revision, expires_at, progress_summary
    ) VALUES (?,?,?,?,?,?,?)`,
    req.id, workerId, leaseTokenHash, fenceEpoch, req.input_revision, expiresAt, 'Bắt đầu dựng cảnh'
  );

  sql.exec(
    'INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), req.id, 'production_claimed', workerId, JSON.stringify({workerId, expiresAt}), now
  );

  return {request: {...req, production_state: 'producing'}, leaseToken, expiresAt, fenceEpoch};
}

export async function heartbeatStudioRequest(sql, requestId, workerId, leaseToken, progress) {
  const tokenHash = await sha256Hex(leaseToken);
  const req = sql.exec('SELECT * FROM web_requests WHERE id=? OR display_id=?', requestId, requestId).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu video');

  const claim = sql.exec('SELECT * FROM web_production_claims WHERE request_id=?', req.id).toArray()[0];
  if (!claim || claim.worker_id !== workerId) {
    throw new HttpError(409, 'Worker không sở hữu lease của yêu cầu này');
  }

  if (claim.lease_token_hash !== tokenHash) {
    throw new HttpError(409, 'Lease token không khớp');
  }

  const now = Date.now();
  if (claim.expires_at <= now || claim.input_revision !== req.input_revision || req.production_state !== 'producing') {
    throw new HttpError(409, 'Lease đã hết hạn hoặc nội dung đã thay đổi');
  }
  const nextExpiry = now + 900000;
  const summary = progress ? boundedString(progress, 'Progress', 500) : claim.progress_summary;

  sql.exec(
    'UPDATE web_production_claims SET expires_at=?, progress_summary=? WHERE request_id=?',
    nextExpiry, summary, req.id
  );

  return {ok: true, expiresAt: nextExpiry};
}

export async function completeStudioRequest(sql, requestId, workerId, leaseToken, result) {
  const tokenHash = await sha256Hex(leaseToken);
  const req = sql.exec('SELECT * FROM web_requests WHERE id=? OR display_id=?', requestId, requestId).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu video');

  const claim = sql.exec('SELECT * FROM web_production_claims WHERE request_id=?', req.id).toArray()[0];
  if (!claim || claim.worker_id !== workerId) {
    throw new HttpError(409, 'Worker không sở hữu lease');
  }

  if (claim.lease_token_hash !== tokenHash) {
    throw new HttpError(409, 'Lease token không khớp');
  }

  const driveId = boundedString(result.driveId, 'Drive ID', 100);
  const driveUrl = boundedString(result.driveUrl, 'Drive URL', 2048);
  const caption = result.caption ? boundedString(result.caption, 'Caption', 2200) : req.caption;
  const hashtags = result.hashtags ? boundedString(result.hashtags, 'Hashtags', 500) : req.hashtags;

  const now = Date.now();
  if (claim.expires_at <= now || claim.input_revision !== req.input_revision || req.production_state !== 'producing') {
    throw new HttpError(409, 'Lease đã hết hạn hoặc nội dung đã thay đổi');
  }
  sql.exec(
    `UPDATE web_requests SET
      production_state='review', drive_id=?, drive_url=?, caption=?, hashtags=?, review_revision=review_revision+1, updated_at=?
     WHERE id=?`,
    driveId, driveUrl, caption, hashtags, now, req.id
  );

  sql.exec('DELETE FROM web_production_claims WHERE request_id=?', req.id);

  sql.exec(
    'INSERT INTO web_sync_outbox (id, request_id, kind, revision, payload, next_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), req.id, 'production_completed', req.input_revision,
    JSON.stringify({id: req.id, displayId: req.display_id, driveUrl, caption, hashtags, statusRender: 'Hoàn tất'}),
    now
  );

  sql.exec(
    'INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), req.id, 'production_completed', workerId,
    JSON.stringify({driveId, driveUrl}), now
  );

  return {ok: true, id: req.id, production_state: 'review'};
}

export async function failStudioRequest(sql, requestId, workerId, leaseToken, message) {
  const tokenHash = await sha256Hex(leaseToken);
  const req = sql.exec('SELECT * FROM web_requests WHERE id=? OR display_id=?', requestId, requestId).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu video');
  const claim = sql.exec('SELECT * FROM web_production_claims WHERE request_id=?', req.id).toArray()[0];
  if (!claim || claim.worker_id !== workerId || claim.lease_token_hash !== tokenHash) {
    throw new HttpError(409, 'Worker không sở hữu lease của yêu cầu này');
  }
  if (claim.input_revision !== req.input_revision || req.production_state !== 'producing') {
    throw new HttpError(409, 'Nội dung đã thay đổi hoặc yêu cầu không còn đang dựng');
  }
  const error = safeText(message || 'Agent chưa hoàn tất video');
  const now = Date.now();
  sql.exec("UPDATE web_requests SET production_state='needs_review', production_error=?, updated_at=? WHERE id=?", error, now, req.id);
  sql.exec('DELETE FROM web_production_claims WHERE request_id=?', req.id);
  sql.exec('INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), req.id, 'production_needs_review', workerId, JSON.stringify({error}), now);
  return {ok: true, production_state: 'needs_review', error};
}

export function retryStudioRequest(sql, requestId, user) {
  const req = sql.exec('SELECT * FROM web_requests WHERE id=? OR display_id=?', requestId, requestId).toArray()[0];
  if (!req) throw new HttpError(404, 'Không tìm thấy yêu cầu video');
  if (req.production_state !== 'needs_review') throw new HttpError(409, 'Chỉ có thể thử lại yêu cầu cần kiểm tra');
  const now = Date.now();
  sql.exec("UPDATE web_requests SET production_state='waiting', production_error=NULL, updated_at=? WHERE id=?", now, req.id);
  sql.exec('INSERT INTO web_events (id, request_id, event_type, actor, data, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), req.id, 'production_retried', user.username, JSON.stringify({displayId: req.display_id}), now);
  return {ok: true, production_state: 'waiting'};
}

export function claimSyncOutbox(sql, workerId, limit = 10) {
  if (!workerId) throw new HttpError(400, 'Thiếu workerId');
  const now = Date.now();
  const boundedLimit = Math.min(Math.max(1, Number(limit) || 10), 20);
  const rows = sql.exec(
    'SELECT * FROM web_sync_outbox WHERE next_at <= ? ORDER BY next_at ASC LIMIT ?',
    now, boundedLimit
  ).toArray();

  for (const item of rows) {
    const claimToken = crypto.randomUUID();
    sql.exec('UPDATE web_sync_outbox SET next_at=?, worker_id=?, claim_token=? WHERE id=?', now + 300000, workerId, claimToken, item.id);
    item.worker_id = workerId;
    item.claim_token = claimToken;
  }

  return {items: rows};
}

export function completeSyncOutbox(sql, {workerId, completedIds = [], failedIds = [], claims = []}) {
  if (!workerId) throw new HttpError(400, 'Thiếu workerId');
  if (!Array.isArray(completedIds) || !Array.isArray(failedIds) || !Array.isArray(claims) || completedIds.length + failedIds.length > 20) {
    throw new HttpError(400, 'Danh sách xác nhận đồng bộ không hợp lệ');
  }
  const now = Date.now();
  for (const id of [...completedIds, ...failedIds]) {
    const item = sql.exec('SELECT * FROM web_sync_outbox WHERE id=?', id).toArray()[0];
    const receipt = claims.find(claim => claim.id === id);
    if (!item || item.worker_id !== workerId || !receipt || item.claim_token !== receipt.claimToken || item.next_at <= now) {
      throw new HttpError(409, 'Lượt đồng bộ đã hết hạn hoặc thuộc máy khác');
    }
  }
  for (const id of completedIds) {
    sql.exec('DELETE FROM web_sync_outbox WHERE id=?', id);
  }
  for (const id of failedIds) {
    sql.exec(
      `UPDATE web_sync_outbox SET attempts=attempts+1, next_at=?, worker_id=NULL, claim_token=NULL WHERE id=?`,
      now + Math.min(3600000, 30000 * 2 ** Math.min(sql.exec('SELECT attempts FROM web_sync_outbox WHERE id=?', id).toArray()[0].attempts, 7)), id
    );
  }
  return {ok: true};
}
