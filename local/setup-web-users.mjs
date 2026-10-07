import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import {stdin, stdout} from 'node:process';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), iterations = 100000) {
  const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');
  return {salt, iterations, hash};
}

export function generateUsersJson({ownerPassword, collaboratorPassword, ownerUsername = 'dat', collaboratorUsername = 'quang'}) {
  const hashOwner = hashPassword(ownerPassword);
  const hashCollab = hashPassword(collaboratorPassword);
  const users = [
    { username: ownerUsername, role: 'owner', ...hashOwner },
    { username: 'owner', role: 'owner', ...hashOwner },
    { username: collaboratorUsername, role: 'collaborator', ...hashCollab },
    { username: 'collaborator', role: 'collaborator', ...hashCollab }
  ];
  if (ownerUsername === 'dat' || ownerUsername === 'đạt') {
    users.push({ username: 'đạt', role: 'owner', ...hashOwner });
    users.push({ username: 'dat', role: 'owner', ...hashOwner });
  }
  const uniqueUsers = [];
  const seen = new Set();
  for (const u of users) {
    if (!seen.has(u.username.toLowerCase())) {
      seen.add(u.username.toLowerCase());
      uniqueUsers.push(u);
    }
  }
  return JSON.stringify({users: uniqueUsers});
}

async function promptPassword(rl, promptText) {
  stdout.write(promptText);
  // Simple prompt for CLI setup
  const pass = await rl.question('');
  return pass.trim();
}

async function main() {
  const rl = readline.createInterface({input: stdin, output: stdout});
  try {
    console.log('=== THIẾT LẬP TÀI KHOẢN WEB VIDEO STUDIO ===');
    console.log('Tạo mật khẩu an toàn băm PBKDF2 cho 2 tài khoản: owner và collaborator.\n');
    
    let ownerPass = process.env.OWNER_PASSWORD;
    if (!ownerPass) {
      ownerPass = await promptPassword(rl, 'Nhập mật khẩu cho "owner": ');
      if (!ownerPass || ownerPass.length < 8) {
        console.error('❌ Mật khẩu phải có ít nhất 8 ký tự.');
        process.exit(1);
      }
    }

    let collabPass = process.env.COLLABORATOR_PASSWORD;
    if (!collabPass) {
      collabPass = await promptPassword(rl, 'Nhập mật khẩu cho "collaborator": ');
      if (!collabPass || collabPass.length < 8) {
        console.error('❌ Mật khẩu phải có ít nhất 8 ký tự.');
        process.exit(1);
      }
    }

    const json = generateUsersJson({ownerPassword: ownerPass, collaboratorPassword: collabPass});
    console.log('\n✅ Đã tạo cấu hình WEB_USERS_JSON thành công:');
    console.log('----------------------------------------------------');
    console.log(json);
    console.log('----------------------------------------------------');
    console.log('Hướng dẫn cài đặt lên Cloudflare Worker:');
    console.log('Chạy lệnh: npx wrangler secret put WEB_USERS_JSON');
    console.log('Và dán toàn bộ chuỗi JSON ở trên vào prompt.');
  } finally {
    rl.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('setup-web-users.mjs')) {
  main().catch(err => {
    console.error('Lỗi thiết lập:', err);
    process.exit(1);
  });
}
