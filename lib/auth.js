const crypto = require('node:crypto');

const COOKIE_NAME = 'lubox_admin_session';
const SESSION_SECONDS = 60 * 60 * 24 * 14;

function timingSafeEqual(value, expected) {
  const a = Buffer.from(String(value));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionSignature(expiresAt) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(String(expiresAt)).digest('base64url');
}

function createSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return {value: `${expiresAt}.${sessionSignature(expiresAt)}`, expiresAt};
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const item = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function hasAdminSession(req) {
  if (!process.env.SESSION_SECRET) return false;
  const value = getCookie(req, COOKIE_NAME);
  const [expiresText, signature] = value.split('.');
  const expiresAt = Number(expiresText);
  if (!expiresAt || expiresAt < Math.floor(Date.now() / 1000) || !signature) return false;
  return timingSafeEqual(signature, sessionSignature(expiresAt));
}

function setSessionCookie(res) {
  const session = createSession();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(session.value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

module.exports = {COOKIE_NAME, hasAdminSession, setSessionCookie, clearSessionCookie, timingSafeEqual};
