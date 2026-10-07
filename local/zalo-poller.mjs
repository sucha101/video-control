import path from 'node:path';
import {parseCommand} from '../shared/commands.mjs';
import {readJSON, atomicJSON} from './manifest.mjs';
import {privateRoot} from './config.mjs';

export class ZaloPoller {
  constructor({botToken, pairingCode, runner}) {
    this.token = botToken;
    this.pairingCode = pairingCode;
    this.runner = runner;
    this.lastUpdateId = 0;
    this.cursorFile = path.join(privateRoot, 'zalo-cursor.json');
    this.running = false;
    this.sendersFile = path.join(privateRoot, 'allowed-senders.json');
    this.allowedSenders = new Set();
  }

  async init() {
    this.lastUpdateId = (await readJSON(this.cursorFile, {})).lastUpdateId || 0;
    const owner = await readJSON(path.join(privateRoot, 'zalo_owner.json'), null);
    const saved = await readJSON(this.sendersFile, []);
    if (owner?.senderId) saved.push(String(owner.senderId));
    this.allowedSenders = new Set(Array.isArray(saved) ? saved : []);
  }

  async saveSenders() {
    await atomicJSON(this.sendersFile, Array.from(this.allowedSenders));
  }

  async send(chatId, text) {
    if (!chatId || !text) return;
    try {
      await fetch(`https://bot-api.zaloplatforms.com/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chat_id: chatId, text}), signal: AbortSignal.timeout(15000)
      });
    } catch (err) {
      console.error('Lỗi gửi tin nhắn Zalo:', err.message);
    }
  }

  async pollOnce() {
    try {
      const url = `https://bot-api.zaloplatforms.com/bot${this.token}/getUpdates`;
      const body = {
        offset: this.lastUpdateId ? this.lastUpdateId + 1 : 0,
        limit: 20,
        timeout: 30
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(40000)
      });

      const data = await res.json();

      const updates = Array.isArray(data.result) ? data.result : data.result ? [data.result] : [];
      if (data.ok) {
        for (const update of updates) {
          if (update.update_id && update.update_id > this.lastUpdateId) {
            this.lastUpdateId = update.update_id;
          }

          await atomicJSON(this.cursorFile, {lastUpdateId: this.lastUpdateId});
          const msg = update.message;
          if (!msg || !msg.text) continue;

          const senderId = String(msg.from?.id || '');
          const chatId = msg.chat?.id;
          const text = msg.text.trim();



          let cmd;
          try {
            cmd = parseCommand(text);
          } catch (err) {
            await this.send(chatId, `⚠️ ${err.message}`);
            continue;
          }

          if (cmd.type === 'help') {
            await this.send(chatId, `📋 Hướng dẫn lệnh Zalo Video Bot:
- làm các bài đã duyệt: Quét & dựng tất cả video đã duyệt
- /run V001: Dựng ngay video mã V001
- /approve V001: Duyệt kịch bản V001
- /publish V001: Đăng ngay video V001 lên Buffer (TikTok, YouTube, Facebook)
- /publish V001 YYYY-MM-DD HH:mm: Hẹn giờ đăng lên Buffer
- /mode V001 auto: Bật chế độ tự động đăng khi video dựng xong
- /skill V001 <skill>: Đổi skill cho video
- /status: Kiểm tra trạng thái`);
            continue;
          }

          if (cmd.type === 'pair') {
            const code = cmd.payload?.code;
            if (code && this.pairingCode && code === this.pairingCode) {
              this.allowedSenders.add(senderId);
              await this.saveSenders();
              await this.send(chatId, '✅ Ghép nối Zalo Bot thành công! Tài khoản của bạn đã được cấp quyền điều khiển.');
            } else {
              await this.send(chatId, '❌ Mã ghép nối không chính xác. Vui lòng kiểm tra lại.');
            }
            continue;
          }

          // Check if sender is in allowedSenders
          if (!this.allowedSenders.has(senderId)) {
            await this.send(chatId, '⛔ Bạn chưa được cấp quyền điều khiển bot. Vui lòng gửi lệnh: /pair <MÃ_GHÉP_NỐI>');
            continue;
          }

          // Execute authorized command via runner
          await this.send(chatId, `⏳ Đang xử lý lệnh: "${text}"...`);
          try {
            // Enqueue into the real fenced queue. Never swap a running worker's queue.
            await this.runner.queue.enqueue(cmd.type, cmd.payload,
              `zalo:${chatId}:${update.update_id || msg.message_id || Date.now()}`);
            await this.send(chatId, 'Đã đưa yêu cầu vào hàng đợi.');
          } catch (err) {
            await this.send(chatId, `❌ Xử lý thất bại: ${err.message}`);
          }
        }
      }
    } catch (err) {
      // 408 is a normal long-polling timeout
      if (!err.message?.includes('408')) {
        // quiet network reconnect
      }
    }
  }

  async start() {
    await this.init();
    this.running = true;
    console.log(`🤖 Zalo Bot Poller (POST) đã khởi động! Cho phép ${this.allowedSenders.size} người điều khiển.`);
    while (this.running) {
      await this.pollOnce();
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  stop() {
    this.running = false;
  }
}
