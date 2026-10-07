import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';

const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_PERMISSION_PAGES = 20;

const throwIfAborted = signal => signal?.throwIfAborted();
const sameStat = (a, b) => ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].every(key => a[key] === b[key]);
const discard = async response => {await response.body?.cancel?.().catch(() => {});};

export async function mediaIdentity(filePath, {signal, statImpl = stat, createReadStreamImpl = createReadStream} = {}) {
  throwIfAborted(signal);
  const before = await statImpl(filePath);
  if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size <= 0) {
    throw new Error('Không thể upload file video rỗng hoặc không hợp lệ');
  }
  const hash = createHash('sha256');
  let byteLength = 0;
  const stream = createReadStreamImpl(filePath, {signal});
  try {
    for await (const bytes of stream) {
      throwIfAborted(signal);
      hash.update(bytes);
      byteLength += bytes.length;
    }
  } finally {stream.destroy();}
  const after = await statImpl(filePath);
  throwIfAborted(signal);
  if (!sameStat(before, after) || byteLength !== after.size) {
    throw new Error('MP4 đã thay đổi trong khi tính checksum; cần kiểm tra trước khi upload');
  }
  return {sha256: hash.digest('hex'), byteLength, mtimeMs: after.mtimeMs,
    ctimeMs: after.ctimeMs, ino: after.ino, dev: after.dev};
}

function confirmedOffset(response, total) {
  const header = response.headers.get('Range');
  if (header === null || header === '') return 0;
  const match = /^bytes=0-(\d+)$/.exec(header);
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 1 || offset > total) {
    throw new Error('Google Drive trả Range/offset upload không hợp lệ');
  }
  return offset;
}

function validSession(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
      (url.hostname === 'googleapis.com' || url.hostname.endsWith('.googleapis.com'));
  } catch {return false;}
}

