import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore, DRAFT_TTL_MS} from '../cloud/web/drafts.js';
import {mountCreateView} from '../cloud/web/views/create.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
    get length() { return store.size; },
    _store: store
  };
}

function createDOMElement(tag = 'div') {
  const listeners = new Map();
  const attributes = new Map();
  const element = {
    tagName: tag.toUpperCase(),
    value: '',
    textContent: '',
    checked: false,
    disabled: false,
    style: {},
    children: [],
    classList: {
      classes: new Set(),
      toggle(cls, force) {
        if (force === undefined) {
          if (this.classes.has(cls)) { this.classes.delete(cls); return false; }
          this.classes.add(cls); return true;
        }
        if (force) this.classes.add(cls);
        else this.classes.delete(cls);
        return force;
      },
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      contains(cls) { return this.classes.has(cls); }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      const fns = listeners.get(event.type) || [];
      for (const fn of fns) fn(event);
      return !event.defaultPrevented;
    },
    setAttribute(k, v) { attributes.set(k, String(v)); },
    getAttribute(k) { return attributes.get(k) ?? null; },
    removeAttribute(k) { attributes.delete(k); },
    querySelector(selector) {
      return this._query(selector);
    },
    querySelectorAll(selector) {
      return this._queryAll(selector);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    _query(selector) {
      if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (this.id === id) return this;
        for (const c of this.children) {
          const found = c._query?.(selector);
          if (found) return found;
        }
      } else if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (this.classList.contains(cls)) return this;
        for (const c of this.children) {
          const found = c._query?.(selector);
          if (found) return found;
        }
      }
      return null;
    },
    _queryAll(selector) {
      const results = [];
      if (selector === 'input[name="skill"]') {
        if (this.tagName === 'INPUT' && this.getAttribute('name') === 'skill') results.push(this);
        for (const c of this.children) {
          if (c._queryAll) results.push(...c._queryAll(selector));
        }
      }
      return results;
    }
  };
  return element;
}

function buildCreateRoot() {
  const root = createDOMElement('main');
  root.id = 'view-create';
  
  const form = createDOMElement('form');
  form.id = 'form-create-request';
  root.appendChild(form);

  const banner = createDOMElement('div');
  banner.id = 'create-draft-banner';
  banner.style.display = 'none';
  form.appendChild(banner);

  const bannerMsg = createDOMElement('span');
  bannerMsg.id = 'create-draft-message';
  banner.appendChild(bannerMsg);

  const btnRestore = createDOMElement('button');
  btnRestore.id = 'btn-draft-restore';
  banner.appendChild(btnRestore);

  const btnDiscard = createDOMElement('button');
  btnDiscard.id = 'btn-draft-discard';
  banner.appendChild(btnDiscard);

  const inputTitle = createDOMElement('input');
  inputTitle.id = 'req-title';
  form.appendChild(inputTitle);

  const countTitle = createDOMElement('span');
  countTitle.id = 'count-title';
  countTitle.textContent = '0/160';
  form.appendChild(countTitle);

  const inputScript = createDOMElement('textarea');
  inputScript.id = 'req-script';
  form.appendChild(inputScript);

  const countScript = createDOMElement('span');
  countScript.id = 'count-script';
  countScript.textContent = '0/30000';
  form.appendChild(countScript);

  const inputVoice = createDOMElement('input');
  inputVoice.id = 'req-voice';
  form.appendChild(inputVoice);

  const inputNotes = createDOMElement('textarea');
  inputNotes.id = 'req-notes';
  form.appendChild(inputNotes);

  const radioStory = createDOMElement('input');
  radioStory.setAttribute('name', 'skill');
  radioStory.value = 'viet-tiktok-story-video';
  radioStory.checked = true;
  form.appendChild(radioStory);

  const radioDrama = createDOMElement('input');
  radioDrama.setAttribute('name', 'skill');
  radioDrama.value = 'drama-mascot-video';
  form.appendChild(radioDrama);

  const cardStory = createDOMElement('label');
  cardStory.id = 'skill-card-story';
  cardStory.classList.add('selected');
  form.appendChild(cardStory);

  const cardDrama = createDOMElement('label');
  cardDrama.id = 'skill-card-drama';
  form.appendChild(cardDrama);

  const errEl = createDOMElement('div');
  errEl.id = 'create-error';
  errEl.style.display = 'none';
  form.appendChild(errEl);

  const succEl = createDOMElement('div');
  succEl.id = 'create-success';
  succEl.style.display = 'none';
  form.appendChild(succEl);

  const btnSubmit = createDOMElement('button');
  btnSubmit.id = 'btn-submit-create';
  const normalText = createDOMElement('span');
  normalText.classList.add('btn-text-normal');
  const loadingText = createDOMElement('span');
  loadingText.classList.add('btn-text-loading');
  btnSubmit.appendChild(normalText);
  btnSubmit.appendChild(loadingText);
  form.appendChild(btnSubmit);

  return {root, form, banner, bannerMsg, btnRestore, btnDiscard, inputTitle, inputScript, inputVoice, inputNotes, countTitle, countScript, radioStory, radioDrama, cardStory, cardDrama, errEl, succEl, btnSubmit, normalText, loadingText};
}

