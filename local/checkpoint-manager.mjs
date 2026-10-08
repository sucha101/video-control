import path from 'node:path';
import {readFile, writeFile, mkdir} from 'node:fs/promises';

const STEP_ORDER = ['init', 'script_ready', 'tts_done', 'media_collected', 'rendered', 'completed'];

export async function loadCheckpoint(jobDir, {requestId, inputRevision} = {}) {
  const filePath = path.join(jobDir, 'checkpoint.json');
  try {
    const raw = await readFile(filePath, 'utf8');
    const cp = JSON.parse(raw);
    
    // Nếu nội dung hoặc requestId đã thay đổi -> vô hiệu hóa checkpoint cũ
    if (requestId && cp.requestId && cp.requestId !== requestId) {
      console.log(`[Checkpoint] Request ID thay đổi (${cp.requestId} -> ${requestId}), làm mới checkpoint.`);
      return {step: 'init', requestId, inputRevision, updatedAt: Date.now(), data: {}};
    }
    if (inputRevision !== undefined && cp.inputRevision !== undefined && cp.inputRevision !== inputRevision) {
      console.log(`[Checkpoint] Nội dung kịch bản đã sửa (revision ${cp.inputRevision} -> ${inputRevision}), hủy cache cũ.`);
      return {step: 'init', requestId, inputRevision, updatedAt: Date.now(), data: {}};
    }
    return cp;
  } catch {
    return {
      step: 'init',
      requestId,
      inputRevision,
      updatedAt: Date.now(),
      data: {}
    };
  }
}

export async function saveCheckpoint(jobDir, step, {requestId, inputRevision, ...data} = {}) {
  await mkdir(jobDir, {recursive: true});
  const filePath = path.join(jobDir, 'checkpoint.json');
  const existing = await loadCheckpoint(jobDir, {requestId, inputRevision});
  const updated = {
    ...existing,
    step,
    requestId: requestId || existing.requestId,
    inputRevision: inputRevision !== undefined ? inputRevision : existing.inputRevision,
    updatedAt: Date.now(),
    data: {
      ...existing.data,
      ...data
    }
  };
  await writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

export function isStepCompleted(checkpoint, targetStep) {
  const currentIdx = STEP_ORDER.indexOf(checkpoint?.step || 'init');
  const targetIdx = STEP_ORDER.indexOf(targetStep);
  return currentIdx >= targetIdx;
}
