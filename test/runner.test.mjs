import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprint,findRow,eligible} from '../local/runner.mjs';
import {publishChannels,scheduleUTC} from '../local/buffer.mjs';
test('stable ID follows sorting and rejects duplicate IDs',()=>{
 const a=['A','title','script','viet-tiktok-story-video','ổn','Chờ tạo'];
 const b=['B']; assert.equal(findRow([b,a],'A').index,1);
 assert.throws(()=>findRow([a,a],'A'),/trùng/);
 assert.ok(eligible(a)); assert.notEqual(fingerprint(a),fingerprint([...a.slice(0,2),'changed',...a.slice(3)]));
});
test('ambiguous publishing intent survives retry without double post',async()=>{
 const state={};let requests=0;
 const args={channels:[{id:'channel',service:'tiktok'}],state,save:async()=>{},fence:async()=>{},create:async()=>{requests++;throw new Error('connection lost');},input:{caption:'caption',mediaUrl:'https://example.test/video.mp4'}};
 await assert.rejects(publishChannels(args),/kiểm tra/);
 await assert.rejects(publishChannels(args),/kiểm tra/);assert.equal(requests,1);
});
test('Bangkok scheduled input converts to UTC',()=>assert.equal(scheduleUTC('2026-10-04 09:00'),'2026-10-04T02:00:00.000Z'));