test('createDraftStore isolates drafts by username and kind', () => {
  const storage = createMemoryStorage();
  const store = createDraftStore({storage, now: () => 100000});

  store.save('userA', 'script', {
    payload: {title: 'Title A', script: 'Script A'},
    submissionKey: 'sub-A',
    payloadSignature: 'sig-A'
  });

  // userA can read userA draft
  const draftA = store.read('userA', 'script');
  assert.equal(draftA.payload.title, 'Title A');
  assert.equal(draftA.submissionKey, 'sub-A');
  assert.equal(draftA.payloadSignature, 'sig-A');
  assert.equal(draftA.schemaVersion, 1);

  // userB CANNOT read userA draft
  const draftB = store.read('userB', 'script');
  assert.equal(draftB, null);
});

test('createDraftStore expires drafts after TTL 7 days', () => {
  const storage = createMemoryStorage();
  let time = 1000000;
  const store = createDraftStore({storage, now: () => time});

  store.save('userA', 'script', {
    payload: {title: 'Title Expire', script: 'Script Expire'}
  });

  // Before TTL: available
  assert.notEqual(store.read('userA', 'script'), null);

  // Advance time beyond 7 days
  time += DRAFT_TTL_MS + 1000;

  // After TTL: returns null and purges from storage
  assert.equal(store.read('userA', 'script'), null);
});

test('createDraftStore strips sensitive fields from payload', () => {
  const storage = createMemoryStorage();
  const store = createDraftStore({storage, now: () => 1000});

  store.save('userA', 'script', {
    payload: {
      title: 'Valid Title',
      password: 'secret-password',
      csrfToken: 'csrf-secret',
      cookie: 'session=123',
      token: 'bearer-token'
    }
  });

  const draft = store.read('userA', 'script');
  assert.equal(draft.payload.title, 'Valid Title');
  assert.equal(draft.payload.password, undefined);
  assert.equal(draft.payload.csrfToken, undefined);
  assert.equal(draft.payload.cookie, undefined);
  assert.equal(draft.payload.token, undefined);
});

test('createDraftStore conditional remove with expectedSignature preserves newer draft', () => {
  const storage = createMemoryStorage();
  const store = createDraftStore({storage, now: () => 1000});

  store.save('userA', 'script', {
    payload: {title: 'Title v1'},
    payloadSignature: 'sig-v1'
  });

  // Try remove with matching signature -> removed
  const removed = store.remove('userA', 'script', {expectedSignature: 'sig-v1'});
  assert.equal(removed, true);
  assert.equal(store.read('userA', 'script'), null);

  // Re-save with sig-v2, simulate user edited while in-flight to sig-v3
  store.save('userA', 'script', {
    payload: {title: 'Title v3'},
    payloadSignature: 'sig-v3'
  });

  // Try remove with old in-flight sig-v2 -> NOT removed
  const notRemoved = store.remove('userA', 'script', {expectedSignature: 'sig-v2'});
  assert.equal(notRemoved, false);
  assert.equal(store.read('userA', 'script')?.payload.title, 'Title v3');
});

