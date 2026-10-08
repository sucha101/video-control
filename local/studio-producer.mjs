import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {GoogleDriveClient} from './google.mjs';
import {verifyMedia} from './media.mjs';
import {runAgent} from './codex.mjs';
import {privateRoot} from './config.mjs';
import {atomicJSON, readJSON, lock} from './manifest.mjs';
import {sendZaloMessage} from './zalo-notify.mjs';
import {runExecutionPipeline, extractScriptLines} from './execution-pipeline.mjs';

export async function runStudioProductionCycle({config, studio, runAgentImpl = runAgent, signal}) {
  const release = await lock(path.join(privateRoot, 'studio-production.lock'));
  try {
    const requests = await studio.getPendingRequests();
    for (const request of requests) {
      signal?.throwIfAborted();
      let claim;
      try { claim = await studio.claimRequest(request.id); }
      catch (error) {
        if (error.status === 409) continue;
        throw error;
      }
      await produceStudioRequest({config, studio, claim, runAgentImpl, externalSignal: signal});
      return {processed: request.display_id};
    }
    return {processed: null};
  } finally {
    await release();
  }
}

async function produceStudioRequest({config, studio, claim, runAgentImpl, externalSignal}) {
  const defaultProvider = request.skill === 'drama-mascot-video' ? 'antigravity' : 'codex';
  const provider = request.agent_provider || defaultProvider;
  const skillPath = config.skills?.[request.skill];
  const jobDir = path.resolve(config.jobRoot, 'studio', request.display_id);
  const manifestFile = path.join(privateRoot, 'manifests', `${request.display_id}.json`);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(externalSignal.reason || new Error('Video Studio đang dừng'));
  externalSignal?.addEventListener('abort', abortFromParent, {once: true});
  if (externalSignal?.aborted) abortFromParent();
  await mkdir(jobDir, {recursive: true});
  await atomicJSON(manifestFile, {
    id: request.id, displayId: request.display_id, title: request.title, skill: request.skill,
    agentProvider: provider, inputRevision: request.input_revision, leaseToken: claim.leaseToken,
    jobDir, status: 'producing', startedAt: Date.now()
  });

  let heartbeatStopped = false;
  const heartbeatLoop = (async () => {
    while (!heartbeatStopped) {
      await new Promise(resolve => {
        const timer = setTimeout(done, config.heartbeatMs || 25000);
        function done() {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', done);
          resolve();
        }
        controller.signal.addEventListener('abort', done, {once: true});
      });
      if (heartbeatStopped) break;
      try {
        await studio.sendHeartbeat(request.id, claim.leaseToken, `AI ${provider} đang dựng theo skill ${request.skill}`);
      } catch (error) {
        controller.abort(new Error(`Mất quyền xử lý lease: ${error.message}`));
        break;
      }
    }
  })();

  try {
    const scriptLines = extractScriptLines(request.script);
    let referenceUrls = [];
    try {
      referenceUrls = Array.isArray(request.reference_urls) 
        ? request.reference_urls 
        : JSON.parse(request.reference_urls || '[]');
    } catch {
      referenceUrls = [];
    }
    const chosenVoice = request.voice || (request.skill === 'drama-mascot-video' ? 'kienthuc' : 'tinhtri');

    let result;
    if (scriptLines.length >= 4) {
      console.log(`[Studio Producer] Kích hoạt Fast-Track tự động cho ${request.display_id} (${scriptLines.length} câu thoại).`);
      try { await sendZaloMessage(`🎬 Đang chạy dựng tự động ${request.display_id} (${scriptLines.length} câu thoại)...`); } catch {}
      result = await runExecutionPipeline({
        requestId: request.id,
        inputRevision: request.input_revision,
        jobDir,
        displayId: request.display_id,
        title: request.title,
        script: request.script,
        skill: request.skill,
        voice: chosenVoice,
        referenceUrls,
        notes: request.notes,
        config,
        signal: controller.signal
      });
    } else {
      if (!skillPath) throw new Error(`Không tìm thấy file SKILL cho: ${request.skill}`);
      try { await sendZaloMessage(`🎬 Đang bắt đầu dựng ${request.display_id} bằng ${provider}.`); } catch {}
      result = await runAgentImpl({
        jobDir, skillPath, script: request.script, title: request.title,
        voice: chosenVoice, referenceUrls, notes: request.notes,
        config, agentProvider: provider, signal: controller.signal
      });
    }
    if (result.status === 'needs_input') throw new Error(result.message || 'AI cần thêm đầu vào');
    if (result.status !== 'ready_for_upload') throw new Error(result.message || `${provider} chưa hoàn tất video`);

    const media = await verifyMedia(jobDir, result);
    const drive = new GoogleDriveClient({folderId: config.driveFolderId, credentialsPath: config.googleCredentials});
    const checkpointFile = path.join(jobDir, 'drive-upload.json');
    const checkpoint = await readJSON(checkpointFile, {});
    if (checkpoint.requestId && checkpoint.requestId !== request.id) throw new Error('Checkpoint upload thuộc yêu cầu khác; cần kiểm tra');
    const fence = async () => {
      controller.signal.throwIfAborted();
      await studio.sendHeartbeat(request.id, claim.leaseToken, 'Đang tải video lên Drive');
      controller.signal.throwIfAborted();
    };
    const uploaded = await drive.uploadResumable({
      filePath: media.videoPath,
      fileName: `${request.display_id}-${String(request.title || 'video').slice(0, 40)}.mp4`,
      checkpoint, requestId: request.id, inputRevision: request.input_revision,
      signal: controller.signal, fence,
      persistCheckpoint: state => atomicJSON(checkpointFile, state)
    });
    await studio.sendResult(request.id, claim.leaseToken, {
      driveId: uploaded.id, driveUrl: uploaded.driveUrl,
      caption: result.caption, hashtags: result.hashtags.join(' ')
    });
    await atomicJSON(manifestFile, {
      id: request.id, displayId: request.display_id, title: request.title,
      skill: request.skill, agentProvider: provider, status: 'completed',
      driveId: uploaded.id, driveUrl: uploaded.driveUrl, completedAt: Date.now()
    });
    try { await sendZaloMessage(`✅ Video ${request.display_id} đã dựng xong bằng ${provider}. Mời bạn xem và duyệt trên Video Studio.\n${uploaded.driveUrl}`); } catch {}
  } catch (error) {
    const message = String(error?.message || 'Agent không hoàn tất video').slice(0, 1000);
    await atomicJSON(manifestFile, {
      id: request.id, displayId: request.display_id, title: request.title,
      skill: request.skill, agentProvider: provider, status: 'needs_review',
      error: message, updatedAt: Date.now()
    });
    try { await studio.failRequest(request.id, claim.leaseToken, message); }
    catch (reportError) { console.warn(`[Studio Producer] Không đồng bộ được lỗi ${request.display_id}:`, reportError.message); }
    try { await sendZaloMessage(`⚠️ Video ${request.display_id} cần kiểm tra: ${message}`); } catch {}
    console.warn(`[Studio Producer] ${request.display_id} cần kiểm tra:`, message);
  } finally {
    heartbeatStopped = true;
    controller.abort();
    await heartbeatLoop.catch(() => {});
    externalSignal?.removeEventListener('abort', abortFromParent);
  }
}
