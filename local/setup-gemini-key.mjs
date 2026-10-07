import {loadConfig} from './config.mjs';
import {atomicJSON} from './manifest.mjs';

function readHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Hãy chạy lệnh trong cửa sổ terminal tương tác để nhập khóa ẩn.');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { cleanup(); reject(new Error('Đã hủy')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value.trim()); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    input.on('data', onData);
  });
}

const config = await loadConfig({secrets: true});
const apiKey = await readHidden('Nhập Gemini API key (ký tự sẽ không hiển thị): ');
if (!apiKey || apiKey.length < 20) throw new Error('API key trống hoặc quá ngắn; chưa lưu.');
await atomicJSON(config.secretsFile, {...config.secrets, geminiApiKey: apiKey});
console.log(`Đã lưu khóa riêng trong ${config.secretsFile}; giá trị khóa không được in ra.`);