test('createDraftStore caption draft isolated by displayId and username', () => {
  const storage = createMemoryStorage();
  const store = createDraftStore({storage, now: () => 1000});

  store.save('userA', 'caption', {
    displayId: 'V002',
    payload: {caption: 'Caption V002', reviewRevision: 1}
  });
  store.save('userA', 'caption', {
    displayId: 'V003',
    payload: {caption: 'Caption V003', reviewRevision: 2}
  });

  assert.equal(store.read('userA', 'caption', 'V002')?.payload.caption, 'Caption V002');
  assert.equal(store.read('userA', 'caption', 'V003')?.payload.caption, 'Caption V003');
  assert.equal(store.read('userB', 'caption', 'V002'), null);
});

test('createDraftStore handles storage exceptions cleanly without losing data', () => {
  const failingStorage = {
    getItem() { return null; },
    setItem() {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem() {}
  };
  const store = createDraftStore({storage: failingStorage, now: () => 1000});

  assert.throws(() => {
    store.save('userA', 'script', {payload: {title: 'T'}});
  }, /QuotaExceededError|lưu trữ/i);
});

test('mountCreateView presents draft banner and restores/discards draft', () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 1000});
  draftStore.save('owner', 'script', {
    payload: {
      title: 'Restored Title',
      script: 'Restored Script',
      skill: 'drama-mascot-video',
      voice: 'Custom Voice',
      notes: 'Important notes'
    }
  });

  const dom = buildCreateRoot();
  const cleanup = mountCreateView({
    root: dom.root,
    api: {request: async () => ({})},
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'}
  });

  // Banner should be visible
  assert.equal(dom.banner.style.display, 'block');
  assert.match(dom.bannerMsg.textContent, /nháp/i);

  // Click restore
  dom.btnRestore.dispatchEvent({type: 'click'});
  assert.equal(dom.inputTitle.value, 'Restored Title');
  assert.equal(dom.inputScript.value, 'Restored Script');
  assert.equal(dom.inputVoice.value, 'Custom Voice');
  assert.equal(dom.inputNotes.value, 'Important notes');
  assert.equal(dom.radioDrama.checked, true);
  assert.equal(dom.cardDrama.classList.contains('selected'), true);
  assert.equal(dom.countTitle.textContent, `${'Restored Title'.length}/160`);
  assert.equal(dom.banner.style.display, 'none');

  cleanup();

  // Test discard
  const dom2 = buildCreateRoot();
  const cleanup2 = mountCreateView({
    root: dom2.root,
    api: {request: async () => ({})},
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'}
  });

  assert.equal(dom2.banner.style.display, 'block');
  dom2.btnDiscard.dispatchEvent({type: 'click'});
  assert.equal(draftStore.read('owner', 'script'), null);
  assert.equal(dom2.banner.style.display, 'none');

  cleanup2();
});

test('mountCreateView auto-saves draft after 500ms on input and flushes on cleanup', async () => {
  const storage = createMemoryStorage();
  let currentTime = 2000;
  const draftStore = createDraftStore({storage, now: () => currentTime});

  const dom = buildCreateRoot();
  const cleanup = mountCreateView({
    root: dom.root,
    api: {request: async () => ({})},
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'},
    now: () => currentTime
  });

  dom.inputTitle.value = 'Auto Title';
  dom.inputTitle.dispatchEvent({type: 'input'});
  dom.inputScript.value = 'Auto Script';
  dom.inputScript.dispatchEvent({type: 'input'});

  // Before 500ms debounce: not saved yet
  assert.equal(draftStore.read('owner', 'script'), null);

  // Wait 550ms
  await new Promise(r => setTimeout(r, 550));

  // Now saved
  const saved = draftStore.read('owner', 'script');
  assert.equal(saved?.payload?.title, 'Auto Title');
  assert.equal(saved?.payload?.script, 'Auto Script');

  // Next edit and immediate cleanup (flush)
  dom.inputTitle.value = 'Flushed Title';
  dom.inputTitle.dispatchEvent({type: 'input'});
  cleanup();

  // Flushed immediately without waiting another 500ms
  const flushed = draftStore.read('owner', 'script');
  assert.equal(flushed?.payload?.title, 'Flushed Title');
});

