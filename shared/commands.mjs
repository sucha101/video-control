import {boundedString, validId, validateJob, HttpError} from './contracts.mjs';
export function parseCommand(input) {
  const text = boundedString(input,'Lệnh',16000).trim();
  if (text === 'làm các bài đã duyệt') return {type:'scan',payload:{}};
  if (text.startsWith('/new ')) {
    const [head,title,...script] = text.split(/\r?\n/);
    const parts = head.split(/\s+/);
    if (parts.length !== 2) throw new HttpError(400,'Lệnh /new không hợp lệ');
    return validateJob('add_row',{skill:parts[1],title,script:script.join('\n')});
  }
  if (/[\r\n]/.test(text)) throw new HttpError(400,'Lệnh không hợp lệ');
  const [command,...args] = text.split(/\s+/);
  const count = (min,max=min) => { if(args.length<min || args.length>max) throw new HttpError(400,'Lệnh thiếu hoặc thừa nội dung'); };
  switch(command) {
    case '/help': count(0); return {type:'help',payload:{}};
    case '/status': count(0,1); return {type:'status',payload:args.length?{jobId:validId(args[0])}:{}};
    case '/pair': count(1); return {type:'pair',payload:{code:validId(args[0])}};
    case '/cancel': case '/retry': count(1); return {type:command.slice(1),payload:{jobId:validId(args[0])}};
    case '/scan': count(0); return validateJob('scan',{});
    case '/run': count(1); return validateJob('produce',{videoId:args[0]});
    case '/approve': count(1); return validateJob('approve',{videoId:args[0]});
    case '/skill': count(2); return validateJob('set_skill',{videoId:args[0],skill:args[1]});
    case '/mode': count(2); return validateJob('set_mode',{videoId:args[0],mode:args[1]});
    case '/publish': count(1,3); return validateJob('publish',{videoId:args[0],...(args.length>1?{schedule:args.slice(1).join(' ')}:{})});
    default: throw new HttpError(400,'Lệnh không được hỗ trợ. Gửi /help.');
  }
}
