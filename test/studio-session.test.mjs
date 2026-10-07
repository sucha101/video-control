import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../cloud/web/api-client.js';
import {createSessionController, safeReturnPath} from '../cloud/web/session.js';
import {studioHarness, deferred, settle, video} from './helpers/studio-ui-harness.mjs';
import {createDraftStore} from '../cloud/web/drafts.js';

function target(extra = {}) {
  const listeners = new Map();
  return Object.assign({addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, new Set()).get(type)).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, data = {}) { for (const fn of listeners.get(type) || []) fn(data); },
    count() { return [...listeners.values()].reduce((n, list) => n + list.size, 0); }}, extra);
}
function fixture(request, path = '/studio/videos/V002') {
  let time = 1000;
  const channel = target({postMessage(value) { this.sent = value; }, close() { this.closed = true; }});
  const win = target({location: new URL(path, 'https://studio.test'), BroadcastChannel: function() { return channel; }});
  const doc = target({hidden: false});
  const states = [], navigations = [];
  const session = createSessionController({api: {request}, router: {navigate(route, options) { navigations.push({route, options}); }},
    window: win, document: doc, now: () => time, onState: value => states.push(value)});
  return {session, win, doc, channel, states, navigations, advance() { time += 60001; }};
}
const auth = {authenticated: true, user: {username: 'owner', role: 'owner'}, csrfToken: 'private', expiresAt: 90000};
const last = f => f.states.at(-1).state;

