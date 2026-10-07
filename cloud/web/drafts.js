export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const sensitive = new Set(['password', 'csrftoken', 'csrf_token', 'token', 'cookie', 'secret', 'authorization']);
  const clean = Array.isArray(payload) ? [] : {};
  for (const [k, v] of Object.entries(payload)) {
    if (sensitive.has(k.toLowerCase())) continue;
    clean[k] = v && typeof v === 'object' ? sanitizePayload(v) : v;
  }
  return clean;
}

export function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
    get length() { return store.size; }
  };
}

function getSafeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probeKey = '__studio_draft_probe__';
      window.localStorage.setItem(probeKey, '1');
      window.localStorage.removeItem(probeKey);
      return {storage: window.localStorage, durable: true};
    }
  } catch {}
  return {storage: createMemoryStorage(), durable: false};
}

export function createDraftStore({
  storage,
  now = Date.now
} = {}) {
  const probed = storage !== undefined ? {storage, durable: Boolean(storage)} : getSafeStorage();
  const effectiveStorage = probed.storage;
  let persistenceAvailable = probed.durable;
  let storageReadable = probed.durable;
  const volatileStorage = createMemoryStorage();
  const removedKeys = new Set();

  function parseDraft(raw, key, sourceStorage) {
    if (!raw) return null;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      try { sourceStorage?.removeItem(key); } catch {}
      return null;
    }
    if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || typeof data.updatedAt !== 'number') {
      try { sourceStorage?.removeItem(key); } catch {}
      return null;
    }
    if (now() - data.updatedAt > DRAFT_TTL_MS) {
      try { sourceStorage?.removeItem(key); } catch {}
      return null;
    }
    return data;
  }

  function keyFor(username, kind, displayId = null) {
    if (!username) throw new Error('Yêu cầu tài khoản để tạo khóa nháp');
    return displayId ? `studio:draft:${username}:${kind}:${displayId}` : `studio:draft:${username}:${kind}`;
  }

  function read(username, kind, displayId = null) {
    if (!username || !kind) return null;
    let key;
    try { key = keyFor(username, kind, displayId); } catch { return null; }
    if (removedKeys.has(key)) return null;

    let durableData = null;
    if (storageReadable && effectiveStorage) {
      try {
        durableData = parseDraft(effectiveStorage.getItem(key), key, effectiveStorage);
      } catch {
        storageReadable = false;
        persistenceAvailable = false;
      }
    }
    let volatileData = null;
    try { volatileData = parseDraft(volatileStorage.getItem(key), key, volatileStorage); } catch {}

    if (!volatileData) return durableData;
    if (!durableData || volatileData.updatedAt >= durableData.updatedAt) return volatileData;
    return durableData;
  }

  function save(username, kind, options = {}) {
    const {payload, submissionKey, payloadSignature, displayId = null} = options;
    if (!username || !kind) throw new Error('Yêu cầu tài khoản và loại nháp để lưu');

    const key = keyFor(username, kind, displayId);
    const cleanPayload = sanitizePayload(payload);
    const sig = payloadSignature || (cleanPayload?.caption !== undefined ? String(cleanPayload.caption) : null);
    const previous = read(username, kind, displayId);
    const pendingSubmission = Object.hasOwn(options, 'pendingSubmission')
      ? options.pendingSubmission
      : previous?.pendingSubmission;
    const data = {
      schemaVersion: 1,
      updatedAt: now(),
      payload: cleanPayload,
      ...(submissionKey ? {submissionKey: String(submissionKey)} : {}),
      ...(sig ? {payloadSignature: String(sig)} : {}),
      ...(pendingSubmission ? {pendingSubmission: sanitizePayload(pendingSubmission)} : {})
    };
    const serialized = JSON.stringify(data);
    removedKeys.delete(key);
    // Keep a session-only copy so storage failure never discards the live draft.
    volatileStorage.setItem(key, serialized);

    if (!persistenceAvailable || !effectiveStorage) {
      throw Object.assign(new Error('Bộ nhớ trình duyệt chỉ lưu tạm trong phiên này; không thể lưu nháp bền vững.'), {
        name: 'DraftStorageUnavailable'
      });
    }

    try {
      effectiveStorage.setItem(key, serialized);
    } catch (err) {
      persistenceAvailable = false;
      throw Object.assign(new Error(`Không thể lưu nháp vào bộ nhớ trình duyệt: ${err.message}`), {
        cause: err,
        name: err.name || 'DraftStorageError'
      });
    }

    let verify;
    try {
      verify = effectiveStorage.getItem(key);
    } catch (err) {
      storageReadable = false;
      persistenceAvailable = false;
      throw Object.assign(new Error(`Không thể xác minh nháp trong bộ nhớ trình duyệt: ${err.message}`), {
        cause: err,
        name: err.name || 'DraftStorageError'
      });
    }
    if (verify !== serialized) {
      persistenceAvailable = false;
      throw new Error('Bộ nhớ không xác nhận đã lưu đúng nội dung');
    }
    return true;
  }

  function remove(username, kind, options = {}) {
    if (!username || !kind) return false;
    const displayId = typeof options === 'string' ? options : (options?.displayId || null);
    const expectedSignature = options && typeof options === 'object' ? options.expectedSignature : null;
    const expectedReviewRevision = options && typeof options === 'object' ? options.expectedReviewRevision : undefined;

    let key;
    try { key = keyFor(username, kind, displayId); } catch { return false; }

    const existing = read(username, kind, displayId);
    if (existing) {
      if (expectedSignature !== null && expectedSignature !== undefined) {
        const sig = existing.payloadSignature || (existing.payload?.caption !== undefined ? String(existing.payload.caption) : null);
        if (sig !== expectedSignature) {
          // Newer draft was typed while request was in flight; preserve it!
          return false;
        }
      }
      if (expectedReviewRevision !== undefined) {
        const rev = existing.payload?.reviewRevision;
        if (rev !== expectedReviewRevision) {
          return false;
        }
      }
    }

    volatileStorage.removeItem(key);
    removedKeys.add(key);
    if (!storageReadable || !effectiveStorage) return true;
    try {
      effectiveStorage.removeItem(key);
      removedKeys.delete(key);
      return true;
    } catch {
      storageReadable = false;
      persistenceAvailable = false;
      return false;
    }
  }

  const api = {
    keyFor,
    read,
    save,
    remove
  };
  Object.defineProperty(api, 'persistenceAvailable', {get: () => persistenceAvailable});
  return api;
}
