export class VideoStudioClient {
  constructor({cloudUrl, runnerToken, workerId, fetchImpl = fetch}) {
    if (!cloudUrl) throw new Error('Thiếu cloudUrl');
    if (!runnerToken) throw new Error('Thiếu runnerToken');
    if (!workerId) throw new Error('Thiếu workerId');
    this.cloudUrl = cloudUrl.replace(/\/$/, '');
    this.runnerToken = runnerToken;
    this.workerId = workerId;
    this.fetch = fetchImpl;
    this.publicationClaims = new Map();
    this.syncClaims = new Map();
  }

  async request(path, {method = 'GET', body} = {}) {
    const url = `${this.cloudUrl}${path}`;
    const headers = {
      Authorization: `Bearer ${this.runnerToken}`,
      'Content-Type': 'application/json'
    };
    const options = {method, headers, signal: AbortSignal.timeout(20000)};
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const res = await this.fetch(url, options);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error || `Lỗi API Studio Runner (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async getPendingRequests() {
    const data = await this.request('/api/runner/studio/requests?state=waiting');
    return data.requests || [];
  }

  async claimRequest(requestId) {
    return await this.request(`/api/runner/studio/requests/${requestId}/claim`, {
      method: 'POST',
      body: {workerId: this.workerId}
    });
  }

  async sendHeartbeat(requestId, leaseToken, progress) {
    return await this.request(`/api/runner/studio/requests/${requestId}/heartbeat`, {
      method: 'POST',
      body: {workerId: this.workerId, leaseToken, progress}
    });
  }

  async sendResult(requestId, leaseToken, {driveId, driveUrl, caption, hashtags}) {
    return await this.request(`/api/runner/studio/requests/${requestId}/result`, {
      method: 'POST',
      body: {
        workerId: this.workerId,
        leaseToken,
        driveId,
        driveUrl,
        caption,
        hashtags
      }
    });
  }

  async failRequest(requestId, leaseToken, message) {
    return await this.request(`/api/runner/studio/requests/${requestId}/fail`, {
      method: 'POST',
      body: {workerId: this.workerId, leaseToken, message}
    });
  }

  async claimSyncOutbox(limit = 10) {
    const data = await this.request('/api/runner/studio/sync/claim', {
      method: 'POST',
      body: {workerId: this.workerId, limit}
    });
    for (const item of data.items || []) this.syncClaims.set(item.id, item.claim_token);
    return data.items || [];
  }

  async completeSyncOutbox({completedIds = [], failedIds = []}) {
    return await this.request('/api/runner/studio/sync/complete', {
      method: 'POST',
      body: {workerId: this.workerId, completedIds, failedIds,
        claims: [...completedIds, ...failedIds].map(id => ({id, claimToken: this.syncClaims.get(id)}))}
    });
  }

  async claimPublicationChannels(limit = 5) {
    const data = await this.request('/api/runner/studio/publications/claim', {
      method: 'POST',
      body: {workerId: this.workerId, limit}
    });
    for (const item of data?.items || []) this.publicationClaims.set(`${item.publication_id}:${item.channel_id}`, item.fence_epoch);
    return data?.items || [];
  }

  async sendPublicationResult({publicationId, channelId, bufferId, bufferStatus, externalLink, errorCode, state, lastPolledAt}) {
    return await this.request('/api/runner/studio/publications/result', {
      method: 'POST',
      body: {
        workerId: this.workerId,
        fenceEpoch: this.publicationClaims.get(`${publicationId}:${channelId}`),
        publicationId,
        channelId,
        bufferId,
        bufferStatus,
        externalLink,
        errorCode,
        state,
        lastPolledAt
      }
    });
  }

  async getPollablePublicationChannels(limit = 10) {
    const data = await this.request(`/api/runner/studio/publications/pollable?workerId=${encodeURIComponent(this.workerId)}&limit=${limit}`);
    for (const item of data.items || []) this.publicationClaims.set(`${item.publication_id}:${item.channel_id}`, item.fence_epoch);
    return data.items || [];
  }
}
