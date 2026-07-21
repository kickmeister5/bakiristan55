/*
  Fındık Hesabı API — Cloudflare Worker + D1
  Bu dosya bilerek mevcut statik Worker'ı değiştirmez. Kurulum tamamlandığında
  wrangler.account.example.jsonc içindeki yapılandırmayla `worker.js` olarak kullanılır.
*/

const json = (data, init = {}) => new Response(JSON.stringify(data), {
  status: init.status || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...init.headers }
});
const now = () => Date.now();
const encoder = new TextEncoder();
const id = () => crypto.randomUUID();
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function getCookie(request, key) {
  return (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(key + '='))?.slice(key.length + 1) || null;
}
function validUsername(value) { return /^[a-zA-Z0-9_]{2,40}$/.test(value); }
function publicProfile(row) { return row ? { kickUsername: row.kick_username, displayName: row.display_name || row.kick_username, coins: Number(row.coins || 0) } : null; }

async function accountFromSession(request, env) {
  const raw = getCookie(request, 'findik_session');
  if (!raw) return null;
  const token = await digest(raw + env.SESSION_PEPPER);
  const row = await env.FINDIK_DB.prepare(`SELECT u.kick_username,u.display_name,u.coins
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(token, now()).first();
  return row || null;
}
async function issueSession(userId, env) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...raw)).replace(/[+/=]/g, '');
  const tokenHash = await digest(secret + env.SESSION_PEPPER);
  const expires = now() + 1000 * 60 * 60 * 24 * 30;
  await env.FINDIK_DB.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
    .bind(id(), userId, tokenHash, expires, now()).run();
  return cookie('findik_session', secret, 60 * 60 * 24 * 30);
}
function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return [...bytes].map(v => alphabet[v % alphabet.length]).join('');
}
async function requestVerification(request, env) {
  const body = await request.json().catch(() => null);
  const kickUsername = String(body?.kickUsername || '').trim().replace(/^@/, '');
  if (!validUsername(kickUsername)) return json({ error: 'Geçerli bir Kick kullanıcı adı yaz.' }, { status: 400 });
  const normalized = kickUsername.toLowerCase();
  const recent = await env.FINDIK_DB.prepare(`SELECT created_at FROM verification_requests
    WHERE kick_username_normalized=? ORDER BY created_at DESC LIMIT 1`).bind(normalized).first();
  if (recent && now() - Number(recent.created_at) < 60_000) return json({ error: 'Yeni kod için bir dakika bekle.' }, { status: 429 });
  const requestId = id(), code = randomCode(), expiresAt = now() + 5 * 60_000;
  const codeHash = await digest(code + env.CODE_PEPPER);
  await env.FINDIK_DB.prepare(`INSERT INTO verification_requests
    (id,kick_username,kick_username_normalized,code_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)`)
    .bind(requestId, kickUsername, normalized, codeHash, expiresAt, now()).run();
  return json({ requestId, message: `!findik ${code}`, expiresInMinutes: 5 });
}

const KICK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;
function fromBase64(value) { const s = atob(value); return Uint8Array.from(s, char => char.charCodeAt(0)); }
async function verifyKickWebhook(request, rawBody) {
  const messageId = request.headers.get('Kick-Event-Message-Id');
  const timestamp = request.headers.get('Kick-Event-Message-Timestamp');
  const signature = request.headers.get('Kick-Event-Signature');
  if (!messageId || !timestamp || !signature) return false;
  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now() - sentAt) > 5 * 60_000) return false;
  const keyData = fromBase64(KICK_PUBLIC_KEY.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, ''));
  const key = await crypto.subtle.importKey('spki', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = `${messageId}.${timestamp}.${rawBody}`;
  return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, fromBase64(signature), encoder.encode(signed));
}
async function verificationStatus(request, env) {
  const requestId = new URL(request.url).searchParams.get('requestId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: 'Geçersiz istek.' }, { status: 400 });
  const entry = await env.FINDIK_DB.prepare('SELECT verified_user_id,expires_at FROM verification_requests WHERE id=?').bind(requestId).first();
  if (!entry) return json({ error: 'Doğrulama isteği bulunamadı.' }, { status: 404 });
  if (!entry.verified_user_id) return json({ verified: false, expired: Number(entry.expires_at) < now() });
  const user = await env.FINDIK_DB.prepare('SELECT kick_username,display_name,coins FROM users WHERE id=?').bind(entry.verified_user_id).first();
  const session = await issueSession(entry.verified_user_id, env);
  return json({ verified: true, profile: publicProfile(user) }, { headers: { 'set-cookie': session } });
}

/* Bu endpoint yalnızca Kick'in imzalı chat.message.sent webhook'u içindir. */
async function receiveKickEvent(request, env) {
  const rawBody = await request.text();
  const verified = await verifyKickWebhook(request, rawBody).catch(() => false);
  if (!verified) return json({ error: 'Geçersiz webhook imzası.' }, { status: 401 });
  const event = JSON.parse(rawBody || 'null');
  const message = String(event?.data?.content || event?.content || '').trim();
  const sender = event?.data?.sender || event?.sender || {};
  const kickUserId = String(sender?.user_id || sender?.id || '');
  const username = String(sender?.username || '').trim();
  const matched = /^!findik\s+([A-Z2-9]{7})$/i.exec(message);
  if (!matched || !kickUserId || !validUsername(username)) return json({ ok: true });
  const codeHash = await digest(matched[1].toUpperCase() + env.CODE_PEPPER);
  const pending = await env.FINDIK_DB.prepare(`SELECT * FROM verification_requests
    WHERE code_hash=? AND verified_user_id IS NULL AND expires_at>? LIMIT 1`).bind(codeHash, now()).first();
  if (!pending || pending.kick_username_normalized !== username.toLowerCase()) return json({ ok: true });
  const userId = id();
  // Kimliği kullanıcı adıyla değil Kick'in değişmeyen kullanıcı ID'siyle bağlarız.
  // Böylece eski bir kullanıcı adı başka bir hesaba geçerse profil devralınamaz.
  const existing = await env.FINDIK_DB.prepare('SELECT id FROM users WHERE kick_user_id=?').bind(kickUserId).first();
  const nameOwner = await env.FINDIK_DB.prepare('SELECT id FROM users WHERE kick_username_normalized=?').bind(username.toLowerCase()).first();
  if (!existing && nameOwner) return json({ ok: true });
  const finalUserId = existing?.id || userId;
  const statements = [];
  if (!existing) {
    statements.push(env.FINDIK_DB.prepare(`INSERT INTO users(id,kick_user_id,kick_username,kick_username_normalized,display_name,coins,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(userId, kickUserId, username, username.toLowerCase(), username, 100, now()));
    statements.push(env.FINDIK_DB.prepare(`INSERT INTO coin_ledger(id,user_id,amount,reason,created_at)
      VALUES(?,?,?,?,?)`).bind(id(), userId, 100, 'welcome_bonus', now()));
  } else {
    statements.push(env.FINDIK_DB.prepare('UPDATE users SET kick_username=?,kick_username_normalized=?,display_name=? WHERE id=?')
      .bind(username, username.toLowerCase(), username, finalUserId));
  }
  statements.push(env.FINDIK_DB.prepare('UPDATE verification_requests SET verified_user_id=?,verified_at=? WHERE id=? AND verified_user_id IS NULL')
    .bind(finalUserId, now(), pending.id));
  await env.FINDIK_DB.batch(statements);
  return json({ ok: true });
}