test('safe return paths canonicalize recognized private routes and reject evasions', () => {
  for (const value of ['/studio', '/studio/new', '/studio/system', '/studio?status=review', '/studio/videos/V002/publish']) assert.equal(safeReturnPath(value, 'https://studio.test'), value);
  for (const value of ['https://evil.test/studio', '//evil.test/studio', '/login', '/studio/nope', '/studio/videos/nope', '/studio/%2e%2e/studio/new', '/studio%5cnew', '/studio/../studio/new', '/studio\\new']) assert.equal(safeReturnPath(value, 'https://studio.test'), '/studio');
});
test('API sends credentials/CSRF and classifies HTTP errors without navigation', async () => {
  let options;
  const api = createApiClient({getCsrf: () => 'csrf', fetchImpl: async (_, opts) => { options = opts; return Response.json({ok: true}); }});
  await api.request('/protected', {method: 'POST', body: {x: 1}});
  assert.equal(options.credentials, 'include'); assert.equal(options.headers.get('X-CSRF-Token'), 'csrf'); assert.equal(options.body, '{"x":1}');
  for (const status of [401, 403, 429, 503]) {
    const client = createApiClient({fetchImpl: async () => new Response('invalid JSON', {status, headers: {'Content-Type': 'application/json'}})});
    await assert.rejects(client.request('/protected'), error => error.status === status && error.retryable === (status === 429 || status >= 500));
  }
});
test('API bounds even a stalled fetch and classifies network errors', async () => {
  await assert.rejects(createApiClient({fetchImpl: async () => { throw new TypeError('offline'); }}).request('/x'), error => error.status === null && error.code === 'NETWORK' && error.retryable);
  await assert.rejects(createApiClient({fetchImpl: () => new Promise(() => {}), timeoutMs: 5}).request('/x'), error => error.code === 'TIMEOUT');
  await assert.rejects(createApiClient({fetchImpl: async () => new Response('<h1>Down</h1>', {status: 503})}).request('/x'), error => error.status === 503 && error.retryable);
  await assert.rejects(createApiClient({fetchImpl: async () => new Response('not JSON')}).request('/x'), error => error.code === 'INVALID_RESPONSE');
});
test('bootstrap matrix preserves deep links on unavailable checks', async () => {
  const good = fixture(async () => auth); await good.session.bootstrap(); assert.equal(last(good), 'authenticated'); assert.equal(good.navigations.length, 0);
  const guest = fixture(async () => ({authenticated: false})); await guest.session.bootstrap(); assert.equal(last(guest), 'guest'); assert.equal(guest.navigations[0].route.next, '/studio/videos/V002'); assert.equal(guest.navigations[0].options.replace, true);
  for (const error of [Object.assign(new Error('offline'), {status: null}), Object.assign(new Error('server'), {status: 503})]) {
    const f = fixture(async () => { throw error; }); await f.session.bootstrap(); assert.equal(last(f), 'unavailable'); assert.equal(f.navigations.length, 0);
  }
});
test('login replacement validates next and rejected credentials preserve prior auth', async () => {
  const f = fixture(async path => path.endsWith('login') ? auth : auth, '/login?next=%2Fstudio%2Fnew');
  await f.session.signIn('owner', 'password'); assert.equal(last(f), 'authenticated'); assert.deepEqual(f.navigations[0], {route: {name: 'create'}, options: {replace: true, reason: 'login'}});
  const valid = fixture(async () => auth, '/login?next=%2Fstudio%2Fvideos%2FV002'); await valid.session.bootstrap(); assert.equal(valid.navigations[0].route.displayId, 'V002');
  let fail = false; const prior = fixture(async () => { if (fail) throw Object.assign(new Error('credentials'), {status: 401}); return auth; }); await prior.session.bootstrap(); fail = true;
  await assert.rejects(prior.session.signIn('x', 'y')); assert.equal(last(prior), 'authenticated');
});
test('stale pageshow/visibility coalesce and dispose cleans listeners/channel', async () => {
  let calls = 0, resolve;
  const f = fixture(async () => { calls++; return calls === 1 ? auth : new Promise(done => { resolve = done; }); });
  await f.session.bootstrap(); f.win.fire('pageshow', {persisted: true}); assert.equal(calls, 1);
  f.advance(); f.win.fire('pageshow', {persisted: true}); f.doc.fire('visibilitychange'); assert.equal(calls, 2);
  resolve(auth); await new Promise(done => setImmediate(done));
  f.session.dispose(); assert.equal(f.win.count(), 0); assert.equal(f.doc.count(), 0); assert.equal(f.channel.count(), 0); assert.equal(f.channel.closed, true);
});
test('401 revalidates once and only explicit unauthenticated result signs out', async () => {
  let checks = 0; let unavailable = true;
  const f = fixture(async path => { if (!path.endsWith('session')) throw Object.assign(new Error('unauthorized'), {status: 401}); checks++; if (checks === 1) return auth; if (unavailable) throw Object.assign(new Error('offline'), {status: null}); return {authenticated: false}; });
  await f.session.bootstrap(); await assert.rejects(f.session.request('/protected')); assert.equal(checks, 2); assert.equal(last(f), 'unavailable'); assert.equal(f.navigations.length, 0);
  unavailable = false; await f.session.revalidate({force: true}); assert.equal(last(f), 'guest');
});
test('logout failure retains auth; success broadcasts no credentials; receiving tab hides private data', async () => {
  let fail = true, logoutOptions;
  const f = fixture(async (path, options) => { if (path.endsWith('logout')) { logoutOptions = options; if (fail) throw new Error('offline'); return {ok: true}; } return auth; });
  await f.session.bootstrap(); await assert.rejects(f.session.signOut()); assert.equal(last(f), 'authenticated');
  fail = false; await f.session.signOut(); assert.equal(logoutOptions.headers['X-CSRF-Token'], 'private'); assert.equal(last(f), 'guest'); assert.deepEqual(f.channel.sent, {type: 'signed-out'});
  const other = fixture(async () => auth); await other.session.bootstrap(); other.channel.fire('message', {data: f.channel.sent}); assert.equal(last(other), 'guest'); assert.equal(other.navigations[0].route.next, '/studio/videos/V002');
});

