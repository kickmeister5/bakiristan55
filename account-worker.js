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
  // Yalnızca Cloudflare'de TEST_AUTO_APPROVE=true iken kullanılan test kolaylığı.
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
async function adminLogin(request, env) {
  const body=await request.json().catch(()=>null);
  const password=String(body?.password||'');
  if (!env.ADMIN_PASSWORD) return json({ error:'ADMIN_PASSWORD sunucu sırrı henüz ayarlanmadı.' },{status:503});
  if ((await digest(password + env.SESSION_PEPPER)) !== (await digest(env.ADMIN_PASSWORD + env.SESSION_PEPPER))) return json({ error:'Yönetici şifresi hatalı.' },{status:401});
  return json({ ok:true },{headers:{'set-cookie':await issueAdminSession(env)}});
}
async function requireAdmin(request, env) {
  return (await adminFromSession(request,env)) ? null : json({error:'Yönetici oturumu gerekli.'},{status:401});
}
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
async function adminOrders(request, env) {
  const denied=await requireAdmin(request,env);if(denied)return denied;
  const q=(new URL(request.url).searchParams.get('q')||'').trim().toLowerCase(),like=`%${q}%`;
  const {results=[]}=await env.FINDIK_DB.prepare(`SELECT p.id,p.product_name,p.unit_price,p.customer_name,p.shipping_address,p.phone,p.created_at,u.kick_username,u.display_name
    FROM shop_purchases p JOIN users u ON u.id=p.user_id
    WHERE u.kick_username_normalized LIKE ? OR p.product_name LIKE ? OR p.customer_name LIKE ? OR p.phone LIKE ? OR p.shipping_address LIKE ?
    ORDER BY p.created_at DESC LIMIT 150`).bind(like,like,like,like,like).all();
  return json({orders:results.map(x=>({...x,unit_price:Number(x.unit_price)}))});
}
const DEFAULT_SLOT_SYMBOLS=[
  {id:'nut',name:'Fındık',image_url:'findik-logo.png',multiplier:3,active:true,sort_order:0},
  {id:'star',name:'Yıldız',image_url:'',multiplier:5,active:true,sort_order:1},
  {id:'gem',name:'Elmas',image_url:'',multiplier:8,active:true,sort_order:2},
  {id:'crown',name:'Taç',image_url:'',multiplier:12,active:true,sort_order:3},{id:'berry',name:'Kiraz',image_url:'',multiplier:10,active:true,sort_order:4}
];
async function getSlotConfig(env,includeInactive=false){
  const config=await env.FINDIK_DB.prepare('SELECT win_rate,cascade_rate FROM slot_config WHERE id=?').bind('main').first();
  const where=includeInactive?'':'WHERE active=1';
  const {results=[]}=await env.FINDIK_DB.prepare(`SELECT id,name,image_url,multiplier,active,sort_order FROM slot_symbols ${where} ORDER BY sort_order,created_at`).all();
  const saved=(results.length?results:DEFAULT_SLOT_SYMBOLS).map(x=>({...x,multiplier:Number(x.multiplier),active:x.active!==0})),known=new Set(saved.map(x=>x.id));
  const symbols=saved.concat(DEFAULT_SLOT_SYMBOLS.filter(x=>!known.has(x.id))).slice(0,Math.max(5,saved.length));
  return {winRate:config?Number(config.win_rate):20,cascadeRate:config?Number(config.cascade_rate):10,symbols};
}
function randomIndex(max){const bytes=crypto.getRandomValues(new Uint32Array(1));return bytes[0]%max}
function shuffle(items){for(let i=items.length-1;i>0;i--){const j=randomIndex(i+1);[items[i],items[j]]=[items[j],items[i]]}return items}
function slotLossGrid(symbols){const counts=new Map(),grid=[];while(grid.length<30){const possible=symbols.filter(x=>(counts.get(x.id)||0)<7);const pick=possible[randomIndex(possible.length)];grid.push(pick.id);counts.set(pick.id,(counts.get(pick.id)||0)+1)}return shuffle(grid)}
function slotWinGrid(symbols,winner){const counts=new Map([[winner.id,8]]),grid=Array(8).fill(winner.id);while(grid.length<30){const possible=symbols.filter(x=>x.id!==winner.id&&(counts.get(x.id)||0)<7);const pick=possible[randomIndex(possible.length)];grid.push(pick.id);counts.set(pick.id,(counts.get(pick.id)||0)+1)}return shuffle(grid)}
async function getSlotLeaderboard(env){
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
  const won=randomIndex(100)<config.winRate;let grid,payout=0,winner=null;
  if(won){winner=symbols[randomIndex(symbols.length)];grid=slotWinGrid(symbols,winner);payout=Math.max(1,Math.round(bet*winner.multiplier));await env.FINDIK_DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(payout,user.id).run()}else grid=slotLossGrid(symbols);
  const spinId=id();const statements=[env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(id(),user.id,-bet,`slot_bet:${spinId}`,now())];
  if(payout)statements.push(env.FINDIK_DB.prepare('INSERT INTO coin_ledger(id,user_id,amount,reason,created_at) VALUES(?,?,?,?,?)').bind(id(),user.id,payout,`slot_win:${spinId}:${winner.id}`,now()));
  await env.FINDIK_DB.batch(statements);
  const fresh=await env.FINDIK_DB.prepare('SELECT id,kick_username,display_name,coins FROM users WHERE id=?').bind(user.id).first();
  if(payout)await env.FINDIK_DB.prepare('INSERT INTO slot_highscores(user_id,username,best_payout,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,best_payout=MAX(slot_highscores.best_payout,excluded.best_payout),updated_at=CASE WHEN excluded.best_payout>slot_highscores.best_payout THEN excluded.updated_at ELSE slot_highscores.updated_at END').bind(user.id,fresh.kick_username,payout,now()).run();
  return json({ok:true,profile:publicProfile(fresh),grid,winner:winner?{id:winner.id,name:winner.name,multiplier:winner.multiplier}:null,payout,bet,config:{winRate:config.winRate,symbols}});
}
async function adminSlotConfig(request,env){
  const denied=await requireAdmin(request,env);if(denied)return denied;
  if(request.method==='GET')return json(await getSlotConfig(env,true));
  const body=await request.json().catch(()=>null),winRate=Math.max(0,Math.min(100,Math.round(Number(body?.winRate)||0))),cascadeRate=Math.max(0,Math.min(100,Math.round(Number(body?.cascadeRate??10)))),items=Array.isArray(body?.symbols)?body.symbols:[];
  if(!items.length)return json({error:'En az bir sembol eklemelisin.'},{status:400});
  const statements=[env.FINDIK_DB.prepare('INSERT INTO slot_config(id,win_rate,cascade_rate,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET win_rate=excluded.win_rate,cascade_rate=excluded.cascade_rate,updated_at=excluded.updated_at').bind('main',winRate,cascadeRate,now()),env.FINDIK_DB.prepare('DELETE FROM slot_symbols')];
  items.slice(0,30).forEach((x,index)=>{const name=String(x.name||'').trim().slice(0,40),multiplier=Number(x.multiplier);if(name&&Number.isFinite(multiplier)&&multiplier>0)statements.push(env.FINDIK_DB.prepare('INSERT INTO slot_symbols(id,name,image_url,multiplier,active,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(String(x.id||id()),name,String(x.image_url||'').slice(0,1200),multiplier,x.active===false?0:1,index,now(),now()))});
  await env.FINDIK_DB.batch(statements);return json(await getSlotConfig(env,true));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/account')) return env.ASSETS.fetch(request);
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
    if (request.method === 'GET' && url.pathname === '/api/account/admin/orders') return adminOrders(request,env);
    if (url.pathname === '/api/account/admin/slot' && (request.method === 'GET'||request.method==='POST')) return adminSlotConfig(request,env);
    if (request.method === 'POST' && url.pathname === '/api/account/request') return requestVerification(request, env);
    if (request.method === 'GET' && url.pathname === '/api/account/status') return verificationStatus(request, env);
    if (request.method === 'POST' && url.pathname === '/api/account/kick-event') return receiveKickEvent(request, env);
    if (request.method === 'POST' && url.pathname === '/api/account/client-confirm') return confirmFromChatClient(request, env);
    if (request.method === 'GET' && url.pathname === '/api/account/me') return json({ profile: publicProfile(await accountFromSession(request, env)) });
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