test('mountCreateView saves submission key before POST, and on success removes draft and navigates to detail', async () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 3000});

  const dom = buildCreateRoot();
  const navigations = [];
  let postBody = null;
  let draftAtPostTime = null;

  const cleanup = mountCreateView({
    root: dom.root,
    api: {
      request: async (path, opts) => {
        if (path === '/api/web/requests' && opts.method === 'POST') {
          postBody = opts.body;
          // Check draftStore AT POST TIME before responding
          draftAtPostTime = draftStore.read('owner', 'script');
          return {request: {id: 'req-456', display_id: 'V004'}};
        }
        return {};
      }
    },
    router: {navigate(route) { navigations.push(route); }},
    draftStore,
    user: {username: 'owner'}
  });

  dom.inputTitle.value = 'Submitted Title';
  dom.inputScript.value = 'Submitted Script';
  dom.inputTitle.dispatchEvent({type: 'input'});

  dom.form.dispatchEvent({type: 'submit', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }});
  await new Promise(r => setImmediate(r));

  // Submission key must be present in body and stored before POST
  assert.ok(postBody.clientSubmissionKey);
  assert.equal(draftAtPostTime?.submissionKey, postBody.clientSubmissionKey);

  // After success: submitted draft removed
  assert.equal(draftStore.read('owner', 'script'), null);

  // Navigates directly to detail route
  assert.deepEqual(navigations[0], {name: 'detail', displayId: 'V004'});

  cleanup();
});

test('mountCreateView preserves unresolved intent and edited draft after network errors', async () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 4000});

  const dom = buildCreateRoot();
  let attempts = 0;
  const capturedKeys = [];

  const cleanup = mountCreateView({
    root: dom.root,
    api: {
      request: async (path, opts) => {
        attempts++;
        capturedKeys.push(opts.body.clientSubmissionKey);
        throw Object.assign(new Error('Network disconnected'), {code: 'NETWORK', retryable: true});
      }
    },
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'}
  });

  dom.inputTitle.value = 'Retry Title';
  dom.inputScript.value = 'Retry Script';

  // First submit attempt -> fails
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(r => setImmediate(r));

  assert.equal(attempts, 1);
  assert.equal(dom.errEl.style.display, 'block');
  assert.match(dom.errEl.textContent, /Network disconnected/i);

  // Draft and key preserved in store
  const saved = draftStore.read('owner', 'script');
  assert.equal(saved?.payload?.title, 'Retry Title');
  assert.equal(saved?.submissionKey, capturedKeys[0]);

  // Second submit attempt without edits -> MUST use same submissionKey
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(r => setImmediate(r));

  assert.equal(attempts, 2);
  assert.equal(capturedKeys[1], capturedKeys[0]);

  // Editing while the server result is unresolved keeps the old request
  // payload/key for reconciliation; the new form draft is retained separately.
  dom.inputTitle.value = 'Edited Title';
  dom.inputTitle.dispatchEvent({type: 'input'});

  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(r => setImmediate(r));

  assert.equal(attempts, 3);
  assert.equal(capturedKeys[2], capturedKeys[0]);
  assert.equal(draftStore.read('owner', 'script')?.payload?.title, 'Edited Title');
  assert.equal(draftStore.read('owner', 'script')?.pendingSubmission?.payload?.title, 'Retry Title');

  cleanup();
});

