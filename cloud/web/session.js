import {parseRoute, routeHref} from './router.js';

export function safeReturnPath(value, origin) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]|%2e|%2f|%5c/i.test(value)) return '/studio';
  if (value.split(/[?#]/)[0].split('/').some(part => part === '.' || part === '..')) return '/studio';
  const route = parseRoute(value, origin);
  return ['list', 'create', 'detail', 'publish', 'system'].includes(route.name) ? routeHref(route) : '/studio';
}

export function createSessionController({api, router, draftStore, onState = () => {}, window: win, document: doc, now = Date.now}) {
  let current = 'checking', user = null, csrf = null, expiresAt = null;
  let checkedAt = null, invalidated = true, inFlight = null, disposed = false, generation = 0;
  const channel = win.BroadcastChannel ? new win.BroadcastChannel('video-studio-session') : null;
  function emit(state, error, source) {
    if (disposed) return;
    current = state;
    // The canonical session fields remain private; views receive only display data.
    onState({state, ...(state === 'authenticated' ? {user: {...user}, expiresAt} : {}), ...(error ? {error} : {}), ...(source ? {source} : {})});
  }
  function returnPath() {
    const url = new URL(win.location.href);
    return safeReturnPath(url.pathname === '/login' ? url.searchParams.get('next') : url.pathname + url.search, url.origin);
  }
  function guest() {
    const next = returnPath();
    user = csrf = expiresAt = null;
    checkedAt = now(); invalidated = false;
    draftStore?.lock?.();
    emit('guest');
    router.navigate({name: 'login', next}, {replace: true, reason: 'login'});
  }
  function authenticated(result, reason, redirect = true, source) {
    user = {...result.user}; csrf = result.csrfToken; expiresAt = result.expiresAt ?? null;
    checkedAt = now(); invalidated = false;
    emit('authenticated', null, source);
    if (redirect && new URL(win.location.href).pathname === '/login') router.navigate(parseRoute(returnPath(), win.location.origin), {replace: true, reason});
  }
  function revalidate({force = false, source = 'revalidate'} = {}) {
    if (disposed) return Promise.resolve();
    if (inFlight) return inFlight;
    if (!force && !invalidated && checkedAt !== null && now() - checkedAt < 60000 && (!expiresAt || now() < expiresAt)) return Promise.resolve();
    const version = generation;
    // A forced protected-API check hides potentially expired private data too.
    emit('checking', null, source);
    inFlight = (async () => {
      try {
        const result = await api.request('/api/web/session');
        if (disposed || version !== generation) return;
        if (result?.authenticated === true && result.user && typeof result.csrfToken === 'string') authenticated(result, 'login', true, source);
        else if (result?.authenticated === false) guest();
        else throw new Error('Phản hồi phiên đăng nhập không hợp lệ.');
      } catch (error) {
        if (!disposed && version === generation) { invalidated = true; emit('unavailable', error); }
      } finally { inFlight = null; }
    })();
    return inFlight;
  }
  async function signIn(username, password) {
    const next = returnPath();
    const result = await api.request('/api/web/login', {method: 'POST', body: {username, password}});
    if (!result?.user || typeof result.csrfToken !== 'string') throw new Error('Phản hồi đăng nhập không hợp lệ.');
    generation++;
    authenticated(result, 'login', false, 'signin');
    router.navigate(parseRoute(next, win.location.origin), {replace: true, reason: 'login'});
    return {user: {...user}};
  }
  async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (csrf && ['POST', 'PATCH', 'PUT', 'DELETE'].includes((options.method || 'GET').toUpperCase())) headers.set('X-CSRF-Token', csrf);
    try { return await api.request(path, {...options, headers}); }
    catch (error) {
      if (error.status === 401 && !disposed) { invalidated = true; await revalidate({force: true}); }
      throw error;
    }
  }
  async function signOut() {
    // A failed revoke must leave the authenticated view/session available.
    await api.request('/api/web/logout', {method: 'POST', headers: {'X-CSRF-Token': csrf}});
    generation++;
    guest();
    channel?.postMessage({type: 'signed-out'});
  }
  function restored(event) { if (event.persisted) revalidate(); }
  function visible() { if (!doc.hidden) revalidate(); }
  function message(event) { if (event.data?.type === 'signed-out') { generation++; guest(); } }
  win.addEventListener('pageshow', restored);
  doc.addEventListener('visibilitychange', visible);
  channel?.addEventListener('message', message);
  return {bootstrap: () => revalidate({force: true, source: 'bootstrap'}), signIn, signOut, revalidate, request,
    dispose() {
      disposed = true; generation++;
      win.removeEventListener('pageshow', restored);
      doc.removeEventListener('visibilitychange', visible);
      channel?.removeEventListener('message', message);
      channel?.close();
    }};
}
