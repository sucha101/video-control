import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommand} from '../shared/commands.mjs';

test('bounded commands use typed payloads', () => {
  assert.deepEqual(parseCommand('/run V001'), {type:'produce',payload:{videoId:'V001'}});
  assert.deepEqual(parseCommand('làm các bài đã duyệt'), {type:'scan',payload:{}});
  assert.deepEqual(parseCommand('/new viet-tiktok-story-video\nTiêu đề\nKịch bản\nDòng hai'), {type:'add_row',payload:{skill:'viet-tiktok-story-video',title:'Tiêu đề',script:'Kịch bản\nDòng hai'}});
  assert.deepEqual(parseCommand('/mode V001 auto'), {type:'set_mode',payload:{videoId:'V001',mode:'auto'}});
  assert.deepEqual(parseCommand('/publish V001 2026-10-04 12:30'), {type:'publish',payload:{videoId:'V001',schedule:'2026-10-04 12:30'}});
});
test('reject malformed, unsafe and unsupported inputs', () => {
  for (const text of ['/run V001 & del C:/','/run','/run ../x','/skill V001 shell','/mode V001 nope','/new drama-mascot-video\nOnly title','/publish V001 2026-02-30 00:00','cmd /c dir','/help extra','/run '+ 'A'.repeat(65), 'x'.repeat(16001)]) {
    assert.throws(() => parseCommand(text), /lệnh|ID|không|ngày|nội dung/i);
  }
});
