import {parseCommand} from '../shared/commands.mjs';
import {HttpError, LEASE_MS, boundedString, validId, validateJob, jobSummary, safeText} from '../shared/contracts.mjs';
import {
  verifyPasswordWeb,
  checkRateLimit,
  recordLoginResult,
  createSession,
  getSession,
  revokeSession,
  rotateCsrfToken,
  verifyCsrf,
  makeClearCookieHeader
} from './web-auth.mjs';
import {
  ensureWebSchema,
  createWebRequest,
  listWebRequests,
  getWebRequest,
  patchWebRequest,
  cancelWebRequest,
  patchWebReview,
  getPendingStudioRequests,
  claimStudioRequest,
  heartbeatStudioRequest,
  completeStudioRequest,
  failStudioRequest,
  retryStudioRequest,
  claimSyncOutbox,
  completeSyncOutbox
} from './web-store.mjs';
import {
  createPublicationIntent,
  getPublications,
  claimPublicationChannels,
  updatePublicationChannelResult,
  getPollablePublicationChannels,
  retryPublicationChannels,
  dispatchPublicationToBuffer
} from './web-publications.mjs';

const HELP = '/scan · /run ID · /new SKILL (xuống dòng: tiêu đề, kịch bản) · /approve ID · /skill ID SKILL · /mode ID video|auto · /publish ID [ngày giờ] · /status [JOB] · /cancel JOB · /retry JOB';
const STATUS = {queued:'đang chờ máy tính',running:'đang xử lý',completed:'hoàn tất',failed:'lỗi',needs_review:'cần kiểm tra',cancelled:'đã hủy'};
const canonical = value => value && typeof value==='object' ? (Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))) : value;
const encode = value => JSON.stringify(canonical(value));

