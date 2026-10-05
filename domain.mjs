import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const PARTS = ['Ön tampon', 'Kaput', 'Sol ön çamurluk', 'Sağ ön çamurluk', 'Sol ön kapı', 'Sağ ön kapı', 'Tavan', 'Sol arka kapı', 'Sağ arka kapı', 'Sol arka çamurluk', 'Sağ arka çamurluk', 'Bagaj', 'Arka tampon'];
export const CONDITIONS = ['Orijinal', 'Boyalı', 'Lokal boyalı', 'Değişen', 'Bilinmiyor'];
export class AppError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
export const requireThat = (ok, message, status=400) => { if (!ok) throw new AppError(message, status); };
export const token = () => randomBytes(24).toString('hex');
export function passwordHash(value, salt=randomBytes(16).toString('hex')) { return salt + ':' + scryptSync(value, salt, 64).toString('hex'); }
export function passwordMatches(value, hash) { if (!hash || typeof value !== 'string') return false; const [salt, hex] = hash.split(':'); const actual = scryptSync(value, salt, 64); const expected = Buffer.from(hex, 'hex'); return expected.length === actual.length && timingSafeEqual(actual, expected); }
export const score = (guess, price) => guess === null || guess === undefined ? 0 : Math.max(0, Math.round(1000 * (1 - Math.abs(guess - price) / price)));
function str(v, max=160) { return String(v ?? '').trim().slice(0,max); }
export function validateCar(input, previous=null) {
  const car = {
    id: previous?.id || token().slice(0,16), brand: str(input.brand,50), series: str(input.series,60), model: str(input.model,100),
    year: Number(input.year)||null, km: Number(input.km)||0, hp: Number(input.hp)||null,
    fuel: str(input.fuel,30), gear: str(input.gear,30), body: str(input.body,30), heavy: str(input.heavy,30),
    price: Number(input.price)||0, status: str(input.status), source: str(input.source,500), recorded: str(input.recorded,10), note: str(input.note,1000),
    demo: previous?.demo || false, photos: Array.isArray(input.photos) ? input.photos.slice(0,8).map(x=>str(x,200)) : [],
    damage: PARTS.map((_,i)=>CONDITIONS.includes(input.damage?.[i]) ? input.damage[i] : 'Bilinmiyor'), updated: Date.now()
  };
  requireThat(car.brand && car.series, 'Marka ve seri alanlarını doldurun.');
  requireThat(['draft','active','archived'].includes(car.status), 'Geçerli bir yayın durumu seçin.');
  requireThat(car.photos.every(p=>/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(p) || /^\/assets\/sample-[1-3]\.jpg$/.test(p)), 'Fotoğraf adresi geçersiz.');
  requireThat(Number.isSafeInteger(car.price) && car.price >= 0 && car.price <= 1000000000, 'Fiyat 0–1 milyar TL arasında tam sayı olmalı.');
  requireThat(Number.isSafeInteger(car.km) && car.km >= 0 && car.km <= 10000000, 'Kilometre geçersiz.');
  requireThat(car.year === null || Number.isInteger(car.year) && car.year >= 1950 && car.year <= new Date().getFullYear()+1, 'Model yılı geçersiz.');
  requireThat(car.hp === null || Number.isInteger(car.hp) && car.hp > 0 && car.hp <= 5000, 'Motor gücü geçersiz.');
  if (car.status === 'active') requireThat(car.photos.length && car.model && car.year && car.price>0 && car.gear && car.fuel && car.body && car.heavy, 'Oyuna dahil etmek için fotoğraf, model, yıl, fiyat, yakıt, vites, kasa ve hasar durumunu tamamlayın.');
  return car;
}
export function eligibleCars(cars, filters={}) {
  return cars.filter(c=>c.status==='active' && (!filters.brand || c.brand===filters.brand) && (!filters.minYear || c.year>=Number(filters.minYear)) && (!filters.minPrice || c.price>=Number(filters.minPrice)) && (!filters.maxPrice || c.price<=Number(filters.maxPrice)));
}
export function publicCar(car) { if (!car) return null; const {price, source, note, status, updated, id, recorded, ...safe} = car; return safe; }
export function startRound(room, now=Date.now()) { room.phase='guess'; room.deadline=now+room.duration*1000; room.guesses={}; room.result=null; room.revision++; }
export function reveal(room) {
  if(room.phase!=='guess') return;
  const price=room.cars[room.round].price;
  room.result={price, recorded:room.cars[room.round].recorded, rows:room.players.map(p=>{
    const guess=room.guesses[p.id] ?? null;
    const points=score(guess,price); p.total+=points;
    return {id:p.id,name:p.name,guess,points,difference:guess===null?null:guess-price,total:p.total};
  }).sort((a,b)=>b.points-a.points || a.name.localeCompare(b.name,'tr'))};
  room.history.push(structuredClone(room.result)); room.phase='result'; room.revision++;
}
export function roomView(room, player, now=Date.now()) {
  return {
    code:room.code, phase:room.phase, locked:room.locked, revision:room.revision,
    round:room.round+1, rounds:room.rounds, duration:room.duration, deadline:room.deadline, serverTime:now,
    me:player.id, isHost:player.id===room.host, ownGuess:room.guesses[player.id]??null,
    players:room.players.map(p=>({id:p.id,name:p.name,total:p.total,host:p.id===room.host,submitted:room.guesses[p.id]!==undefined,online:now-p.lastSeen<15000})).sort((a,b)=>b.total-a.total || a.name.localeCompare(b.name,'tr')),
    car:['guess','result'].includes(room.phase)?publicCar(room.cars[room.round]):null,
    result:room.phase==='result'?room.result:null,
    history:room.phase==='finished'?room.history:[], filters:room.filters, demo:room.demo
  };
}
