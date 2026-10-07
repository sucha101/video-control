import path from 'node:path';
import {mkdir, readFile, writeFile, rename, rm, stat} from 'node:fs/promises';
import {privateRoot} from './config.mjs';

const DAY = 86400000;
const MONTH = 30 * DAY;
export class BufferRateLimitError extends Error {
  constructor(retryAt, reason = 'Hạn mức Buffer đang được bảo vệ') {
    super(`${reason}; thử lại sau ${new Date(retryAt).toISOString()}`);
    this.name = 'BufferRateLimitError';
    this.retryAt = retryAt;
    this.status = 429;
    this.definitelyNotCreated = true;
  }
}

export function parseBufferHeaders(headers, now = Date.now()) {
  const policies = [];
  for (const entry of (headers.get('ratelimit') || '').split(/,\s*(?=")/)) {
    const name = /"([^"]+)"/.exec(entry)?.[1];
    const remaining = /;\s*r\s*=\s*(\d+)/.exec(entry)?.[1];
    const seconds = /;\s*t\s*=\s*(\d+)/.exec(entry)?.[1];
    if (name && remaining !== undefined && seconds !== undefined) {
      policies.push({name, remaining: Number(remaining), resetAt: now + Number(seconds) * 1000});
    }
  }
  const retry = headers.get('retry-after');
  const retryAt = retry && /^\d+(?:\.\d+)?$/.test(retry.trim())
    ? now + Number(retry) * 1000 : Date.parse(retry || '') || 0;
  return {policies, retryAt};
}

// One ledger for the local installation: CLI and watcher share the same quota.
// Never include API credentials in this file, its name, or log messages.
export class BufferBudget {
  constructor({file = process.env.BUFFER_BUDGET_FILE || path.join(privateRoot, 'buffer-budget.json'), now = Date.now,
    maxReadsPerDay = 60, maxRequestsPerDay = 200, maxRequestsPerMonth = 2500} = {}) {
    Object.assign(this, {file, now, maxReadsPerDay, maxRequestsPerDay, maxRequestsPerMonth});
  }
  async locked(action) {
    await mkdir(path.dirname(this.file), {recursive: true});
    const lock = path.resolve(`${this.file}.lock`);
    if (path.dirname(lock) !== path.resolve(path.dirname(this.file)) || lock === path.parse(lock).root) {
      throw new Error('Đường dẫn khóa Buffer không hợp lệ');
    }
    const deadline = Date.now() + 30000;
    while (true) {
      try { await mkdir(lock); break; } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const info = await stat(lock).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 120000) { await rm(lock, {recursive: true, force: true}); continue; }
        if (Date.now() >= deadline) throw new Error('Buffer đang được tiến trình khác sử dụng; thử lại sau');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try { return await action(); } finally { await rm(lock, {recursive: true, force: true}); }
  }
  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return {requests: [], policies: [], cooldownUntil: 0}; throw err; }
  }
  async save(state) {
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state), {mode: 0o600});
    await rename(temp, this.file);
  }
  gate(state, kind, now) {
    state.requests = (state.requests || []).filter(item => item.at > now - MONTH);
    let retryAt = state.cooldownUntil || 0;
    const month = state.requests;
    const daily = month.filter(item => item.at > now - DAY);
    const reads = daily.filter(item => item.kind === 'read');
    if (month.length >= this.maxRequestsPerMonth) retryAt = Math.max(retryAt, month[0].at + MONTH);
    if (daily.length >= this.maxRequestsPerDay) retryAt = Math.max(retryAt, daily[0].at + DAY);
    if (kind === 'read' && reads.length >= this.maxReadsPerDay) retryAt = Math.max(retryAt, reads[0].at + DAY);
    for (const policy of state.policies || []) {
      if (policy.resetAt <= now) continue;
      const reserve = kind === 'read' ? (policy.name.includes('30day') ? 100 : 10) : 0;
      if (policy.remaining <= reserve) retryAt = Math.max(retryAt, policy.resetAt);
    }
    if (retryAt > now) throw new BufferRateLimitError(retryAt);
  }
  async request(kind, fetchResponse) {
    return this.locked(async () => {
      const state = await this.load();
      const now = this.now();
      this.gate(state, kind, now);
      state.requests.push({at: now, kind});
      // Reserve before any network I/O, including crash or timeout.
      await this.save(state);
      const response = await fetchResponse();
      const parsed = parseBufferHeaders(response.headers, this.now());
      if (parsed.policies.length) {
        const policies = new Map((state.policies || []).filter(item => item.resetAt > this.now()).map(item => [item.name, item]));
        for (const policy of parsed.policies) policies.set(policy.name, policy);
        state.policies = [...policies.values()];
      }
      const exhausted = parsed.policies.filter(item => item.remaining === 0).map(item => item.resetAt);
      if (response.status === 429 || exhausted.length) {
        state.cooldownUntil = Math.max(state.cooldownUntil || 0, parsed.retryAt,
          ...exhausted, response.status === 429 ? this.now() + 60000 : 0);
      }
      await this.save(state);
      if (response.status === 429) {
        await response.body?.cancel?.().catch(() => {});
        throw new BufferRateLimitError(state.cooldownUntil, 'Buffer API trả mã lỗi 429');
      }
      return response;
    });
  }
  async cooldown(kind = 'read') {
    return this.locked(async () => {
      try { this.gate(await this.load(), kind, this.now()); return 0; }
      catch (err) { if (err instanceof BufferRateLimitError) return err.retryAt; throw err; }
    });
  }
  async deferUntil(retryAt) {
    if (!Number.isFinite(retryAt) || retryAt <= 0) throw new Error('Thời điểm hồi hạn Buffer không hợp lệ');
    return this.locked(async () => {
      const state = await this.load();
      state.cooldownUntil = Math.max(state.cooldownUntil || 0, retryAt);
      await this.save(state);
      return state.cooldownUntil;
    });
  }
}
export const bufferBudget = new BufferBudget();
