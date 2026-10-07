import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {hashPassword, generateUsersJson} from '../local/setup-web-users.mjs';
import {verifyPasswordWeb, parseCookies, recordLoginResult} from '../cloud/web-auth.mjs';

const OWNER_PASS = 'OwnerSecret2026!';
const COLLAB_PASS = 'CollabSecret2026!';
const usersJson = generateUsersJson({ownerPassword: OWNER_PASS, collaboratorPassword: COLLAB_PASS});

const secrets = {
  ZALO_WEBHOOK_SECRET: 'fake-webhook-secret',
  RUNNER_TOKEN: 'fake-runner-secret',
  PAIR_CODE: 'test-pair-code',
  ZALO_BOT_TOKEN: 'fake-bot-token',
  WEB_USERS_JSON: usersJson
};

const bundle = (await build({
  stdin: {
    contents: `
import worker from './cloud/worker.mjs';
import {VideoQueue as Base} from './cloud/queue.mjs';
export default worker;
export class VideoQueue extends Base {}
`,
    resolveDir: path.resolve('.'),
    sourcefile: 'test-web-entry.mjs'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false
})).outputFiles[0].text;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'web-queue-test-'));
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'web-queue-test',
    modules: true,
    script: bundle,
    compatibilityDate: '2026-09-01',
    resourcePersistencePath: directory,
    durableObjects: {VIDEO_QUEUE: {className: 'VideoQueue', useSQLite: true}},
    bindings: secrets
  }));
  await mf.ready;

  const fetchApi = async (url, {method = 'GET', body, headers = {}} = {}) => {
    const fullUrl = `https://queue${url}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const response = await mf.dispatchFetch(fullUrl, options);
    const setCookie = response.headers.get('set-cookie');
    let resBody;
    try {
      resBody = await response.json();
    } catch {
      resBody = null;
    }
    return {status: response.status, body: resBody, headers: response.headers, setCookie};
  };

  let disposed = false;
  const dispose = async () => {
    if (!disposed) {
      disposed = true;
      await mf.dispose();
    }
  };
  t.after(async () => {
    await dispose();
    await rm(directory, {recursive: true, force: true});
  });

  return {mf, fetchApi};
}

test('unit: PBKDF2 hash generation and verification works accurately', async () => {
  const user = {username: 'test', role: 'owner', ...hashPassword('MyPassword@123')};
  const valid = await verifyPasswordWeb('MyPassword@123', user);
  assert.equal(valid, true);

  const invalid = await verifyPasswordWeb('WrongPassword', user);
  assert.equal(invalid, false);
});

test('web login flow, session cookie, and CSRF token', async t => {
  const f = await fixture(t);

  // 1. Unauthenticated session check
  const noSession = await f.fetchApi('/api/web/session');
  assert.equal(noSession.status, 200);
  assert.deepEqual(noSession.body, {authenticated: false});

  // 2. Failed login with wrong password
  const badLogin = await f.fetchApi('/api/web/login', {
    method: 'POST',
    body: {username: 'owner', password: 'WrongPassword'}
  });
  assert.equal(badLogin.status, 401);

  // 3. Successful login as owner
  const goodLogin = await f.fetchApi('/api/web/login', {
    method: 'POST',
    body: {username: 'owner', password: OWNER_PASS}
  });
  assert.equal(goodLogin.status, 200);
  assert.equal(goodLogin.body.ok, true);
  assert.equal(goodLogin.body.user.username, 'owner');
  assert.equal(goodLogin.body.user.role, 'owner');
  assert.ok(goodLogin.body.csrfToken);
  assert.ok(goodLogin.setCookie);
  assert.match(goodLogin.setCookie, /Max-Age=2592000/);

  const cookies = parseCookies(goodLogin.setCookie);
  const cookieHeader = goodLogin.setCookie.split(';')[0]; // __Host-vs_session=...
  const csrfToken = goodLogin.body.csrfToken;

  // 4. Authenticated session check with cookie
  const activeSession = await f.fetchApi('/api/web/session', {
    headers: {Cookie: cookieHeader}
  });
  assert.equal(activeSession.status, 200);
  assert.equal(activeSession.body.authenticated, true);
  assert.equal(activeSession.body.user.username, 'owner');
  assert.ok(activeSession.body.expiresAt > Date.now());
  assert.equal(activeSession.headers.get('cache-control'), 'no-store');
  assert.ok(activeSession.body.csrfToken);
  assert.equal(activeSession.body.csrfToken, csrfToken, 'a second tab must retain the first tab CSRF token');
  const secondTab = await f.fetchApi('/api/web/session', {headers: {Cookie: cookieHeader}});
  assert.equal(secondTab.body.csrfToken, csrfToken);

  // 5. Protected request without CSRF should fail with 403
  const noCsrfReq = await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Video Test 1',
      script: 'Kịch bản thử nghiệm',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'sub-key-1'
    },
    headers: {
      Cookie: cookieHeader,
      Origin: 'https://queue'
    }
  });
  assert.equal(noCsrfReq.status, 403);

  // 6. Protected request with valid cookie and CSRF should succeed (201)
  const createReq = await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Video Test 1',
      script: 'Kịch bản thử nghiệm',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'sub-key-1'
    },
    headers: {
      Cookie: cookieHeader,
      'X-CSRF-Token': csrfToken,
      Origin: 'https://queue'
    }
  });
  assert.equal(createReq.status, 201);
  assert.ok(createReq.body.request.id);
  assert.equal(createReq.body.request.display_id, 'V002');
  assert.equal(createReq.body.request.production_state, 'waiting');

  // 7. Duplicate submission with same key and payload returns 200
  const dupReq = await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Video Test 1',
      script: 'Kịch bản thử nghiệm',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'sub-key-1'
    },
    headers: {
      Cookie: cookieHeader,
      'X-CSRF-Token': activeSession.body.csrfToken,
      Origin: 'https://queue'
    }
  });
  assert.equal(dupReq.status, 200);
  assert.equal(dupReq.body.duplicate, true);

  // 8. Conflicting submission with same key but different title returns 409
  const conflictReq = await f.fetchApi('/api/web/requests', {
    method: 'POST',
    body: {
      title: 'Different Title',
      script: 'Kịch bản thử nghiệm',
      skill: 'viet-tiktok-story-video',
      clientSubmissionKey: 'sub-key-1'
    },
    headers: {
      Cookie: cookieHeader,
      'X-CSRF-Token': activeSession.body.csrfToken,
      Origin: 'https://queue'
    }
  });
  assert.equal(conflictReq.status, 409);

  // 9. List requests
  const list = await f.fetchApi('/api/web/requests', {
    headers: {Cookie: cookieHeader}
  });
  assert.equal(list.status, 200);
  assert.equal(list.body.requests.length, 2);
  assert.ok(list.body.requests.some(r => r.display_id === 'V001'));
  assert.ok(list.body.requests.some(r => r.display_id === 'V002'));

  // 10. Logout revokes session
  for (const headers of [
    {Cookie: cookieHeader, Origin: 'https://queue'},
    {Cookie: cookieHeader, 'X-CSRF-Token': 'invalid', Origin: 'https://queue'},
    {Cookie: cookieHeader, 'X-CSRF-Token': activeSession.body.csrfToken, Origin: 'https://evil.test'}
  ]) {
    const rejected = await f.fetchApi('/api/web/logout', {method: 'POST', headers});
    assert.equal(rejected.status, 403);
    assert.equal((await f.fetchApi('/api/web/session', {headers: {Cookie: cookieHeader}})).body.authenticated, true);
  }
  const logout = await f.fetchApi('/api/web/logout', {
    method: 'POST',
    headers: {Cookie: cookieHeader, 'X-CSRF-Token': activeSession.body.csrfToken, Origin: 'https://queue'}
  });
  assert.equal(logout.status, 200);

  const afterLogout = await f.fetchApi('/api/web/session', {
    headers: {Cookie: cookieHeader}
  });
  assert.equal(afterLogout.body.authenticated, false);
});

test('malformed cookie encoding does not prevent valid session cookie parsing', () => {
  assert.deepEqual(parseCookies('broken=%ZZ; __Host-vs_session=abc123'), {'__Host-vs_session': 'abc123'});
});

test('expired login lock starts a new attempt window', async () => {
  const row = {attempts: 5, locked_until: Date.now() - 1000};
  let inserted;
  const sql = {exec(query, ...params) {
    if (query.startsWith('SELECT')) return {toArray: () => [row]};
    inserted = params;
  }};
  await recordLoginResult(sql, 'bucket', false);
  assert.deepEqual(inserted, ['bucket', 1, null]);
});

test('boundary isolation: cookie cannot access runner api and runner token cannot act as web session', async t => {
  const f = await fixture(t);

  // Log in as collaborator
  const login = await f.fetchApi('/api/web/login', {
    method: 'POST',
    body: {username: 'collaborator', password: COLLAB_PASS}
  });
  assert.equal(login.status, 200);
  const cookieHeader = login.setCookie.split(';')[0];

  // Try calling runner queue API /api/jobs with web session cookie
  const runnerWithCookie = await f.fetchApi('/api/jobs', {
    headers: {Cookie: cookieHeader}
  });
  assert.equal(runnerWithCookie.status, 401);

  // Try calling web API with runner Bearer token without cookie
  const webWithBearer = await f.fetchApi('/api/web/requests', {
    headers: {Authorization: `Bearer ${secrets.RUNNER_TOKEN}`}
  });
  assert.equal(webWithBearer.status, 401);
});
