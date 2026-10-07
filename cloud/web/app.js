import {SKILL_NAMES, AGENT_NAMES, requestStateLabel, canRetryReceipt, safeHttpsUrl, driveVideoId, canonicalSubmissionPayload, submissionIntent} from './studio-policy.js';
import {createRouter, parseRoute, routeHref} from './router.js';
import {createApiClient} from './api-client.js';
import {createSessionController, safeReturnPath} from './session.js';
import {createDraftStore} from './drafts.js';
import {mountCreateView} from './views/create.js';

// Render user text via textContent and validate URLs before assigning href/src.

(function() {
  'use strict';

  const state = {
    currentUser: null,
    sessionStatus: null,
    currentView: 'login',
    currentRoute: null,
    currentDetail: null,
    currentFilter: 'all',
    requests: [],
    nextCursor: null,
    pollTimer: null,
    healthInFlight: false,
    healthPollVersion: 0,
    detailLoadVersion: 0,
    listLoadVersion: 0,
    submission: null,
    createRedirectTimer: null,
    mutationInFlight: false
  };

  function submissionKey(payload) {
    state.submission = submissionIntent(state.submission, state.currentUser?.username, payload);
    // Preserve the key if the response is lost and the user retries unchanged input.
    return state.submission.key;
  }

  async function saveCaptionIfChanged() {
    if (el.detailCaptionConflict?.style.display === 'block') {
      throw new Error('Hãy chọn dùng caption trên máy hoặc caption trên máy chủ trước khi lưu/đăng.');
    }
    const generation = accountGeneration;
    const username = state.currentUser?.username;
    const req = state.currentDetail;
    if (!username || !req || !req.display_id) return false;
    const expectedRevision = req.review_revision;
    const submittedRaw = el.detailCaptionInput.value;
    const caption = submittedRaw.trim();
    if (caption === (req.caption || '')) {
      draftStore.remove(username, 'caption', {
        displayId: req.display_id,
        expectedSignature: caption,
        expectedReviewRevision: expectedRevision
      });
      return true;
    }
    const res = await api(`/api/web/requests/${req.id}/review`, {
      method: 'PATCH',
      body: {caption, expectedReviewRevision: expectedRevision}
    });
    if (accountGeneration !== generation || state.currentUser?.username !== username || state.currentDetail?.id !== req.id) {
      return false;
    }
    if (state.currentDetail.review_revision !== expectedRevision) {
      return false;
    }
    state.currentDetail = res.request;
    const currentInputVal = el.detailCaptionInput.value;
    if (currentInputVal === submittedRaw) {
      draftStore.remove(username, 'caption', {
        displayId: req.display_id,
        expectedSignature: submittedRaw,
        expectedReviewRevision: expectedRevision
      });
    } else {
      try {
        draftStore.save(username, 'caption', {
          displayId: req.display_id,
          payload: {
            caption: currentInputVal,
            reviewRevision: res.request.review_revision
          },
          payloadSignature: currentInputVal
        });
      } catch (err) {
        console.warn('Không thể lưu nháp caption:', err);
      }
    }
    return true;
  }

  function saveCaptionDraftNow() {
    if (captionDebounceTimer) {
      clearTimeout(captionDebounceTimer);
      captionDebounceTimer = null;
    }
    const username = state.currentUser?.username;
    const req = state.currentDetail;
    if (!username || !req || !req.display_id) return;
    // The local caption belongs to an unresolved conflict. Keep it intact until
    // the user explicitly chooses the local or server version.
    if (el.detailCaptionConflict?.style.display === 'block') return;
    const caption = el.detailCaptionInput.value;
    try {
      draftStore.save(username, 'caption', {
        displayId: req.display_id,
        payload: {
          caption,
          reviewRevision: req.review_revision
        },
        payloadSignature: caption
      });
    } catch (err) {
      if (typeof alert === 'function') {
        try { alert(`Nháp chưa lưu trên thiết bị: ${err.message}`); } catch {}
      }
    }
  }

  function updateRetryButton() {
    if (!el.btnRetryPublish) return;
    const selected = el.receiptsContainer.querySelectorAll('input[name="retry-channel"]:checked');
    el.btnRetryPublish.disabled = state.mutationInFlight || selected.length === 0;
  }

  // DOM Elements
  const el = {
    // Header
    runnerDot: document.getElementById('runner-dot'),
    runnerLabel: document.getElementById('runner-label'),
    userSection: document.getElementById('user-section'),
    userDisplay: document.getElementById('user-display'),
    btnLogout: document.getElementById('btn-logout'),

    // Views
    viewLogin: document.getElementById('view-login'),
    viewList: document.getElementById('view-list'),
    viewCreate: document.getElementById('view-create'),
    viewDetail: document.getElementById('view-detail'),
    viewSystem: document.getElementById('view-system'),
    viewNotFound: document.getElementById('view-not-found'),
    viewSession: document.getElementById('view-session'),
    sessionMessage: document.getElementById('session-message'),
    btnSessionRetry: document.getElementById('btn-session-retry'),
    bottomNav: document.getElementById('bottom-nav'),
    desktopNav: document.getElementById('desktop-nav'),
    deskBtnList: document.getElementById('desk-btn-list'),
    deskBtnCreate: document.getElementById('desk-btn-create'),
    btnCreateTop: document.getElementById('btn-create-top'),

    // Login Form
    formLogin: document.getElementById('form-login'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    loginError: document.getElementById('login-error'),
    btnSubmitLogin: document.getElementById('btn-submit-login'),

    // List View
    filterBar: document.getElementById('filter-bar'),
    requestsContainer: document.getElementById('requests-container'),
    navBtnList: document.getElementById('nav-btn-list'),
    navBtnCreate: document.getElementById('nav-btn-create'),

    // Create Form
    formCreate: document.getElementById('form-create-request'),
    reqTitle: document.getElementById('req-title'),
    reqScript: document.getElementById('req-script'),
    reqVoice: document.getElementById('req-voice'),
    reqNotes: document.getElementById('req-notes'),
    countTitle: document.getElementById('count-title'),
    countScript: document.getElementById('count-script'),
    createError: document.getElementById('create-error'),
    createSuccess: document.getElementById('create-success'),
    btnSubmitCreate: document.getElementById('btn-submit-create'),
    skillCardStory: document.getElementById('skill-card-story'),
    skillCardDrama: document.getElementById('skill-card-drama'),
    createDraftBanner: document.getElementById('create-draft-banner'),
    createDraftMessage: document.getElementById('create-draft-message'),
    btnDraftRestore: document.getElementById('btn-draft-restore'),
    btnDraftDiscard: document.getElementById('btn-draft-discard'),

    // Detail View
    btnBackToList: document.getElementById('btn-back-to-list'),
    detailDisplayId: document.getElementById('detail-display-id'),
    detailTitle: document.getElementById('detail-title'),
    detailSkillBadge: document.getElementById('detail-skill-badge'),
    detailAgentBadge: document.getElementById('detail-agent-badge'),
    detailStateBadge: document.getElementById('detail-state-badge'),
    videoPreviewSection: document.getElementById('video-preview-section'),
    videoIframe: document.getElementById('video-iframe'),
    btnOpenDrive: document.getElementById('btn-open-drive'),
    detailScriptText: document.getElementById('detail-script-text'),
    detailCaptionConflict: document.getElementById('detail-caption-conflict'),
    detailCaptionConflictMessage: document.getElementById('detail-caption-conflict-message'),
    btnCaptionUseLocal: document.getElementById('btn-caption-use-local'),
    btnCaptionDiscardLocal: document.getElementById('btn-caption-discard-local'),
    detailCaptionInput: document.getElementById('detail-caption-input'),
    btnSaveCaption: document.getElementById('btn-save-caption'),
    detailNotice: document.getElementById('detail-notice'),
    btnCancelReq: document.getElementById('btn-cancel-req'),
    btnRetryProduction: document.getElementById('btn-retry-production'),

    // Publish & Receipts
    sectionPublish: document.getElementById('section-publish'),
    btnSubmitPublish: document.getElementById('btn-submit-publish'),
    chkChanYoutube: document.getElementById('chk-chan-youtube'),
    chkChanTiktok: document.getElementById('chk-chan-tiktok'),
    chkChanFacebook: document.getElementById('chk-chan-facebook'),
    publishScheduleTime: document.getElementById('publish-schedule-time'),
    sectionReceipts: document.getElementById('section-receipts'),
    receiptsContainer: document.getElementById('receipts-container'),
    btnRetryPublish: document.getElementById('btn-retry-publish'),
    receiptsNotice: document.getElementById('receipts-notice')
  };

  const router = createRouter({
    window,
    onRoute: renderRoute,
    getViewState: () => state.currentView === 'list' ? {
      filter: state.currentFilter,
      cursor: state.nextCursor,
      requests: state.requests,
      username: state.currentUser?.username,
      focusId: document.activeElement?.id || null
    } : undefined
  });

  const transport = createApiClient({fetchImpl: (...args) => fetch(...args)});
  const session = createSessionController({api: transport, router, window, document, onState: renderSession});
  const api = async (path, options) => {
    const result = await session.request(path, options);
    // A successful response may race a separate session check. Wait for that
    // check before consumers decide whether their account/load fence is valid.
    if (state.sessionStatus === 'checking') await session.revalidate();
    return result;
  };
  const draftStore = createDraftStore();
  let createViewCleanup = null;
  let captionDebounceTimer = null;
  let privateUsername = null;
  let accountGeneration = 0;
  let resumeView = 'list';
  let resumeTitle = '';

  function switchPrivateUser(username) {
    if (username === privateUsername) return;
    accountGeneration++;
    if (createViewCleanup) {
      try {
        createViewCleanup();
      } catch (err) {
        console.warn('Error during createViewCleanup on switchPrivateUser:', err);
      }
      createViewCleanup = null;
    }
    if (captionDebounceTimer) {
      clearTimeout(captionDebounceTimer);
      captionDebounceTimer = null;
      // Save the outgoing account's edit before the identity/detail fields are
      // cleared. saveCaptionDraftNow catches storage errors and respects an
      // unresolved conflict, so privacy cleanup can always continue.
      saveCaptionDraftNow();
    }
    const inputs = [el.reqTitle, el.reqScript, el.reqNotes, el.reqVoice];
    if (privateUsername) {
      const values = inputs.map(input => input.value);
      if (values.some(Boolean)) {
        const payload = {
          title: el.reqTitle.value || '',
          script: el.reqScript.value || '',
          notes: el.reqNotes.value || '',
          voice: el.reqVoice.value || '',
          skill: el.formCreate.querySelector('input[name="skill"]:checked')?.value || 'viet-tiktok-story-video'
        };
        const stored = draftStore.read(privateUsername, 'script');
        const previous = stored?.submissionKey
          ? {key: stored.submissionKey, signature: stored.payloadSignature}
          : null;
        const intent = submissionIntent(previous, privateUsername, canonicalSubmissionPayload(payload));
        try {
          draftStore.save(privateUsername, 'script', {
            payload,
            submissionKey: intent.key,
            payloadSignature: intent.signature
          });
        } catch (err) {
          console.warn('Không thể lưu nháp khi đổi tài khoản:', err);
        }
      }
    }
    inputs.forEach(input => { input.value = ''; });
    const skill = 'viet-tiktok-story-video';
    el.formCreate.querySelectorAll('input[name="skill"]').forEach(input => { input.checked = input.value === skill; });
    el.skillCardStory.classList.toggle('selected', skill === 'viet-tiktok-story-video');
    el.skillCardDrama.classList.toggle('selected', skill === 'drama-mascot-video');
    el.countTitle.textContent = '0/160';
    el.countScript.textContent = '0/30000';
    el.createError.style.display = el.createSuccess.style.display = 'none';
    if (el.createDraftBanner) el.createDraftBanner.style.display = 'none';
    el.btnSubmitCreate.disabled = false;
    el.btnSubmitCreate.querySelector('.btn-text-normal').style.display = 'inline';
    el.btnSubmitCreate.querySelector('.btn-text-loading').style.display = 'none';
    state.submission = null;
    state.mutationInFlight = false;
    state.requests = [];
    state.nextCursor = null;
    state.currentDetail = null;
    state.listLoadVersion++;
    state.detailLoadVersion++;
    el.requestsContainer.replaceChildren();
    el.receiptsContainer.replaceChildren();
    for (const node of [el.detailDisplayId, el.detailTitle, el.detailSkillBadge, el.detailAgentBadge, el.detailStateBadge, el.detailScriptText, el.detailNotice]) node.textContent = '';
    el.detailCaptionInput.value = '';
    if (el.detailCaptionConflict) el.detailCaptionConflict.style.display = 'none';
    el.videoIframe.src = '';
    el.btnOpenDrive.removeAttribute('href');
    privateUsername = username;
  }

  function renderSession({state: status, user, source}) {
    const previousStatus = state.sessionStatus;
    const changedIdentity = status === 'authenticated' && user.username !== privateUsername;
    if (status === 'guest' || changedIdentity) switchPrivateUser(status === 'guest' ? null : user.username);
    if (status === 'checking' && previousStatus === 'authenticated') {
      resumeView = state.currentView;
      resumeTitle = document.title;
    }
    state.sessionStatus = status;
    state.currentUser = status === 'authenticated' ? user : null;
    if (status === 'authenticated') {
      el.userDisplay.textContent = user.username;
      // The controller performs the login replacement after emitting auth.
      const route = parseRoute(window.location.href, window.location.origin);
      const resume = source === 'revalidate' && !changedIdentity && state.currentRoute &&
        routeHref(route) === routeHref(state.currentRoute);
      if (route.name !== 'login') {
        if (resume) { renderView(resumeView, {preserveLoads: true}); document.title = resumeTitle; }
        else renderRoute(route);
      }
      if (!state.pollTimer && !state.healthInFlight) {
        if (resume) state.pollTimer = setTimeout(pollHealth, 60000);
        else pollHealth();
      }
      return;
    }
    state.healthPollVersion++;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
    if (status === 'guest') {
      state.requests = [];
      state.currentDetail = null;
      el.requestsContainer.replaceChildren();
      el.videoIframe.src = '';
      renderView('login');
    } else {
      renderView('session', {preserveLoads: true});
      el.sessionMessage.textContent = status === 'checking' ? 'Đang kiểm tra phiên đăng nhập…' : 'Chưa kết nối được máy chủ. Phiên đăng nhập chưa được xác minh; bạn có thể thử lại.';
      el.btnSessionRetry.style.display = status === 'unavailable' ? 'inline-flex' : 'none';
      el.videoIframe.src = '';
    }
    if (previousStatus !== status) document.title = `${status === 'guest' ? 'Đăng nhập' : 'Kết nối Studio'} · Video Studio`;
  }

  // Navigation View Controller
  function renderView(viewName, {preserveLoads = false} = {}) {
    if (viewName !== 'detail' && !preserveLoads) state.detailLoadVersion++;
    if (viewName !== 'detail') saveCaptionDraftNow();
    if (viewName !== 'create' && createViewCleanup) {
      createViewCleanup();
      createViewCleanup = null;
    }
    if (state.createRedirectTimer) {
      clearTimeout(state.createRedirectTimer);
      state.createRedirectTimer = null;
    }
    state.currentView = viewName;
    el.viewLogin.style.display = viewName === 'login' ? 'block' : 'none';
    el.viewList.style.display = viewName === 'list' ? 'block' : 'none';
    el.viewCreate.style.display = viewName === 'create' ? 'block' : 'none';
    el.viewDetail.style.display = viewName === 'detail' ? 'block' : 'none';
    el.viewSystem.style.display = viewName === 'system' ? 'block' : 'none';
    el.viewNotFound.style.display = viewName === 'notFound' ? 'block' : 'none';
    el.viewSession.style.display = viewName === 'session' ? 'block' : 'none';

    if (viewName === 'create' && state.currentUser) {
      if (createViewCleanup) createViewCleanup();
      createViewCleanup = mountCreateView({
        root: el.viewCreate,
        document,
        api,
        router: {navigate},
        draftStore,
        user: state.currentUser,
        onFeedback: fb => {
          if (el.createError && fb?.type === 'warning') {
            el.createError.textContent = fb.message;
            el.createError.style.display = 'block';
          }
        }
      });
    }

    el.bottomNav.style.display = state.currentUser ? 'flex' : 'none';
    el.userSection.style.display = state.currentUser ? 'flex' : 'none';
    if (el.desktopNav) el.desktopNav.style.display = state.currentUser ? 'flex' : 'none';

    if (el.navBtnList) el.navBtnList.classList.toggle('active', viewName === 'list');
    if (el.navBtnCreate) el.navBtnCreate.classList.toggle('active', viewName === 'create');
    if (el.deskBtnList) el.deskBtnList.classList.toggle('active', viewName === 'list');
    if (el.deskBtnCreate) el.deskBtnCreate.classList.toggle('active', viewName === 'create');

    for (const link of document.querySelectorAll('[data-studio-link]')) {
      const linkedRoute = parseRoute(link.href, window.location.origin);
      if (linkedRoute.name === state.currentRoute?.name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  async function renderRoute(route, {reason, entry} = {}) {
    // A restored list does not fetch, but must still fence the previous route's response.
    state.listLoadVersion++;
    if (state.sessionStatus === 'checking' || state.sessionStatus === 'unavailable') return;
    if (state.currentUser && route.name === 'login') {
      router.navigate(parseRoute(safeReturnPath(route.next, window.location.origin), window.location.origin), {replace: true, reason: 'login'});
      return;
    }
    if (!state.currentUser && route.name !== 'login' && route.name !== 'notFound') {
      router.navigate({name: 'login', next: safeReturnPath(routeHref(route), window.location.origin)}, {replace: true, reason: 'login'});
      return;
    }
    state.currentRoute = route;
    let viewName = route.name === 'publish' ? 'detail' : route.name;
    if (viewName === 'detail') prepareDetail(route.displayId);
    renderView(viewName);
    if (route.name === 'list') {
      const saved = reason === 'popstate' ? entry?.viewState : null;
      state.currentFilter = route.status || 'all';
      el.filterBar.querySelectorAll('[data-filter]').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === state.currentFilter);
      });
      if (saved?.requests && saved.username === state.currentUser.username) {
        state.requests = saved.requests;
        state.nextCursor = saved.cursor;
        renderRequestsList();
      } else {
        await loadRequests();
      }
    } else if (route.name === 'detail' || route.name === 'publish') {
      if (await openDetailView(route.displayId) === false) viewName = 'notFound';
    }
    if (state.currentRoute !== route) return;
    const titles = {
      login: 'Đăng nhập', list: route.status === 'review' ? 'Cần duyệt' : 'Video của tôi',
      create: 'Tạo video', system: 'Kết nối hệ thống', notFound: 'Không tìm thấy',
      detail: `${route.displayId} — ${state.currentDetail?.title || 'Video'}`,
      publish: `Xác nhận đăng ${route.displayId}`
    };
    document.title = `${viewName === 'notFound' ? titles.notFound : titles[route.name]} · Video Studio`;
    const view = document.getElementById(`view-${viewName === 'notFound' ? 'not-found' : viewName}`);
    const restoredFocus = reason === 'popstate' && route.name === 'list' && entry?.viewState?.focusId;
    const target = (restoredFocus && document.getElementById(restoredFocus)) ||
      (route.name === 'publish' && el.sectionPublish.style.display === 'block' ?
        el.sectionPublish.querySelector('h3') : view?.querySelector('h2'));
    if (target) {
      if (!restoredFocus) target.setAttribute('tabindex', '-1');
      target.focus({preventScroll: true});
    }
  }

  function prepareDetail(displayId) {
    state.currentDetail = null;
    el.viewDetail.setAttribute('aria-busy', 'true');
    el.detailDisplayId.textContent = displayId;
    el.detailTitle.textContent = 'Đang tải video…';
    document.title = `${displayId} · Video Studio`;
    el.detailSkillBadge.textContent = '';
    el.detailAgentBadge.textContent = '';
    el.detailStateBadge.textContent = '';
    el.detailScriptText.textContent = '';
    el.detailCaptionInput.value = '';
    el.detailCaptionInput.disabled = true;
    el.detailNotice.textContent = 'Đang tải thông tin video…';
    el.videoIframe.src = '';
    el.btnOpenDrive.removeAttribute('href');
    el.videoPreviewSection.style.display = 'none';
    el.sectionPublish.style.display = 'none';
    el.sectionReceipts.style.display = 'none';
    el.receiptsContainer.replaceChildren();
    el.btnSaveCaption.style.display = 'none';
    el.btnCancelReq.style.display = 'none';
    el.btnRetryProduction.style.display = 'none';
    for (const button of [el.btnSaveCaption, el.btnCancelReq, el.btnRetryProduction, el.btnSubmitPublish, el.btnRetryPublish]) {
      if (button) button.disabled = true;
    }
  }

  function navigate(route, options) {
    if (state.mutationInFlight && route.name !== 'login') return;
    router.navigate(route, options);
  }

  // Health and Presence Polling
  async function checkHealth() {
    if (!state.currentUser || document.hidden || state.healthInFlight) return;
    state.healthInFlight = true;
    try {
      const data = await api('/api/web/health');
      if (data.runnerOnline) {
        el.runnerDot.className = 'status-dot online';
        el.runnerLabel.textContent = 'Máy dựng online';
      } else {
        el.runnerDot.className = 'status-dot offline';
        el.runnerLabel.textContent = 'Máy dựng chưa bật';
      }
    } catch {
      el.runnerDot.className = 'status-dot offline';
      el.runnerLabel.textContent = 'Mất kết nối máy chủ';
    } finally {
      state.healthInFlight = false;
    }
  }

  async function pollHealth() {
    const version = ++state.healthPollVersion;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
    if (!state.currentUser || document.hidden) return;
    await checkHealth();
    if (version === state.healthPollVersion && state.currentUser && !document.hidden) {
      state.pollTimer = setTimeout(pollHealth, 60000);
    } else if (state.currentUser && !document.hidden && !state.pollTimer) {
      // Session revalidation changed the generation while health was in flight.
      // Resume at the normal interval without another immediate request.
      state.pollTimer = setTimeout(pollHealth, 60000);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.healthPollVersion++;
      if (state.pollTimer) clearTimeout(state.pollTimer);
      state.pollTimer = null;
    } else {
      pollHealth();
    }
  });

  // Session Initialization
  async function initSession() {
    state.sessionStatus = 'checking';
    // Validate raw next before the router canonicalizes URL path segments.
    const initialUrl = new URL(window.location.href);
    if (initialUrl.pathname === '/login') {
      router.navigate({name: 'login', next: safeReturnPath(initialUrl.searchParams.get('next'), initialUrl.origin)}, {replace: true, reason: 'login'});
    }
    router.start();
    await session.bootstrap();
  }

  // Render Requests List safely without innerHTML
  function renderLoadMore(container) {
    if (!state.nextCursor) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary btn-block';
    button.textContent = 'Tải thêm video';
    button.addEventListener('click', async () => {
      button.disabled = true;
      await loadRequests({append: true});
      button.disabled = false;
    });
    container.appendChild(button);
  }

  function renderRequestsList() {
    const container = el.requestsContainer;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const filtered = state.requests.filter(req => {
      if (state.currentFilter === 'all') return true;
      if (state.currentFilter === 'sent') return req.publication_state === 'sent';
      if (state.currentFilter === 'review') return req.production_state === 'review' && !req.publication_state;
      return req.production_state === state.currentFilter;
    });

    if (filtered.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'card text-center';
      emptyDiv.style.padding = '40px 20px';
      const p = document.createElement('p');
      p.className = 'section-subtitle';
      p.textContent = 'Chưa có yêu cầu nào trong mục này.';
      emptyDiv.appendChild(p);
      container.appendChild(emptyDiv);
      renderLoadMore(container);
      return;
    }

    filtered.forEach(req => {
      const card = document.createElement('a');
      card.className = 'req-item-card';
      card.href = routeHref({name: 'detail', displayId: req.display_id});
      card.dataset.studioLink = '';
      card.id = `video-${req.display_id}`;
      card.style.color = 'inherit';
      card.style.textDecoration = 'none';

      // Header row
      const header = document.createElement('div');
      header.className = 'req-item-header';

      const idSpan = document.createElement('span');
      idSpan.className = 'req-item-id';
      idSpan.textContent = req.display_id;

      const stateInfo = requestStateLabel(req);
      const stateBadge = document.createElement('span');
      stateBadge.className = `badge ${stateInfo.badgeClass}`;
      stateBadge.textContent = stateInfo.text;

      header.appendChild(idSpan);
      header.appendChild(stateBadge);

      // Title
      const title = document.createElement('h3');
      title.className = 'req-item-title';
      title.textContent = req.title;

      // Footer row
      const footer = document.createElement('div');
      footer.className = 'req-item-footer';

      const skillSpan = document.createElement('span');
      skillSpan.textContent = `${SKILL_NAMES[req.skill] || req.skill} · ${AGENT_NAMES[req.agent_provider || 'codex'] || req.agent_provider}`;

      const timeSpan = document.createElement('span');
      const date = new Date(req.updated_at);
      timeSpan.textContent = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')} ${date.getDate()}/${date.getMonth() + 1}`;

      footer.appendChild(skillSpan);
      footer.appendChild(timeSpan);

      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(footer);

      if (req.production_state === 'review' && !req.publication_state) {
        const reviewAction = document.createElement('div');
        reviewAction.className = 'btn btn-primary btn-block';
        reviewAction.style.marginTop = '10px';
        reviewAction.style.textAlign = 'center';
        reviewAction.style.fontWeight = 'bold';
        reviewAction.textContent = '🚀 Bấm vào đây để Xem Video & ĐĂNG BÀI';
        card.appendChild(reviewAction);
      }

      container.appendChild(card);
    });
    renderLoadMore(container);
  }

  // Load Requests from Server
  async function loadRequests({append = false} = {}) {
    const version = ++state.listLoadVersion;
    try {
      const cursor = append && state.nextCursor ? `?cursor=${encodeURIComponent(state.nextCursor)}` : '';
      const res = await api(`/api/web/requests${cursor}`);
      if (version !== state.listLoadVersion || !state.currentUser) return;
      const requests = append ? [...state.requests, ...(res.requests || [])] : (res.requests || []);
      state.requests = [...new Map(requests.map(request => [request.id, request])).values()];
      state.nextCursor = res.nextCursor || null;
      renderRequestsList();
      router.save();
    } catch (err) {
      if (!state.currentUser || version !== state.listLoadVersion) return;
      if (append || state.requests.length) {
        alert(`Chưa tải được danh sách mới: ${err.message}`);
      } else {
        el.requestsContainer.replaceChildren();
        const message = document.createElement('p');
        message.textContent = `Không thể tải danh sách: ${err.message}`;
        message.setAttribute('role', 'alert');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-secondary';
        retry.textContent = 'Tải lại danh sách';
        retry.addEventListener('click', () => loadRequests());
        el.requestsContainer.append(message, retry);
      }
    }
  }

  // Open Detail View
  async function openDetailView(id, {allowDuringMutation = false} = {}) {
    if (state.mutationInFlight && !allowDuringMutation) return;
    const version = ++state.detailLoadVersion;
    try {
      const res = await api(`/api/web/requests/${id}`);
      if (version !== state.detailLoadVersion || !state.currentUser) return;
      const req = res.request;
      state.currentDetail = req;

      el.detailDisplayId.textContent = req.display_id;
      el.detailTitle.textContent = req.title;
      el.detailSkillBadge.textContent = SKILL_NAMES[req.skill] || req.skill;
      el.detailAgentBadge.textContent = AGENT_NAMES[req.agent_provider || 'codex'] || req.agent_provider || 'Codex';

      const stateInfo = requestStateLabel(req);
      el.detailStateBadge.className = `badge ${stateInfo.badgeClass}`;
      el.detailStateBadge.textContent = stateInfo.text;

      el.detailScriptText.textContent = req.script;
      let fullCaption = (req.caption || '').trim();
      if (req.hashtags && !fullCaption.includes(req.hashtags.trim())) {
        fullCaption = fullCaption ? `${fullCaption}\n\n${req.hashtags.trim()}` : req.hashtags.trim();
      }
      el.detailCaptionInput.value = fullCaption;
      if (el.detailCaptionConflict) el.detailCaptionConflict.style.display = 'none';

      if (state.currentUser?.username) {
        const captionDraft = draftStore.read(state.currentUser.username, 'caption', req.display_id);
        const draftText = typeof captionDraft?.payload?.caption === 'string' ? captionDraft.payload.caption.trim() : '';
        if (draftText && draftText !== fullCaption) {
          const draftRev = captionDraft.payload.reviewRevision;
          if (draftRev !== undefined && draftRev !== req.review_revision) {
            if (el.detailCaptionConflict && el.detailCaptionConflictMessage) {
              el.detailCaptionConflictMessage.textContent =
                `Xung đột bản nháp: Bản nháp trên máy này (revision ${draftRev}) khác với phiên bản trên máy chủ (revision ${req.review_revision}). Bạn có muốn dùng bản nháp này không?`;
              el.detailCaptionConflict.style.display = 'block';
            }
          } else {
            el.detailCaptionInput.value = captionDraft.payload.caption;
          }
        } else if (captionDraft && !draftText) {
          draftStore.remove(state.currentUser.username, 'caption', req.display_id);
        }
      }

      el.chkChanYoutube.checked = true;
      el.chkChanTiktok.checked = true;
      el.chkChanFacebook.checked = true;
      el.publishScheduleTime.value = '';

      // Video preview handling
      const videoId = driveVideoId(req);
      if (videoId) {
        el.videoPreviewSection.style.display = 'block';
        el.videoIframe.src = `https://drive.google.com/file/d/${videoId}/preview`;
        el.btnOpenDrive.href = `https://drive.google.com/file/d/${videoId}/view`;
      } else {
        el.videoPreviewSection.style.display = 'none';
        el.videoIframe.src = '';
      }

      // Actions based on state
      if (req.production_state === 'waiting') {
        el.detailNotice.textContent = 'Yêu cầu đã vào hàng đợi. Máy dựng sẽ tự giao việc cho AI đã chọn khi đang trực tuyến.';
        el.btnCancelReq.style.display = 'block';
        el.btnRetryProduction.style.display = 'none';
        el.btnSaveCaption.style.display = 'none';
        el.sectionPublish.style.display = 'none';
        el.detailCaptionInput.disabled = true;
      } else if (req.production_state === 'producing') {
        el.detailNotice.textContent = res.claim?.progress_summary || `Máy đang giao việc cho ${AGENT_NAMES[req.agent_provider || 'codex'] || 'AI đã chọn'} để dựng video...`;
        el.btnCancelReq.style.display = 'none';
        el.btnRetryProduction.style.display = 'none';
        el.btnSaveCaption.style.display = 'none';
        el.sectionPublish.style.display = 'none';
        el.detailCaptionInput.disabled = true;
      } else if (req.production_state === 'review') {
        el.detailNotice.textContent = 'Video đã dựng hoàn tất! Vui lòng xem kỹ video và chọn kênh xuất bản.';
        el.btnCancelReq.style.display = 'none';
        el.btnSaveCaption.style.display = 'inline-block';
        el.sectionPublish.style.display = 'block';
        el.detailCaptionInput.disabled = false;
      } else if (req.production_state === 'needs_review') {
        el.detailNotice.textContent = `Cần kiểm tra trước khi chạy lại. ${req.production_error || ''}`;
        el.btnCancelReq.style.display = 'none';
        el.btnRetryProduction.style.display = 'block';
        el.btnSaveCaption.style.display = 'none';
        el.sectionPublish.style.display = 'none';
        el.detailCaptionInput.disabled = true;
      } else {
        el.detailNotice.textContent = `Trạng thái: ${stateInfo.text}`;
        el.btnCancelReq.style.display = 'none';
        el.btnRetryProduction.style.display = 'none';
        el.btnSaveCaption.style.display = 'none';
        el.sectionPublish.style.display = 'none';
        el.detailCaptionInput.disabled = true;
      }

      // Render receipts if available
      const pubs = res.publications || [];
      if (pubs.length > 0) {
        el.sectionPublish.style.display = 'none';
        el.sectionReceipts.style.display = 'block';
        while (el.receiptsContainer.firstChild) {
          el.receiptsContainer.removeChild(el.receiptsContainer.firstChild);
        }
        let hasRetryable = false;
        let isRateLimited = false;
        for (const pub of pubs) {
          const retryable = canRetryReceipt(pub);
          if (retryable) hasRetryable = true;
          if (pub.error_code && pub.error_code.includes('429')) {
            isRateLimited = true;
          }

          const itemDiv = document.createElement('div');
          itemDiv.className = 'receipt-item';

          const row = document.createElement('div');
          row.className = 'receipt-row';
          const label = document.createElement('label');
          label.className = 'receipt-choice';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.name = 'retry-channel';
          checkbox.value = pub.channel_id;
          checkbox.checked = retryable;
          checkbox.disabled = !retryable;

          const infoSpan = document.createElement('span');
          const chanName = pub.channel_id === '6a9a28c0065799be4684eacd' ? 'YouTube Shorts'
                         : (pub.channel_id === '6ac376a86a5c39ccb61d85e4' || pub.channel_id === '6a985593065799be4674eed4') ? 'TikTok (Triết Lý Sống Sâu)'
                         : pub.channel_id === '6a985567065799be4674ee3b' ? 'Facebook Reels'
                         : `Kênh ${pub.channel_id}`;
          const chanStatus = pub.channel_state === 'sent' ? 'Đã đăng'
                           : pub.channel_state === 'accepted' ? 'Buffer đã nhận'
                           : pub.channel_state === 'attempting' ? 'Đang gửi...'
                           : pub.channel_state === 'needs_review' ? 'Cần kiểm tra'
                           : pub.channel_state === 'failed_confirmed' || pub.channel_state === 'failed' ? 'Lỗi'
                           : 'Sẵn sàng';
          infoSpan.textContent = `${chanName}: ${chanStatus}`;
          label.appendChild(checkbox);
          label.appendChild(infoSpan);
          row.appendChild(label);
          itemDiv.appendChild(row);

          if (!retryable && pub.channel_state !== 'sent') {
            const safetyNote = document.createElement('p');
            safetyNote.className = 'field-hint';
            safetyNote.textContent = 'Chưa thể chọn gửi lại: cần xác minh trạng thái trên Buffer để tránh đăng trùng.';
            itemDiv.appendChild(safetyNote);
          }

          if (pub.error_code) {
            const errSpan = document.createElement('div');
            errSpan.className = 'field-hint';
            errSpan.style.color = '#c84e3a';
            errSpan.style.marginTop = '4px';
            errSpan.textContent = `Chi tiết: ${pub.error_code}`;
            itemDiv.appendChild(errSpan);
          }

          const externalUrl = safeHttpsUrl(pub.external_link);
          if (externalUrl) {
            const link = document.createElement('a');
            link.className = 'receipt-link';
            link.href = externalUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = 'Xem bài đăng ↗';
            itemDiv.appendChild(link);
          }

          el.receiptsContainer.appendChild(itemDiv);
        }

        if (el.btnRetryPublish) {
          el.btnRetryPublish.style.display = hasRetryable ? 'block' : 'none';
          updateRetryButton();
        }
        if (el.receiptsNotice) {
          if (isRateLimited) {
            el.receiptsNotice.style.display = 'block';
            el.receiptsNotice.textContent = 'Buffer đang giới hạn API. Chỉ gửi lại kênh đã tích sau khi hạn mức phục hồi; các kênh chưa rõ kết quả cần kiểm tra trước.';
          } else {
            el.receiptsNotice.style.display = 'none';
          }
        }
      } else {
        el.sectionReceipts.style.display = 'none';
        if (el.btnRetryPublish) el.btnRetryPublish.style.display = 'none';
        if (el.receiptsNotice) el.receiptsNotice.style.display = 'none';
      }

      el.viewDetail.removeAttribute('aria-busy');
      el.btnSaveCaption.disabled = state.mutationInFlight;
      el.btnCancelReq.disabled = state.mutationInFlight;
      el.btnSubmitPublish.disabled = state.mutationInFlight;
      updateRetryButton();
      renderView('detail');
      return true;
    } catch (err) {
      if (version !== state.detailLoadVersion || !state.currentUser) return;
      state.currentDetail = null;
      el.viewDetail.removeAttribute('aria-busy');
      renderView('notFound');
      alert(`Không thể mở chi tiết video: ${err.message}`);
      return false;
    }
  }

  // Event Listeners Setup
  function setupEvents() {
    // Login Submit
    el.formLogin.addEventListener('submit', async e => {
      e.preventDefault();
      el.loginError.style.display = 'none';
      el.btnSubmitLogin.disabled = true;
      el.btnSubmitLogin.textContent = 'Đang xác thực...';

      try {
        await session.signIn(el.loginUsername.value.trim(), el.loginPassword.value);
        el.loginPassword.value = '';
      } catch (err) {
        el.loginError.textContent = err.message;
        el.loginError.style.display = 'block';
      } finally {
        el.btnSubmitLogin.disabled = false;
        el.btnSubmitLogin.textContent = 'Đăng nhập';
      }
    });

    // Logout
    el.btnLogout.addEventListener('click', async () => {
      try {
        await session.signOut();
      } catch (err) {
        if (state.currentUser) alert(`Chưa thể đăng xuất: ${err.message}. Vui lòng thử lại.`);
      }
    });

    el.btnSessionRetry.addEventListener('click', () => session.revalidate({force: true, source: 'retry'}));

    // Preserve native link behavior for modified clicks and opening new tabs.
    document.addEventListener('click', event => {
      const link = event.target.closest('a[data-studio-link]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      if (new URL(link.href).origin !== window.location.origin) return;
      event.preventDefault();
      navigate(parseRoute(link.href, window.location.origin));
    });

    // Detail Caption Input & Conflict handlers
    el.detailCaptionInput.addEventListener('input', () => {
      if (captionDebounceTimer) clearTimeout(captionDebounceTimer);
      captionDebounceTimer = setTimeout(saveCaptionDraftNow, 500);
    });

    if (el.btnCaptionUseLocal) {
      el.btnCaptionUseLocal.addEventListener('click', () => {
        const username = state.currentUser?.username;
        const req = state.currentDetail;
        if (!username || !req) return;
        const captionDraft = draftStore.read(username, 'caption', req.display_id);
        if (captionDraft?.payload && typeof captionDraft.payload.caption === 'string') {
          el.detailCaptionInput.value = captionDraft.payload.caption;
          draftStore.save(username, 'caption', {
            displayId: req.display_id,
            payload: {
              caption: captionDraft.payload.caption,
              reviewRevision: req.review_revision
            }
          });
        }
        if (el.detailCaptionConflict) el.detailCaptionConflict.style.display = 'none';
      });
    }

    if (el.btnCaptionDiscardLocal) {
      el.btnCaptionDiscardLocal.addEventListener('click', () => {
        const username = state.currentUser?.username;
        const req = state.currentDetail;
        if (username && req) {
          draftStore.remove(username, 'caption', req.display_id);
          el.detailCaptionInput.value = req.caption || '';
        }
        if (el.detailCaptionConflict) el.detailCaptionConflict.style.display = 'none';
      });
    }

    window.addEventListener('pagehide', event => {
      saveCaptionDraftNow();
      // Keep listeners alive in a page frozen for BFCache. A persisted pagehide
      // restores the same DOM and JS context without rendering this route again.
      if (!event.persisted && createViewCleanup) {
        createViewCleanup();
        createViewCleanup = null;
      }
    });

    // Save Caption on Detail View
    el.btnSaveCaption.addEventListener('click', async () => {
      if (!state.currentDetail) return;
      if (state.mutationInFlight) return;
      const initialGeneration = accountGeneration;
      const initialUser = state.currentUser?.username;
      state.mutationInFlight = true;
      el.btnSaveCaption.disabled = true;
      el.btnSaveCaption.textContent = 'Đang lưu...';

      try {
        const saved = await saveCaptionIfChanged();
        if (saved && accountGeneration === initialGeneration && state.currentUser?.username === initialUser) {
          alert('Đã cập nhật caption thành công!');
        }
      } catch (err) {
        if (accountGeneration === initialGeneration && state.currentUser?.username === initialUser) {
          alert(`Không thể lưu caption: ${err.message}`);
        }
      } finally {
        if (accountGeneration === initialGeneration && state.currentUser?.username === initialUser) {
          state.mutationInFlight = false;
          el.btnSaveCaption.disabled = false;
          el.btnSaveCaption.textContent = 'Lưu caption';
        }
      }
    });

    // Cancel Request
    el.btnCancelReq.addEventListener('click', async () => {
      if (!state.currentDetail) return;
      if (!confirm(`Bạn có chắc muốn hủy yêu cầu ${state.currentDetail.display_id}?`)) return;

      el.btnCancelReq.disabled = true;
      try {
        await api(`/api/web/requests/${state.currentDetail.id}/cancel`, {
          method: 'POST',
          body: {
            expectedRevision: state.currentDetail.input_revision
          }
        });
        alert('Đã hủy yêu cầu thành công.');
        navigate({name: 'list'});
      } catch (err) {
        alert(`Không thể hủy: ${err.message}`);
      } finally {
        el.btnCancelReq.disabled = false;
      }
    });

    el.btnRetryProduction.addEventListener('click', async () => {
      if (!state.currentDetail || state.mutationInFlight) return;
      const detail = state.currentDetail;
      const providerName = AGENT_NAMES[detail.agent_provider || 'codex'] || 'AI đã chọn';
      if (!confirm(`Thử dựng lại ${detail.display_id} bằng ${providerName}?`)) return;
      state.mutationInFlight = true;
      el.btnRetryProduction.disabled = true;
      try {
        await api(`/api/web/requests/${detail.id}/production/retry`, {method: 'POST'});
        await renderRoute(state.currentRoute);
      } catch (error) {
        alert(`Không thể xếp lại yêu cầu: ${error.message}`);
      } finally {
        state.mutationInFlight = false;
        el.btnRetryProduction.disabled = false;
      }
    });

    // Submit Publish
    el.btnSubmitPublish.addEventListener('click', async () => {
      if (!state.currentDetail) return;
      if (state.mutationInFlight) return;

      const channelIds = [];
      if (el.chkChanYoutube.checked) channelIds.push(el.chkChanYoutube.value);
      if (el.chkChanTiktok.checked) channelIds.push(el.chkChanTiktok.value);
      if (el.chkChanFacebook.checked) channelIds.push(el.chkChanFacebook.value);

      if (channelIds.length === 0) {
        alert('Vui lòng chọn ít nhất 1 kênh mạng xã hội');
        return;
      }

      if (!confirm(`Bạn có chắc muốn duyệt video này và đăng lên ${channelIds.length} kênh đã chọn?`)) {
        return;
      }

      const scheduledAtBangkok = el.publishScheduleTime.value || null;
      const requestId = state.currentDetail.id;
      state.mutationInFlight = true;
      el.btnSaveCaption.disabled = true;
      el.detailCaptionInput.disabled = true;

      const btnLoading = el.btnSubmitPublish.querySelector('.btn-text-loading');
      const btnNormal = el.btnSubmitPublish.querySelector('.btn-text-normal');
      el.btnSubmitPublish.disabled = true;
      if (btnNormal) btnNormal.style.display = 'none';
      if (btnLoading) btnLoading.style.display = 'inline';

      try {
        await saveCaptionIfChanged();
        const publicationKey = `pub-${requestId}-${state.currentDetail.review_revision}`;
        await api(`/api/web/requests/${requestId}/publications`, {
          method: 'POST',
          body: {
            channelIds,
            publicationKey,
            scheduledAtBangkok,
            expectedReviewRevision: state.currentDetail.review_revision
          }
        });
        alert('Đã tạo lệnh xuất bản thành công! Video đã được gửi trực tiếp lên Buffer.');
        await openDetailView(requestId, {allowDuringMutation: true});
      } catch (err) {
        alert(`Không thể duyệt và xuất bản: ${err.message}`);
      } finally {
        state.mutationInFlight = false;
        el.btnSaveCaption.disabled = false;
        el.detailCaptionInput.disabled = state.currentDetail?.production_state !== 'review';
        el.btnSubmitPublish.disabled = false;
        if (btnNormal) btnNormal.style.display = 'inline';
        if (btnLoading) btnLoading.style.display = 'none';
      }
    });

    // Retry Publish
    if (el.btnRetryPublish) {
      el.receiptsContainer.addEventListener('change', event => {
        if (event.target.matches('input[name="retry-channel"]')) updateRetryButton();
      });
      el.btnRetryPublish.addEventListener('click', async () => {
        if (!state.currentDetail) return;
        if (state.mutationInFlight) return;
        const channelIds = Array.from(el.receiptsContainer.querySelectorAll('input[name="retry-channel"]:checked'), input => input.value);
        if (!channelIds.length) return;
        if (!confirm(`Gửi lại ${channelIds.length} nền tảng đã tích?`)) return;
        state.mutationInFlight = true;

        const btnLoading = el.btnRetryPublish.querySelector('.btn-text-loading');
        const btnNormal = el.btnRetryPublish.querySelector('.btn-text-normal');
        el.btnRetryPublish.disabled = true;
        if (btnNormal) btnNormal.style.display = 'none';
        if (btnLoading) btnLoading.style.display = 'inline';

        try {
          await api(`/api/web/requests/${state.currentDetail.id}/publications/retry`, {
            method: 'POST',
            body: {channelIds}
          });
          alert(`Đã chọn ${channelIds.length} kênh để gửi lại khi máy ở nhà chạy và Buffer cho phép.`);
          await openDetailView(state.currentDetail.id, {allowDuringMutation: true});
        } catch (err) {
          alert(`Không thể thử lại: ${err.message}`);
        } finally {
          state.mutationInFlight = false;
          updateRetryButton();
          if (btnNormal) btnNormal.style.display = 'inline';
          if (btnLoading) btnLoading.style.display = 'none';
        }
      });
    }
  }

  // Start app
  document.addEventListener('DOMContentLoaded', () => {
    setupEvents();
    initSession();
  });
})();
