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

// Test kurulumu: D1 Console'da parça parça SQL çalıştırmaya gerek kalmadan eksik tabloları oluşturur.
let schemaReady = null;
function ensureSchema(env) {
  if (schemaReady) return schemaReady;
  const sql = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,kick_user_id TEXT NOT NULL UNIQUE,kick_username TEXT NOT NULL,kick_username_normalized TEXT NOT NULL UNIQUE,display_name TEXT,coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS verification_requests (id TEXT PRIMARY KEY,kick_username TEXT NOT NULL,kick_username_normalized TEXT NOT NULL,code_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,verified_user_id TEXT REFERENCES users(id),verified_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_verify_name_created ON verification_requests(kick_username_normalized, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)`,
    `CREATE TABLE IF NOT EXISTS coin_ledger (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id, reason))`,
    `CREATE TABLE IF NOT EXISTS daily_claims (user_id TEXT NOT NULL REFERENCES users(id),claimed_day TEXT NOT NULL,claimed_at INTEGER NOT NULL,PRIMARY KEY(user_id, claimed_day))`,
    `CREATE TABLE IF NOT EXISTS pending_game_rewards (id TEXT PRIMARY KEY,kick_username TEXT NOT NULL,kick_username_normalized TEXT NOT NULL,amount INTEGER NOT NULL CHECK (amount > 0),reason TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(kick_username_normalized,reason))`,
    `CREATE INDEX IF NOT EXISTS idx_pending_game_rewards_user ON pending_game_rewards(kick_username_normalized,created_at)`,    `CREATE TABLE IF NOT EXISTS shop_products (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',image_url TEXT NOT NULL DEFAULT '',price INTEGER NOT NULL CHECK (price >= 0),stock INTEGER,active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_shop_products_active ON shop_products(active, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS shop_purchases (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES shop_products(id),product_name TEXT NOT NULL,unit_price INTEGER NOT NULL CHECK (unit_price >= 0),customer_name TEXT NOT NULL DEFAULT '',shipping_address TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shop_purchases_created ON shop_purchases(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash)`,
    `CREATE TABLE IF NOT EXISTS slot_config (id TEXT PRIMARY KEY,win_rate INTEGER NOT NULL DEFAULT 20 CHECK (win_rate BETWEEN 0 AND 100),cascade_rate INTEGER NOT NULL DEFAULT 10 CHECK (cascade_rate BETWEEN 0 AND 100),updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS slot_symbols (id TEXT PRIMARY KEY,name TEXT NOT NULL,image_url TEXT NOT NULL DEFAULT '',multiplier REAL NOT NULL CHECK (multiplier > 0),active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),sort_order INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_slot_symbols_active ON slot_symbols(active, sort_order)`,
    `CREATE TABLE IF NOT EXISTS slot_symbol_rarity (symbol_id TEXT PRIMARY KEY,rarity INTEGER NOT NULL DEFAULT 1 CHECK (rarity BETWEEN 1 AND 10000))`,    `CREATE TABLE IF NOT EXISTS slot_highscores (user_id TEXT PRIMARY KEY REFERENCES users(id),username TEXT NOT NULL,best_payout INTEGER NOT NULL DEFAULT 0 CHECK (best_payout >= 0),updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS slot_bonus_config (id TEXT PRIMARY KEY,chance INTEGER NOT NULL DEFAULT 10 CHECK (chance BETWEEN 0 AND 100),updated_at INTEGER NOT NULL)`, `CREATE TABLE IF NOT EXISTS slot_media_config (id TEXT PRIMARY KEY,music_url TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS slot_x_symbols (id TEXT PRIMARY KEY,name TEXT NOT NULL,image_url TEXT NOT NULL DEFAULT '',multiplier REAL NOT NULL CHECK (multiplier > 0),rarity INTEGER NOT NULL DEFAULT 1 CHECK (rarity BETWEEN 1 AND 10000),active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),sort_order INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_slot_x_symbols_active ON slot_x_symbols(active, sort_order)`,    `CREATE INDEX IF NOT EXISTS idx_slot_highscores_best ON slot_highscores(best_payout DESC)`
  ];
  schemaReady = env.FINDIK_DB.batch(sql.map(statement => env.FINDIK_DB.prepare(statement))).catch(error => { schemaReady=null; throw error; });
  return schemaReady;
}

function dailyKey(){ return new Date(now()+3*60*60*1000).toISOString().slice(0,10); }
async function claimDailyBonus(request, env) {
  const user=await accountFromSession(request,env);
  if(!user)return json({error:'Günlük hediyeyi almak için hesabına giriş yapmalısın.'},{status:401});
  const day=dailyKey(), reward=100;
  const claim=await env.FINDIK_DB.prepare('INSERT OR IGNORE INTO daily_claims(user_id,claimed_day,claimed_at) VALUES(?,?,?)').bind(user.id,day,now()).run();
  if(!claim.meta?.changes){const fresh=await env.FINDIK_DB.prepare('SELECT kick_username,display_name,coins FROM users WHERE id=?').bind(user.id).first();return json({ok:true,claimed:false,day,profile:publicProfile(fresh)});}
  const ledgerId=id();await env.FINDIK_DB.batch([env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(reward,user.id),env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(ledgerId,user.id,reward,'daily_bonus:'+day,now())]);
  const fresh=await env.FINDIK_DB.prepare('SELECT kick_username,display_name,coins FROM users WHERE id=?').bind(user.id).first();return json({ok:true,claimed:true,reward,day,profile:publicProfile(fresh)});
}

