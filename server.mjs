import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { AppError, requireThat, token, passwordHash, passwordMatches, validateCar, eligibleCars, publicCar, startRound, reveal, roomView } from './domain.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DATA=path.resolve(process.env.DATA_DIR || path.join(ROOT,'data'));
fs.mkdirSync(path.join(DATA,'uploads'),{recursive:true});
const FILE=path.join(DATA,'state.json');
let state=fs.existsSync(FILE)?JSON.parse(fs.readFileSync(FILE,'utf8')):{settings:{brand:'GARAJ ARENA'},adminHash:null,hostHash:null,cars:[],rooms:{},sessions:{}};
function save(){ const temp=FILE+'.tmp'; fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600}); fs.renameSync(temp,FILE); }
if(process.env.ENABLE_DEMO!=='true'){
 for(const c of state.cars)if(c.demo)c.status='archived';
 const drafts=JSON.parse(fs.readFileSync(path.join(ROOT,'cloudflare/vehicle-drafts.json'),'utf8'));
 for(const c of drafts)if(!state.cars.some(x=>x.id===c.id))state.cars.push(c);
 save();
}
if(process.env.ENABLE_DEMO!=='true'&&!state.simpleAdminV1){state.adminHash='3600e54f0721a58d88f8548ec095e992:861ab408c22dc43fd1d3263a24e5f22dd10be2574b6edaac744a8db52a7961066db3045e5d7d6b156f56aea815280efa754b835a8f8f61a44b9d7600f86828ea';state.simpleAdminV1=true;for(const [key,value] of Object.entries(state.sessions))if(value.role==='admin')delete state.sessions[key];save();}
const sessions=state.sessions;
const limit=new Map();
function rate(req, name, max=25, window=60000) {
  const key=name+':'+req.socket.remoteAddress; let l=limit.get(key);
  if(!l || Date.now()>l.until){l={count:0,until:Date.now()+window};limit.set(key,l);}
  requireThat(++l.count<=max,'Çok fazla deneme. Biraz bekleyip tekrar deneyin.',429);
}
function auth(req,role){const t=(req.headers.authorization||'').replace(/^Bearer /,''); const s=sessions[t]; requireThat(s && s.expires>Date.now() && (!role || s.role===role || s.role==='admin'),'Oturumunuz sona erdi. Tekrar giriş yapın.',401);return s;}
function newSession(role){const t=token();sessions[t]={role,expires:Date.now()+12*60*60*1000};save();return {token:t,role};}
const loopback = ip=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
function roomAuth(req,code){ const room=state.rooms[code]; requireThat(room,'Oda bulunamadı.',404);const t=(req.headers.authorization||'').replace(/^Bearer /,'');const p=room.players.find(p=>p.token===t);requireThat(p,'Bu odadaki oturumunuz bulunamadı.',403);p.lastSeen=Date.now();if(room.phase==='guess'&&Date.now()>=room.deadline){reveal(room);save();}return [room,p];}
function hostOnly(room,p){ requireThat(p.id===room.host,'Bu işlemi yalnızca oda sahibi yapabilir.',403); }
function player(name){name=String(name||'').trim();requireThat(name.length>=2&&name.length<=24,'Oyuncu adı 2–24 karakter olmalı.');return{id:token().slice(0,12),token:token(),name,total:0,lastSeen:Date.now()};}
function shuffled(cars){const a=structuredClone(cars);for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
const seed=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'samples.json'),'utf8'));
async function body(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;requireThat(bytes<=5*1024*1024,'Dosya çok büyük. En fazla 3 MB fotoğraf yükleyin.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('İstek okunamadı.');}}
async function api(req,url){
 const route=url.pathname, method=req.method;
 if(method==='GET'&&route==='/api/meta')return{brand:state.settings.brand,configured:!!state.adminHash,canSetup:process.env.ENABLE_DEMO==='true'&&loopback(req.socket.remoteAddress),active:state.cars.filter(c=>c.status==='active').length,brands:[...new Set(state.cars.filter(c=>c.status==='active').map(c=>c.brand))].sort(),demoAvailable:process.env.ENABLE_DEMO==='true'};
 if(method==='GET'&&route==='/api/session')return{role:auth(req).role};
 if(method==='GET'&&route==='/api/cars'){auth(req,'admin');return{cars:state.cars};}
 if(method==='GET'&&route==='/api/settings'){auth(req,'admin');return{brand:state.settings.brand};}
 const match=route.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(\w+))?$/);
 if(method==='GET'&&match){const[r,p]=roomAuth(req,match[1]);return roomView(r,p);}
 requireThat(method==='POST','Adres bulunamadı.',404);
 const b=await body(req);
 if(route==='/api/setup'){
   requireThat(loopback(req.socket.remoteAddress),'İlk kurulumu sunucu bilgisayarında localhost adresinden yapın.',403);
   requireThat(!state.adminHash,'Kurulum zaten tamamlandı.',409);
   requireThat(typeof b.password==='string'&&b.password.length>=10&&b.password.length<=128,'Admin parolası 10–128 karakter olmalı.');
   requireThat(typeof b.hostPassword==='string'&&b.hostPassword.length>=8&&b.hostPassword.length<=128,'Yayıncı parolası 8–128 karakter olmalı.');
   requireThat(b.password!==b.hostPassword,'Admin ve yayıncı için farklı parolalar seçin.');
   state.adminHash=passwordHash(b.password);state.hostHash=passwordHash(b.hostPassword);state.settings.brand=String(b.brand||'GARAJ ARENA').trim().slice(0,40)||'GARAJ ARENA';save();return newSession('admin');
 }
 if(route==='/api/login'){rate(req,'login',10);requireThat(state.adminHash,'Önce ilk kurulumu tamamlayın.',409);const role=b.role==='admin'?'admin':'host';requireThat(passwordMatches(b.password,role==='admin'?state.adminHash:state.hostHash),'Parola doğru değil.',401);return newSession(role);}
 if(route==='/api/logout'){const t=(req.headers.authorization||'').replace(/^Bearer /,'');delete sessions[t];save();return{ok:true};}
 if(route==='/api/settings'){
   auth(req,'admin'); const brand=String(b.brand||'').trim();requireThat(brand.length>=2&&brand.length<=40,'Yayın adı 2–40 karakter olmalı.');
   state.settings.brand=brand;save();return{ok:true};
 }
 if(route==='/api/cars/seed'){requireThat(process.env.ENABLE_DEMO==='true','Demo kapalı.',404);auth(req,'admin');const existing=new Set(state.cars.map(c=>c.id));for(const c of seed())if(!existing.has(c.id))state.cars.push(c);save();return{cars:state.cars};}
 if(route==='/api/cars/save'){
   auth(req,'admin');const prev=b.id?state.cars.find(c=>c.id===b.id):null;requireThat(!b.id||prev,'Araç bulunamadı.',404);const c=validateCar(b,prev);
   for(const p of c.photos)requireThat(fs.existsSync(p.startsWith('/uploads/')?path.join(DATA,p):path.join(ROOT,'dist',p)),'Fotoğraf dosyası bulunamadı. Tekrar yükleyin.');
   if(prev)state.cars[state.cars.indexOf(prev)]=c;else state.cars.push(c);save();return{car:c};
 }
 if(route==='/api/cars/archive'){auth(req,'admin');const c=state.cars.find(c=>c.id===b.id);requireThat(c,'Araç bulunamadı.',404);c.status='archived';save();return{ok:true};}
 if(route==='/api/upload'){
   auth(req,'admin');rate(req,'upload',80);requireThat(typeof b.data==='string','Fotoğraf seçin.');const m=b.data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);requireThat(m,'Yalnızca JPG, PNG ve WebP fotoğraflar yüklenebilir.');
   const buf=Buffer.from(m[2],'base64');requireThat(buf.length<=3*1024*1024,'Fotoğraf en fazla 3 MB olabilir.');
   const valid=m[1]==='jpeg'?buf[0]===255&&buf[1]===216&&buf[2]===255:m[1]==='png'?buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP';
   requireThat(valid,'Fotoğraf dosyası geçersiz.');const name=token().slice(0,32)+'.'+(m[1]==='jpeg'?'jpg':m[1]);fs.writeFileSync(path.join(DATA,'uploads',name),buf);return{url:'/uploads/'+name};
 }
 if(route==='/api/rooms'){
   rate(req,'create',12);const demo=b.demo===true;requireThat(!demo||process.env.ENABLE_DEMO==='true','Demo kapalı.');
   const p=player(b.name||'Yayıncı');const rounds=Number(b.rounds),duration=Number(b.duration);requireThat(Number.isInteger(rounds)&&rounds>=1&&rounds<=30,'Tur sayısı 1–30 arasında olmalı.');requireThat(Number.isInteger(duration)&&duration>=10&&duration<=180,'Süre 10–180 saniye arasında olmalı.');
   const filters=b.filters||{};const pool=eligibleCars(demo?seed():state.cars,filters);if(process.env.ENABLE_DEMO==='true')requireThat(pool.length>=rounds,`Bu filtrelerde ${pool.length} araç var. Tur sayısını azaltın veya havuza araç ekleyin.`);
   let code;do{code=Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');}while(state.rooms[code]);
   state.rooms[code]={code,host:p.id,players:[p],phase:'lobby',round:0,rounds,duration,filters,cars:shuffled(pool).slice(0,rounds),guesses:{},deadline:0,result:null,history:[],revision:1,locked:false,created:Date.now(),demo};save();return{code,token:p.token};
 }
 if(route==='/api/rooms/join'){
   rate(req,'join',30);const code=String(b.code||'').trim().toUpperCase(),r=state.rooms[code];requireThat(r,'Oda kodunu kontrol edin.',404);requireThat(r.phase==='lobby'&&!r.locked,'Bu oda yeni katılıma kapalı.',409);requireThat(r.players.length<16,'Oda dolu (en fazla 16 oyuncu).');const p=player(b.name);requireThat(!r.players.some(x=>x.name.toLocaleLowerCase('tr')===p.name.toLocaleLowerCase('tr')),'Bu kullanıcı adı odada kullanılıyor.');r.players.push(p);r.revision++;save();return{code,token:p.token};
 }
 if(match){
   const[r,p]=roomAuth(req,match[1]),action=match[2];
   if(action==='guess'){
     requireThat(r.phase==='guess','Bu tur için tahmin süresi bitti.',409);requireThat(Number(b.round)===r.round+1,'Tur değişti. Ekranı güncelleyin.',409);requireThat(r.guesses[p.id]===undefined,'İlk tahminin kilitlendi. Bu turda tekrar değiştiremezsin.',409);const value=Number(b.value);requireThat(Number.isSafeInteger(value)&&value>0&&value<=1000000000,'1–1 milyar TL arasında bir tahmin girin.');r.guesses[p.id]=value;r.revision++;
   }else if(action==='leave'){
     if(p.id===r.host){r.phase='closed';r.locked=true;}else{r.players=r.players.filter(x=>x.id!==p.id);delete r.guesses[p.id];}r.revision++;save();return{ok:true};
   }else{
     hostOnly(r,p);
     if(action==='start'){requireThat(r.phase==='lobby','Oyun zaten başladı.',409);if(process.env.ENABLE_DEMO!=='true'){const pool=eligibleCars(state.cars,r.filters);requireThat(pool.length>=r.rounds,'Oyuna başlamak için yeterli hazır araç yok.');r.cars=shuffled(pool).slice(0,r.rounds);}r.locked=true;startRound(r);}
     else if(action==='settings'){
       requireThat(r.phase==='lobby','Ayarlar yalnızca lobide değiştirilebilir.',409);
       requireThat(['rounds','duration'].includes(b.setting),'Geçersiz ayar.');
       const step=b.setting==='rounds'?1:10;requireThat(b.delta===step||b.delta===-step,'Geçersiz değişim.');
       const value=r[b.setting]+b.delta;requireThat(value>=(b.setting==='rounds'?1:10)&&value<=(b.setting==='rounds'?30:180),'Ayar sınırına ulaşıldı.');
       if(b.setting==='rounds'){
         if(value>r.rounds){const pool=eligibleCars(r.demo?seed():state.cars,r.filters).filter(c=>!r.cars.some(x=>x.id===c.id));requireThat(pool.length>=value-r.rounds,'Tur eklemek için araç havuzunda yeterli araç yok.');r.cars.push(...shuffled(pool).slice(0,value-r.rounds));}
         else r.cars=r.cars.slice(0,value);
       }
       r[b.setting]=value;r.revision++;
     }
     else if(action==='lock'){requireThat(r.phase==='lobby','Oyun başladı.',409);r.locked=!r.locked;r.revision++;}
     else if(action==='kick'){requireThat(r.phase==='lobby','Oyuncu yalnızca lobide çıkarılabilir.');requireThat(b.id!==r.host,'Oda sahibi çıkarılamaz.');r.players=r.players.filter(x=>x.id!==b.id);r.revision++;}
     else if(action==='reveal'){requireThat(r.phase==='guess','Tahmin aşaması bitmiş.',409);requireThat(r.players.every(x=>r.guesses[x.id]!==undefined),'Sonucu erken açmak için herkes tahmin göndermeli.');reveal(r);}
     else if(action==='next'){requireThat(r.phase==='result','Önce turun bitmesini bekleyin.',409);requireThat(Number(b.round)===r.round+1,'Tur zaten değişti.',409);if(r.round+1>=r.rounds){r.phase='finished';r.revision++;}else{r.round++;startRound(r);}}
     else throw new AppError('İşlem bulunamadı.',404);
   }
   save();return roomView(r,p);
 }
 throw new AppError('Adres bulunamadı.',404);
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
 try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/garaj-arena'){res.writeHead(308,{Location:'/garaj-arena/'+url.search});res.end();return;}
   if(url.pathname.startsWith('/garaj-arena/'))url.pathname=url.pathname.slice('/garaj-arena'.length);
   if(url.pathname.startsWith('/api/')){
     if(req.method!=='GET'){
       requireThat((req.headers['content-type']||'').startsWith('application/json'),'JSON isteği gerekli.',415);
       if(req.headers.origin)requireThat(new URL(req.headers.origin).host===req.headers.host,'Farklı kaynaktan gelen istek reddedildi.',403);
     }
     const result=await api(req,url);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
   }
   requireThat(req.method==='GET'||req.method==='HEAD','Yöntem desteklenmiyor.',405);
   let route=decodeURIComponent(url.pathname);if(route==='/')route='/index.html';
   let file;
   if(route.startsWith('/uploads/')){requireThat(/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(route),'Dosya bulunamadı.',404);file=path.join(DATA,route);}
   else {file=path.resolve(ROOT,'dist','.'+route);requireThat(file.startsWith(path.join(ROOT,'dist')+path.sep),'Dosya bulunamadı.',404);}
   requireThat(fs.existsSync(file)&&fs.statSync(file).isFile(),'Dosya bulunamadı.',404);const stat=fs.statSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 }catch(e){const status=e.status||500;if(status===500)console.error(e);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:status===500?'Sunucuda bir hata oluştu. Tekrar deneyin.':e.message}));}
});
const timer=setInterval(()=>{let changed=false;for(const r of Object.values(state.rooms)){if(r.phase==='guess'&&Date.now()>=r.deadline){reveal(r);changed=true;}if(Date.now()-r.created>24*3600000){delete state.rooms[r.code];changed=true;}}for(const[t,s]of Object.entries(sessions))if(s.expires<Date.now()){delete sessions[t];changed=true;}for(const[k,l]of limit)if(Date.now()>l.until)limit.delete(k);if(changed)save();},500);timer.unref();
server.listen(Number(process.env.PORT||4173),process.env.HOST||'127.0.0.1',()=>console.log(`Garaj Arena: http://localhost:${process.env.PORT||4173}\nVeriler: ${DATA}\nDurdurmak için Ctrl+C. LAN için HOST=0.0.0.0 ile başlatın.`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{save();server.close(()=>process.exit(0));});
