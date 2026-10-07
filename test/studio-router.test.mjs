import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute, routeHref, createRouter} from '../cloud/web/router.js';
import worker from '../cloud/worker.mjs';

const origin = 'https://studio.example';

test('canonical Studio routes distinguish create, exact detail, publish and system', () => {
  assert.deepEqual(parseRoute('/studio/new', origin), {name: 'create'});
  assert.deepEqual(parseRoute('/studio/videos/V002', origin), {name: 'detail', displayId: 'V002'});
  assert.deepEqual(parseRoute('/studio/videos/v002/publish', origin), {name: 'publish', displayId: 'V002'});
  assert.deepEqual(parseRoute('/studio/system', origin), {name: 'system'});
  assert.deepEqual(parseRoute('/', origin), {name: 'list'});
  assert.equal(routeHref({name: 'publish', displayId: 'V002'}), '/studio/videos/V002/publish');
});

test('list accepts only the declared filters and ignores private content in the URL', () => {
  for (const status of ['all', 'waiting', 'producing', 'review', 'publishing', 'sent', 'needs_review']) {
    assert.equal(parseRoute(`/studio?status=${status}`, origin).status, status);
  }
  assert.equal(parseRoute('/studio?status=bogus', origin).name, 'notFound');
  assert.equal(routeHref(parseRoute('/studio?status=review&title=secret&script=secret', origin)), '/studio?status=review');
});

test('malformed IDs, extra path segments and other origins are not Studio routes', () => {
  for (const path of ['/studio/videos/not-a-video', '/studio/videos/V2/extra', '/studio/videos/V2.js', '/unknown', '/studio/newer', 'https://other.example/studio', '//other.example/studio']) {
    assert.deepEqual(parseRoute(path, origin), {name: 'notFound'});
  }
  assert.throws(() => routeHref({name: 'detail', displayId: '../secret'}));
});

test('login next is restricted to a canonical same-origin private route', () => {
  assert.deepEqual(parseRoute('/login?next=%2Fstudio%2Fvideos%2Fv002', origin), {name: 'login', next: '/studio/videos/V002'});
  for (const next of ['https://other.example/studio', '//other.example/studio', '/login', '/unknown']) {
    assert.deepEqual(parseRoute(`/login?next=${encodeURIComponent(next)}`, origin), {name: 'login'});
  }
});

function browser(path = '/studio') {
  const listeners = new Map();
  const entries = [{url: path, state: null}];
  let index = 0;
  const win = {
    location: new URL(path, origin), scrollY: 0,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.({state: entries[index].state}); },
    scrollTo(x, y) { this.scrollY = y; },
    history: {
      scrollRestoration: 'auto',
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      replaceState(state, unused, url) { entries[index] = {state, url: url ?? entries[index].url}; win.location = new URL(entries[index].url, origin); },
      pushState(state, unused, url) { entries.splice(++index); entries.push({state, url}); win.location = new URL(url, origin); },
      back() { if (index) { index--; win.location = new URL(entries[index].url, origin); win.dispatch('popstate'); } },
      forward() { if (index < entries.length - 1) { index++; win.location = new URL(entries[index].url, origin); win.dispatch('popstate'); } }
    }
  };
  return win;
}

test('list → create → Back → Forward preserves list scroll, filter, cursor and focus', () => {
  const win = browser('/studio?status=review');
  const seen = [];
  const router = createRouter({window: win, onRoute: (route, context) => seen.push({route, context}), getViewState: () => ({filter: 'review', cursor: 'page-2', focusId: 'video-V002'})});
  router.start();
  router.start();
  win.scrollY = 420;
  router.navigate({name: 'create'});
  assert.equal(win.history.length, 2);
  assert.equal(win.location.pathname, '/studio/new');
  win.history.back();
  assert.equal(seen.at(-1).route.name, 'list');
  assert.equal(seen.at(-1).context.reason, 'popstate');
  assert.equal(seen.at(-1).context.entry.scrollY, 420);
  assert.deepEqual(seen.at(-1).context.entry.viewState, {filter: 'review', cursor: 'page-2', focusId: 'video-V002'});
  win.history.forward();
  assert.equal(seen.at(-1).route.name, 'create');
  assert.equal(win.history.length, 2);
  router.stop();
  win.history.back();
  assert.equal(seen.at(-1).route.name, 'create');
  assert.equal(win.history.scrollRestoration, 'auto');
});

test('direct detail starts at current URL; lowercase IDs and successful login use replace', () => {
  const win = browser('/studio/videos/v002');
  const routes = [];
  const router = createRouter({window: win, onRoute: route => routes.push(route)});
  router.start();
  assert.equal(win.location.pathname, '/studio/videos/V002');
  assert.equal(routes.at(-1).name, 'detail');
  assert.equal(win.history.length, 1);
  router.navigate({name: 'login'}, {replace: true});
  router.navigate({name: 'list'}, {replace: true});
  assert.equal(win.history.length, 1);
});

test('Worker falls back only for Studio/login GET HTML navigation, never APIs or missing assets', async () => {
  const fetched = [];
  const env = {ASSETS: {fetch: async request => { fetched.push(new URL(request.url).pathname); return new Response(new URL(request.url).pathname === '/index.html' ? '<html>Studio</html>' : 'missing', {status: new URL(request.url).pathname === '/index.html' ? 200 : 404}); }}};
  for (const path of ['/login', '/', '/studio', '/studio/new', '/studio/videos/V002', '/studio/videos/v002/publish', '/studio/system']) {
    const response = await worker.fetch(new Request(origin + path, {headers: {Accept: 'text/html'}}), env);
    assert.equal(response.status, 200, path);
  }
  for (const path of ['/unknown', '/studio/videos/bad', '/missing.js', '/missing.css', '/assets/missing']) {
    assert.equal((await worker.fetch(new Request(origin + path, {headers: {Accept: 'text/html'}}), env)).status, 404, path);
  }
  assert.equal((await worker.fetch(new Request(origin + '/studio/new', {headers: {Accept: 'application/json'}}), env)).status, 404);
  assert.equal((await worker.fetch(new Request(origin + '/studio/new', {method: 'POST', headers: {Accept: 'text/html'}}), env)).status, 404);
  const count = fetched.length;
  const response = await worker.fetch(new Request(origin + '/api/missing', {headers: {Accept: 'text/html'}}), env);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  assert.equal(fetched.length, count);
});
