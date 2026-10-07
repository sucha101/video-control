import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJSON, readJSON} from './manifest.mjs';
import {resumeDriveUpload} from './drive-upload.mjs';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
];

const tokenRefreshes = new Map();
export async function getAccessToken(credentialsPath, options = {}) {
  const key = path.resolve(credentialsPath);
  if (tokenRefreshes.has(key)) return tokenRefreshes.get(key);
  const task = refreshAccessToken(credentialsPath, options);
  tokenRefreshes.set(key, task);
  try { return await task; } finally { tokenRefreshes.delete(key); }
}
async function refreshAccessToken(credentialsPath, {fetchImpl = fetch} = {}) {
  const creds = await readJSON(credentialsPath, null);
  if (!creds) throw new Error(`Không tìm thấy file Google credentials tại: ${credentialsPath}`);

  // 1. Authorized User OAuth (installed app)
  if (creds.type === 'authorized_user' || creds.refresh_token) {
    if (creds.access_token && creds.expiry_date && creds.expiry_date > Date.now() + 60000) {
      return creds.access_token;
    }

    if (!creds.refresh_token || !creds.client_id || !creds.client_secret) {
      throw new Error('Google OAuth credentials thiếu refresh_token, client_id hoặc client_secret');
    }

    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    if (!res.ok) {
      throw new Error(`Làm mới Google token thất bại (${res.status})`);
    }

    const tokenData = await res.json();
    creds.access_token = tokenData.access_token;
    creds.expiry_date = Date.now() + (tokenData.expires_in || 3600) * 1000;
    await atomicJSON(credentialsPath, creds);
    return creds.access_token;
  }

  // 2. Service Account
  if (creds.type === 'service_account' && creds.private_key) {
    if (creds.access_token && creds.expiry_date && creds.expiry_date > Date.now() + 60000) {
      return creds.access_token;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({alg: 'RS256', typ: 'JWT'})).toString('base64url');
    const claim = Buffer.from(JSON.stringify({
      iss: creds.client_email,
      scope: SCOPES.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    })).toString('base64url');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(creds.private_key, 'base64url');
    const jwt = `${header}.${claim}.${signature}`;

    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Xác thực Service Account thất bại (${res.status}): ${err}`);
    }

    const tokenData = await res.json();
    creds.access_token = tokenData.access_token;
    creds.expiry_date = Date.now() + (tokenData.expires_in || 3600) * 1000;
    await atomicJSON(credentialsPath, creds);
    return creds.access_token;
  }

  throw new Error('Định dạng Google credentials không được hỗ trợ');
}

export class GoogleSheetsClient {
  constructor({spreadsheetId, tab = 'Trang tính1', credentialsPath, fetchImpl = fetch}) {
    this.spreadsheetId = spreadsheetId;
    this.tab = tab;
    this.credentialsPath = credentialsPath;
    this.fetch = fetchImpl;
  }

  async readRows(range = 'A2:P') {
    const token = await getAccessToken(this.credentialsPath, {fetchImpl: this.fetch});
    const fullRange = `${this.tab}!${range}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(fullRange)}?valueRenderOption=FORMATTED_VALUE`;

    const res = await this.fetch(url, {
      headers: {Authorization: `Bearer ${token}`}
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Đọc Google Sheets thất bại (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.values || [];
  }

  async updateRow(rowIndex, rowValues) {
    const token = await getAccessToken(this.credentialsPath, {fetchImpl: this.fetch});
    const sheetRowNumber = rowIndex + 2; // 0-indexed data corresponds to Sheet row 2
    const range = `${this.tab}!A${sheetRowNumber}:P${sheetRowNumber}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

    const res = await this.fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values: [rowValues]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cập nhật dòng ${sheetRowNumber} trên Sheet thất bại (${res.status}): ${err}`);
    }

    return await res.json();
  }

  async appendRow(rowValues) {
    const token = await getAccessToken(this.credentialsPath, {fetchImpl: this.fetch});
    const range = `${this.tab}!A:P`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`;

    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        range,
        majorDimension: 'ROWS',
        values: [rowValues]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Thêm dòng vào Sheet thất bại (${res.status}): ${err}`);
    }

    return await res.json();
  }

  async batchUpdateRanges(data) {
    const token = await getAccessToken(this.credentialsPath, {fetchImpl: this.fetch});
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values:batchUpdate`;

    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: data.map(d => ({
          range: d.range.includes('!') ? d.range : `${this.tab}!${d.range}`,
          majorDimension: 'ROWS',
          values: d.values
        }))
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cập nhật dải ô Google Sheets thất bại (${res.status}): ${err}`);
    }

    return await res.json();
  }
}

export class GoogleDriveClient {
  constructor({folderId, credentialsPath, fetchImpl = fetch}) {
    this.folderId = folderId;
    this.credentialsPath = credentialsPath;
    this.fetch = fetchImpl;
  }

  async uploadResumable({filePath, fileName, checkpoint = {}, onSessionCreated = async () => {}, onProgress = async () => {},
    persistCheckpoint = async () => {}, fence, signal, requestId, inputRevision}) {
    let lastSessionUri = checkpoint.sessionUri;
    return resumeDriveUpload({
      filePath, fileName, folderId: this.folderId, checkpoint, fence, signal, requestId, inputRevision,
      getAccessToken: () => getAccessToken(this.credentialsPath, {fetchImpl: this.fetch}),
      fetchImpl: this.fetch,
      persistCheckpoint: async state => {
        await persistCheckpoint(state);
        if (state.sessionUri && state.sessionUri !== lastSessionUri) {
          lastSessionUri = state.sessionUri;
          await onSessionCreated(state.sessionUri);
        }
        await onProgress({...state, offset: state.committedOffset, fileSize: state.byteLength});
      }
    });
  }
}

export async function startLoopbackOAuth({clientFile, outputFile, port = 8089}) {
  const clientData = JSON.parse(await readFile(clientFile, 'utf8'));
  const config = clientData.installed || clientData.web;
  if (!config) throw new Error('File Google OAuth Client JSON không đúng định dạng');

  const {client_id, client_secret} = config;
  const redirectUri = `http://localhost:${port}`;

  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, `http://localhost:${port}`);
        const queryState = u.searchParams.get('state');
        const code = u.searchParams.get('code');

        if (!code) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        if (queryState !== state || !code) {
          res.writeHead(400);
          res.end('Lỗi xác thực OAuth: state không khớp hoặc thiếu code');
          server.close();
          reject(new Error('OAuth state mismatch or code missing'));
          return;
        }

        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({
            client_id,
            client_secret,
            code,
            code_verifier: codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          })
        });

        if (!tokenRes.ok) {
          const err = await tokenRes.text();
          res.writeHead(500);
          res.end(`Lỗi đổi token: ${err}`);
          server.close();
          reject(new Error(`Token exchange failed: ${err}`));
          return;
        }

        const tokens = await tokenRes.json();
        const saved = {
          type: 'authorized_user',
          client_id,
          client_secret,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          expiry_date: Date.now() + (tokens.expires_in || 3600) * 1000
        };

        await atomicJSON(outputFile, saved);

        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.end('<h1>Xác thực Google thành công!</h1><p>Bạn có thể đóng cửa sổ này và quay lại terminal.</p>');
        server.close();
        resolve(saved);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`\n=== Vui lòng mở link sau trong trình duyệt để cấp quyền Google: ===\n\n${authUrl.toString()}\n`);
    });
  });
}