test('actual app gates protected data until bootstrap and exposes Retry without rewriting the deep link', async () => {
  const pending = deferred();
  const calls = [];
  let unavailable = true;
  const h = await studioHarness({path: '/studio/videos/V002', fetchImpl: async path => {
    calls.push(path);
    if (path.endsWith('session')) { if (unavailable) { await pending.promise; throw new TypeError('offline'); } return auth; }
    if (path.endsWith('health')) return {runnerOnline: false};
    return {request: video('V002'), publications: []};
  }});
  h.document.dispatch('DOMContentLoaded');
  assert.deepEqual(calls, ['/api/web/session']);
  assert.equal(h.nodes.get('view-detail').style.display, 'none');
  pending.resolve(); await settle();
  assert.equal(h.window.location.pathname, '/studio/videos/V002');
  assert.equal(h.nodes.get('view-session').style.display, 'block');
  assert.equal(h.nodes.get('btn-session-retry').style.display, 'inline-flex');
  unavailable = false; h.nodes.get('btn-session-retry').dispatch('click'); await settle();
  assert.equal(h.nodes.get('view-detail').style.display, 'block');
  assert.equal(h.nodes.get('detail-title').textContent, 'Title V002');
  h.app.state.currentUser = null;
  clearTimeout(h.app.state.pollTimer);
});

test('actual app validates raw login next before router canonicalization', async () => {
  const h = await studioHarness({path: '/login?next=%2Fstudio%2F..%2Fstudio%2Fnew', fetchImpl: async path =>
    path.endsWith('session') ? auth : path.endsWith('health') ? {runnerOnline: false} : {requests: [], nextCursor: null}});
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.window.location.pathname, '/studio');
  assert.equal(h.window.history.length, 1);
  h.app.state.currentUser = null;
  clearTimeout(h.app.state.pollTimer);
});

test('changing authenticated identity clears A cards before the delayed B list arrives', async t => {
  const pendingB = deferred();
  let username = 'account-A';
  const h = await studioHarness({fetchImpl: async path => {
    if (path.endsWith('session')) return {...auth, user: {...auth.user, username}};
    if (path.endsWith('health')) return {runnerOnline: false};
    return username === 'account-A' ? {requests: [video('V002', {title: 'Private A card'})], nextCursor: 'A-cursor'} : pendingB.promise;
  }});
  t.after(() => { pendingB.resolve({requests: [], nextCursor: null}); h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.app.state.requests[0].title, 'Private A card');
  username = 'account-B'; h.nodes.get('btn-session-retry').dispatch('click'); await settle();
  assert.equal(h.nodes.get('view-list').style.display, 'block');
  assert.equal(h.app.state.currentUser.username, 'account-B');
  assert.equal(h.app.state.requests.length, 0, 'A state must be cleared before B data resolves');
  assert.equal(h.app.state.nextCursor, null);
  assert.equal(h.nodes.get('requests-container').children.length, 0, 'A cards must not reappear under B');
  pendingB.resolve({requests: [video('V003', {title: 'B card'})], nextCursor: null}); await settle();
  assert.equal(h.app.state.requests[0].title, 'B card');
});

test('guest/logout clears mounted A draft and B sign-in to next=create cannot expose it', async t => {
  let username = 'account-A';
  const h = await studioHarness({path: '/studio/new', fetchImpl: async path => {
    if (path.endsWith('session') || path.endsWith('login')) return {...auth, user: {...auth.user, username}};
    if (path.endsWith('logout')) return {ok: true};
    return {runnerOnline: false};
  }});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) h.nodes.get(id).value = `Private A ${id}`;
  h.nodes.get('btn-logout').dispatch('click'); await settle();
  assert.equal(h.window.location.search, '?next=%2Fstudio%2Fnew');
  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) assert.equal(h.nodes.get(id).value, '', 'guest must not leave private fields mounted');
  username = 'account-B';
  h.nodes.get('login-username').value = username;
  h.nodes.get('login-password').value = 'synthetic';
  h.nodes.get('form-login').dispatch('submit', {preventDefault() {}}); await settle();
  assert.equal(h.window.location.pathname, '/studio/new');
  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) assert.equal(h.nodes.get(id).value, '', 'B must not receive A draft');
  h.nodes.get('btn-logout').dispatch('click'); await settle();
  username = 'account-A';
  h.nodes.get('login-username').value = username;
  h.nodes.get('form-login').dispatch('submit', {preventDefault() {}}); await settle();
  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) assert.equal(h.nodes.get(id).value, '', 'draft restoration must be explicit');
  assert.equal(h.nodes.get('create-draft-banner').style.display, 'block');
  h.nodes.get('btn-draft-restore').dispatch('click');
  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) assert.equal(h.nodes.get(id).value, `Private A ${id}`, 'same account can explicitly recover its draft');
});

