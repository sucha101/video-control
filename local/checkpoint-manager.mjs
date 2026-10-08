import path from 'node:path';
import {readFile, writeFile, mkdir} from 'node:fs/promises';

const STEP_ORDER = ['init', 'script_ready', 'tts_done', 'media_collected', 'rendered', 'completed'];

export async function loadCheckpoint(jobDir) {
  const filePath = path.join(jobDir, 'checkpoint.json');
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      step: 'init',
      updatedAt: Date.now(),
      data: {}
    };
  }
}

export async function saveCheckpoint(jobDir, step, data = {}) {
  await mkdir(jobDir, {recursive: true});
  const filePath = path.join(jobDir, 'checkpoint.json');
  const existing = await loadCheckpoint(jobDir);
  const updated = {
    ...existing,
    step,
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
