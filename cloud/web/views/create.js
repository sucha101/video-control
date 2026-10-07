import {canonicalSubmissionPayload, submissionIntent} from '../studio-policy.js';

export function mountCreateView({
  root,
  api,
  router,
  draftStore,
  user,
  onFeedback,
  now = Date.now,
  document: docOverride
}) {
  const doc = docOverride || root?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const getEl = selector => {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (doc?.getElementById) {
        const found = doc.getElementById(id);
        if (found) return found;
      }
    }
    return root.querySelector ? root.querySelector(selector) : null;
  };

  const form = root.id === 'form-create-request' ? root : (getEl('#form-create-request') || root);
  const banner = getEl('#create-draft-banner');
  const bannerMsg = getEl('#create-draft-message');
  const btnRestore = getEl('#btn-draft-restore');
  const btnDiscard = getEl('#btn-draft-discard');

  const inputTitle = getEl('#req-title');
  const countTitle = getEl('#count-title');
  const inputScript = getEl('#req-script');
  const countScript = getEl('#count-script');
  const inputVoice = getEl('#req-voice');
  const inputNotes = getEl('#req-notes');

  const cardStory = getEl('#skill-card-story');
  const cardDrama = getEl('#skill-card-drama');
  const cardCodex = getEl('#agent-card-codex');
  const cardAntigravity = getEl('#agent-card-antigravity');
  const errEl = getEl('#create-error');
  const succEl = getEl('#create-success');
  const btnSubmit = getEl('#btn-submit-create');

  let debounceTimer = null;
  let currentSubmission = null;
  let isSubmitting = false;
  let isCleanedUp = false;
  let hasEdited = false;

  function getRadios() {
    return Array.from(root.querySelectorAll('input[name="skill"]'));
  }

  function getSelectedSkill() {
    const checked = getRadios().find(r => r.checked);
    return checked ? checked.value : 'viet-tiktok-story-video';
  }

  function setSelectedSkill(skill) {
    getRadios().forEach(r => {
      r.checked = r.value === skill;
    });
    if (cardStory) cardStory.classList.toggle('selected', skill === 'viet-tiktok-story-video');
    if (cardDrama) cardDrama.classList.toggle('selected', skill === 'drama-mascot-video');
  }

  function getAgentRadios() {
    return Array.from(root.querySelectorAll('input[name="agentProvider"]'));
  }

  function getSelectedAgent() {
    return getAgentRadios().find(r => r.checked)?.value || 'codex';
  }

  function setSelectedAgent(agentProvider) {
    getAgentRadios().forEach(r => { r.checked = r.value === agentProvider; });
    if (cardCodex) cardCodex.classList.toggle('selected', agentProvider === 'codex');
    if (cardAntigravity) cardAntigravity.classList.toggle('selected', agentProvider === 'antigravity');
  }

  function getRawFormData() {
    return {
      title: inputTitle?.value || '',
      script: inputScript?.value || '',
      skill: getSelectedSkill(),
      agentProvider: getSelectedAgent(),
      voice: inputVoice?.value || '',
      notes: inputNotes?.value || ''
    };
  }

  function getCanonicalPayload() {
    return canonicalSubmissionPayload(getRawFormData());
  }

  function hasFormContent(payload) {
    return Boolean(payload?.title || payload?.script || payload?.voice || payload?.notes);
  }

  function updateCharCounts() {
    if (countTitle && inputTitle) countTitle.textContent = `${inputTitle.value.length}/160`;
    if (countScript && inputScript) countScript.textContent = `${inputScript.value.length}/30000`;
  }

  function formatDraftTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function saveDraftNow() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!user?.username || !draftStore) return;
    const raw = getRawFormData();
    if (!hasFormContent(raw)) {
      if (hasEdited && !isSubmitting) draftStore.remove(user.username, 'script');
      return;
    }

    const canonical = getCanonicalPayload();
    currentSubmission = submissionIntent(currentSubmission, user.username, canonical);
    try {
      draftStore.save(user.username, 'script', {
        payload: raw,
        submissionKey: currentSubmission.key,
        payloadSignature: currentSubmission.signature
      });
    } catch (err) {
      if (onFeedback) {
        onFeedback({
          type: 'warning',
          message: `Nháp chưa lưu trên thiết bị: ${err.message || 'Lỗi lưu trữ'}`
        });
      }
    }
  }

  function scheduleAutoSave() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      saveDraftNow();
    }, 500);
  }

  // Restore or discard existing draft
  const username = user?.username;
  if (username && draftStore) {
    const existing = draftStore.read(username, 'script');
    if (existing && existing.payload && hasFormContent(existing.payload)) {
      currentSubmission = {
        signature: existing.payloadSignature || null,
        key: existing.submissionKey || null
      };
      if (inputTitle?.value || inputScript?.value || inputVoice?.value || inputNotes?.value) {
        if (banner) banner.style.display = 'none';
      } else if (banner) {
        banner.style.display = 'block';
        const timeStr = existing.updatedAt ? ` (lưu lúc ${formatDraftTime(existing.updatedAt)})` : '';
        if (bannerMsg) {
          bannerMsg.textContent = existing.pendingSubmission
            ? `Có yêu cầu gửi trước chưa xác nhận${timeStr}. Bấm gửi sẽ kiểm tra lại đúng mã cũ; bản nháp hiện tại vẫn được giữ.`
            : `Bạn có bản nháp chưa gửi${timeStr}. Bạn có muốn khôi phục không?`;
        }
      }
    } else if (banner) {
      banner.style.display = 'none';
    }
  } else if (banner) {
    banner.style.display = 'none';
  }

  function handleRestore(e) {
    e?.preventDefault?.();
    if (!username || !draftStore) return;
    const existing = draftStore.read(username, 'script');
    if (existing?.payload) {
      if (inputTitle) inputTitle.value = existing.payload.title || '';
      if (inputScript) inputScript.value = existing.payload.script || '';
      if (inputVoice) inputVoice.value = existing.payload.voice || '';
      if (inputNotes) inputNotes.value = existing.payload.notes || '';
      if (existing.payload.skill) setSelectedSkill(existing.payload.skill);
      if (existing.payload.agentProvider) setSelectedAgent(existing.payload.agentProvider);
      updateCharCounts();
      if (existing.submissionKey && existing.payloadSignature) {
        currentSubmission = {
          signature: existing.payloadSignature,
          key: existing.submissionKey
        };
      }
    }
    if (banner) banner.style.display = 'none';
  }

  function handleDiscard(e) {
    e?.preventDefault?.();
    const existing = username && draftStore ? draftStore.read(username, 'script') : null;
    if (existing?.pendingSubmission) {
      if (errEl) {
        errEl.textContent = 'Yêu cầu gửi trước chưa rõ kết quả; cần kiểm tra lại bằng cùng mã trước khi xóa nháp.';
        errEl.style.display = 'block';
      }
      return;
    }
    if (username && draftStore) {
      draftStore.remove(username, 'script');
    }
    currentSubmission = null;
    if (banner) banner.style.display = 'none';
  }

  function handleInput() {
    hasEdited = true;
    updateCharCounts();
    scheduleAutoSave();
  }

  function handleSkillChange(e) {
    const target = e.target;
    if (target && target.name === 'skill') {
      hasEdited = true;
      setSelectedSkill(target.value);
      scheduleAutoSave();
    }
  }

  function handleAgentChange(e) {
    const target = e.target;
    if (target && target.name === 'agentProvider') {
      hasEdited = true;
      setSelectedAgent(target.value);
      scheduleAutoSave();
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (errEl) errEl.style.display = 'none';
    if (succEl) succEl.style.display = 'none';

    const payload = getCanonicalPayload();
    const raw = getRawFormData();
    if (!payload.title || !payload.script) {
      if (errEl) {
        errEl.textContent = 'Vui lòng điền đầy đủ tiêu đề và kịch bản.';
        errEl.style.display = 'block';
      }
      return;
    }

    if (!user?.username || !draftStore || draftStore.persistenceAvailable !== true) {
      if (errEl) {
        errEl.textContent = 'Bộ nhớ trình duyệt không khả dụng, không thể lưu nháp bền vững.';
        errEl.style.display = 'block';
      }
      return;
    }

    currentSubmission = submissionIntent(currentSubmission, user.username, payload);
    const currentIntent = currentSubmission;
    const existingDraft = draftStore.read(user.username, 'script');
    const pending = existingDraft?.pendingSubmission || null;
    const requestPayload = pending?.payload || payload;
    const clientSubmissionKey = pending?.clientSubmissionKey || pending?.submissionKey || currentIntent.key;
    const signature = pending?.payloadSignature || currentIntent.signature;
    const submittedRaw = pending?.rawPayload || raw;
    const submittedSnapshot = JSON.stringify(submittedRaw);

    // Save submission key and draft before POST; abort POST if saving fails to prevent duplicate submissions
    try {
      const saved = draftStore.save(user.username, 'script', {
        payload: raw,
        submissionKey: currentIntent.key,
        payloadSignature: currentIntent.signature,
        pendingSubmission: pending || {
          payload,
          rawPayload: raw,
          clientSubmissionKey,
          payloadSignature: signature
        }
      });
      if (saved !== true) throw new Error('Bộ nhớ không xác nhận đã lưu nháp');
    } catch (err) {
      if (onFeedback) {
        onFeedback({
          type: 'warning',
          message: `Nháp chưa lưu trên thiết bị: ${err.message || 'Lỗi lưu trữ'}`
        });
      }
      if (errEl) {
        errEl.textContent = `Không thể lưu nháp trước khi gửi: ${err.message || 'Bộ nhớ đầy hoặc không khả dụng'}. Yêu cầu chưa được gửi để tránh mất dữ liệu hoặc trùng lặp.`;
        errEl.style.display = 'block';
      }
      return;
    }

    if (pending && JSON.stringify(payload) !== JSON.stringify(pending.payload)) {
      if (errEl) {
        errEl.textContent = 'Đang kiểm tra yêu cầu đã gửi trước bằng cùng mã. Bản nháp mới của bạn sẽ được giữ riêng.';
        errEl.style.display = 'block';
      }
    }

    isSubmitting = true;
    if (btnSubmit) btnSubmit.disabled = true;
    const normalText = btnSubmit?.querySelector?.('.btn-text-normal');
    const loadingText = btnSubmit?.querySelector?.('.btn-text-loading');
    if (normalText) normalText.style.display = 'none';
    if (loadingText) loadingText.style.display = 'inline';

    try {
      const callApi = typeof api === 'function' ? api : (path, opts) => api.request(path, opts);
      const res = await callApi('/api/web/requests', {
        method: 'POST',
        body: {
          ...requestPayload,
          clientSubmissionKey
        }
      });
      if (isCleanedUp) return;

      // Check if user edited form while POST was in flight (check raw input values)
      const currentRaw = getRawFormData();
      const isUnmodified = JSON.stringify(currentRaw) === submittedSnapshot;

      // Clear draft only if form content still matches what was submitted
      if (isUnmodified) {
        draftStore.remove(user.username, 'script', {expectedSignature: currentIntent.signature});
        if (inputTitle) inputTitle.value = '';
        if (inputScript) inputScript.value = '';
        if (inputVoice) inputVoice.value = '';
        if (inputNotes) inputNotes.value = '';
        updateCharCounts();
        if (banner) banner.style.display = 'none';
        currentSubmission = null;
      } else {
        // Resolve the old idempotency key, but preserve and key the newer user draft.
        currentSubmission = submissionIntent(currentSubmission, user.username, getCanonicalPayload());
        try {
          draftStore.save(user.username, 'script', {
            payload: currentRaw,
            submissionKey: currentSubmission.key,
            payloadSignature: currentSubmission.signature,
            pendingSubmission: null
          });
        } catch (err) {
          if (onFeedback) onFeedback({type: 'warning', message: `Nháp chưa lưu trên thiết bị: ${err.message || 'Lỗi lưu trữ'}`});
        }
        // The newer content remains visible and is not sent with the old request.
      }

      const displayId = res?.request?.display_id;
      if (displayId && router?.navigate) {
        router.navigate({name: 'detail', displayId});
      }
    } catch (err) {
      if (isCleanedUp) return;
      // A fast failure can arrive before the autosave debounce fires. Persist
      // any edits made while the request was in flight while retaining the
      // unresolved idempotency intent in pendingSubmission.
      if (hasFormContent(getRawFormData())) saveDraftNow();
      let pendingResolved = false;
      // An explicit 4xx response (except rate limiting) means the server
      // rejected this request before creating it. Release the pending intent
      // so the user can correct the draft and submit it with a fresh key.
      if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 && err.status !== 429) {
        currentSubmission = submissionIntent(null, user.username, getCanonicalPayload());
        try {
          draftStore.save(user.username, 'script', {
            payload: getRawFormData(),
            submissionKey: currentSubmission.key,
            payloadSignature: currentSubmission.signature,
            pendingSubmission: null
          });
          pendingResolved = true;
        } catch (storageError) {
          if (onFeedback) onFeedback({type: 'warning', message: `Nháp chưa lưu trên thiết bị: ${storageError.message || 'Lỗi lưu trữ'}`});
        }
      }
      if (errEl) {
        errEl.textContent = pending && !pendingResolved
          ? `Chưa xác nhận được yêu cầu gửi trước. Hãy nhấn gửi lại để kiểm tra bằng cùng mã; bản nháp mới vẫn được giữ. ${err.message || ''}`
          : (err.message || 'Lỗi khi gửi yêu cầu');
        errEl.style.display = 'block';
      }
    } finally {
      if (!isCleanedUp) {
        isSubmitting = false;
        if (btnSubmit) btnSubmit.disabled = false;
        if (normalText) normalText.style.display = 'inline';
        if (loadingText) loadingText.style.display = 'none';
      }
    }
  }

  // Attach event listeners
  if (btnRestore) btnRestore.addEventListener('click', handleRestore);
  if (btnDiscard) btnDiscard.addEventListener('click', handleDiscard);
  if (inputTitle) inputTitle.addEventListener('input', handleInput);
  if (inputScript) inputScript.addEventListener('input', handleInput);
  if (inputVoice) inputVoice.addEventListener('input', handleInput);
  if (inputNotes) inputNotes.addEventListener('input', handleInput);

  getRadios().forEach(r => r.addEventListener('change', handleSkillChange));
  getAgentRadios().forEach(r => r.addEventListener('change', handleAgentChange));
  if (form) form.addEventListener('submit', handleSubmit);

  const handlePageHide = () => saveDraftNow();
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', handlePageHide);
  }

  return function cleanup() {
    isCleanedUp = true;
    saveDraftNow();
    isSubmitting = false;
    if (btnSubmit) btnSubmit.disabled = false;
    const normalText = btnSubmit?.querySelector?.('.btn-text-normal');
    const loadingText = btnSubmit?.querySelector?.('.btn-text-loading');
    if (normalText) normalText.style.display = 'inline';
    if (loadingText) loadingText.style.display = 'none';

    if (btnRestore) btnRestore.removeEventListener('click', handleRestore);
    if (btnDiscard) btnDiscard.removeEventListener('click', handleDiscard);
    if (inputTitle) inputTitle.removeEventListener('input', handleInput);
    if (inputScript) inputScript.removeEventListener('input', handleInput);
    if (inputVoice) inputVoice.removeEventListener('input', handleInput);
    if (inputNotes) inputNotes.removeEventListener('input', handleInput);

    getRadios().forEach(r => r.removeEventListener('change', handleSkillChange));
    getAgentRadios().forEach(r => r.removeEventListener('change', handleAgentChange));
    if (form) form.removeEventListener('submit', handleSubmit);

    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('pagehide', handlePageHide);
    }
  };
}