test('logout preserves a saved draft when the user has not restored or discarded it', async t => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const drafts = createDraftStore({storage});
  drafts.save('owner', 'script', {payload: {title: 'Keep me', script: 'Saved before opening create'}});
  const h = await studioHarness({path: '/studio/new', storage, fetchImpl: async path => {
    if (path.endsWith('session') || path.endsWith('login')) return auth;
    if (path.endsWith('logout')) return {ok: true};
    return {runnerOnline: false};
  }});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.nodes.get('create-draft-banner').style.display, 'block');
  h.nodes.get('btn-logout').dispatch('click'); await settle();
  assert.deepEqual(drafts.read('owner', 'script')?.payload, {title: 'Keep me', script: 'Saved before opening create'});
});

test('BFCache return keeps create form handlers active without a session recheck', async t => {
  let posts = 0;
  const h = await studioHarness({path: '/studio/new', fetchImpl: async (path, options) => {
    if (path.endsWith('session')) return auth;
    if (path.endsWith('health')) return {runnerOnline: false};
    if (path.endsWith('/requests') && options?.method === 'POST') {
      posts++;
      return {request: {display_id: 'V008'}};
    }
    return {requests: [], nextCursor: null};
  }});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  h.window.dispatch('pagehide', {persisted: true});
  h.window.dispatch('pageshow', {persisted: true});
  await settle();
  h.nodes.get('req-title').value = 'After back';
  h.nodes.get('req-script').value = 'Form must still submit';
  h.nodes.get('form-create-request').dispatch('submit', {preventDefault() {}});
  await settle();
  assert.equal(posts, 1);
});

test('leaving detail with unresolved caption conflict preserves the local draft', async t => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const drafts = createDraftStore({storage});
  drafts.save('owner', 'caption', {displayId: 'V002', payload: {caption: 'Local revision one', reviewRevision: 1}, payloadSignature: 'Local revision one'});
  const h = await studioHarness({path: '/studio/videos/V002', storage, fetchImpl: async (path, options) => {
    if (path.endsWith('session')) return auth;
    if (path.endsWith('health')) return {runnerOnline: false};
    if (options?.method === 'PATCH') throw new Error('Conflict choice must be explicit');
    if (path.endsWith('/V002')) return {request: video('V002', {caption: 'Server revision two', review_revision: 2}), publications: []};
    return {requests: [], nextCursor: null};
  }});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.nodes.get('detail-caption-conflict').style.display, 'block');
  assert.equal(h.nodes.get('detail-caption-input').value, 'Server revision two');
  h.nodes.get('btn-save-caption').dispatch('click'); await settle();
  assert.deepEqual(drafts.read('owner', 'caption', 'V002')?.payload, {caption: 'Local revision one', reviewRevision: 1});
  assert.equal(h.alerts.some(message => /chọn dùng caption/i.test(message)), true);
  h.app.router.navigate({name: 'list'}); await settle();
  assert.deepEqual(drafts.read('owner', 'caption', 'V002')?.payload, {caption: 'Local revision one', reviewRevision: 1});
});

