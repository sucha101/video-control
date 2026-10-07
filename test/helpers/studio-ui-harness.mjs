import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as policy from '../../cloud/web/studio-policy.js';
import * as routing from '../../cloud/web/router.js';
import * as transport from '../../cloud/web/api-client.js';
import * as session from '../../cloud/web/session.js';
import * as drafts from '../../cloud/web/drafts.js';
import * as createView from '../../cloud/web/views/create.js';

function events(target) {
  const listeners = new Map();
  target.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  };
  target.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
  target.dispatch = (type, event = {}) => {
    for (const listener of listeners.get(type) || []) listener({type, ...event});
  };
  return target;
}

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

export async function settle() {
  for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve));
}

// A small DOM/history fake executes the actual app closure and router. Responses are local stubs.
export async function studioHarness({path = '/studio', fetchImpl, storage}) {
  if (!storage) {
    const values = new Map();
    storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
  }
  const alerts = [];
  const nodes = new Map();
  const document = events({hidden: false, activeElement: null, title: ''});
  class Element {
    constructor(tag = 'div') {
      events(this);
      this.tagName = tag.toUpperCase();
      this.style = {};
      this.attributes = new Map();
      this.children = [];
      this.value = '';
      this.textContent = '';
      this.disabled = false;
      this.dataset = {};
      this.classList = {toggle() {}, add() {}, remove() {}};
    }
    set id(value) { this._id = value; nodes.set(value, this); }
    get id() { return this._id; }
    get firstChild() { return this.children[0]; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    querySelector(selector) {
      this.selected ??= new Map();
      if (!this.selected.has(selector)) this.selected.set(selector, new Element(selector === 'h2' || selector === 'h3' ? selector : 'div'));
      return this.selected.get(selector);
    }
    querySelectorAll() { return []; }
    focus() { document.activeElement = this; document.dispatch('focusin', {target: this}); }
  }
  document.getElementById = id => nodes.get(id) || null;
  document.createElement = tag => new Element(tag);
  document.querySelectorAll = () => [];
  document.activeElement = new Element('body');
  const source = await readFile(new URL('../../cloud/web/app.js', import.meta.url), 'utf8');
  for (const match of source.matchAll(/getElementById\('([^']+)'\)/g)) {
    const element = new Element();
    element.id = match[1];
  }
  const entries = [{url: path, state: null}];
  let index = 0;
  const window = events({location: new URL(path, 'https://studio.example'), scrollY: 0, document});
  if (storage) window.localStorage = storage;
  window.scrollTo = (x, y) => { window.scrollY = y; };
  window.history = {
    scrollRestoration: 'auto',
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    replaceState(state, unused, url) { entries[index] = {state: structuredClone(state), url: url ?? entries[index].url}; window.location = new URL(entries[index].url, window.location.origin); },
    pushState(state, unused, url) { entries.splice(++index); entries.push({state: structuredClone(state), url}); window.location = new URL(url, window.location.origin); },
    back() { if (index) { index--; window.location = new URL(entries[index].url, window.location.origin); window.dispatch('popstate'); } },
    forward() { if (index < entries.length - 1) { index++; window.location = new URL(entries[index].url, window.location.origin); window.dispatch('popstate'); } }
  };
  const context = vm.createContext({document, window, ...policy, ...routing, ...transport, ...session, ...drafts, ...createView,
    createDraftStore: options => drafts.createDraftStore({storage, ...options}), FormData, Blob, AbortSignal,
    fetch: async (url, options) => { const result = await fetchImpl(url, options); return result instanceof Response ? result : Response.json(result); },
    setTimeout, clearTimeout, alert: message => alerts.push(message), confirm: () => false, URL, Map});
  const instrumented = source.replace(/^import .+;\r?\n/gm, '').replace(/\}\)\(\);\s*$/, 'globalThis.app = {state, router, loadRequests};\n})();');
  vm.runInContext(instrumented, context, {filename: 'app.js'});
  context.app.state.currentUser = {username: 'fixture-user', role: 'owner'};
  return {app: context.app, window, document, nodes, alerts, storage};
}

export function video(displayId, extra = {}) {
  return {id: `fixture-${displayId}`, display_id: displayId, title: `Title ${displayId}`, script: `Script ${displayId}`,
    caption: `Caption ${displayId}`, production_state: 'review', publication_state: null,
    skill: 'viet-tiktok-story-video', updated_at: '2026-10-05T12:00:00Z', review_revision: 1, ...extra};
}
