import path from 'node:path';
import {loadConfig, privateRoot} from './config.mjs';
import {readJSON, atomicJSON} from './manifest.mjs';

const ownerFile = path.join(privateRoot, 'zalo_owner.json');

export async function saveZaloOwner(chatId, senderId = null) {
  await atomicJSON(ownerFile, {chatId, senderId, updatedAt: Date.now()});
}

export async function getZaloOwner() {
  return await readJSON(ownerFile, null);
}

export async function sendZaloMessage(text) {
  const config = await loadConfig({secrets: true});
  const botToken = config.secrets?.zaloBotToken;
  if (!botToken) {
    console.warn('[Zalo Notify] Thiếu zaloBotToken');
    return false;
  }

  const owner = await getZaloOwner();
  if (!owner?.chatId) {
    console.warn('[Zalo Notify] Chưa ghép Chat ID Zalo');
    return false;
  }

  try {
    const res = await fetch(`https://bot-api.zaloplatforms.com/bot${botToken}/sendMessage`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: owner.chatId, text})
    });
    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    console.error('[Zalo Notify] Lỗi gửi:', err.message);
    return false;
  }
}