export class VideoQueue {
  constructor(state,env) {
    this.state=state; this.env=env; this.sql=state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL, signature TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created_at)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS inbound (key TEXT PRIMARY KEY, signature TEXT NOT NULL, response TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, text TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL)');
    ensureWebSchema(this.sql);
  }
  rows(query,...params) { return this.sql.exec(query,...params).toArray(); }
  meta(key) { const row=this.rows('SELECT value FROM metadata WHERE key=?',key)[0]; return row ? JSON.parse(row.value):null; }
  putMeta(key,value) { this.sql.exec('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)',key,JSON.stringify(value)); }
  tx(fn) { return this.state.storage.transactionSync(fn); }
  getJob(id) { const row=this.rows('SELECT data FROM jobs WHERE id=?',id)[0]; if(!row) throw new HttpError(404,'Không tìm thấy công việc'); return JSON.parse(row.data); }
  saveJob(job) { this.sql.exec('UPDATE jobs SET data=?,status=? WHERE id=?',JSON.stringify(job),job.status,job.id); }
  redact(text) { return safeText(text,[this.env.ZALO_BOT_TOKEN,this.env.ZALO_WEBHOOK_SECRET,this.env.RUNNER_TOKEN,this.env.PAIR_CODE]); }
  notify(text, chatId=this.meta('owner')?.chatId, driveUrl) {
    const secrets=[this.env.ZALO_BOT_TOKEN,this.env.ZALO_WEBHOOK_SECRET,this.env.RUNNER_TOKEN,this.env.PAIR_CODE].filter(Boolean);
    const cleanLink=driveUrl && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(driveUrl) && !secrets.some(secret=>driveUrl.includes(secret)) ? ` ${driveUrl}` : '';
    if(chatId) this.sql.exec('INSERT INTO outbox(id,chat_id,text,next_at) VALUES(?,?,?,?)',crypto.randomUUID(),chatId,this.redact(text)+cleanLink,Date.now()+1000);
  }
  enqueue(body) {
    const {type,payload}=validateJob(body.type,body.payload);
    const key=boundedString(body.dedupeKey,'Dedupe key',512);
    if(body.sourceJobId!==undefined) validId(body.sourceJobId);
    const signature=encode({type,payload,sourceJobId:body.sourceJobId??null});
    const old=this.rows('SELECT data,signature FROM jobs WHERE dedupe_key=?',key)[0];
    if(old) { if(old.signature!==signature) throw new HttpError(409,'Dedupe key collision'); return {job:JSON.parse(old.data),duplicate:true}; }
    const now=Date.now();
    const job={id:crypto.randomUUID(),type,payload,status:'queued',createdAt:now,updatedAt:now,attempt:0,...(body.sourceJobId?{sourceJobId:body.sourceJobId}:{})};
    this.sql.exec('INSERT INTO jobs(id,dedupe_key,signature,data,status,created_at) VALUES(?,?,?,?,?,?)',job.id,key,signature,JSON.stringify(job),job.status,now);
    this.notify(`Đã lưu công việc ${job.id}. Máy tính sẽ xử lý khi online.`);
    return {job,duplicate:false};
  }
  expire(now=Date.now()) {
    for(const row of this.rows("SELECT data FROM jobs WHERE status='running'")) {
      const job=JSON.parse(row.data);
      if(job.leaseExpiresAt<=now) {
        job.status='needs_review'; job.updatedAt=now; job.error='Mất lease; cần kiểm tra trước khi thử lại.';
        delete job.leaseToken; delete job.leaseExpiresAt; delete job.workerId;
        this.saveJob(job); this.notify(`Công việc ${job.id}: cần kiểm tra do máy tính mất kết nối.`);
      }
    }
  }
  fence(id,body) {
    validId(body.workerId); boundedString(body.leaseToken,'Lease token',128);
    const job=this.getJob(id);
    if(job.status!=='running' || job.workerId!==body.workerId || job.leaseToken!==body.leaseToken || job.leaseExpiresAt<=Date.now()) throw new HttpError(409,'Lease không còn hiệu lực');
    return job;
  }
  claim(body) {
    validId(body.workerId); this.putMeta('worker',{workerId:body.workerId,lastSeenAt:Date.now()});
    if(this.rows("SELECT id FROM jobs WHERE status='running' LIMIT 1").length) return {job:null};
    const row=this.rows("SELECT data FROM jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1")[0];
    if(!row) return {job:null};
    const job=JSON.parse(row.data); const now=Date.now();
    Object.assign(job,{status:'running',updatedAt:now,workerId:body.workerId,leaseToken:crypto.randomUUID(),leaseExpiresAt:now+LEASE_MS,attempt:job.attempt+1});
    this.saveJob(job); this.notify(`Công việc ${job.id}: bắt đầu xử lý.`); return {job};
  }
  runnerAction(id,action,body) {
    const job=this.fence(id,body); const now=Date.now();
    this.putMeta('worker',{workerId:body.workerId,lastSeenAt:now});
    if(action==='heartbeat') {
      if(body.summary!==undefined) {
        const summary=this.redact(boundedString(body.summary,'Summary',2000));
        if(summary!==job.summary) { job.summary=summary; this.notify(`Công việc ${id}: ${summary}`); }
      }
      job.leaseExpiresAt=now+LEASE_MS; job.updatedAt=now; this.saveJob(job);
      return {ok:true,cancelRequested:!!job.cancelRequested,leaseExpiresAt:job.leaseExpiresAt};
    }
    if(action==='complete') {
      if(job.cancelRequested) throw new HttpError(409,'Công việc đã yêu cầu hủy');
      if(!body.result || typeof body.result!=='object' || Array.isArray(body.result)) throw new HttpError(400,'Result không hợp lệ');
      boundedString(body.result.message,'Result message',2000);
      if(body.result.videoId!==undefined) validId(body.result.videoId);
      if(body.result.driveUrl!==undefined && (typeof body.result.driveUrl!=='string' || body.result.driveUrl.length>2048 || !/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(body.result.driveUrl))) throw new HttpError(400,'Drive URL không hợp lệ');
      if(JSON.stringify(body.result).length>6000) throw new HttpError(400,'Result quá dài');
      job.status='completed'; job.result={...body.result,message:this.redact(body.result.message)};
      // Only the verified Drive result URL is preserved; raw URLs in messages/errors are redacted.
      this.notify(`Công việc ${id}: hoàn tất. ${job.result.message}`,undefined,job.result.driveUrl);
    } else if(action==='fail') {
      boundedString(body.error,'Error',2000);
      if(body.needsReview!==undefined && typeof body.needsReview!=='boolean') throw new HttpError(400,'needsReview không hợp lệ');
      job.status=job.cancelRequested?'cancelled':body.needsReview?'needs_review':'failed'; job.error=this.redact(body.error);
      this.notify(`Công việc ${id}: ${STATUS[job.status]}. ${job.error}`);
    } else throw new HttpError(404,'Not found');
    job.updatedAt=now; delete job.workerId; delete job.leaseToken; delete job.leaseExpiresAt; this.saveJob(job);
    return {ok:true};
  }
  command(command,eventKey) {
    const {type,payload}=command;
    if(type==='help') return HELP;
    if(type==='status') {
      if(payload.jobId) { const job=this.getJob(payload.jobId); return `Công việc ${job.id}: ${STATUS[job.status]}. ${job.summary??''}`; }
      const worker=this.meta('worker'); const online=worker && Date.now()-worker.lastSeenAt<90000;
      const counts=this.rows('SELECT status,COUNT(*) AS count FROM jobs GROUP BY status').map(r=>`${STATUS[r.status]}: ${r.count}`).join(', ');
      return `Máy tính ${online?'online':'offline'}. ${counts || 'Chưa có công việc.'}`;
    }
    if(type==='cancel' || type==='retry') {
      const job=this.getJob(payload.jobId);
      if(type==='cancel') {
        if(!['queued','running'].includes(job.status)) throw new HttpError(409,'Công việc không thể hủy');
        job.cancelRequested=true; if(job.status==='queued') job.status='cancelled';
      } else {
        if(!['failed','needs_review'].includes(job.status)) throw new HttpError(409,'Chỉ thử lại công việc lỗi hoặc cần kiểm tra');
        job.status='queued'; job.cancelRequested=false; delete job.error; delete job.summary;
      }
      job.updatedAt=Date.now(); this.saveJob(job); return `Công việc ${job.id}: ${type==='cancel'?'đã yêu cầu hủy':'đã lưu yêu cầu thử lại'}.`;
    }
    const {job}=this.enqueue({dedupeKey:`zalo:${eventKey}`,type,payload});
    return `Đã lưu công việc ${job.id}. Máy tính sẽ xử lý khi online.`;
  }
  webhook(body) {
    // Verification may send a bare object. It has no user-message envelope and no side effects.
    if(body.result===undefined && body.message===undefined) return {ok:true};
    if(body?.ok!==true || !body.result || typeof body.result!=='object') throw new HttpError(400,'Webhook không hợp lệ');
    const result=body.result;
    // Official verification probes contain no user message; unsupported events have no queue effect.
    if(result.event_name!=='message.text.received') return {ok:true};
    const message=result.message;
    if(!message || message.chat?.chat_type!=='PRIVATE' || message.from?.is_bot!==false) throw new HttpError(403,'Chỉ nhận tin nhắn cá nhân');
    if(!Number.isSafeInteger(message.date) || message.date<0) throw new HttpError(400,'Ngày tin nhắn không hợp lệ');
    const sender=boundedString(message.from.id,'Sender',128),chat=boundedString(message.chat.id,'Chat',128),messageId=boundedString(message.message_id,'Message ID',128);
    boundedString(message.text,'Lệnh',16000);
    const key=encode([sender,chat,messageId]); const signature=encode(result);
    const old=this.rows('SELECT signature,response FROM inbound WHERE key=?',key)[0];
    if(old) { if(old.signature!==signature) throw new HttpError(409,'Message replay collision'); return {...JSON.parse(old.response),duplicate:true}; }
    const owner=this.meta('owner'); let command;
    if(!owner) {
      command=parseCommand(message.text);
      if(command.type!=='pair' || !this.env.PAIR_CODE || command.payload.code!==this.env.PAIR_CODE) throw new HttpError(403,'Chưa ghép chủ sở hữu');
      this.putMeta('owner',{senderId:sender,chatId:chat});
    } else if(owner.senderId!==sender || owner.chatId!==chat) throw new HttpError(403,'Không phải chủ sở hữu');
    let reply;
    try {
      command??=parseCommand(message.text);
      reply=command.type==='pair'?(owner?'Bot đã ghép chủ sở hữu.':'Đã ghép chủ sở hữu.'):this.command(command,key);
    } catch(error) {
      if(!(error instanceof HttpError)) throw error;
      reply=error.message;
    }
    // enqueue() already stores the acknowledgement in the outbox.
    if(!['scan','produce','add_row','approve','set_skill','set_mode','publish'].includes(command?.type) || reply.startsWith('Lệnh')) this.notify(reply,chat);
    const response={ok:true}; this.sql.exec('INSERT INTO inbound(key,signature,response) VALUES(?,?,?)',key,signature,JSON.stringify(response));
    return response;
  }
  async scheduleAlarm() {
    const next=this.rows('SELECT MIN(next_at) AS time FROM outbox')[0]?.time;
    const running=this.rows("SELECT data FROM jobs WHERE status='running'").map(r=>JSON.parse(r.data).leaseExpiresAt);
    const times=[next,...running].filter(v=>typeof v==='number');
    if(times.length) await this.state.storage.setAlarm(Math.max(Date.now()+1,Math.min(...times)));
    else await this.state.storage.deleteAlarm();
  }
  async handleWebRequest(request, path, url) {
    const isHttps = url.protocol === 'https:';
    let body = {};
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      const raw = await request.text();
      if (raw.length > 65536) throw new HttpError(413, 'Request body too large');
      if (raw.trim().length > 0) {
        try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid JSON body');
      }
    }

    if (path === '/api/web/health' && request.method === 'GET') {
      const presence = this.meta('worker');
      const online = !!presence && Date.now() - presence.lastSeenAt < 900000;
      return Response.json({ok: true, runnerLastSeenAt: presence?.lastSeenAt ?? null, runnerOnline: online}, {headers: {'Cache-Control': 'no-store'}});
    }

    if (path === '/api/web/login' && request.method === 'POST') {
      const username = (body.username || '').trim();
      const password = body.password || '';
      if (!username || !password) throw new HttpError(400, 'Vui lòng nhập tên đăng nhập và mật khẩu');

      const ip = request.headers.get('cf-connecting-ip') || '127.0.0.1';
      const bucket = `${ip}:${username}`;
      await checkRateLimit(this.sql, bucket);

      let usersConfig = null;
      try {
        usersConfig = this.env.WEB_USERS_JSON ? JSON.parse(this.env.WEB_USERS_JSON) : null;
      } catch {
        throw new HttpError(500, 'Cấu hình WEB_USERS_JSON không hợp lệ');
      }
      const user = usersConfig?.users?.find(u => u.username.toLowerCase() === username.toLowerCase());
      const valid = user ? await verifyPasswordWeb(password, user) : false;
      await recordLoginResult(this.sql, bucket, valid);

      if (!valid) throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không chính xác');

      const session = await createSession(this.sql, user, {isHttps});
      return new Response(JSON.stringify({ok: true, user: session.user, csrfToken: session.csrfToken}), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': session.cookieHeader,
          'Cache-Control': 'no-store'
        }
      });
    }

    if (path === '/api/web/logout' && request.method === 'POST') {
      const session = await getSession(this.sql, request.headers.get('cookie'));
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin request rejected');
      if (!session) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập');
      if (!await verifyCsrf(session, request.headers.get('x-csrf-token'))) throw new HttpError(403, 'CSRF token không hợp lệ hoặc thiếu');
      await revokeSession(this.sql, session.tokenHash);
      return new Response(JSON.stringify({ok: true}), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': makeClearCookieHeader('vs_session', {isHttps}),
          'Cache-Control': 'no-store'
        }
      });
    }

    if (path === '/api/web/session' && request.method === 'GET') {
      const session = await getSession(this.sql, request.headers.get('cookie'));
      if (!session) return Response.json({authenticated: false}, {headers: {'Cache-Control': 'no-store'}});
      const csrfToken = await rotateCsrfToken(this.sql, session);
      return Response.json({
        authenticated: true,
        user: {username: session.username, role: session.role},
        csrfToken,
        expiresAt: session.expiresAt
      }, {headers: {'Cache-Control': 'no-store'}});
    }

    // Protected web endpoints
    const session = await getSession(this.sql, request.headers.get('cookie'));
    if (!session) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập');

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin request rejected');
      const csrfHeader = request.headers.get('x-csrf-token');
      const validCsrf = await verifyCsrf(session, csrfHeader);
      if (!validCsrf) throw new HttpError(403, 'CSRF token không hợp lệ hoặc thiếu');
    }

    if (path === '/api/web/requests' && request.method === 'GET') {
      const state = url.searchParams.get('state') || undefined;
      const cursor = url.searchParams.get('cursor') || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const data = listWebRequests(this.sql, {state, cursor, limit});
      return Response.json(data, {headers: {'Cache-Control': 'no-store'}});
    }

    if (path === '/api/web/requests' && request.method === 'POST') {
      const result = await createWebRequest(this.sql, session, body);
      if (!result.duplicate) {
        try {
          this.notify(`[Video Studio] Yêu cầu mới ${result.request?.display_id || 'mới'}: ${result.request?.title || ''} (từ ${result.request?.created_by || ''})`);
          await this.scheduleAlarm();
        } catch {}
      }
      return Response.json(result, {status: result.duplicate ? 200 : 201, headers: {'Cache-Control': 'no-store'}});
    }

    const reqMatch = /^\/api\/web\/requests\/([A-Za-z0-9_-]+)$/.exec(path);
    if (reqMatch) {
      const reqId = reqMatch[1];
      if (request.method === 'GET') {
        const data = getWebRequest(this.sql, reqId);
        return Response.json(data, {headers: {'Cache-Control': 'no-store'}});
      }
      if (request.method === 'PATCH') {
        const updated = await patchWebRequest(this.sql, reqId, session, body);
        return Response.json({request: updated}, {headers: {'Cache-Control': 'no-store'}});
      }
    }

    const cancelMatch = /^\/api\/web\/requests\/([A-Za-z0-9_-]+)\/cancel$/.exec(path);
    if (cancelMatch && request.method === 'POST') {
      const result = cancelWebRequest(this.sql, cancelMatch[1], session, body);
      return Response.json(result, {headers: {'Cache-Control': 'no-store'}});
    }

    const reviewMatch = /^\/api\/web\/requests\/([A-Za-z0-9_-]+)\/review$/.exec(path);
    if (reviewMatch && request.method === 'PATCH') {
      const updated = patchWebReview(this.sql, reviewMatch[1], session, body);
      return Response.json({request: updated}, {headers: {'Cache-Control': 'no-store'}});
    }

    const pubMatch = /^\/api\/web\/requests\/([A-Za-z0-9_-]+)\/publications$/.exec(path);
    if (pubMatch) {
      if (request.method === 'GET') {
        const data = getPublications(this.sql, pubMatch[1]);
        return Response.json({publications: data}, {headers: {'Cache-Control': 'no-store'}});
      }
      if (request.method === 'POST') {
        const result = this.tx(() => createPublicationIntent(this.sql, pubMatch[1], session, body));
        if (!result.duplicate) {
          try {
            this.notify(`[Video Studio] Đã duyệt xuất bản ${pubMatch[1]} lên ${result.channels?.length || 0} kênh mạng xã hội`);
            await this.scheduleAlarm();
          } catch {}
          if (result.publication?.id) {
            try {
              await dispatchPublicationToBuffer(this.sql, this.env, result.publication.id);
            } catch (err) {
              console.error('[Buffer Dispatch Error]', err);
            }
          }
        }
        return Response.json(result, {status: result.duplicate ? 200 : 201, headers: {'Cache-Control': 'no-store'}});
      }
    }

    const pubRetryMatch = /^\/api\/web\/requests\/([A-Za-z0-9_-]+)\/publications\/retry$/.exec(path);
    if (pubRetryMatch && request.method === 'POST') {
      const result = this.tx(() => retryPublicationChannels(this.sql, pubRetryMatch[1], body.channelIds));
      if (result.publicationId) {
        try {
          await dispatchPublicationToBuffer(this.sql, this.env, result.publicationId);
        } catch (err) {
          console.error('[Buffer Dispatch Retry Error]', err);
        }
      }
      return Response.json(result);
    }

    const productionRetryMatch = /^\/api\/web\/requests\/([A-Za-z0-9_-]+)\/production\/retry$/.exec(path);
    if (productionRetryMatch && request.method === 'POST') {
      const result = retryStudioRequest(this.sql, productionRetryMatch[1], session);
      try { await this.scheduleAlarm(); } catch {}
      return Response.json(result);
    }

    throw new HttpError(404, 'Endpoint không tồn tại');
  }
  async handleStudioRunner(request, path, url) {
    let body = {};
    if (request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > 65536) throw new HttpError(413, 'Request payload too large');
      if (raw.trim().length > 0) {
        try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON body'); }
      }
    }

    this.putMeta('worker', {workerId: body.workerId || 'runner', lastSeenAt: Date.now()});

    if (path === '/api/runner/studio/requests' && request.method === 'GET') {
      const state = url.searchParams.get('state');
      if (state === 'waiting') {
        return Response.json({requests: getPendingStudioRequests(this.sql)});
      }
      return Response.json({requests: listWebRequests(this.sql, {state}).requests});
    }

    if (path === '/api/runner/studio/requests' && request.method === 'POST') {
      const result = await createWebRequest(this.sql, {username: body.createdBy || 'runner'}, body);
      if (!result.duplicate) {
        try {
          this.notify(`[Video Studio] Yêu cầu mới ${result.request?.display_id || 'mới'}: ${result.request?.title || ''}`);
          await this.scheduleAlarm();
        } catch {}
      }
      return Response.json(result, {status: result.duplicate ? 200 : 201});
    }

    const singleReqMatch = /^\/api\/runner\/studio\/requests\/([A-Za-z0-9_-]+)$/.exec(path);
    if (singleReqMatch && request.method === 'GET') {
      const data = getWebRequest(this.sql, singleReqMatch[1]);
      return Response.json(data);
    }

    const claimMatch = /^\/api\/runner\/studio\/requests\/([A-Za-z0-9_-]+)\/claim$/.exec(path);
    if (claimMatch && request.method === 'POST') {
      const result = await claimStudioRequest(this.sql, claimMatch[1], body.workerId);
      return Response.json(result);
    }

    const hbMatch = /^\/api\/runner\/studio\/requests\/([A-Za-z0-9_-]+)\/heartbeat$/.exec(path);
    if (hbMatch && request.method === 'POST') {
      const result = await heartbeatStudioRequest(this.sql, hbMatch[1], body.workerId, body.leaseToken, body.progress);
      return Response.json(result);
    }

    const resMatch = /^\/api\/runner\/studio\/requests\/([A-Za-z0-9_-]+)\/result$/.exec(path);
    if (resMatch && request.method === 'POST') {
      const result = await completeStudioRequest(this.sql, resMatch[1], body.workerId, body.leaseToken, body);
      try {
        this.notify(`[Video Studio] Video ${resMatch[1]} đã dựng xong! Mời duyệt trên Web.`, undefined, body.driveUrl);
        await this.scheduleAlarm();
      } catch {}
      return Response.json(result);
    }

    const failMatch = /^\/api\/runner\/studio\/requests\/([A-Za-z0-9_-]+)\/fail$/.exec(path);
    if (failMatch && request.method === 'POST') {
      const result = await failStudioRequest(this.sql, failMatch[1], body.workerId, body.leaseToken, body.message);
      try {
        this.notify(`[Video Studio] Video ${failMatch[1]} cần kiểm tra: ${result.error || 'bộ dựng chưa hoàn tất'}`);
        await this.scheduleAlarm();
      } catch {}
      return Response.json(result);
    }

    if (path === '/api/runner/studio/sync/claim' && request.method === 'POST') {
      const result = this.tx(() => claimSyncOutbox(this.sql, body.workerId, body.limit));
      return Response.json(result);
    }

    if (path === '/api/runner/studio/sync/complete' && request.method === 'POST') {
      const result = this.tx(() => completeSyncOutbox(this.sql, body));
      return Response.json(result);
    }

    if (path === '/api/runner/studio/publications/claim' && request.method === 'POST') {
      const items = this.tx(() => claimPublicationChannels(this.sql, body.workerId, body.limit));
      return Response.json({items});
    }

    if (path === '/api/runner/studio/publications/result' && request.method === 'POST') {
      const result = this.tx(() => updatePublicationChannelResult(this.sql, body));
      return Response.json(result);
    }

    if (path === '/api/runner/studio/publications/all' && request.method === 'GET') {
      const pubs = this.sql.exec('SELECT * FROM web_publications').toArray();
      const chans = this.sql.exec('SELECT * FROM web_publication_channels').toArray();
      return Response.json({pubs, chans});
    }

    const runnerPubMatch = /^\/api\/runner\/studio\/requests\/([A-Za-z0-9_-]+)\/publish$/.exec(path);
    if (runnerPubMatch && request.method === 'POST') {
      const result = this.tx(() => createPublicationIntent(this.sql, runnerPubMatch[1], {username: 'runner'}, body));
      return Response.json(result);
    }

    const runnerRetryMatch = /^\/api\/runner\/studio\/requests\/([A-Za-z0-9_-]+)\/publications\/retry$/.exec(path);
    if (runnerRetryMatch && request.method === 'POST') {
      const result = this.tx(() => retryPublicationChannels(this.sql, runnerRetryMatch[1], body.channelIds));
      return Response.json(result);
    }

    if (path === '/api/runner/studio/publications/pollable' && request.method === 'GET') {
      const items = this.tx(() => getPollablePublicationChannels(this.sql, 1, url.searchParams.get('workerId')));
      return Response.json({items});
    }

    throw new HttpError(404, 'Runner studio endpoint not found');
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path.startsWith('/api/web/')) {
        return await this.handleWebRequest(request, path, url);
      }

      const expected = path === '/zalo/webhook' ? this.env.ZALO_WEBHOOK_SECRET : this.env.RUNNER_TOKEN;
      if (!expected || request.headers.get(path === '/zalo/webhook' ? 'X-Bot-Api-Secret-Token' : 'Authorization') !== (path === '/zalo/webhook' ? expected : `Bearer ${expected}`)) {
        throw new HttpError(401, 'Unauthorized');
      }

      if (path.startsWith('/api/runner/studio/')) {
        return await this.handleStudioRunner(request, path, url);
      }

      let body = {};
      if (request.method === 'POST') {
        const raw = await request.text();
        if (raw.length > 20000) throw new HttpError(413, 'Request too large');
        try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid JSON object');
      }

      // Expiry commits separately so a rejected stale request cannot roll it back.
      this.tx(() => this.expire());
      const result = this.tx(() => {
        if (path === '/zalo/webhook' && request.method === 'POST') return this.webhook(body);
        if (path === '/api/claim' && request.method === 'POST') return this.claim(body);
        if (path === '/api/jobs' && request.method === 'POST') return this.enqueue(body);
        if (path === '/api/jobs' && request.method === 'GET') {
          const presence = this.meta('worker');
          return {jobs: this.rows('SELECT data FROM jobs ORDER BY created_at DESC,rowid DESC LIMIT 100').map(r => jobSummary(JSON.parse(r.data))), worker: {lastSeenAt: presence?.lastSeenAt ?? null, online: !!presence && Date.now() - presence.lastSeenAt < 90000}};
        }
        const match = /^\/api\/jobs\/([A-Za-z0-9_-]+)\/(heartbeat|complete|fail)$/.exec(path);
        if (match && request.method === 'POST') return this.runnerAction(validId(match[1]), match[2], body);
        throw new HttpError(404, 'Not found');
      });
      await this.scheduleAlarm();
      return Response.json(result);
    } catch (error) {
      await this.scheduleAlarm();
      return Response.json({error: error instanceof HttpError ? error.message : 'Internal error'}, {status: error instanceof HttpError ? error.status : 500});
    }
  }
  async alarm() {
    this.tx(()=>this.expire());
    for(let i=0;i<20;i++) {
      const row=this.tx(()=>{
        const item=this.rows('SELECT * FROM outbox WHERE next_at<=? ORDER BY next_at,rowid LIMIT 1',Date.now())[0];
        if(item) this.sql.exec('UPDATE outbox SET attempts=attempts+1,next_at=? WHERE id=?',Date.now()+60000,item.id);
        return item;
      });
      if(!row) break;
      try {
        if(!this.env.ZALO_BOT_TOKEN) throw new Error('Missing bot token');
        const response=await fetch(`https://bot-api.zaloplatforms.com/bot${this.env.ZALO_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:row.chat_id,text:row.text}),signal:AbortSignal.timeout(15000)});
        const body=await response.json();
        if(!response.ok || body.ok!==true) throw new Error('Notification rejected');
        this.tx(()=>this.sql.exec('DELETE FROM outbox WHERE id=?',row.id));
      } catch {
        const delay=Math.min(3600000,1000*2**Math.min(row.attempts+1,12));
        this.tx(()=>this.sql.exec('UPDATE outbox SET next_at=? WHERE id=?',Date.now()+delay,row.id));
      }
    }
    await this.scheduleAlarm();
  }
}
