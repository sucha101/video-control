import crypto from 'node:crypto';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {GoogleSheetsClient, GoogleDriveClient} from './google.mjs';
import {verifyMedia} from './media.mjs';
import {runAgent} from './codex.mjs';
import {publishChannels, createBufferPost} from './buffer.mjs';
import {atomicJSON, readJSON, lock} from './manifest.mjs';

export function fingerprint(row) {
  const parts = [row[1] ?? '', row[2] ?? '', row[3] ?? '', row[4] ?? ''];
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

export function findRow(rows, id) {
  let found = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[0] === id) {
      if (found !== null) {
        throw new Error(`Phát hiện ID trùng lặp trên Sheet: ${id}`);
      }
      found = {row, index: i};
    }
  }
  if (!found) throw new Error(`Không tìm thấy hàng với ID: ${id}`);
  return found;
}

export function eligible(row) {
  if (!row || !Array.isArray(row)) return false;
  if (row[12] === 'Duyệt trên web') return false;
  const script = (row[2] || '').trim();
  const skill = row[3] || '';
  const approval = (row[4] || '').trim();
  const status = (row[5] || '').trim();

  const validSkills = ['viet-tiktok-story-video', 'drama-mascot-video'];
  if (!script) return false;
  if (!validSkills.includes(skill)) return false;
  if (approval !== 'ổn') return false;
  if (status !== '' && status !== 'Chờ tạo') return false;
  return true;
}

export function nextId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = /^V(\d+)$/i.exec(r[0] || '');
    if (m) {
      const num = parseInt(m[1], 10);
      if (num > max) max = num;
    }
  }
  return `V${String(max + 1).padStart(3, '0')}`;
}

export class Runner {
  constructor({config, queueClient, sheetsClient, driveClient}) {
    this.config = config;
    this.queue = queueClient;
    this.sheets = sheetsClient || new GoogleSheetsClient({
      spreadsheetId: config.sheetId,
      tab: config.sheetTab,
      credentialsPath: config.googleCredentials
    });
    this.drive = driveClient || new GoogleDriveClient({
      folderId: config.driveFolderId,
      credentialsPath: config.googleCredentials
    });
    this.activeJob = null;
    this.abortController = null;
  }

  async executeJob(job) {
    if (this.activeJob) throw new Error('Runner đang xử lý một công việc khác');
    this.activeJob = job;
    this.abortController = new AbortController();

    // Start heartbeat timer
    let heartbeatActive = true;
    let heartbeatTimer = null;
    let heartbeatResolve = null;
    const heartbeatPromise = (async () => {
      while (heartbeatActive) {
        await new Promise(r => {
          heartbeatResolve = r;
          heartbeatTimer = setTimeout(r, this.config.heartbeatMs || 25000);
        });
        if (!heartbeatActive) break;
        try {
          const hb = await this.queue.heartbeat(job);
          if (hb.cancelRequested) {
            this.abortController.abort(new Error('Công việc đã bị hủy'));
            break;
          }
        } catch (err) {
          this.abortController.abort(err);
          console.warn(`Heartbeat warning: ${err.message}`);
        }
      }
    })();

    try {
      switch (job.type) {
        case 'scan':
          await this.handleScan(job);
          break;
        case 'produce':
          await this.handleProduce(job);
          break;
        case 'approve':
          await this.handleApprove(job);
          break;
        case 'set_skill':
          await this.handleSetSkill(job);
          break;
        case 'set_mode':
          await this.handleSetMode(job);
          break;
        case 'add_row':
          await this.handleAddRow(job);
          break;
        case 'publish':
          await this.handlePublish(job);
          break;
        default:
          throw new Error(`Loại job không hợp lệ: ${job.type}`);
      }
    } finally {
      heartbeatActive = false;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (heartbeatResolve) heartbeatResolve();
      await heartbeatPromise.catch(() => {});
      this.activeJob = null;
      this.abortController = null;
    }
  }

  async handleScan(job) {
    const rows = await this.sheets.readRows();
    const queuedIds = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (eligible(row)) {
        let videoId = (row[0] || '').trim();
        if (!videoId) {
          videoId = nextId(rows);
          row[0] = videoId;
          await this.sheets.updateRow(i, row);
        }
        const fp = fingerprint(row);
        await this.queue.enqueue('produce', {videoId, fingerprint: fp}, `produce:${videoId}:${fp}`, job.id);
        queuedIds.push(videoId);
      }
    }

    const msg = queuedIds.length
      ? `Đã quét và đưa vào hàng đợi ${queuedIds.length} video: ${queuedIds.join(', ')}`
      : 'Không có video nào đủ điều kiện sản xuất (cần có kịch bản, skill hợp lệ, Duyệt = "ổn")';