test('choosing an empty local caption resolves conflict without restoring server text', async t => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const drafts = createDraftStore({storage});
  drafts.save('owner', 'caption', {displayId: 'V002', payload: {caption: '', reviewRevision: 1}, payloadSignature: ''});
  const h = await studioHarness({path: '/studio/videos/V002', storage, fetchImpl: async (path, options) => {
    if (path.endsWith('session')) return auth;
    if (path.endsWith('health')) return {runnerOnline: false};
    if (options?.method === 'PATCH') throw new Error('Do not save until explicit caption submit');
    if (path.endsWith('/V002')) return {request: video('V002', {caption: 'Server revision two', review_revision: 2}), publications: []};
    return {requests: [], nextCursor: null};
  }});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.nodes.get('detail-caption-conflict').style.display, 'block');
  h.nodes.get('btn-caption-use-local').dispatch('click');
  assert.equal(h.nodes.get('detail-caption-input').value, '');
  assert.equal(h.nodes.get('detail-caption-conflict').style.display, 'none');
  assert.deepEqual(drafts.read('owner', 'caption', 'V002')?.payload, {caption: '', reviewRevision: 2});
  h.app.router.navigate({name: 'list'}); await settle();
  assert.deepEqual(drafts.read('owner', 'caption', 'V002')?.payload, {caption: '', reviewRevision: 2});
});

test('logout flushes a caption edit before the debounce expires', async t => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  const drafts = createDraftStore({storage});
  const h = await studioHarness({path: '/studio/videos/V002', storage, fetchImpl: async path => {
    if (path.endsWith('session')) return auth;
    if (path.endsWith('logout')) return {ok: true};
    if (path.endsWith('health')) return {runnerOnline: false};
    if (path.endsWith('/V002')) return {request: video('V002', {caption: 'Original'}), publications: []};
    return {requests: [], nextCursor: null};
  }});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  h.nodes.get('detail-caption-input').value = 'Unsaved edit before logout';
  h.nodes.get('detail-caption-input').dispatch('input');
  h.nodes.get('btn-logout').dispatch('click'); await settle();
  assert.equal(h.app.state.sessionStatus, 'guest');
  assert.equal(h.nodes.get('detail-caption-input').value, '');
  assert.deepEqual(drafts.read('owner', 'caption', 'V002')?.payload, {caption: 'Unsaved edit before logout', reviewRevision: 1});
});