test('definitive HTTP validation failure releases the unresolved intent for an edited retry', async () => {
  const draftStore = createDraftStore({storage: createMemoryStorage()});
  const dom = buildCreateRoot();
  const calls = [];
  const cleanup = mountCreateView({
    root: dom.root,
    api: async (path, options) => {
      calls.push(options.body);
      if (calls.length === 1) throw Object.assign(new Error('Skill không hợp lệ'), {status: 400, retryable: false});
      return {request: {display_id: 'V009'}};
    },
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'}
  });
  dom.inputTitle.value = 'Rejected title';
  dom.inputScript.value = 'Script';
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(draftStore.read('owner', 'script')?.pendingSubmission, undefined);

  dom.inputTitle.value = 'Corrected title';
  dom.inputTitle.dispatchEvent({type: 'input'});
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].title, 'Corrected title');
  assert.notEqual(calls[1].clientSubmissionKey, calls[0].clientSubmissionKey);
  cleanup();
});

test('mountCreateView handles storage error during auto-save without clearing form inputs', async () => {
  const failingStorage = {
    getItem() { return null; },
    setItem() {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem() {}
  };
  const draftStore = createDraftStore({storage: failingStorage, now: () => 5000});

  const dom = buildCreateRoot();
  const feedbacks = [];

  const cleanup = mountCreateView({
    root: dom.root,
    api: {request: async () => ({})},
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'},
    onFeedback: fb => feedbacks.push(fb)
  });

  dom.inputTitle.value = 'Preserved Title';
  dom.inputScript.value = 'Preserved Script';
  dom.inputTitle.dispatchEvent({type: 'input'});

  await new Promise(r => setTimeout(r, 550));

  // Form content MUST NOT BE CLEARED
  assert.equal(dom.inputTitle.value, 'Preserved Title');
  assert.equal(dom.inputScript.value, 'Preserved Script');

  // Feedback signaled
  assert.ok(feedbacks.some(f => f.message.includes('Nháp chưa lưu trên thiết bị')));

  cleanup();
});

test('caption draft conflict detection reports revision mismatch and preserves local vs server choices', () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 1000});

  // User saved draft when revision was 1
  draftStore.save('editor', 'caption', {
    displayId: 'V002',
    payload: {caption: 'Local draft caption', reviewRevision: 1}
  });

  // Verify conflict condition:
  const draft = draftStore.read('editor', 'caption', 'V002');
  const serverVideo = {display_id: 'V002', caption: 'Server caption v2', review_revision: 2};

  assert.equal(draft.payload.reviewRevision, 1);
  assert.equal(serverVideo.review_revision, 2);
  assert.notEqual(draft.payload.reviewRevision, serverVideo.review_revision);

  // If local accepted, draft revision advances to match server
  draftStore.save('editor', 'caption', {
    displayId: 'V002',
    payload: {caption: draft.payload.caption, reviewRevision: serverVideo.review_revision}
  });
  const updatedDraft = draftStore.read('editor', 'caption', 'V002');
  assert.equal(updatedDraft.payload.reviewRevision, 2);
  assert.equal(updatedDraft.payload.caption, 'Local draft caption');

  // If server kept, local draft is deleted
  draftStore.remove('editor', 'caption', 'V002');
  assert.equal(draftStore.read('editor', 'caption', 'V002'), null);
});

test('caption save removes caption draft on successful PATCH', () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 1000});

  draftStore.save('editor', 'caption', {
    displayId: 'V002',
    payload: {caption: 'Saved caption', reviewRevision: 1}
  });
  assert.notEqual(draftStore.read('editor', 'caption', 'V002'), null);

  // Successful save cleans up the draft
  draftStore.remove('editor', 'caption', 'V002');
  assert.equal(draftStore.read('editor', 'caption', 'V002'), null);
});

