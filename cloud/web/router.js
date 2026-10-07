const STATUSES = new Set(['all', 'waiting', 'producing', 'review', 'publishing', 'sent', 'needs_review']);
const DISPLAY_ID = /^V\d+$/i;
const DEFAULT_ORIGIN = 'https://studio.invalid';

export function parseRoute(value, origin = DEFAULT_ORIGIN) {
  let url;
  try {
    url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password) return {name: 'notFound'};
  } catch {
    return {name: 'notFound'};
  }
  const path = url.pathname;
  if (path === '/login') {
    const route = {name: 'login'};
    const next = url.searchParams.get('next');
    // A return path is always local and cannot recurse into another login URL.
    if (next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) {
      const target = new URL(next, url.origin);
      if (target.pathname !== '/login') {
        const parsed = parseRoute(target, url.origin);
        if (parsed.name !== 'notFound') route.next = routeHref(parsed);
      }
    }
    return route;
  }
  if (path === '/' || path === '/studio') {
    const status = url.searchParams.get('status');
    if (status !== null && !STATUSES.has(status)) return {name: 'notFound'};
    return status === null ? {name: 'list'} : {name: 'list', status};
  }
  if (path === '/studio/new') return {name: 'create'};
  if (path === '/studio/system') return {name: 'system'};
  const match = /^\/studio\/videos\/(V\d+)(\/publish)?$/i.exec(path);
  if (match && path.startsWith('/studio/videos/') && (!match[2] || match[2] === '/publish')) {
    return {name: match[2] ? 'publish' : 'detail', displayId: match[1].toUpperCase()};
  }
  return {name: 'notFound'};
}

export function routeHref(route) {
  if (route.name === 'login') {
    const parsed = parseRoute(`/login?next=${encodeURIComponent(route.next || '')}`);
    return parsed.next ? `/login?next=${encodeURIComponent(parsed.next)}` : '/login';
  }
  if (route.name === 'list') {
    if (route.status !== undefined && !STATUSES.has(route.status)) throw new TypeError('Invalid Studio status');
    return '/studio' + (route.status ? `?status=${route.status}` : '');
  }
  if (route.name === 'create') return '/studio/new';
  if (route.name === 'system') return '/studio/system';
  if (route.name === 'detail' || route.name === 'publish') {
    if (!DISPLAY_ID.test(route.displayId || '')) throw new TypeError('Invalid Studio display ID');
    return `/studio/videos/${route.displayId.toUpperCase()}` + (route.name === 'publish' ? '/publish' : '');
  }
  if (route.name === 'notFound') return '/not-found';
  throw new TypeError('Unknown Studio route');
}

// getViewState supplies list data/filter/cursor/focus only; routing never fetches or changes auth.
export function createRouter({window: win, onRoute, getViewState = () => undefined}) {
  let started = false;
  let renderVersion = 0;
  let previousScrollRestoration;

  function saveEntry() {
    const entry = win.history.state;
    if (!entry?.videoStudio) return;
    win.history.replaceState({...entry, scrollY: win.scrollY, viewState: getViewState() ?? entry.viewState}, '');
  }

  function render(reason) {
    const route = parseRoute(win.location.href, win.location.origin);
    const href = route.name === 'notFound' ? win.location.pathname + win.location.search : routeHref(route);
    const current = win.history.state;
    const entry = current?.videoStudio ? {...current, route} : {videoStudio: true, route, scrollY: win.scrollY};
    // Canonicalization must not leave a duplicate lowercase/root entry behind.
    win.history.replaceState(entry, '', href);
    const version = ++renderVersion;
    const done = onRoute(route, {reason, entry});
    Promise.resolve(done).then(() => {
      if (version === renderVersion && started) win.scrollTo(0, reason === 'popstate' ? entry.scrollY || 0 : 0);
    });
  }

  function popstate() { render('popstate'); }

  return {
    start() {
      if (started) return;
      started = true;
      previousScrollRestoration = win.history.scrollRestoration;
      win.history.scrollRestoration = 'manual';
      win.addEventListener('popstate', popstate);
      win.addEventListener('scroll', saveEntry);
      win.addEventListener('pagehide', saveEntry);
      win.document?.addEventListener('focusin', saveEntry);
      render('start');
    },
    // List responses change data/cursors even when no navigation or scrolling occurs.
    save() { saveEntry(); },
    navigate(route, {replace = false, reason = 'link'} = {}) {
      saveEntry();
      const href = routeHref(route);
      if (!replace && href === win.location.pathname + win.location.search) return;
      win.history[replace ? 'replaceState' : 'pushState']({videoStudio: true, route, scrollY: 0}, '', href);
      render(reason);
    },
    stop() {
      if (!started) return;
      saveEntry();
      started = false;
      renderVersion++;
      win.removeEventListener('popstate', popstate);
      win.removeEventListener('scroll', saveEntry);
      win.removeEventListener('pagehide', saveEntry);
      win.document?.removeEventListener('focusin', saveEntry);
      win.history.scrollRestoration = previousScrollRestoration;
    }
  };
}