export async function resumeDriveUpload({filePath, fileName, folderId, checkpoint = {},
  requestId = checkpoint.requestId, inputRevision = checkpoint.inputRevision ?? checkpoint.inputFingerprint,
  getAccessToken, fetchImpl = fetch, persistCheckpoint = async () => {}, fence = async () => {}, signal}) {
  const identity = await mediaIdentity(filePath, {signal});
  const total = identity.byteLength;
  const name = fileName || path.basename(filePath);
  const save = async update => {
    Object.assign(checkpoint, update, {updatedAt: new Date().toISOString()});
    await persistCheckpoint(checkpoint);
  };
  const review = async (message, extra = {}) => {
    await save({...extra, needsReview: true, reviewReason: message});
    const error = new Error(`${message}; cần kiểm tra (needs_review), không tạo file mới`);
    error.code = 'DRIVE_UPLOAD_NEEDS_REVIEW';
    throw error;
  };
  const quarantineIntegrity = message => review(message, {
    integrityQuarantine: checkpoint.integrityQuarantine || {
      mediaSha256: checkpoint.mediaSha256 || identity.sha256,
      byteLength: checkpoint.byteLength ?? total,
      detectedAt: new Date().toISOString()
    }
  });
  const checkFence = async () => {
    throwIfAborted(signal);
    await fence();
    throwIfAborted(signal);
  };
  const request = async (url, options = {}, timeoutMs = 30000) => {
    throwIfAborted(signal);
    const token = await getAccessToken();
    throwIfAborted(signal);
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      return await fetchImpl(url, {...options, signal: requestSignal,
        headers: {...options.headers, Authorization: `Bearer ${token}`}});
    } catch {
      throwIfAborted(signal);
      // Provider/transport error messages may contain the private session URI.
      const error = new Error('Kết nối Google Drive bị gián đoạn; giữ checkpoint để tiếp tục (retry)');
      error.code = 'DRIVE_UPLOAD_RETRY';
      throw error;
    }
  };
  const mediaUnchanged = async () => {
    const current = await stat(filePath);
    if (!sameStat({...identity, size: total}, current)) {
      await quarantineIntegrity('MP4 đã thay đổi sau khi tính checksum; giữ integrity quarantine');
    }
  };

  if (checkpoint.schemaVersion !== undefined && checkpoint.schemaVersion !== 1) {
    await review('Checkpoint upload có schema không được hỗ trợ');
  }
  if ((checkpoint.requestId && requestId && checkpoint.requestId !== requestId) ||
      (checkpoint.inputRevision && inputRevision && checkpoint.inputRevision !== inputRevision)) {
    await review('Checkpoint thuộc yêu cầu hoặc phiên bản kịch bản khác');
  }
  const hasIdentity = typeof checkpoint.mediaSha256 === 'string' && /^[a-f0-9]{64}$/.test(checkpoint.mediaSha256);
  if (checkpoint.mediaSha256 !== undefined && !hasIdentity) await review('Checksum checkpoint không hợp lệ');
  if (hasIdentity && (checkpoint.mediaSha256 !== identity.sha256 ||
      (checkpoint.byteLength ?? checkpoint.fileSize) !== total)) {
    await quarantineIntegrity('MP4 checksum hoặc byte length đã thay đổi so với checkpoint');
  }
  // Restoring local bytes cannot prove bytes already accepted by Drive are sound.
  // A quarantined session without a completed file ID must not even be probed.
  if (checkpoint.integrityQuarantine && !checkpoint.driveFileId) {
    await review('Integrity quarantine chưa có file Drive hoàn tất để chứng minh checksum');
  }
  const bindIdentity = async extra => save({schemaVersion: 1, requestId, inputRevision,
    mediaSha256: identity.sha256, byteLength: total, mediaMtimeMs: identity.mtimeMs,
    needsReview: Boolean(checkpoint.integrityQuarantine),
    reviewReason: checkpoint.integrityQuarantine ? checkpoint.reviewReason : null, ...extra});

  let driveFile;
  // File identity takes priority even if the old session is missing or expired.
  if (checkpoint.driveFileId) {
    const response = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(checkpoint.driveFileId)}?fields=id,name,trashed,size,sha256Checksum`);
    if (response.status === 404 || response.status === 410) {
      await discard(response);
      await review('File Drive đã biết không còn truy cập được');
    }
    if (!response.ok) {
      await discard(response);
      throw new Error(`Không thể kiểm tra file Drive (${response.status}); giữ ID để thử lại`);
    }
    driveFile = await response.json();
    if (driveFile.id !== checkpoint.driveFileId || driveFile.trashed) await review('Metadata file Drive đã biết không hợp lệ');
    if (checkpoint.integrityQuarantine) {
      const intended = checkpoint.integrityQuarantine;
      if (!hasIdentity || intended.mediaSha256 !== checkpoint.mediaSha256 || intended.byteLength !== total ||
          driveFile.sha256Checksum !== intended.mediaSha256 || Number(driveFile.size) !== intended.byteLength) {
        await review('Integrity quarantine chưa có bằng chứng SHA-256 và byte length khớp từ Drive');
      }
      // Only completed-object checksum/length evidence may release quarantine.
      await save({integrityQuarantine: null, integrityVerifiedAt: new Date().toISOString(), needsReview: false, reviewReason: null});
    }
    const remoteMatches = driveFile.sha256Checksum === identity.sha256 && Number(driveFile.size) === total;
    if (!hasIdentity && !remoteMatches) await review('Checkpoint cũ thiếu bằng chứng checksum MP4');
    if ((driveFile.sha256Checksum && driveFile.sha256Checksum !== identity.sha256) ||
        (driveFile.size !== undefined && Number(driveFile.size) !== total)) await review('Bytes file Drive khác MP4 trong checkpoint');
    await bindIdentity({phase: 'uploaded', committedOffset: total, driveFileName: driveFile.name || checkpoint.driveFileName || name});
  } else {
    if (checkpoint.sessionUri && !hasIdentity) await review('Checkpoint session cũ thiếu bằng chứng checksum MP4');
    if (!checkpoint.sessionUri && (checkpoint.initializationAttempted || checkpoint.phase || checkpoint.offset || checkpoint.committedOffset)) {
      await review('Checkpoint upload thiếu session hoặc file ID để đối soát');
    }
    if (checkpoint.sessionUri && !validSession(checkpoint.sessionUri)) await review('Session upload không hợp lệ');
    if (!checkpoint.sessionUri) {
      await checkFence();
      await mediaUnchanged();
      // Persist intent first: a lost initialization response must not create again.
      await bindIdentity({phase: 'initialized', committedOffset: 0, initializationAttempted: true});
      const response = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name', {
        method: 'POST', headers: {'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(total)},
        body: JSON.stringify({name, parents: [folderId]})
      });
      if (!response.ok) {
        await discard(response);
        throw new Error(`Khởi tạo upload Drive thất bại (${response.status}); giữ checkpoint để kiểm tra`);
      }
      const sessionUri = response.headers.get('Location');
      await discard(response);
      if (!validSession(sessionUri)) await review('Drive không trả session upload hợp lệ');
      await save({sessionUri});
    } else await bindIdentity({phase: checkpoint.phase || 'uploading'});

    const accept = async response => {
      if (response.status === 200 || response.status === 201) {
        const result = await response.json();
        if (typeof result.id !== 'string' || !result.id) await review('Drive xác nhận upload nhưng thiếu file ID');
        driveFile = result;
        await save({driveFileId: result.id, driveFileName: result.name || name, committedOffset: total, phase: 'uploaded'});
        return total;
      }
      if (response.status === 308) {
        let offset;
        try {offset = confirmedOffset(response, total);} finally {await discard(response);}
        await save({committedOffset: offset, phase: 'uploading'});
        return offset;
      }
      await discard(response);
      if (response.status === 404 || response.status === 410) await review('Session upload đã hết hạn hoặc không còn tồn tại');
      throw new Error(`Upload Drive bị gián đoạn (${response.status}); giữ checkpoint để tiếp tục`);
    };
    const probe = async () => accept(await request(checkpoint.sessionUri, {
      method: 'PUT', headers: {'Content-Length': '0', 'Content-Range': `bytes */${total}`}
    }));
    let offset = await probe();
    let probedComplete = false;
    while (!driveFile) {
      throwIfAborted(signal);
      if (offset === total) {
        if (probedComplete) throw new Error('Drive đã nhận bytes nhưng chưa xác nhận file ID; giữ checkpoint để tiếp tục');
        probedComplete = true;
        offset = await probe();
        continue;
      }
      await checkFence();
      await mediaUnchanged();
      const end = Math.min(offset + CHUNK_SIZE, total) - 1;
      const stream = createReadStream(filePath, {start: offset, end, signal});
      let response;
      try {
        response = await request(checkpoint.sessionUri, {method: 'PUT',
          headers: {'Content-Type': 'video/mp4', 'Content-Length': String(end - offset + 1),
            'Content-Range': `bytes ${offset}-${end}/${total}`}, body: stream, duplex: 'half'}, 120000);
      } finally {stream.destroy();}
      // Save any returned file identity before checking for local media changes.
      const next = await accept(response);
      await mediaUnchanged();
      throwIfAborted(signal);
      if (!driveFile && (next <= offset || next > end + 1)) throw new Error('Drive trả offset không tiến triển hoặc ngoài chunk đã gửi; giữ checkpoint');
      offset = next;
    }
  }

  const permissionsUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.id)}/permissions`;
  let pageToken;
  let readable = false;
  const seenPages = new Set();
  for (let page = 0; page < MAX_PERMISSION_PAGES; page++) {
    const query = new URLSearchParams({fields: 'nextPageToken,permissions(type,role)', pageSize: '100'});
    if (pageToken) query.set('pageToken', pageToken);
    const response = await request(`${permissionsUrl}?${query}`);
    if (!response.ok) {
      await discard(response);
      throw new Error(`Tệp đã tải lên nhưng chưa xác minh quyền đọc (${response.status}); giữ ID để thử lại`);
    }
    const data = await response.json();
    readable = (data.permissions || []).some(p => p.type === 'anyone' && ['reader', 'writer', 'owner'].includes(p.role));
    if (readable || !data.nextPageToken) {pageToken = null; break;}
    pageToken = data.nextPageToken;
    if (seenPages.has(pageToken)) throw new Error('Phân trang quyền Drive không tiến triển; giữ ID để kiểm tra');
    seenPages.add(pageToken);
  }
  if (pageToken) throw new Error('Vượt giới hạn kiểm tra trang quyền Drive; giữ ID để kiểm tra');
  if (!readable) {
    await checkFence();
    await mediaUnchanged();
    const response = await request(permissionsUrl, {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({role: 'reader', type: 'anyone'})});
    await discard(response);
    if (!response.ok) throw new Error(`Tệp đã tải lên nhưng chưa cấp được quyền đọc (${response.status}); giữ ID để thử lại`);
  }
  throwIfAborted(signal);
  await save({phase: 'shared'});
  return {id: driveFile.id, name: checkpoint.driveFileName,
    driveUrl: `https://drive.google.com/file/d/${driveFile.id}/view`};
}