test('pagehide triggers immediate draft save without waiting for 500ms debounce', () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 2000});

  const dom = buildCreateRoot();
  const windowListeners = new Map();
  const fakeWindow = {
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    removeEventListener(type) { windowListeners.delete(type); }
  };

  const oldWindow = globalThis.window;
  globalThis.window = fakeWindow;

  try {
    const cleanup = mountCreateView({
      root: dom.root,
      api: {request: async () => ({})},
      router: {navigate() {}},
      draftStore,
      user: {username: 'owner'}
    });

    dom.inputTitle.value = 'Pagehide Title';
    dom.inputScript.value = 'Pagehide Script';
    dom.inputTitle.dispatchEvent({type: 'input'});

    // Not yet saved before 500ms
    assert.equal(draftStore.read('owner', 'script'), null);

    // Simulate pagehide event on window
    const pagehideHandler = windowListeners.get('pagehide');
    assert.ok(pagehideHandler, 'pagehide listener must be registered on window');
    pagehideHandler();

    // Immediately flushed and saved
    const saved = draftStore.read('owner', 'script');
    assert.equal(saved?.payload?.title, 'Pagehide Title');
    assert.equal(saved?.payload?.script, 'Pagehide Script');

    cleanup();
  } finally {
    globalThis.window = oldWindow;
  }
});

test('REGRESSION 1: mountCreateView aborts POST submission if saving submissionKey fails due to storage error', async () => {
  const failingStorage = {
    getItem() { return null; },
    setItem() {
      const err = new Error('QuotaExceededError: Storage is full');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem() {}
  };
  const draftStore = createDraftStore({storage: failingStorage, now: () => 1000});

  let postCalled = false;
  const dom = buildCreateRoot();

  const cleanup = mountCreateView({
    root: dom.root,
    api: {
      request: async () => {
        postCalled = true;
        return {request: {display_id: 'V999'}};
      }
    },
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'}
  });

  dom.inputTitle.value = 'Title to submit';
  dom.inputScript.value = 'Script to submit';

  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(r => setImmediate(r));

  // Must NOT send POST if key cannot be safely stored
  assert.equal(postCalled, false, 'Must not send POST request if draft and submissionKey cannot be saved');

  // Form input must NOT be cleared
  assert.equal(dom.inputTitle.value, 'Title to submit');
  assert.equal(dom.inputScript.value, 'Script to submit');

  // User must see clear warning
  assert.equal(dom.errEl.style.display, 'block');
  assert.match(dom.errEl.textContent, /dung lượng|lưu nháp|bộ nhớ/i);

  cleanup();
});

test('REGRESSION 2: auto-save and form submit compute canonical signatures so retry with same content preserves submission key', async () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 1000});

  const dom = buildCreateRoot();
  let capturedKey = null;

  const cleanup = mountCreateView({
    root: dom.root,
    api: {
      request: async (path, opts) => {
        capturedKey = opts.body.clientSubmissionKey;
        return {request: {display_id: 'V100'}};
      }
    },
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'}
  });

  dom.inputTitle.value = '  Canonical Title  ';
  dom.inputScript.value = '  Canonical Script  ';
  dom.inputTitle.dispatchEvent({type: 'input'});

  // Wait for auto-save debounce (550ms)
  await new Promise(r => setTimeout(r, 550));

  const autoSavedDraft = draftStore.read('owner', 'script');
  assert.ok(autoSavedDraft?.submissionKey);

  // Now submit the form without changing content
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(r => setImmediate(r));

  // The clientSubmissionKey sent in POST must match the autoSaved draft key
  assert.equal(capturedKey, autoSavedDraft.submissionKey, 'Submit must reuse the canonical auto-saved submission key');

  cleanup();
});