test('confirmed session after protected 401 does not reissue that endpoint in a request loop', async t => {
  const calls = {session: 0, list: 0, health: 0};
  const hold = deferred();
  const h = await studioHarness({fetchImpl: async path => {
    if (path.endsWith('session')) { calls.session++; return auth; }
    if (path.endsWith('health')) { calls.health++; return {runnerOnline: false}; }
    if (++calls.list >= 4) return hold.promise;
    return Response.json({error: 'Protected endpoint refuses this request'}, {status: 401});
  }});
  t.after(() => { hold.resolve({requests: [], nextCursor: null}); h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(calls.list, 1);
  assert.equal(calls.session, 2, 'one bootstrap and one invalidation check');
  assert.equal(calls.health, 1);
  assert.equal(h.app.state.currentUser.username, 'owner');
  assert.equal(h.nodes.get('requests-container').children[0].textContent, 'Không thể tải danh sách: Protected endpoint refuses this request');
});

test('detail completion during same-user checking waits for confirmation and renders once', async t => {
  const detail = deferred(), check = deferred();
  let sessionCalls = 0, detailCalls = 0;
  const h = await studioHarness({path: '/studio/videos/V002', fetchImpl: async path => {
    if (path.endsWith('session')) return ++sessionCalls === 1 ? auth : check.promise;
    if (path.endsWith('health')) return Response.json({error: 'Check session'}, {status: 401});
    detailCalls++; return detail.promise;
  }});
  t.after(() => { detail.resolve({request: video('V002'), publications: []}); check.resolve(auth); h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.app.state.sessionStatus, 'checking');
  detail.resolve({request: video('V002'), publications: []}); await settle();
  assert.equal(h.nodes.get('view-detail').style.display, 'none', 'checking must keep private detail hidden');
  check.resolve(auth); await settle();
  assert.equal(h.nodes.get('view-detail').style.display, 'block');
  assert.equal(h.nodes.get('detail-title').textContent, 'Title V002');
  assert.equal(detailCalls, 1);
});

for (const staleResult of ['success', 'error']) test(`stale A create ${staleResult} cannot alter B form or its pending submit`, async t => {
  const pendingA = deferred(), pendingB = deferred();
  let username = 'account-A', creates = 0;
  const h = await studioHarness({path: '/studio/new', fetchImpl: async (path, options) => {
    if (path.endsWith('session') || path.endsWith('login')) return {...auth, user: {...auth.user, username}};
    if (path.endsWith('logout')) return {ok: true};
    if (options.method === 'POST') return ++creates === 1 ? pendingA.promise : pendingB.promise;
    return {runnerOnline: false};
  }});
  t.after(() => {
    pendingA.resolve({request: video('V002')}); pendingB.resolve(Response.json({error: 'End B test'}, {status: 503}));
    h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); clearTimeout(h.app.state.createRedirectTimer);
  });
  h.document.dispatch('DOMContentLoaded'); await settle();
  h.nodes.get('req-title').value = 'A title'; h.nodes.get('req-script').value = 'A private script';
  h.nodes.get('form-create-request').dispatch('submit', {preventDefault() {}}); await settle();
  h.nodes.get('btn-logout').dispatch('click'); await settle();
  username = 'account-B'; h.nodes.get('login-username').value = username; h.nodes.get('login-password').value = 'synthetic';
  h.nodes.get('form-login').dispatch('submit', {preventDefault() {}}); await settle();
  const readyBeforeBSubmit = !h.nodes.get('btn-submit-create').disabled;
  h.nodes.get('req-title').value = 'B title'; h.nodes.get('req-script').value = 'B private script';
  h.nodes.get('form-create-request').dispatch('submit', {preventDefault() {}}); await settle();
  assert.equal(creates, 2);
  pendingA.resolve(staleResult === 'success' ? {request: video('V002')} : Response.json({error: 'A request failed'}, {status: 503})); await settle();
  assert.equal(h.nodes.get('req-title').value, 'B title');
  assert.equal(h.nodes.get('req-script').value, 'B private script');
  assert.equal(h.nodes.get('create-success').style.display, 'none');
  assert.equal(h.nodes.get('create-error').style.display, 'none');
  assert.equal(h.nodes.get('btn-submit-create').disabled, true, 'A finally must not enable B pending submit');
  assert.equal(h.app.state.createRedirectTimer, null, 'A must not schedule a redirect for B');
  assert.equal(readyBeforeBSubmit, true, 'B must not inherit A pending spinner');
  pendingB.resolve(Response.json({error: 'B request failed'}, {status: 503})); await settle();
  assert.equal(h.nodes.get('create-error').textContent, 'B request failed');
  assert.equal(h.nodes.get('btn-submit-create').disabled, false);
});

test('REGRESSION 5: logout clears mounted A inputs even if draftStore.save throws storage error', async t => {
  let username = 'account-A';
  let shouldThrowStorage = false;
  const storage = {
    getItem() { return null; },
    setItem(k) {
      if (k === '__studio_draft_probe__') return;
      if (shouldThrowStorage) throw new Error('QuotaExceededError');
    },
    removeItem() {}
  };
  const h = await studioHarness({path: '/studio/new', storage, fetchImpl: async path => {
    if (path.endsWith('session') || path.endsWith('login')) return {...auth, user: {...auth.user, username}};
    if (path.endsWith('logout')) return {ok: true};
    return {runnerOnline: false};
  }});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); });
  h.document.dispatch('DOMContentLoaded'); await settle();

  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) {
    h.nodes.get(id).value = `Private A ${id}`;
  }

  // Trigger storage quota error when saving private draft during logout
  shouldThrowStorage = true;
  h.nodes.get('btn-logout').dispatch('click'); await settle();

  // Must still clear all inputs despite storage failure!
  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) {
    assert.equal(h.nodes.get(id).value, '', 'Storage failure on logout must not leak private inputs');
  }

  // Now login as B
  username = 'account-B';
  h.nodes.get('login-username').value = username;
  h.nodes.get('login-password').value = 'synthetic';
  h.nodes.get('form-login').dispatch('submit', {preventDefault() {}}); await settle();
  for (const id of ['req-title', 'req-script', 'req-notes', 'req-voice']) {
    assert.equal(h.nodes.get(id).value, '', 'B must not receive A draft');
  }
});

