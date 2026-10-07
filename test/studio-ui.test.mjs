import test from 'node:test';
import assert from 'node:assert/strict';
import {submissionIntent, safeHttpsUrl, driveVideoId, canRetryReceipt, requestStateLabel} from '../cloud/web/studio-policy.js';
import {studioHarness, deferred, settle, video} from './helpers/studio-ui-harness.mjs';

test('lost create response retries preserve key; edits and user changes create a new intent', () => {
  const payload = {title: 'New video', script: 'Narration', skill: 'viet-tiktok-story-video'};
  const first = submissionIntent(null, 'owner', payload);
  assert.equal(submissionIntent(first, 'owner', {...payload}).key, first.key);
  assert.notEqual(submissionIntent(first, 'owner', {...payload, script: 'Changed'}).key, first.key);
  assert.notEqual(submissionIntent(first, 'collaborator', payload).key, first.key);
});

test('receipt selection blocks known or ambiguous provider results', () => {
  for (const channel_state of ['sent', 'accepted', 'attempting', 'needs_review']) {
    assert.equal(canRetryReceipt({channel_state}), false);
  }
  assert.equal(canRetryReceipt({channel_state: 'ready'}), true);
  assert.equal(canRetryReceipt({channel_state: 'ready', buffer_id: 'already-created'}), false);
  assert.equal(canRetryReceipt({channel_state: 'failed_confirmed', error_code: 'HTTP 429'}), true);
});

test('unsafe media and publication URLs cannot become clickable or iframe targets', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com', 'https://user:pass@example.com']) {
    assert.equal(safeHttpsUrl(url), null);
  }
  assert.equal(driveVideoId({drive_url: 'https://drive.google.com/file/d/abc-123/view?usp=sharing'}), 'abc-123');
  assert.equal(driveVideoId({drive_url: 'https://drive.google.com.evil.example/file/d/abc/view'}), null);
  assert.equal(driveVideoId({drive_url: 'javascript:alert(1)'}), null);
});

test('provider acceptance is not shown as published', () => {
  assert.equal(requestStateLabel({production_state: 'review', publication_state: 'publishing'}).text, 'Đang xử lý xuất bản');
  assert.equal(requestStateLabel({production_state: 'review', publication_state: 'sent'}).text, 'Đã đăng các kênh đã chọn');
});

test('a delayed filtered-list response cannot overwrite the list restored by Back', async () => {
  const pending = deferred();
  let listCalls = 0;
  const h = await studioHarness({fetchImpl: async () => ++listCalls === 1 ?
    {requests: [video('V002')], nextCursor: 'saved-page'} : pending.promise});
  h.app.router.start();
  await settle();
  h.app.router.navigate({name: 'list', status: 'review'});
  h.window.history.back();
  await settle();
  pending.resolve({requests: [video('V003')], nextCursor: 'stale-page'});
  await settle();
  assert.equal(h.window.location.pathname + h.window.location.search, '/studio');
  assert.equal(h.nodes.get('requests-container').children[0].id, 'video-V002');
  assert.equal(h.app.state.nextCursor, 'saved-page');
  h.app.router.stop();
});

test('another detail URL clears the previous video and blocks mutations until its delayed data arrives', async () => {
  const pending = deferred();
  const h = await studioHarness({path: '/studio/videos/V002', fetchImpl: async url =>
    url.endsWith('/V002') ? {request: video('V002'), publications: []} : pending.promise});
  h.app.router.start();
  await settle();
  assert.equal(h.nodes.get('detail-title').textContent, 'Title V002');
  h.app.router.navigate({name: 'detail', displayId: 'V003'});
  assert.equal(h.window.location.pathname, '/studio/videos/V003');
  assert.equal(h.app.state.currentDetail, null);
  assert.notEqual(h.nodes.get('detail-title').textContent, 'Title V002');
  assert.equal(h.nodes.get('detail-script-text').textContent, '');
  assert.equal(h.nodes.get('detail-caption-input').value, '');
  for (const id of ['btn-save-caption', 'btn-cancel-req', 'btn-submit-publish', 'btn-retry-publish']) {
    assert.equal(h.nodes.get(id).disabled, true, id);
  }
  assert.equal(h.nodes.get('section-publish').style.display, 'none');
  assert.equal(h.nodes.get('section-receipts').style.display, 'none');
  pending.resolve({request: video('V003'), publications: []});
  await settle();
  assert.equal(h.nodes.get('detail-title').textContent, 'Title V003');
  assert.equal(h.nodes.get('btn-save-caption').disabled, false);
  assert.equal(h.nodes.get('btn-submit-publish').disabled, false);
  h.app.router.stop();
});

test('native Forward/Back without scrolling restores the latest appended page, cursor and focused link', async () => {
  const h = await studioHarness({fetchImpl: async url => url.includes('cursor=') ?
    {requests: [video('V003')], nextCursor: 'latest-page'} : {requests: [video('V002')], nextCursor: 'page-2'}});
  h.app.router.start();
  await settle();
  h.app.router.navigate({name: 'create'});
  h.window.history.back();
  await settle();
  await h.app.loadRequests({append: true});
  h.nodes.get('video-V003').focus();
  h.window.history.forward();
  await settle();
  h.window.history.back();
  await settle();
  assert.equal(h.nodes.get('requests-container').children[1].id, 'video-V003');
  assert.equal(h.app.state.nextCursor, 'latest-page');
  assert.equal(h.document.activeElement.id, 'video-V003');
  assert.equal(h.window.history.length, 2);
  h.app.router.stop();
});