test('REGRESSION 3: user editing form during in-flight POST preserves newly typed input and newer draft on success', async () => {
  const storage = createMemoryStorage();
  const draftStore = createDraftStore({storage, now: () => 1000});

  const dom = buildCreateRoot();
  let resolvePost;
  const postPromise = new Promise(r => { resolvePost = r; });

  const cleanup = mountCreateView({
    root: dom.root,
    api: {
      request: async () => {
        return postPromise;
      }
    },
    router: {navigate() {}},
    draftStore,
    user: {username: 'owner'}
  });

  dom.inputTitle.value = 'Original Title';
  dom.inputScript.value = 'Original Script';

  // Trigger submit
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}});
  await new Promise(r => setImmediate(r));

  // While POST is in flight, user types new title
  dom.inputTitle.value = 'Newer Title Typed During POST';
  dom.inputTitle.dispatchEvent({type: 'input'});
  // Auto-save the new edit
  await new Promise(r => setTimeout(r, 550));

  // Now the POST succeeds
  resolvePost({request: {display_id: 'V101'}});
  await new Promise(r => setImmediate(r));

  // Form input must NOT be wiped!
  assert.equal(dom.inputTitle.value, 'Newer Title Typed During POST');

  // Stored draft must NOT be deleted!
  const currentDraft = draftStore.read('owner', 'script');
  assert.notEqual(currentDraft, null, 'Newer draft must be preserved in storage');
  assert.equal(currentDraft?.payload?.title, 'Newer Title Typed During POST');

  cleanup();
});

test('REGRESSION 4: createDraftStore safely initializes without throwing if window.localStorage throws on access', () => {
  const fakeWindow = {};
  Object.defineProperty(fakeWindow, 'localStorage', {
    get() {
      const err = new Error('SecurityError: Access is denied');
      err.name = 'SecurityError';
      throw err;
    }
  });

  const oldWindow = globalThis.window;
  globalThis.window = fakeWindow;

  try {
    // Calling createDraftStore() must NOT throw SecurityError
    let store;
    assert.doesNotThrow(() => {
      store = createDraftStore();
    });

    // It should work in-memory
    assert.throws(() => store.save('userA', 'script', {payload: {title: 'Safe'}}), /chỉ lưu tạm/i);
    assert.equal(store.read('userA', 'script')?.payload?.title, 'Safe');
  } finally {
    globalThis.window = oldWindow;
  }
});

test('REGRESSION 6: caption draft removal with expectedSignature preserves newer draft typed in flight', () => {
  const store = createDraftStore({storage: createMemoryStorage()});

  // User submits 'Submitted caption' for display_id V100
  store.save('userA', 'caption', {
    displayId: 'V100',
    payload: {caption: 'Submitted caption', reviewRevision: 2},
    payloadSignature: 'Submitted caption'
  });

  // While PATCH is in flight, user types and auto-saves a newer caption
  store.save('userA', 'caption', {
    displayId: 'V100',
    payload: {caption: 'New In-Flight Caption', reviewRevision: 2},
    payloadSignature: 'New In-Flight Caption'
  });

  // PATCH for 'Submitted caption' succeeds and attempts conditional removal
  const removed = store.remove('userA', 'caption', {
    displayId: 'V100',
    expectedSignature: 'Submitted caption'
  });

  // Must NOT remove newer draft!
  assert.equal(removed, false, 'Conditional remove must fail when signature does not match');
  const preserved = store.read('userA', 'caption', 'V100');
  assert.notEqual(preserved, null, 'Newer draft must be preserved in storage');
  assert.equal(preserved.payload.caption, 'New In-Flight Caption');
});

test('unavailable localStorage exposes memory-only persistence and blocks durable submission', async () => {
  const previousWindow = globalThis.window;
  const denied = {};
  Object.defineProperty(denied, 'localStorage', {get() { throw new DOMException('Denied', 'SecurityError'); }});
  globalThis.window = denied;
  let store;
  try { store = createDraftStore(); } finally { globalThis.window = previousWindow; }
  assert.equal(store.persistenceAvailable, false);
  assert.throws(() => store.save('owner', 'script', {payload: {title: 'Memory recovery'}}), /chỉ lưu tạm/i);
  assert.equal(store.read('owner', 'script').payload.title, 'Memory recovery');
  const dom = buildCreateRoot(); let posts = 0;
  const cleanup = mountCreateView({root: dom.root, draftStore: store, user: {username: 'owner'}, api: async () => { posts++; }, router: {navigate() {}}});
  dom.inputTitle.value = 'Local title'; dom.inputScript.value = 'Local script';
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts, 0);
  assert.equal(dom.inputTitle.value, 'Local title');
  assert.match(dom.errEl.textContent, /chưa|lưu|bộ nhớ/i);
  cleanup();
});

