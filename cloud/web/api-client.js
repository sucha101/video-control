export class ApiError extends Error {
  constructor(message, {status = null, code, retryable = false} = {}) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, {status, code, retryable});
  }
}

// Transport has no authority to navigate or change the session.
export function createApiClient({fetchImpl = globalThis.fetch, getCsrf = () => null, timeoutMs = 20000} = {}) {
  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    let body = options.body;
    if (body !== undefined && body !== null && typeof body === 'object' &&
        !(body instanceof FormData) && !(body instanceof Blob)) {
      body = JSON.stringify(body);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    const csrf = getCsrf();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && csrf && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrf);
    const controller = new AbortController();
    let timer;
    let abort;
    try {
      // A race bounds the entire response, including stalled body reads or mocks
      // that do not obey the AbortSignal. Always clean up the timer/listener.
      const limit = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ApiError('Máy chủ phản hồi quá lâu. Vui lòng thử lại.', {code: 'TIMEOUT', retryable: true}));
        }, timeoutMs);
        abort = () => {
          controller.abort();
          reject(new ApiError('Yêu cầu đã bị hủy.', {code: 'ABORTED'}));
        };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, {once: true});
      });
      const response = (async () => {
        const res = await fetchImpl(path, {...options, method, headers, body, credentials: 'include', signal: controller.signal});
        let data = null;
        try { data = await res.json(); } catch {}
        if (!res.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `Yêu cầu thất bại (Mã: ${res.status})`, {
          status: res.status, code: `HTTP_${res.status}`, retryable: res.status === 429 || res.status >= 500
        });
        if (data === null) throw new ApiError('Phản hồi máy chủ không hợp lệ.', {status: res.status, code: 'INVALID_RESPONSE', retryable: true});
        return data;
      })();
      return await Promise.race([response, limit]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError('Yêu cầu đã bị hủy.', {code: 'ABORTED'});
      throw new ApiError('Không kết nối được máy chủ. Vui lòng thử lại.', {code: 'NETWORK', retryable: true});
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  return {request};
}