    await this.queue.complete(job, {message: msg});
  }

  async handleApprove(job) {
    const {videoId} = job.payload;
    const rows = await this.sheets.readRows();
    const {row, index} = findRow(rows, videoId);
    row[4] = 'ổn';
    await this.sheets.updateRow(index, row);
    await this.queue.complete(job, {message: `Đã duyệt "ổn" cho video ${videoId}`});
  }

  async handleSetSkill(job) {
    const {videoId, skill} = job.payload;
    const rows = await this.sheets.readRows();
    const {row, index} = findRow(rows, videoId);
    row[3] = skill;
    await this.sheets.updateRow(index, row);
    await this.queue.complete(job, {message: `Đã cập nhật skill ${skill} cho video ${videoId}`});
  }

  async handleSetMode(job) {
    const {videoId, mode} = job.payload;
    const rows = await this.sheets.readRows();
    const {row, index} = findRow(rows, videoId);
    if (row[12] === 'Duyệt trên web') throw new Error('Đổi chế độ của video này qua Web Studio');
    row[12] = mode === 'auto' ? 'Tự đăng' : 'Chỉ tạo video';
    await this.sheets.updateRow(index, row);
    await this.queue.complete(job, {message: `Đã đổi chế độ đăng của ${videoId} sang "${row[12]}"`});
  }

  async handleAddRow(job) {
    const {skill, title, script} = job.payload;
    const rows = await this.sheets.readRows();
    const videoId = nextId(rows);
    const newRow = [
      videoId,
      title || '',
      script || '',
      skill,
      'Chờ duyệt',
      'Chờ tạo',
      '', '', '', '', '', '',
      'Chỉ tạo video',
      '', '', ''
    ];
    await this.sheets.appendRow(newRow);
    await this.queue.complete(job, {message: `Đã thêm kịch bản mới mã ${videoId} (${skill})`});
  }

  async handleProduce(job) {
    const {videoId, fingerprint: expectedFp} = job.payload;
    if (!/^V\d+$/i.test(videoId)) throw new Error('Mã video không hợp lệ');
    const rows = await this.sheets.readRows();
    const {row, index} = findRow(rows, videoId);

    if (row[4] !== 'ổn') {
      await this.queue.fail(job, `Video ${videoId} chưa được duyệt "ổn"`, true);
      return;
    }

    const currentFp = fingerprint(row);
    if (expectedFp && currentFp !== expectedFp) {
      row[5] = 'Cần kiểm tra';
      row[15] = 'Nội dung kịch bản thay đổi so với khi lên lịch';
      await this.sheets.updateRow(index, row);
      await this.queue.fail(job, `Nội dung kịch bản ${videoId} đã thay đổi, cần duyệt lại`, true);
      return;
    }

    // Set status to Đang tạo
    row[5] = 'Đang tạo';
    row[15] = '';
    await this.sheets.updateRow(index, row);

    const jobDir = path.resolve(this.config.jobRoot, videoId);
    await mkdir(jobDir, {recursive: true});

    const skillPath = this.config.skills?.[row[3]];
    if (!skillPath) {
      row[5] = 'Lỗi';
      row[15] = `Không tìm thấy file SKILL cho: ${row[3]}`;
      await this.sheets.updateRow(index, row);
      await this.queue.fail(job, row[15], true);
      return;
    }

    let agentResult;
    try {
      agentResult = await runAgent({
        jobDir,
        skillPath,
        script: row[2],
        title: row[1],
        config: this.config,
        signal: this.abortController.signal
      });
    } catch (err) {
      row[5] = 'Lỗi';
      row[15] = err.message;
      await this.sheets.updateRow(index, row);
      await this.queue.fail(job, `Lỗi tạo video: ${err.message}`, true);
      return;
    }

    if (agentResult.status === 'needs_input') {
      row[5] = 'Cần kiểm tra';
      row[15] = agentResult.message;
      await this.sheets.updateRow(index, row);
      await this.queue.fail(job, agentResult.message, true);
      return;
    }

    if (agentResult.status !== 'ready_for_upload') {
      row[5] = 'Lỗi';
      row[15] = agentResult.message || 'Agent thất bại';
      await this.sheets.updateRow(index, row);
      await this.queue.fail(job, row[15], true);
      return;
    }

    // Media verification
    let mediaPaths;
    try {
      mediaPaths = await verifyMedia(jobDir, agentResult);
    } catch (err) {
      row[5] = 'Lỗi';
      row[15] = `Cổng chất lượng không đạt: ${err.message}`;
      await this.sheets.updateRow(index, row);
      await this.queue.fail(job, row[15], true);
      return;
    }

    // Recheck sheet approval and fingerprint before external side effects
    const freshRows = await this.sheets.readRows();
    const fresh = findRow(freshRows, videoId);
    if (fresh.row[4] !== 'ổn' || fingerprint(fresh.row) !== currentFp) {
      fresh.row[5] = 'Cần kiểm tra';
      fresh.row[15] = 'Kịch bản bị sửa đổi trước khi upload';
      await this.sheets.updateRow(fresh.index, fresh.row);
      await this.queue.fail(job, 'Dữ liệu thay đổi trước khi upload', true);
      return;
    }

    // Upload to Google Drive
    const driveResult = await this.uploadDriveMedia({
      job, jobDir, videoId, inputRevision: currentFp,
      filePath: mediaPaths.videoPath,
      fileName: `${videoId}-${(row[1] || 'video').slice(0, 30)}.mp4`
    });

    fresh.row[9] = driveResult.driveUrl;
    fresh.row[10] = agentResult.caption || '';
    fresh.row[11] = (agentResult.hashtags || []).join(' ');
    fresh.row[5] = 'Hoàn tất';
    fresh.row[15] = '';
    await this.sheets.updateRow(fresh.index, fresh.row);

    await this.queue.complete(job, {
      message: `Đã hoàn thành video ${videoId} và tải lên Drive`,
      videoId,
      driveUrl: driveResult.driveUrl
    });
  }

  async uploadDriveMedia({job, jobDir, videoId, inputRevision, filePath, fileName}) {
    const signal = this.abortController.signal;
    const fence = async () => {
      signal.throwIfAborted();
      const lease = await this.queue.heartbeat(job);
      if (lease.cancelRequested) throw new Error('Công việc đã bị hủy');
      signal.throwIfAborted();
    };
    await fence();
    const checkpointPath = path.join(jobDir, 'drive-upload.json');
    const checkpoint = await readJSON(checkpointPath, {});
    if (checkpoint.inputFingerprint && checkpoint.inputFingerprint !== inputRevision) {
      throw new Error('Upload Drive đang có checkpoint của nội dung khác; cần kiểm tra trước khi tiếp tục');
    }
    return this.drive.uploadResumable({
      filePath, fileName, checkpoint, requestId: videoId, inputRevision, signal, fence,
      persistCheckpoint: async state => atomicJSON(checkpointPath, state)
    });
  }

  async handlePublish(job) {
    const {videoId, schedule} = job.payload;
    if (!/^V\d+$/i.test(videoId)) throw new Error('Mã video không hợp lệ');
    const rows = await this.sheets.readRows();
    const {row, index} = findRow(rows, videoId);
    if (row[12] === 'Duyệt trên web') throw new Error('Video này cần đăng qua Web Studio để giữ biên nhận và kênh đã chọn');

    if (row[5] !== 'Hoàn tất' || !row[9]) {
      await this.queue.fail(job, `Video ${videoId} chưa hoàn tất hoặc thiếu link Drive`, true);
      return;
    }

    if (!this.config.channels || !this.config.channels.length) {
      await this.queue.fail(job, 'Chưa cấu hình kênh Buffer để đăng', true);
      return;
    }

    const apiKey = this.config.secrets?.bufferApiKey;
    if (!apiKey) {
      await this.queue.fail(job, 'Buffer API key chưa được cấu hình trong secrets.json', true);
      return;
    }

    // Call publishChannels
    const journalPath = path.join(this.config.jobRoot, videoId, 'publication.json');
    const release = await lock(`${journalPath}.lock`);
    try {
    const publishState = await readJSON(journalPath, row[14] ? JSON.parse(row[14]) : {});
    const publishResults = await publishChannels({
      channels: this.config.channels,
      state: publishState,
      save: async state => atomicJSON(journalPath, state),
      fence: async () => {
        if (this.abortController.signal.aborted) throw new Error('Đã mất lease');
        const lease = await this.queue.heartbeat(job);
        if (lease.cancelRequested) throw new Error('Công việc đã bị hủy');
      },
      create: async (channel, input, scheduledAt) => {
        return await createBufferPost({
          apiKey,
          channel,
          input,
          scheduledAt
        });
      },
      input: {
        title: row[1],
        caption: `${row[10] || ''} ${row[11] || ''}`.trim(),
        mediaUrl: row[9].includes('drive.google.com/file/d/')
          ? `https://drive.google.com/uc?export=download&id=${row[9].split('/d/')[1].split('/')[0]}`
          : row[9]
      },
      schedule
    });

    row[14] = JSON.stringify(publishResults);
    await this.sheets.updateRow(index, row);
    await this.queue.complete(job, {message: `Đã gửi bài đăng cho video ${videoId}`});
    } finally { await release(); }
  }
}
