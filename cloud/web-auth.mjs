import {HttpError} from '../shared/contracts.mjs';

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256Hex(text) {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return toHex(hashBuffer);
}

export async function verifyPasswordWeb(password, userRecord) {
  if (!userRecord || !userRecord.salt || !userRecord.hash || !userRecord.iterations) return false;
  const passBuffer = new TextEncoder().encode(password);
  const saltBuffer = fromHex(userRecord.salt);
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passBuffer,
    {name: 'PBKDF2'},
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: userRecord.iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256 // 32 bytes * 8
  );

  const derivedHex = toHex(derivedBits);
  return timingSafeEqualStr(derivedHex, userRecord.hash);
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  const pairs = header.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      // A malformed unrelated cookie must not break authentication.
    }
  }
  return cookies;
}

export function makeCookieHeader(name, value, {maxAge = 604800, isHttps = true} = {}) {
  // If HTTPS, use __Host- prefix for maximum cookie security
  const cookieName = isHttps ? `__Host-${name}` : name;
  const parts = [
    `${cookieName}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export function makeClearCookieHeader(name, {isHttps = true} = {}) {
  const cookieName = isHttps ? `__Host-${name}` : name;
  const parts = [
    `${cookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export async function checkRateLimit(sql, bucket) {
  const now = Date.now();
  const row = sql.exec('SELECT attempts, locked_until FROM web_login_attempts WHERE ip_user_bucket=?', bucket).toArray()[0];
  if (row && row.locked_until && row.locked_until > now) {
    const remainingMins = Math.ceil((row.locked_until - now) / 60000);
    throw new HttpError(429, `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau ${remainingMins} phút.`);
  }
}

export async function recordLoginResult(sql, bucket, success) {
  const now = Date.now();
  if (success) {
    sql.exec('DELETE FROM web_login_attempts WHERE ip_user_bucket=?', bucket);
    return;
  }
  const row = sql.exec('SELECT attempts, locked_until FROM web_login_attempts WHERE ip_user_bucket=?', bucket).toArray()[0];
  const previousAttempts = row && (!row.locked_until || row.locked_until > now) ? row.attempts : 0;
  const attempts = previousAttempts + 1;
  const lockedUntil = attempts >= 5 ? now + 15 * 60 * 1000 : null;
  sql.exec(
    'INSERT OR REPLACE INTO web_login_attempts(ip_user_bucket, attempts, locked_until) VALUES(?,?,?)',
    bucket,
    attempts,
    lockedUntil
  );
}

export async function createSession(sql, user, {isHttps = true} = {}) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessionToken = toHex(tokenBytes);
  const tokenHash = await sha256Hex(sessionToken);

  const csrfToken = await sessionCsrfToken(tokenHash);
  const csrfHash = await sha256Hex(csrfToken);

  const now = Date.now();
  const maxAge = 30 * 86400; // Persist the HttpOnly browser session for 30 days.
  const expiresAt = now + maxAge * 1000;

  sql.exec('DELETE FROM web_sessions WHERE expires_at<=?', now);

  sql.exec(
    'INSERT OR REPLACE INTO web_sessions(token_hash, username, role, csrf_hash, expires_at, created_at) VALUES(?,?,?,?,?,?)',
    tokenHash,
    user.username,
    user.role,
    csrfHash,
    expiresAt,
    now
  );

  return {
    sessionToken,
    csrfToken,
    user: {username: user.username, role: user.role},
    cookieHeader: makeCookieHeader('vs_session', sessionToken, {maxAge, isHttps})
  };
}

export async function getSession(sql, cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const token = cookies['__Host-vs_session'] || cookies['vs_session'];
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const row = sql.exec(
    'SELECT username, role, csrf_hash, expires_at FROM web_sessions WHERE token_hash=? AND expires_at>?',
    tokenHash,
    now
  ).toArray()[0];

  if (!row) return null;
  return {
    tokenHash,
    username: row.username,
    role: row.role,
    csrfHash: row.csrf_hash,
    expiresAt: row.expires_at
  };
}

export async function revokeSession(sql, tokenHash) {
  if (!tokenHash) return;
  sql.exec('DELETE FROM web_sessions WHERE token_hash=?', tokenHash);
}

async function sessionCsrfToken(tokenHash) {
  // Stable per session: opening a second tab must not invalidate the first.
  // The raw cookie and its hash are never exposed to browser JavaScript.
  return sha256Hex(`video-studio-csrf:${tokenHash}`);
}

export async function rotateCsrfToken(sql, session) {
  if (!session || !session.tokenHash) return null;
  const csrfToken = await sessionCsrfToken(session.tokenHash);
  const csrfHash = await sha256Hex(csrfToken);
  // This also upgrades sessions created before stable CSRF tokens were added.
  if (session.csrfHash !== csrfHash) {
    sql.exec('UPDATE web_sessions SET csrf_hash=? WHERE token_hash=?', csrfHash, session.tokenHash);
  }
  session.csrfHash = csrfHash;
  return csrfToken;
}

export async function verifyCsrf(session, csrfHeader) {
  if (!session || !session.csrfHash || !csrfHeader) return false;
  const providedHash = await sha256Hex(csrfHeader);
  return timingSafeEqualStr(providedHash, session.csrfHash);
}