test('REGRESSION 6: stale caption PATCH from account A cannot alter account B detail', async t => {
  const pendingPatch = deferred();
  let username = 'account-A';
  const h = await studioHarness({path: '/studio/videos/V002', fetchImpl: async (path, options) => {
    if (path.endsWith('session') || path.endsWith('login')) return {...auth, user: {...auth.user, username}};
    if (path.endsWith('logout')) return {ok: true};
    if (path.includes('/review') && options?.method === 'PATCH') return pendingPatch.promise;
    if (path.endsWith('V002')) return {request: video('V002', {caption: 'Caption A'}), publications: []};
    return {runnerOnline: false};
  }});
  t.after(() => {
    pendingPatch.resolve({request: video('V002', {caption: 'Stale A Updated Caption'})});
    h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer);
  });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.nodes.get('detail-caption-input').value, 'Caption A');

  // Account A edits caption and clicks Save
  h.nodes.get('detail-caption-input').value = 'Updated by A in flight';
  h.nodes.get('btn-save-caption').dispatch('click'); await settle();

  // While PATCH is in flight, logout A and login B
  h.nodes.get('btn-logout').dispatch('click'); await settle();
  username = 'account-B';
  h.nodes.get('login-username').value = username;
  h.nodes.get('login-password').value = 'synthetic';
  h.nodes.get('form-login').dispatch('submit', {preventDefault() {}}); await settle();

  // Now stale PATCH resolves
  pendingPatch.resolve({request: video('V002', {caption: 'Stale A Updated Caption'})}); await settle();

  // Account B must not have detail state or caption overwritten by A
  assert.notEqual(h.app.state.currentDetail?.caption, 'Stale A Updated Caption');
});

