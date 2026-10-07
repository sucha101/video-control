import test from 'node:test';
import assert from 'node:assert/strict';
import {authorize} from '../cloud/worker.mjs';
import {Miniflare, Response as MFResponse, convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const secrets={ZALO_WEBHOOK_SECRET:'fake-webhook-secret',RUNNER_TOKEN:'fake-runner-secret',PAIR_CODE:'test-pair-code',ZALO_BOT_TOKEN:'fake-bot-token'};
const bundle=(await build({stdin:{contents:`
import worker from './cloud/worker.mjs';
import {VideoQueue as Base} from './cloud/queue.mjs';
export default worker;
export class VideoQueue extends Base {
  async fetch(request) {
    if(new URL(request.url).pathname==='/__test') {
      const body=await request.json();
      if(body.alarm) {await this.alarm(); return Response.json({ok:true});}
      return Response.json(this.tx(()=>this.rows(body.sql,...(body.params??[]))));
    }
    return super.fetch(request);
  }
}`,resolveDir:path.resolve('.'),sourcefile:'test-entry.mjs'},bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;

async function fixture(t, persistence) {
  const sent=[]; let rejectNotifications=true;
  const directory=persistence??await mkdtemp(path.join(tmpdir(),'zalo-queue-test-'));
  const mf=new Miniflare(convertV4MiniflareOptions({name:'queue-test',modules:true,script:bundle,compatibilityDate:'2026-09-01',resourcePersistencePath:directory,durableObjects:{VIDEO_QUEUE:{className:'VideoQueue',useSQLite:true}},bindings:secrets,outboundService:async request=>{
    assert.equal(request.url,'https://bot-api.zaloplatforms.com/botfake-bot-token/sendMessage');
    sent.push(await request.json());
    return MFResponse.json({ok:!rejectNotifications},{status:rejectNotifications?503:200});
  }}));
  await mf.ready;
  const namespace=await mf.getDurableObjectNamespace('VIDEO_QUEUE');
  const stub=namespace.get(namespace.idFromName('personal-v1'));
  const inspect=async (sql,params=[]) => (await stub.fetch('https://queue/__test',{method:'POST',body:JSON.stringify({sql,params})})).json();
  const api=async (url,body,headers={Authorization:`Bearer ${secrets.RUNNER_TOKEN}`}) => {
    const response=await mf.dispatchFetch(`https://queue${url}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  let sequence=0;
  const webhook=(text,override={})=>api('/zalo/webhook',{ok:true,result:{event_name:'message.text.received',message:{from:{id:'owner',is_bot:false},chat:{id:'private-chat',chat_type:'PRIVATE'},text,message_id:`m${++sequence}`,date:123,...override}}},{'X-Bot-Api-Secret-Token':secrets.ZALO_WEBHOOK_SECRET});
  let disposed=false;
  const dispose=async()=>{if(!disposed){disposed=true;await mf.dispose();}};
  t.after(async()=>{await dispose(); if(!persistence) await rm(directory,{recursive:true,force:true});});
  return {mf,dispose,api,webhook,inspect,sent,directory,allowNotifications:()=>{rejectNotifications=false;},alarm:()=>stub.fetch('https://queue/__test',{method:'POST',body:JSON.stringify({alarm:true})})};
}

test('empty and missing configured secrets fail closed', () => {
  assert.equal(authorize(new Request('https://queue/api/claim'), {}), false);
  assert.equal(authorize(new Request('https://queue/api/claim',{headers:{Authorization:'Bearer '}}), {RUNNER_TOKEN:''}), false);
});
test('real runtime auth, official probe, one-time owner pairing and replay collision', async t=>{
  const f=await fixture(t);
  assert.deepEqual((await f.api('/health')).body,{ok:true,version:1});
  assert.equal((await f.api('/api/jobs',undefined,{})).status,401);
  assert.equal((await f.api('/zalo/webhook',{ok:true,result:{}},{})).status,401);
  assert.equal((await f.api('/zalo/webhook',{ok:true,result:{}},{'X-Bot-Api-Secret-Token':secrets.ZALO_WEBHOOK_SECRET})).status,200);
  assert.equal((await f.api('/zalo/webhook',{}, {'X-Bot-Api-Secret-Token':secrets.ZALO_WEBHOOK_SECRET})).status,200);
  assert.equal((await f.api('/api/jobs')).body.jobs.length,0);
  assert.equal((await f.webhook('/run V001')).status,403);
  assert.equal((await f.webhook('/pair test-pair-code',{chat:{id:'group',chat_type:'GROUP'}})).status,403);
  assert.equal((await f.webhook('/pair test-pair-code')).status,200);
  assert.equal((await f.webhook('/pair test-pair-code',{from:{id:'stranger',is_bot:false}})).status,403);
  const event={message_id:'immutable-1',date:999};
  assert.equal((await f.webhook('/run V001',event)).status,200);
  assert.equal((await f.webhook('/run V001',event)).body.duplicate,true);
  assert.equal((await f.webhook('/run V002',event)).status,409);
  assert.equal((await f.api('/api/jobs')).body.jobs.length,1);
  assert.equal((await f.webhook('/run V002',{chat:{id:'other-chat',chat_type:'PRIVATE'}})).status,403);
});
test('concurrent claims serialize, payload dedupe is immutable, completion and cancellation fence',async t=>{
  const f=await fixture(t); await f.webhook('/pair test-pair-code');
  const body={dedupeKey:'one',type:'produce',payload:{videoId:'V001'}};
  assert.equal((await f.api('/api/jobs',{...body,payload:{videoId:'../x'}})).status,400);
  const first=await f.api('/api/jobs',body);
  assert.equal(first.status,200);
  assert.equal((await f.api('/api/jobs',body)).body.duplicate,true);
  assert.equal((await f.api('/api/jobs',{...body,payload:{videoId:'V002'}})).status,409);
  const claims=await Promise.all(['pc-a','pc-b'].map(workerId=>f.api('/api/claim',{workerId})));
  assert.equal(claims.filter(x=>x.body.job).length,1);
  const job=claims.find(x=>x.body.job).body.job;
  assert.equal(job.attempt,1);
  const auth={workerId:job.workerId,leaseToken:job.leaseToken};
  assert.equal((await f.api(`/api/jobs/${job.id}/complete`,{...auth,leaseToken:'wrong',result:{message:'done'}})).status,409);
  const list=(await f.api('/api/jobs')).body;
  assert.equal(list.jobs[0].leaseToken,undefined);
  assert.equal(list.worker.online,true);
  assert.equal((await f.webhook(`/cancel ${job.id}`)).status,200);
  assert.equal((await f.api(`/api/jobs/${job.id}/heartbeat`,auth)).body.cancelRequested,true);
  assert.equal((await f.api(`/api/jobs/${job.id}/complete`,{...auth,result:{message:'done'}})).status,409);
  assert.equal((await f.api(`/api/jobs/${job.id}/fail`,{...auth,error:'Stopped'})).status,200);
  assert.equal((await f.api('/api/jobs')).body.jobs[0].status,'cancelled');
});
test('expired work requires explicit retry and fresh fence; completed work cannot retry',async t=>{
  const f=await fixture(t); await f.webhook('/pair test-pair-code'); await f.webhook('/run V001');
  const original=(await f.api('/api/claim',{workerId:'pc-a'})).body.job;
  original.leaseExpiresAt=Date.now()-1;
  await f.inspect('UPDATE jobs SET data=? WHERE id=?',[JSON.stringify(original),original.id]);
  assert.equal((await f.api('/api/claim',{workerId:'pc-b'})).body.job,null);
  assert.equal((await f.api('/api/jobs')).body.jobs[0].status,'needs_review');
  const stale={workerId:'pc-a',leaseToken:original.leaseToken};
  assert.equal((await f.api(`/api/jobs/${original.id}/heartbeat`,stale)).status,409);
  await f.webhook(`/retry ${original.id}`);
  const retry=(await f.api('/api/claim',{workerId:'pc-b'})).body.job;
  assert.equal(retry.attempt,2); assert.notEqual(retry.leaseToken,original.leaseToken);
  assert.equal((await f.api(`/api/jobs/${original.id}/complete`,{...stale,result:{message:'old'}})).status,409);
  const driveUrl='https://drive.google.com/file/d/fake-file-id/view';
  assert.equal((await f.api(`/api/jobs/${original.id}/complete`,{workerId:'pc-b',leaseToken:retry.leaseToken,result:{message:'Hoàn tất',driveUrl}})).status,200);
  assert.ok((await f.inspect('SELECT text FROM outbox')).some(row=>row.text.includes(driveUrl)));
  await f.webhook(`/retry ${original.id}`);
  assert.equal((await f.api('/api/claim',{workerId:'pc-b'})).body.job,null);
});
test('offline queued work and owner/replay records persist through actual runtime restart',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'zalo-restart-'));
  const first=await fixture(t,directory);
  await first.webhook('/pair test-pair-code'); await first.webhook('/run V001',{message_id:'persistent'});
  const id=(await first.api('/api/jobs')).body.jobs[0].id;
  await first.dispose();
  const second=await fixture(t,directory);
  const replay=await second.webhook('/run V001',{message_id:'persistent'});
  assert.equal(replay.body.duplicate,true,JSON.stringify(replay));
  const job=(await second.api('/api/claim',{workerId:'after-restart'})).body.job;
  assert.equal(job.id,id); assert.equal(job.attempt,1);
  await second.dispose();
  await rm(directory,{recursive:true,force:true});
});
test('actual alarms retry failed notification independently, then remove only delivered outbox rows',async t=>{
  const f=await fixture(t); await f.webhook('/pair test-pair-code'); await f.webhook('/run V001');
  await f.inspect('UPDATE outbox SET next_at=?',[Date.now()-1]);
  await f.alarm();
  const pending=await f.inspect('SELECT * FROM outbox');
  assert.equal(pending.length,2); assert.ok(pending.every(x=>x.attempts===1));
  assert.equal((await f.api('/api/jobs')).body.jobs[0].status,'queued');
  f.allowNotifications(); await f.inspect('UPDATE outbox SET next_at=?',[Date.now()-1]); await f.alarm();
  assert.equal((await f.inspect('SELECT * FROM outbox')).length,0);
  assert.ok(f.sent.every(x=>x.chat_id==='private-chat' && typeof x.text==='string'));
  const job=(await f.api('/api/claim',{workerId:'pc-a'})).body.job;
  await f.api(`/api/jobs/${job.id}/fail`,{workerId:'pc-a',leaseToken:job.leaseToken,error:'bad fake-bot-token https://example.com/token'});
  const messages=await f.inspect('SELECT text FROM outbox');
  assert.ok(messages.every(x=>!x.text.includes('fake-bot-token')&&!x.text.includes('https://')));
});