test('submission requires a verified durable write, not a silently ignored storage set', async () => {
  const store = createDraftStore({storage: {getItem() { return null; }, setItem() {}, removeItem() {}}});
  const dom = buildCreateRoot(); let posts = 0;
  const cleanup = mountCreateView({root: dom.root, draftStore: store, user: {username: 'owner'}, api: async () => { posts++; }, router: {navigate() {}}});
  dom.inputTitle.value = 'Title'; dom.inputScript.value = 'Script';
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts, 0); cleanup();
});

test('lost-response reload restores exact form text and retains canonical submission key', async () => {
  const store = createDraftStore({storage: createMemoryStorage(), now: () => 5000});
  const keys = [];
  const api = async (_, options) => { keys.push(options.body.clientSubmissionKey); throw new Error('Lost response'); };
  const first = buildCreateRoot();
  const cleanup = mountCreateView({root: first.root, api, router: {navigate() {}}, draftStore: store, user: {username: 'owner'}});
  first.inputTitle.value = '  Title  '; first.inputScript.value = '  Script\n  '; first.inputVoice.value = '   ';
  first.form.dispatchEvent({type: 'submit', preventDefault() {}}); await new Promise(resolve => setImmediate(resolve)); cleanup();
  assert.equal(store.read('owner', 'script').payload.title, '  Title  ');
  const second = buildCreateRoot();
  const cleanup2 = mountCreateView({root: second.root, api, router: {navigate() {}}, draftStore: store, user: {username: 'owner'}});
  assert.equal(second.inputTitle.value, '', 'restore choice must be explicit');
  assert.match(second.bannerMsg.textContent, /lưu lúc/);
  second.btnRestore.dispatchEvent({type: 'click'});
  assert.equal(second.inputScript.value, '  Script\n  ');
  second.form.dispatchEvent({type: 'submit', preventDefault() {}}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(keys[1], keys[0]); cleanup2();
});

test('create success preserves raw edits made in flight even when canonical POST text is equal', async () => {
  const store = createDraftStore({storage: createMemoryStorage()}); const dom = buildCreateRoot();
  let resolve;
  const cleanup = mountCreateView({root: dom.root, api: async () => new Promise(done => { resolve = done; }), router: {navigate() {}}, draftStore: store, user: {username: 'owner'}});
  dom.inputTitle.value = 'Title'; dom.inputScript.value = 'Script';
  dom.form.dispatchEvent({type: 'submit', preventDefault() {}}); await new Promise(done => setImmediate(done));
  dom.inputTitle.value = '  Title  '; dom.inputTitle.dispatchEvent({type: 'input'});
  resolve({request: {display_id: 'V003'}}); await new Promise(done => setImmediate(done));
  assert.equal(dom.inputTitle.value, '  Title  ');
  assert.equal(store.read('owner', 'script').payload.title, '  Title  '); cleanup();
});

test('caption removal checks the submitted revision as well as raw caption snapshot', () => {
  const store = createDraftStore({storage: createMemoryStorage()});
  store.save('owner', 'caption', {displayId: 'V002', payload: {caption: 'Same text', reviewRevision: 4}, payloadSignature: 'Same text'});
  assert.equal(store.remove('owner', 'caption', {displayId: 'V002', expectedSignature: 'Same text', expectedReviewRevision: 3}), false);
  assert.equal(store.read('owner', 'caption', 'V002').payload.reviewRevision, 4);
});