async function accountFromSession(request, env) {
  const raw = getCookie(request, 'findik_session');
  if (!raw) return null;
  const token = await digest(raw + env.SESSION_PEPPER);
  const row = await env.FINDIK_DB.prepare(`SELECT u.id,u.kick_username,u.display_name,u.coins
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(token, now()).first();
  return row || null;
}
async function adminFromSession(request, env) {
  const raw = getCookie(request, 'findik_admin_session');
  if (!raw) return false;
  const token = await digest(raw + env.SESSION_PEPPER);
  const row = await env.FINDIK_DB.prepare('SELECT id FROM admin_sessions WHERE token_hash=? AND expires_at>?')
    .bind(token, now()).first();
  return !!row;
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
async function issueAdminSession(env) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...raw)).replace(/[+/=]/g, '');
  const tokenHash = await digest(secret + env.SESSION_PEPPER);
  const expires = now() + 1000 * 60 * 60 * 12;
  await env.FINDIK_DB.prepare('INSERT INTO admin_sessions(id,token_hash,expires_at,created_at) VALUES(?,?,?,?)')
    .bind(id(), tokenHash, expires, now()).run();
  return cookie('findik_admin_session', secret, 60 * 60 * 12);
}
function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return [...bytes].map(v => alphabet[v % alphabet.length]).join('');
}
async function claimPendingGameRewards(env,userId,normalized){
  const {results=[]}=await env.FINDIK_DB.prepare('SELECT id,amount,reason FROM pending_game_rewards WHERE kick_username_normalized=? ORDER BY created_at').bind(normalized).all();
  if(!results.length)return 0;
  const total=results.reduce((sum,row)=>sum+Number(row.amount||0),0),statements=[env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(total,userId)];
  for(const reward of results)statements.push(env.FINDIK_DB.prepare('INSERT OR IGNORE INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(id(),userId,Number(reward.amount),'pending_game_reward:'+reward.id,now()));
  statements.push(env.FINDIK_DB.prepare('DELETE FROM pending_game_rewards WHERE kick_username_normalized=?').bind(normalized));
  await env.FINDIK_DB.batch(statements);
  return total;
}async function requestVerification(request, env) {
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
  // Yalnızca TEST_AUTO_APPROVE=true açıkça tanımlanırsa kullanılan test kolaylığı.
  if (env.TEST_AUTO_APPROVE === 'true') {
    const testKickId = `test:${normalized}`;
    const existing = await env.FINDIK_DB.prepare('SELECT id FROM users WHERE kick_user_id=?').bind(testKickId).first();
    const nameOwner = await env.FINDIK_DB.prepare('SELECT id FROM users WHERE kick_username_normalized=?').bind(normalized).first();
    if (!existing && nameOwner) return json({ error: 'Bu kullanıcı adı başka bir profile bağlı.' }, { status: 409 });
    const userId = existing?.id || id(), statements=[];
    if (!existing) {
      statements.push(env.FINDIK_DB.prepare(`INSERT INTO users(id,kick_user_id,kick_username,kick_username_normalized,display_name,coins,created_at)
        VALUES(?,?,?,?,?,?,?)`).bind(userId,testKickId,kickUsername,normalized,kickUsername,100,now()));
      statements.push(env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)')
        .bind(id(),userId,100,'welcome_bonus',now()));
    }
    statements.push(env.FINDIK_DB.prepare('UPDATE verification_requests SET verified_user_id=?,verified_at=? WHERE id=?')
      .bind(userId,now(),requestId));
    await env.FINDIK_DB.batch(statements);
    await claimPendingGameRewards(env,userId,normalized);
    const profile = await env.FINDIK_DB.prepare('SELECT kick_username,display_name,coins FROM users WHERE id=?').bind(userId).first();
    return json({ requestId, verified:true, profile:publicProfile(profile) }, { headers:{ 'set-cookie':await issueSession(userId,env) } });
  }
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
  await claimPendingGameRewards(env,finalUserId,username.toLowerCase());
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
  await claimPendingGameRewards(env,userId,username.toLowerCase());
  const profile=await env.FINDIK_DB.prepare('SELECT kick_username,display_name,coins FROM users WHERE id=?').bind(userId).first();
  return json({ verified:true,profile:publicProfile(profile) },{headers:{'set-cookie':await issueSession(userId,env)}});
}

function requireAccount(row) {
  return row ? null : json({ error: 'Bu işlem için hesabına giriş yapmalısın.' }, { status: 401 });
}
async function listShopProducts(env, includeInactive=false) {
  const where = includeInactive ? '' : 'WHERE active=1';
  const { results=[] } = await env.FINDIK_DB.prepare(`SELECT id,name,description,image_url,price,stock,active,created_at,updated_at
    FROM shop_products ${where} ORDER BY created_at DESC`).all();
  return results.map(p => ({ ...p, price:Number(p.price), stock:p.stock===null?null:Number(p.stock), active:!!p.active }));
}
async function shopHistory(request, env) {
  const user = await accountFromSession(request, env);
  const missing = requireAccount(user); if (missing) return missing;
  const [purchases, ledger] = await Promise.all([
    env.FINDIK_DB.prepare(`SELECT id,product_name,unit_price,created_at FROM shop_purchases WHERE user_id=? ORDER BY created_at DESC LIMIT 60`).bind(user.id).all(),
    env.FINDIK_DB.prepare(`SELECT id,amount,reason,created_at FROM coin_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 80`).bind(user.id).all()
  ]);
  return json({ profile:publicProfile(user), purchases:(purchases.results||[]).map(x=>({...x,unit_price:Number(x.unit_price)})), ledger:ledger.results||[] });
}
async function buyProduct(request, env) {
  const user = await accountFromSession(request, env);
  const missing = requireAccount(user); if (missing) return missing;
  const body = await request.json().catch(()=>null);
  const productId = String(body?.productId || '');
  const customerName=String(body?.fullName||'').trim().replace(/\s+/g,' ').slice(0,100);
  const address=String(body?.address||'').trim().replace(/\s+/g,' ').slice(0,500);
  const phone=String(body?.phone||'').trim().replace(/[^0-9+]/g,'').slice(0,20);
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return json({ error:'Ürün bulunamadı.' },{status:400});
  if(customerName.length<3||address.length<10||phone.replace(/\D/g,'').length<10)return json({error:'Ad soyad, geçerli telefon ve açık adres yazmalısın.'},{status:400});
  const product = await env.FINDIK_DB.prepare('SELECT id,name,price,stock,active FROM shop_products WHERE id=?').bind(productId).first();
  if (!product || !product.active) return json({ error:'Bu ürün artık satışta değil.' },{status:404});
  if (product.stock !== null && Number(product.stock) < 1) return json({ error:'Bu ürün tükendi.' },{status:409});
  const price = Number(product.price);
  const paid = await env.FINDIK_DB.prepare('UPDATE users SET coins=coins-? WHERE id=? AND coins>=?').bind(price,user.id,price).run();
  if (!paid.meta?.changes) return json({ error:'Yeterli Fındık Coin bulunmuyor.' },{status:409});
  if (product.stock !== null) {
    const stock = await env.FINDIK_DB.prepare('UPDATE shop_products SET stock=stock-1,updated_at=? WHERE id=? AND stock>0 AND active=1').bind(now(),product.id).run();
    if (!stock.meta?.changes) {
      await env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(price,user.id).run();
      return json({ error:'Ürün az önce tükendi; coinlerin iade edildi.' },{status:409});
    }
  }
  const purchaseId=id();
  try {
    await env.FINDIK_DB.batch([
      env.FINDIK_DB.prepare('INSERT INTO shop_purchases(id,user_id,product_id,product_name,unit_price,customer_name,shipping_address,phone,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(purchaseId,user.id,product.id,product.name,price,customerName,address,phone,now()),
      env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(id(),user.id,-price,`shop_purchase:${purchaseId}`,now())
    ]);
  } catch (error) {
    await env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(price,user.id).run();
    if (product.stock !== null) await env.FINDIK_DB.prepare('UPDATE shop_products SET stock=stock+1,updated_at=? WHERE id=?').bind(now(),product.id).run();
    throw error;
  }
  const refreshed=await env.FINDIK_DB.prepare('SELECT id,kick_username,display_name,coins FROM users WHERE id=?').bind(user.id).first();
  return json({ ok:true, profile:publicProfile(refreshed), purchase:{id:purchaseId,name:product.name,price} });
}
// Test sürecinde yönetim API'leri şifresizdir. Canlı açılıştan önce admin oturumu yeniden etkinleştirilecek.
async function adminLogin(request, env) { return json({ ok:true }); }
async function requireAdmin(request, env) { return null; }
async function adminProducts(request, env) {
  const denied=await requireAdmin(request,env); if(denied)return denied;
  if(request.method==='GET') return json({items:await listShopProducts(env,true)});
  const body=await request.json().catch(()=>null), item=body?.item||{};
  const name=String(item.name||'').trim().slice(0,80), description=String(item.description||'').trim().slice(0,400), imageUrl=String(item.imageUrl||'').trim().slice(0,1200);
  const price=Number(item.price), stock=item.stock===''||item.stock===null||item.stock===undefined?null:Number(item.stock);
  if(!name||!Number.isInteger(price)||price<0||!Number.isInteger(stock??0)||stock!==null&&stock<0)return json({error:'Ürün adı, fiyatı ve stok bilgisi geçersiz.'},{status:400});
  const itemId=String(item.id||'');
  if(itemId&&/^[0-9a-f-]{36}$/i.test(itemId)){
    await env.FINDIK_DB.prepare('UPDATE shop_products SET name=?,description=?,image_url=?,price=?,stock=?,active=?,updated_at=? WHERE id=?').bind(name,description,imageUrl,price,stock,item.active===false?0:1,now(),itemId).run();
  } else {
    await env.FINDIK_DB.prepare('INSERT INTO shop_products(id,name,description,image_url,price,stock,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id(),name,description,imageUrl,price,stock,item.active===false?0:1,now(),now()).run();
  }
  return json({ok:true,items:await listShopProducts(env,true)});
}
async function adminProductStatus(request, env) {
  const denied=await requireAdmin(request,env);if(denied)return denied;
  const body=await request.json().catch(()=>null), productId=String(body?.productId||'');
  if(!/^[0-9a-f-]{36}$/i.test(productId))return json({error:'Ürün bulunamadı.'},{status:400});
  await env.FINDIK_DB.prepare('UPDATE shop_products SET active=0,updated_at=? WHERE id=?').bind(now(),productId).run();
  return json({ok:true,items:await listShopProducts(env,true)});
}
async function adminCoinAdjustment(request, env) {
  const denied=await requireAdmin(request,env);if(denied)return denied;
  const body=await request.json().catch(()=>null), username=String(body?.username||'').trim().replace(/^@/,'').toLowerCase(), amount=Number(body?.amount), note=String(body?.note||'manuel coin işlemi').trim().slice(0,160);
  if(!validUsername(username)||!Number.isInteger(amount)||amount===0||Math.abs(amount)>1000000)return json({error:'Kullanıcı adı veya coin miktarı geçersiz.'},{status:400});
  const user=await env.FINDIK_DB.prepare('SELECT id,kick_username,coins FROM users WHERE kick_username_normalized=?').bind(username).first();
  if(!user)return json({error:'Bu kullanıcı adına ait hesap bulunamadı.'},{status:404});
  const result= amount<0
    ? await env.FINDIK_DB.prepare('UPDATE users SET coins=coins-? WHERE id=? AND coins>=?').bind(-amount,user.id,-amount).run()
    : await env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(amount,user.id).run();
  if(!result.meta?.changes)return json({error:'Kullanıcının bakiyesi bu kesinti için yeterli değil.'},{status:409});
  const ledgerId=id();
  await env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(ledgerId,user.id,amount,`admin:${note}:${ledgerId}`,now()).run();
  const fresh=await env.FINDIK_DB.prepare('SELECT coins FROM users WHERE id=?').bind(user.id).first();
  return json({ok:true,user:{username:user.kick_username,coins:Number(fresh.coins)}});
}
async function adminLogs(request, env) {
  const denied=await requireAdmin(request,env);if(denied)return denied;
  const q=(new URL(request.url).searchParams.get('q')||'').trim().toLowerCase();
  const like=`%${q}%`;
  const [users,purchases,ledger]=await Promise.all([
    env.FINDIK_DB.prepare(`SELECT kick_username,display_name,coins,created_at FROM users WHERE kick_username_normalized LIKE ? ORDER BY created_at DESC LIMIT 30`).bind(like).all(),
    env.FINDIK_DB.prepare(`SELECT p.id,p.product_name,p.unit_price,p.created_at,u.kick_username FROM shop_purchases p JOIN users u ON u.id=p.user_id WHERE u.kick_username_normalized LIKE ? OR p.product_name LIKE ? ORDER BY p.created_at DESC LIMIT 80`).bind(like,like).all(),
    env.FINDIK_DB.prepare(`SELECT l.id,l.amount,l.reason,l.created_at,u.kick_username FROM coin_ledger l JOIN users u ON u.id=l.user_id WHERE u.kick_username_normalized LIKE ? OR l.reason LIKE ? ORDER BY l.created_at DESC LIMIT 100`).bind(like,like).all()
  ]);
  return json({users:users.results||[],purchases:purchases.results||[],ledger:ledger.results||[]});
}
async function adminDeleteUser(request,env){
  const denied=await requireAdmin(request,env);if(denied)return denied;
  const body=await request.json().catch(()=>null),username=String(body?.username||'').trim().replace(/^@/,'').toLowerCase();
  if(!validUsername(username))return json({error:'Geçerli bir kullanıcı adı yaz.'},{status:400});
  const user=await env.FINDIK_DB.prepare('SELECT id,kick_username FROM users WHERE kick_username_normalized=?').bind(username).first();
  if(!user)return json({error:'Kullanıcı bulunamadı.'},{status:404});
  await env.FINDIK_DB.batch([
    env.FINDIK_DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
    env.FINDIK_DB.prepare('DELETE FROM coin_ledger WHERE user_id=?').bind(user.id),
    env.FINDIK_DB.prepare('DELETE FROM slot_highscores WHERE user_id=?').bind(user.id),
    env.FINDIK_DB.prepare('DELETE FROM shop_purchases WHERE user_id=?').bind(user.id),
    env.FINDIK_DB.prepare('DELETE FROM verification_requests WHERE verified_user_id=? OR kick_username_normalized=?').bind(user.id,username),
    env.FINDIK_DB.prepare('DELETE FROM users WHERE id=?').bind(user.id)
  ]);
  return json({ok:true,username:user.kick_username});
}async function adminOrders(request, env) {
  const denied=await requireAdmin(request,env);if(denied)return denied;
  const q=(new URL(request.url).searchParams.get('q')||'').trim().toLowerCase(),like=`%${q}%`;
  const {results=[]}=await env.FINDIK_DB.prepare(`SELECT p.id,p.product_name,p.unit_price,p.customer_name,p.shipping_address,p.phone,p.created_at,u.kick_username,u.display_name
    FROM shop_purchases p JOIN users u ON u.id=p.user_id
    WHERE u.kick_username_normalized LIKE ? OR p.product_name LIKE ? OR p.customer_name LIKE ? OR p.phone LIKE ? OR p.shipping_address LIKE ?
    ORDER BY p.created_at DESC LIMIT 150`).bind(like,like,like,like,like).all();
  return json({orders:results.map(x=>({...x,unit_price:Number(x.unit_price)}))});
}
const DEFAULT_SLOT_SYMBOLS=[
  {id:'nut',name:'Fındık',image_url:'FC.png',multiplier:3,rarity:20,active:true,sort_order:0},
  {id:'star',name:'Yıldız',image_url:'',multiplier:5,rarity:20,active:true,sort_order:1},
  {id:'gem',name:'Elmas',image_url:'',multiplier:8,rarity:20,active:true,sort_order:2},
  {id:'crown',name:'Taç',image_url:'',multiplier:12,rarity:20,active:true,sort_order:3},
  {id:'berry',name:'Kiraz',image_url:'',multiplier:10,rarity:20,active:true,sort_order:4}
];async function getSlotConfig(env,includeInactive=false){
  try {
    const config=await env.FINDIK_DB.prepare('SELECT win_rate,cascade_rate FROM slot_config WHERE id=?').bind('main').first();
    const bonusConfig=await env.FINDIK_DB.prepare('SELECT chance FROM slot_bonus_config WHERE id=?').bind('main').first();
    const mediaConfig=await env.FINDIK_DB.prepare('SELECT music_url FROM slot_media_config WHERE id=?').bind('main').first();
    const where=includeInactive?'':'WHERE s.active=1';
    const {results=[]}=await env.FINDIK_DB.prepare(`SELECT s.id,s.name,s.image_url,s.multiplier,s.active,s.sort_order,COALESCE(r.rarity,1) AS rarity FROM slot_symbols s LEFT JOIN slot_symbol_rarity r ON r.symbol_id=s.id ${where} ORDER BY s.sort_order,s.created_at`).all();
    const saved=results.map(x=>({id:x.id,name:x.name,image_url:x.image_url==='findik-logo.png'?'FC.png':(x.image_url||''),multiplier:Number(x.multiplier),rarity:Math.max(1,Number(x.rarity||1)),active:!!x.active}));
    const known=new Set(saved.map(x=>x.id));
    const symbols=saved.concat(DEFAULT_SLOT_SYMBOLS.filter(x=>!known.has(x.id))).slice(0,Math.max(5,saved.length));
    const {results:xRows=[]}=await env.FINDIK_DB.prepare('SELECT id,name,image_url,multiplier,rarity,active FROM slot_x_symbols ORDER BY sort_order,created_at').all();
    const xAll=xRows.map(x=>({id:x.id,name:x.name,image_url:x.image_url||'',multiplier:Number(x.multiplier),rarity:Math.max(1,Number(x.rarity||1)),active:!!x.active}));
    const xSymbols=(xAll.length?xAll:DEFAULT_X_SYMBOLS.map(x=>({...x}))).filter(x=>includeInactive||x.active!==false);
    return {winRate:config?Number(config.win_rate):20,cascadeRate:config?Number(config.cascade_rate):10,xChance:bonusConfig?Number(bonusConfig.chance):10,musicUrl:mediaConfig?.music_url||'',symbols,xSymbols,storageReady:true};
  } catch (error) {
    return {winRate:20,cascadeRate:10,xChance:10,symbols:DEFAULT_SLOT_SYMBOLS.map(x=>({...x})),xSymbols:DEFAULT_X_SYMBOLS.map(x=>({...x})),storageReady:false};
  }
}function randomIndex(max){const bytes=crypto.getRandomValues(new Uint32Array(1));return bytes[0]%max}
function shuffle(items){for(let i=items.length-1;i>0;i--){const j=randomIndex(i+1);[items[i],items[j]]=[items[j],items[i]]}return items}
function weightedPick(items){const total=items.reduce((sum,item)=>sum+Math.max(1,Math.round(Number(item.rarity)||1)),0);let roll=randomIndex(total);for(const item of items){roll-=Math.max(1,Math.round(Number(item.rarity)||1));if(roll<0)return item}return items[items.length-1]}
function slotLossGrid(symbols){const counts=new Map(),grid=[];while(grid.length<30){const possible=symbols.filter(x=>(counts.get(x.id)||0)<7);const pick=weightedPick(possible);grid.push(pick.id);counts.set(pick.id,(counts.get(pick.id)||0)+1)}return shuffle(grid)}
function slotWinGrid(symbols,winner){const counts=new Map([[winner.id,8]]),grid=Array(8).fill(winner.id);while(grid.length<30){const possible=symbols.filter(x=>x.id!==winner.id&&(counts.get(x.id)||0)<7);const pick=weightedPick(possible);grid.push(pick.id);counts.set(pick.id,(counts.get(pick.id)||0)+1)}return shuffle(grid)}function planSlotCascades(startGrid,winner,symbols,cascadeRate,bonus,bet){
  let grid=startGrid.slice(),first=true,bonusPlaced=!!bonus&&Number(bonus.dropRound??0)===0;
  const plan=[];
  for(let round=1;round<=30;round++){
    const matches=symbols.filter(s=>grid.filter(id=>id===s.id).length>=8);
    const hit=first?winner:matches[0];
    if(!hit)break;
    const positions=[];grid.forEach((id,index)=>{if(id===hit.id)positions.push(index)});
    const counts=new Map();grid.forEach((id,index)=>{if(!positions.includes(index))counts.set(id,(counts.get(id)||0)+1)});
    const nextTarget=randomIndex(100)<Number(cascadeRate||0)?weightedPick(symbols):null;
    let needed=nextTarget?Math.max(0,8-(counts.get(nextTarget.id)||0)):0;
    const xPosition=bonus&&!bonusPlaced&&Number(bonus.dropRound??0)===round?positions[randomIndex(positions.length)]:-1;
    if(xPosition>=0)bonusPlaced=true;
    const next=grid.map((id,index)=>{
      if(!positions.includes(index))return id;
      if(index===xPosition)return bonus.id;
      let pick;
      if(nextTarget&&needed>0){pick=nextTarget;needed--}
      else {const possible=symbols.filter(s=>s.id!==nextTarget?.id&&(counts.get(s.id)||0)<7);pick=weightedPick(possible)}
      counts.set(pick.id,(counts.get(pick.id)||0)+1);return pick.id;
    });
    plan.push({hitId:hit.id,positions,nextGrid:next,payout:Math.max(1,Math.round(bet*hit.multiplier))});
    grid=next;first=false;
  }
  return plan;
}async function getSlotLeaderboard(env){
  const {results=[]}=await env.FINDIK_DB.prepare('SELECT username,best_payout FROM slot_highscores ORDER BY best_payout DESC,updated_at ASC LIMIT 10').all();
  return {items:results.map(x=>({username:x.username,bestPayout:Number(x.best_payout)}))};
}async function slotSpin(request,env){
  const user=await accountFromSession(request,env),missing=requireAccount(user);if(missing)return missing;
  const body=await request.json().catch(()=>null),bet=Number(body?.bet);
  if(!Number.isInteger(bet)||bet<1||bet>10000)return json({error:'Bahis 1 ile 10.000 Fındık Coin arasında olmalı.'},{status:400});
  const config=await getSlotConfig(env),symbols=config.symbols.filter(x=>x.active);
  if(symbols.length<5)return json({error:'Slot için en az beş aktif sembol gerekiyor.'},{status:409});
  if(symbols.length<2)return json({error:'Slot için en az iki aktif sembol gerekiyor.'},{status:409});
  const spent=await env.FINDIK_DB.prepare('UPDATE users SET coins=coins-? WHERE id=? AND coins>=?').bind(bet,user.id,bet).run();
  if(!spent.meta?.changes)return json({error:'Yeterli Fındık Coin yok.'},{status:409});
  const won=randomIndex(100)<config.winRate;let grid,payout=0,basePayout=0,winner=null,bonus=null;
  let cascadePlan=[],initialPayout=0;if(won){winner=weightedPick(symbols);grid=slotWinGrid(symbols,winner);const xPool=(config.xSymbols||[]).filter(x=>x.active!==false);const pickedBonus=xPool.length&&randomIndex(100)<Number(config.xChance||0)?weightedPick(xPool):null;bonus=pickedBonus?{...pickedBonus,dropRound:randomIndex(2)}:null;if(bonus&&bonus.dropRound===0){const slots=grid.map((id,index)=>id===winner.id?-1:index).filter(index=>index>=0);grid[slots[randomIndex(slots.length)]]=bonus.id}cascadePlan=planSlotCascades(grid,winner,symbols,config.cascadeRate,bonus,bet);initialPayout=Number(cascadePlan[0]?.payout||Math.max(1,Math.round(bet*winner.multiplier)));basePayout=cascadePlan.reduce((sum,step)=>sum+Number(step.payout||0),0);payout=basePayout*(bonus?bonus.multiplier:1);await env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(payout,user.id).run()}else{grid=slotLossGrid(symbols)}
  const spinId=id();const statements=[env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(id(),user.id,-bet,`slot_bet:${spinId}`,now())];
  if(payout)statements.push(env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(id(),user.id,payout,`slot_win:${spinId}:${winner.id}`,now()));
  await env.FINDIK_DB.batch(statements);
  const fresh=await env.FINDIK_DB.prepare('SELECT id,kick_username,display_name,coins FROM users WHERE id=?').bind(user.id).first();
  if(payout)await env.FINDIK_DB.prepare('INSERT INTO slot_highscores(user_id,username,best_payout,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,best_payout=MAX(slot_highscores.best_payout,excluded.best_payout),updated_at=CASE WHEN excluded.best_payout>slot_highscores.best_payout THEN excluded.updated_at ELSE slot_highscores.updated_at END').bind(user.id,fresh.kick_username,payout,now()).run();
  return json({ok:true,profile:publicProfile(fresh),grid,winner:winner?{id:winner.id,name:winner.name,multiplier:winner.multiplier}:null,bonus:bonus?{id:bonus.id,name:bonus.name,image_url:bonus.image_url||'',multiplier:bonus.multiplier,dropRound:bonus.dropRound}:null,basePayout,initialPayout,cascadePlan,payout,bet,config:{winRate:config.winRate,symbols,xSymbols:config.xSymbols||[]}});
}
const STREAM_GAME_HOSTS=new Set(['kickmeister5','batuhanfurkan5']);
async function streamGameHostStatus(request,env){const user=await accountFromSession(request,env);const name=String(user?.kick_username_normalized||user?.kick_username||'').toLowerCase();return json({host:STREAM_GAME_HOSTS.has(name),username:user?.kick_username||null});}async function awardTabooCoins(request,env){
  const host=await accountFromSession(request,env);
  const hostName=String(host?.kick_username_normalized||host?.kick_username||'').toLowerCase();
  if(!STREAM_GAME_HOSTS.has(hostName))return json({error:'Bu odulu yalnizca yayinci hesabi verebilir.'},{status:403});
  const body=await request.json().catch(()=>null);
  const username=String(body?.username||'').trim().replace(/^@/,'').toLowerCase();
  const amount=Number(body?.amount),eventId=String(body?.eventId||'').trim().slice(0,180);
  if(!validUsername(username)||![20,100].includes(amount)||!eventId)return json({error:'Odul bilgisi gecersiz.'},{status:400});
  const user=await env.FINDIK_DB.prepare('SELECT id,kick_username,coins FROM users WHERE kick_username_normalized=?').bind(username).first();
  const reason='yayinci_tabusu:'+eventId;
  if(!user){const queued=await env.FINDIK_DB.prepare('INSERT OR IGNORE INTO pending_game_rewards(id,kick_username,kick_username_normalized,amount,reason,created_at) VALUES(?,?,?,?,?,?)').bind(id(),username,username,amount,reason,now()).run();return json({ok:true,awarded:false,pending:!!queued.meta?.changes,reason:'account_not_found'});}
  const claim=await env.FINDIK_DB.prepare('INSERT OR IGNORE INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(id(),user.id,amount,reason,now()).run();
  if(!claim.meta?.changes)return json({ok:true,awarded:false,reason:'already_awarded'});
  await env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(amount,user.id).run();
  const fresh=await env.FINDIK_DB.prepare('SELECT coins FROM users WHERE id=?').bind(user.id).first();
  return json({ok:true,awarded:true,username:user.kick_username,amount,coins:Number(fresh?.coins||0)});
}
async function adminSlotConfig(request,env){
  const denied=await requireAdmin(request,env);if(denied)return denied;
  if(request.method==='GET')return json(await getSlotConfig(env,true));
  const body=await request.json().catch(()=>null);
  const winRate=Math.max(0,Math.min(100,Math.round(Number(body?.winRate)||0)));
  const cascadeRate=Math.max(0,Math.min(100,Math.round(Number(body?.cascadeRate??10))));
  const xChance=Math.max(0,Math.min(100,Math.round(Number(body?.xChance??10))));
  const musicUrl=String(body?.musicUrl||'').trim().slice(0,1600);
  const items=Array.isArray(body?.symbols)?body.symbols:[];
  const xItems=Array.isArray(body?.xSymbols)?body.xSymbols:DEFAULT_X_SYMBOLS;
  if(!items.length)return json({error:'En az bir ana sembol eklemelisin.'},{status:400});
  const mainItems=items.slice(0,30).map(x=>({...x,rarity:Math.max(1,Math.min(100,Math.round(Number(x.rarity)||1)))})).filter(x=>String(x.name||'').trim()&&Number(x.multiplier)>0&&x.active!==false);
  if(!mainItems.length)return json({error:'En az bir aktif ana sembol eklemelisin.'},{status:400});
  const probabilityTotal=mainItems.reduce((sum,x)=>sum+x.rarity,0);
  if(probabilityTotal!==100)return json({error:'Ana sembollerin görünme oranları toplamı tam %100 olmalı.'},{status:400});
  const statements=[env.FINDIK_DB.prepare('INSERT INTO slot_config(id,win_rate,cascade_rate,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET win_rate=excluded.win_rate,cascade_rate=excluded.cascade_rate,updated_at=excluded.updated_at').bind('main',winRate,cascadeRate,now()),env.FINDIK_DB.prepare('INSERT INTO slot_bonus_config(id,chance,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET chance=excluded.chance,updated_at=excluded.updated_at').bind('main',xChance,now()),env.FINDIK_DB.prepare('INSERT INTO slot_media_config(id,music_url,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET music_url=excluded.music_url,updated_at=excluded.updated_at').bind('main',musicUrl,now()),env.FINDIK_DB.prepare('DELETE FROM slot_symbols'),env.FINDIK_DB.prepare('DELETE FROM slot_symbol_rarity'),env.FINDIK_DB.prepare('DELETE FROM slot_x_symbols')];
  mainItems.forEach((x,index)=>{const name=String(x.name||'').trim().slice(0,40),multiplier=Number(x.multiplier),symbolId=String(x.id||id()),rarity=Math.max(1,Math.min(100,Math.round(Number(x.rarity)||1)));statements.push(env.FINDIK_DB.prepare('INSERT INTO slot_symbols(id,name,image_url,multiplier,active,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(symbolId,name,String(x.image_url||'').slice(0,1200),multiplier,1,index,now(),now()));statements.push(env.FINDIK_DB.prepare('INSERT INTO slot_symbol_rarity(symbol_id,rarity) VALUES(?,?)').bind(symbolId,rarity))});
  xItems.slice(0,20).forEach((x,index)=>{const name=String(x.name||'').trim().slice(0,40),multiplier=Number(x.multiplier);if(!name||!Number.isFinite(multiplier)||multiplier<=0)return;const rarity=Math.max(1,Math.min(10000,Math.round(Number(x.rarity)||1)));statements.push(env.FINDIK_DB.prepare('INSERT INTO slot_x_symbols(id,name,image_url,multiplier,rarity,active,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(String(x.id||id()),name,String(x.image_url||'').slice(0,1200),multiplier,rarity,x.active===false?0:1,index,now(),now()))});
  await env.FINDIK_DB.batch(statements);
  return json(await getSlotConfig(env,true));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/account')) return env.ASSETS.fetch(request);
    try { await ensureSchema(env); } catch (error) { return json({ error:'Veritabanı başlatılamadı: '+String(error?.message||error) },{status:500}); }
    if (request.method === 'POST' && url.pathname === '/api/account/admin/login') return adminLogin(request, env);
    if (request.method === 'POST' && url.pathname === '/api/account/admin/logout') {
      const raw=getCookie(request,'findik_admin_session');
      if(raw) await env.FINDIK_DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(raw+env.SESSION_PEPPER)).run();
      return json({ok:true},{headers:{'set-cookie':cookie('findik_admin_session','',0)}});
    }
    if (url.pathname === '/api/account/admin/products' && (request.method === 'GET' || request.method === 'POST')) return adminProducts(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/admin/products/archive') return adminProductStatus(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/admin/coins') return adminCoinAdjustment(request,env);
    if (request.method === 'GET' && url.pathname === '/api/account/admin/logs') return adminLogs(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/admin/users/delete') return adminDeleteUser(request,env);
    if (request.method === 'GET' && url.pathname === '/api/account/admin/orders') return adminOrders(request,env);
    if (url.pathname === '/api/account/admin/slot' && (request.method === 'GET'||request.method==='POST')) return adminSlotConfig(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/request') return requestVerification(request, env);
    if (request.method === 'GET' && url.pathname === '/api/account/status') return verificationStatus(request, env);
    if (request.method === 'POST' && url.pathname === '/api/account/kick-event') return receiveKickEvent(request, env);
    if (request.method === 'POST' && url.pathname === '/api/account/client-confirm') return confirmFromChatClient(request, env);
    if (request.method === 'GET' && url.pathname === '/api/account/game/host') return streamGameHostStatus(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/game/taboo-award') return awardTabooCoins(request,env);
    if (request.method === 'GET' && url.pathname === '/api/account/me') return json({ profile: publicProfile(await accountFromSession(request, env)) });
    if (request.method === 'POST' && url.pathname === '/api/account/daily-claim') return claimDailyBonus(request,env);
    if (request.method === 'GET' && url.pathname === '/api/account/shop/products') return json({items:await listShopProducts(env)});
    if (request.method === 'GET' && url.pathname === '/api/account/shop/history') return shopHistory(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/shop/buy') return buyProduct(request,env);
    if (request.method === 'GET' && url.pathname === '/api/account/slot/leaderboard') return json(await getSlotLeaderboard(env));
    if (request.method === 'GET' && url.pathname === '/api/account/slot/config') return json(await getSlotConfig(env));
    if (request.method === 'POST' && url.pathname === '/api/account/slot/spin') return slotSpin(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/logout') {
      const raw = getCookie(request, 'findik_session');
      if (raw) await env.FINDIK_DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(raw + env.SESSION_PEPPER)).run();
      return json({ ok: true }, { headers: { 'set-cookie': cookie('findik_session', '', 0) } });
    }
    return json({ error: 'Bulunamadı.' }, { status: 404 });
  }
};