/* Geçici topluluk modu: VMYM/Tabu'daki tarayıcı sohbet gözleminden gelen onay.
   Resmî webhook bağlandığında /kick-event doğrulaması bu akışın yerini alabilir. */
async function confirmFromChatClient(request, env) {
  const body = await request.json().catch(() => null);
  const requestId = String(body?.requestId || '');
  const username = String(body?.kickUsername || '').trim().replace(/^@/, '');
  const kickUserId = String(body?.kickUserId || '').trim();
  const message = String(body?.message || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !validUsername(username) || !/^[0-9]+$/.test(kickUserId)) {
    return json({ error: 'Sohbet doğrulama bilgisi geçersiz.' }, { status: 400 });
  }
  const match = /^!findik\s+([A-Z2-9]{7})$/i.exec(message);
  if (!match) return json({ error: 'Onay mesajı bulunamadı.' }, { status: 400 });
  const pending = await env.FINDIK_DB.prepare(`SELECT * FROM verification_requests
    WHERE id=? AND verified_user_id IS NULL AND expires_at>?`).bind(requestId, now()).first();
  if (!pending || pending.kick_username_normalized !== username.toLowerCase()) {
    return json({ error: 'Bu kod için geçerli bir doğrulama isteği yok.' }, { status: 400 });
  }
  if ((await digest(match[1].toUpperCase() + env.CODE_PEPPER)) !== pending.code_hash) {
    return json({ error: 'Kod eşleşmedi.' }, { status: 400 });
  }
  const existing = await env.FINDIK_DB.prepare('SELECT id FROM users WHERE kick_user_id=?').bind(kickUserId).first();
  const nameOwner = await env.FINDIK_DB.prepare('SELECT id FROM users WHERE kick_username_normalized=?').bind(username.toLowerCase()).first();
  if (!existing && nameOwner) return json({ error: 'Bu Kick kullanıcı adı başka bir profile bağlı.' }, { status: 409 });
  const userId = existing?.id || id(), statements=[];
  if (!existing) {
    statements.push(env.FINDIK_DB.prepare(`INSERT INTO users(id,kick_user_id,kick_username,kick_username_normalized,display_name,coins,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(userId,kickUserId,username,username.toLowerCase(),username,100,now()));
    statements.push(env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)')
      .bind(id(),userId,100,'welcome_bonus',now()));
  }
  statements.push(env.FINDIK_DB.prepare('UPDATE verification_requests SET verified_user_id=?,verified_at=? WHERE id=? AND verified_user_id IS NULL')
    .bind(userId,now(),pending.id));
  await env.FINDIK_DB.batch(statements);
  const profile=await env.FINDIK_DB.prepare('SELECT kick_username,display_name,coins FROM users WHERE id=?').bind(userId).first();
  return json({ verified:true,profile:publicProfile(profile) },{headers:{'set-cookie':await issueSession(userId,env)}});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/account')) return env.ASSETS.fetch(request);
    if (request.method === 'POST' && url.pathname === '/api/account/request') return requestVerification(request, env);
    if (request.method === 'GET' && url.pathname === '/api/account/status') return verificationStatus(request, env);
    if (request.method === 'POST' && url.pathname === '/api/account/kick-event') return receiveKickEvent(request, env);
    if (request.method === 'POST' && url.pathname === '/api/account/client-confirm') return confirmFromChatClient(request, env);
    if (request.method === 'GET' && url.pathname === '/api/account/me') return json({ profile: publicProfile(await accountFromSession(request, env)) });
    if (request.method === 'POST' && url.pathname === '/api/account/logout') {
      const raw = getCookie(request, 'findik_session');
      if (raw) await env.FINDIK_DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(raw + env.SESSION_PEPPER)).run();
      return json({ ok: true }, { headers: { 'set-cookie': cookie('findik_session', '', 0) } });
    }
    return json({ error: 'Bulunamadı.' }, { status: 404 });
  }
};
