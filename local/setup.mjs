import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access, readFile} from 'node:fs/promises';
import {loadConfig, configFile, privateRoot} from './config.mjs';
import {readJSON} from './manifest.mjs';

const run = promisify(execFile);

export async function checkCommand(cmd, args = ['--version']) {
  try {
    const res = await run(cmd, args, {windowsHide: true});
    return {ok: true, output: (res.stdout || res.stderr || '').trim()};
  } catch (err) {
    return {ok: false, error: err.message};
  }
}

export async function checkFile(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor() {
  console.log('=== KIỂM TRA HỆ THỐNG ZALO VIDEO BOT ===\n');
  const results = [];

  // 1. Node version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split('.')[0], 10);
  results.push({
    name: 'Node.js (>= 22)',
    ok: major >= 22,
    detail: nodeVer
  });

  // 2. ffprobe
  const ffprobeRes = await checkCommand('ffprobe', ['-version']);
  results.push({
    name: 'FFprobe / FFmpeg',
    ok: ffprobeRes.ok,
    detail: ffprobeRes.ok ? ffprobeRes.output.split('\n')[0] : 'Chưa cài đặt hoặc chưa thêm vào PATH'
  });

  // 3. Codex CLI
  const codexRes = await checkCommand('codex', ['--version']);
  results.push({
    name: 'Codex CLI',
    ok: codexRes.ok,
    detail: codexRes.ok ? codexRes.output : 'Chưa tìm thấy lệnh codex'
  });

  // 4. Config & Secrets
  const config = await loadConfig({secrets: true}).catch(() => null);
  const hasSecrets = config && config.secrets && Boolean(config.secrets.zaloBotToken && config.secrets.runnerToken);
  results.push({
    name: 'File secrets (secrets.json)',
    ok: hasSecrets,
    detail: hasSecrets ? 'Đã có Zalo Bot Token & Runner Token' : `Thiếu hoặc chưa cấu hình tại: ${path.join(privateRoot, 'secrets.json')}`
  });

  // 5. Google Credentials
  const hasGoogle = config ? await checkFile(config.googleCredentials) : false;
  results.push({
    name: 'Google Credentials (OAuth / Service Account)',
    ok: hasGoogle,
    detail: hasGoogle ? config.googleCredentials : 'Chưa xác thực (Chạy: npm run connect:google)'
  });

  // 6. Skills
  if (config?.skills) {
    for (const [skillName, skillPath] of Object.entries(config.skills)) {
      const exists = await checkFile(skillPath);
      results.push({
        name: `Skill: ${skillName}`,
        ok: exists,
        detail: exists ? skillPath : 'File không tồn tại'
      });
    }
  }

  // Print results
  for (const r of results) {
    const symbol = r.ok ? '✅' : '❌';
    console.log(`${symbol} [${r.name}]: ${r.detail}`);
  }

  console.log('\n========================================');
  const allOk = results.every(r => r.ok);
  return {allOk, results};
}