test('persistent account draft offers restore timestamp without silently prefilling on login', async t => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  createDraftStore({storage}).save('owner', 'script', {payload: {title: 'Private saved title', script: 'Private saved script'}});
  const h = await studioHarness({path: '/studio/new', storage, fetchImpl: async path => path.endsWith('session') ? auth : {runnerOnline: false}});
  t.after(() => { h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  assert.equal(h.nodes.get('req-title').value, '');
  assert.equal(h.nodes.get('create-draft-banner').style.display, 'block');
  assert.match(h.nodes.get('create-draft-message').textContent, /lưu lúc/);
  h.nodes.get('btn-draft-restore').dispatch('click');
  assert.equal(h.nodes.get('req-title').value, 'Private saved title');
});

test('caption PATCH completion is fenced by revision and cannot remove a newer draft', async t => {
  const patch = deferred();
  const h = await studioHarness({path: '/studio/videos/V002', fetchImpl: async (path, options) =>
    path.endsWith('session') ? auth : options.method === 'PATCH' ? patch.promise : path.endsWith('health') ? {runnerOnline: false} : {request: video('V002'), publications: []}});
  t.after(() => { patch.resolve({request: video('V002', {caption: 'Submitted caption', review_revision: 2})}); h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  h.nodes.get('detail-caption-input').value = 'Submitted caption';
  h.nodes.get('btn-save-caption').dispatch('click'); await settle();
  h.app.state.currentDetail = video('V002', {caption: 'Server revision 3', review_revision: 3});
  createDraftStore({storage: h.storage}).save('owner', 'caption', {displayId: 'V002', payload: {caption: 'Submitted caption', reviewRevision: 3}, payloadSignature: 'Submitted caption'});
  patch.resolve({request: video('V002', {caption: 'Submitted caption', review_revision: 2})}); await settle();
  assert.equal(h.app.state.currentDetail.review_revision, 3);
  assert.equal(createDraftStore({storage: h.storage}).read('owner', 'caption', 'V002').payload.reviewRevision, 3);
  assert.equal(h.alerts.some(message => message.includes('thành công')), false);
});

test('late A caption PATCH cannot clear the mutation state of B pending caption save', async t => {
  const patchA = deferred(), patchB = deferred(); let username = 'A', patches = 0;
  const h = await studioHarness({path: '/studio/videos/V002', fetchImpl: async (path, options) => {
    if (path.endsWith('session') || path.endsWith('login')) return {...auth, user: {...auth.user, username}};
    if (path.endsWith('logout')) return {ok: true};
    if (options.method === 'PATCH') return ++patches === 1 ? patchA.promise : patchB.promise;
    return path.endsWith('health') ? {runnerOnline: false} : {request: video('V002', {caption: `Server ${username}`}), publications: []};
  }});
  t.after(() => { patchA.resolve({request: video('V002')}); patchB.resolve({request: video('V002')}); h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  h.nodes.get('detail-caption-input').value = 'A edit'; h.nodes.get('btn-save-caption').dispatch('click'); await settle();
  h.nodes.get('btn-logout').dispatch('click'); await settle(); username = 'B';
  h.nodes.get('login-username').value = username; h.nodes.get('form-login').dispatch('submit', {preventDefault() {}}); await settle();
  assert.equal(h.app.state.currentDetail?.caption, 'Server B', 'B detail must not be blocked by A mutation');
  h.nodes.get('detail-caption-input').value = 'B edit'; h.nodes.get('btn-save-caption').dispatch('click'); await settle();
  patchA.resolve({request: video('V002', {caption: 'A edit', review_revision: 2})}); await settle();
  assert.equal(h.app.state.mutationInFlight, true);
  assert.equal(h.nodes.get('btn-save-caption').disabled, true);
  assert.equal(h.alerts.some(message => message.includes('thành công')), false);
  patchB.resolve({request: video('V002', {caption: 'B edit', review_revision: 2})}); await settle();
  assert.equal(h.app.state.currentDetail.caption, 'B edit');
});

test('caption PATCH preserves and flushes raw edits made before autosave fires', async t => {
  const patch = deferred();
  const h = await studioHarness({path: '/studio/videos/V002', fetchImpl: async (path, options) => path.endsWith('session') ? auth : options.method === 'PATCH' ? patch.promise : path.endsWith('health') ? {runnerOnline: false} : {request: video('V002'), publications: []}});
  t.after(() => { patch.resolve({request: video('V002')}); h.app.state.currentUser = null; clearTimeout(h.app.state.pollTimer); h.app.router.stop(); });
  h.document.dispatch('DOMContentLoaded'); await settle();
  h.nodes.get('detail-caption-input').value = 'Caption edit'; h.nodes.get('btn-save-caption').dispatch('click'); await settle();
  h.nodes.get('detail-caption-input').value = '  Caption edit  ';
  patch.resolve({request: video('V002', {caption: 'Caption edit', review_revision: 2})}); await settle();
  assert.equal(createDraftStore({storage: h.storage}).read('owner', 'caption', 'V002').payload.caption, '  Caption edit  ');
});
