// Pedestrians (entity type 8) ported from d.java br()/a(b,..) and b.java M()/J()/k()/c(n,n2,n3)/e(int).
// Pure logic, no DOM. Positions are 8.8 fixed point. Path nodes = bh[blockType] (assets/maps/<tag>_objects.json):
// 5 values per node: x, y (px inside the block), link bytes E/N (v2), W/S (v3), v4 = mask of allowed directions.
import { idiv, makeWorld, HIT_W, HIT_H } from './sim.js';

export const MAX_PEDS = 10;                  // original: fi, set by level script (starts at 4) -- tunable here
export const LATERAL = idiv(65536, 100 * 2); // d.d = 65536 / (a*2) = 327
const WALK_MAX = [768, 768, 512];            // c[] from e_02 (max speed per kind), accel j[6] = 85
const ACCEL = 85, SPAWN_DIST2 = 90000 * 24;  // k[2] * 24
const DIRQ = [[1, 0], [0, -1], [-1, 0], [0, 1]];

export class Rng {                           // d.a(n, n2): n + |nextInt| % (n2 - n)
  constructor(seed = 1) { this.s = seed >>> 0; }
  next() { let t = (this.s += 0x6D2B79F5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  int(n, n2) { return n2 === n ? n2 : n + Math.floor(this.next() * (n2 - n)); }
}

export function makePedWorld(w, objects, seed = 1, max = MAX_PEDS) {
  const bh = {}; for (const [k, v] of Object.entries(objects.bh)) bh[k] = v.flat();   // flat, 5 values per node, like the original
  return { w, bh, rng: new Rng(seed), peds: [], hd: 0, max, fw: w.ft * w.T, fx: w.fu * w.T, tz: w.tables.z };
}
// ---- geometry helpers (d.p, d.q, d.Q, d.R, b.i(), b.j()) --------------------------------------------------
export const blockAt = (pw, x8, y8) => { const bx = (x8 >> 8) < 0 ? -1 : idiv(x8 >> 8, pw.fw), by = (y8 >> 8) < 0 ? -1 : idiv(y8 >> 8, pw.fx); return bx < 0 || by < 0 || bx >= pw.w.fz || by >= pw.w.fA ? -1 : bx + by * pw.w.fz; };
const blockType = (pw, id) => pw.w.map.blockMap[id] & 0x1f;
const originX = (pw, id) => (id % pw.w.fz) * pw.fw, originY = (pw, id) => idiv(id, pw.w.fz) * pw.fx;
const entBlockX = (pw, p) => idiv(p.a >> 8, pw.fw) * pw.fw << 8;      // b.i()
const entBlockY = (pw, p) => idiv(p.b >> 8, pw.fw) * pw.fw << 8;      // b.j() (uses fw as in the original)
const nodeX = (pw, bt, i) => pw.bh[bt][i * 5] << 8, nodeY = (pw, bt, i) => pw.bh[bt][i * 5 + 1] << 8;
const linkByte = (pw, bt, i, q) => { const v = pw.bh[bt][i * 5 + (q < 2 ? 2 : 3)] & 0xFFFF; const x = (v >> ((q & 1) * 8)) & 0xFF; return x > 127 ? x - 256 : x; };
const sgn = v => v > 0 ? 1 : v === 0 ? 0 : -1;

// b.c(n, n2, n3): node of the neighbouring block in direction n3 that lines up with node n2 of block type n.
function neighbourNode(pw, p, bt, idx, q) {
  const w = pw.w, nb = [1, -w.fz, -1, w.fz], A = w.tables.A;
  const s = pw.bh[bt][idx * 5], s2 = pw.bh[bt][idx * 5 + 1];
  const n4 = blockAt(pw, p.a, p.b), n5 = n4 + nb[q];
  const dx = sgn(A[q * 8]), dy = sgn(A[q * 8 + 1]);
  const n6 = dx * pw.fw, n7 = dy * pw.fx;
  if (n4 < 0 || !((q & 1) === 1 || idiv(n4, w.fz) === idiv(n5, w.fz)) || n5 < 0 || n5 >= w.fz * w.fA) return -1;
  const n8 = blockType(pw, n5); const tab = pw.bh[n8]; if (!tab) return -1;
  let best = -1, bd = 75;
  for (let i = 0; i < tab.length; i += 5) {
    const n12 = tab[i] - (s - n6), n13 = tab[i + 1] - (s2 - n7);
    if (sgn(n12) !== dx || sgn(n13) !== dy) continue;
    const d = Math.abs(n12) + Math.abs(n13); if (d >= bd) continue; bd = d; best = i / 5;
  }
  return best >= 0 ? { block: n5, idx: best } : -1;
}

// ---- entity ------------------------------------------------------------------------------------------------
function setNodeLocal(pw, p, bt, idx) {          // b.e(n, n2)
  p.J = nodeX(pw, bt, idx) + entBlockX(pw, p); p.K = nodeY(pw, bt, idx) + entBlockY(pw, p); p.idx = idx; p.bt = bt;
}
function setNodeBlock(pw, p, blk, bt, idx) {      // b.d(n, n2, n3)
  p.J = nodeX(pw, bt, idx) + (originX(pw, blk) << 8); p.K = nodeY(pw, bt, idx) + (originY(pw, blk) << 8); p.idx = idx; p.bt = bt;
}
function refreshVel(pw, p) { const A = pw.w.tables.A; p.c = A[p.dir * 2] * idiv(p.h, 100); p.d = A[p.dir * 2 + 1] * idiv(p.h, 100); }
function setDir(pw, p, n) { if (p.dir === n) return; p.dir = n; if (p.h > 0) refreshVel(pw, p); }   // b.i(n)
function accel(pw, p, n) {                                                                           // b.g(n), generic
  const n2 = p.h; p.h += n > ACCEL ? ACCEL : n; if (p.h > p.vmax) p.h = p.vmax; if (p.h === n2) return; refreshVel(pw, p);
}
function decel(pw, p, n) { if (p.h <= 0) return; p.h -= n > 700 ? 700 : n; if (p.h <= 0) p.h = 0; refreshVel(pw, p); }   // b.h(n)
function faceTarget(pw, p, n) {                                                                      // b.e(int)
  const n2 = p.J - p.a, n3 = p.K - p.b;
  if (p.m > n || p.h === 0) {
    const by = p.dir;
    if (Math.abs(n2) > Math.abs(n3)) setDir(pw, p, n2 > 0 ? 0 : 8); else setDir(pw, p, n3 >= 0 ? 12 : 4);
    if ((p.dir & 4) === 0) { if (Math.abs(n3) * 3 > Math.abs(n2) * 2) setDir(pw, p, n3 >= 0 ? 12 : 4); }
    else if (Math.abs(n2) * 3 > Math.abs(n3) * 2) setDir(pw, p, n2 > 0 ? 0 : 8);
    if (by !== p.dir) p.m = 0;
  }
}
const arrived = (p) => { const n = idiv(200 * Math.max(2, idiv(p.h * 2, 100)) * 24, 16); return p.a > p.J - n && p.a < p.J + n && p.b > p.K - n && p.b < p.K + n; };   // b.J()

// movement: b.u() case 8 -- move, revert + stop when a hitbox corner is in a wall
function move(pw, p) {
  if (p.h === 0 && p.c === 0 && p.d === 0) return;
  const w = pw.w, oa = p.a, ob = p.b;
  p.a += idiv((p.c * 100 >> 8) * 24, 16); p.b += idiv((p.d * 100 >> 8) * 24, 16);
  const x0 = p.a - HIT_W / 2, y0 = p.b - HIT_H / 2;
  for (let k = 0; k < 4; k++) if (w.collisionAt(x0 + (k % 2) * HIT_W, y0 + (k >> 1) * HIT_H) === 2) {
    p.a = oa; p.b = ob; p.l = 0; p.m = 0; p.c = 0; p.d = 0; p.h = 0; p.stuck = true; return;
  }
}
// b.M(): AI step (runs every 200 ms)
function ai(pw, p) {
  const rng = pw.rng, w = pw.w;
  if (p.l < 200) return;
  if (p.stuck) {                                        // blocked by a wall: look at the node again and wait a moment
    p.stuck = false; p.l = -200; setNodeLocal(pw, p, p.bt, p.idx); faceTarget(pw, p, 0); return;
  }
  if (p.L > 0) { decel(pw, p, ACCEL); if (p.l < p.L) return; p.L = 0; p.l = 0; }
  if (p.m > 20000 && rng.int(0, 100) < 15) { p.L = rng.int(2, 30) * 100; p.m = 0; }
  let n4 = 0, n5 = 0;
  if ((p.dir & 4) === 0) { const n = p.K - p.b; if (Math.abs(n) <= 768) p.d = 0; else n5 = p.d = idiv(LATERAL * (n >= 0 ? 1 : -1) * 16, 24); }
  else { const n = p.J - p.a; if (Math.abs(n) <= 768) p.c = 0; else n4 = p.c = idiv(LATERAL * (n >= 0 ? 1 : -1) * 16, 24); }
  if (arrived(p)) {
    let bt = p.bt; const mask = pw.bh[bt][p.idx * 5 + 4] & 0xFF;
    let n9 = 0; if (rng.int(0, 100) < 30) n9 = 2; if (rng.int(0, 100) > 50) ++n9;
    let n10 = 0, n8;
    do { n8 = idiv(p.dir, 4) + pw.tz[n9 * 4 + n10++]; if (n8 < 0) n8 += 4; else n8 &= 3; } while ((mask & (1 << n8)) === 0 && n10 < 4);
    let by = linkByte(pw, bt, p.idx, n8), nb = -1;
    if (by === -1 || n10 === 4) {
      const s = neighbourNode(pw, p, bt, p.idx, idiv(p.dir, 4));
      if (s !== -1) { nb = s.block; by = s.idx; bt = blockType(pw, nb); } else if (by === -1) return;
    }
    if (nb === -1) setNodeLocal(pw, p, bt, by); else setNodeBlock(pw, p, nb, bt, by);
    if (n10 === 4 && nb === -1) { p.L = rng.int(1, 30) * 500; p.l = 0; }
  }
  accel(pw, p, p.vmax - p.h);
  if (n4 !== 0 && p.c === 0) p.c = n4;
  if (n5 !== 0 && p.d === 0) p.d = n5;
  faceTarget(pw, p, 1000);
  p.l = 0;
}
export function pedAnim(p) {                                                  // b.e(), (e&3)==1, no weapon
  const q = p.dir >> 2;
  if (p.kind >= 2) return q * 5 + (p.h === 0 ? 0 : p.h < 1280 ? 1 : 2) + 208 + (p.kind - 2) * 20;
  return q * 11 + (p.h === 0 ? 0 : p.h < 1280 ? 1 : 2) + 120 + p.kind * 44;
}

// ---- spawning: d.br() ---------------------------------------------------------------------------------------------
// view = {fU, fV}: integer camera position; player = {a,b}
const inView = (view, x8, y8) => x8 < (view.fU << 8) + 61440 && y8 < (view.fV << 8) + 70656 && x8 > (view.fU << 8) && y8 > (view.fV << 8);   // d.v()
export function cameraZones(pw, view) {                                                    // d.aC(): cN[], cL[]
  const cK = [0, 0, 240, 0, 0, 276, 240, 276], cN = [], cL = [];
  for (let i = 0; i < 4; i++) { const id = blockAt(pw, (view.fU + cK[i * 2]) << 8, (view.fV + cK[i * 2 + 1]) << 8); cN.push(id); cL.push(id < 0 ? -1 : blockType(pw, id)); }
  return { cN, cL };
}
function spawnPed(pw, view, player, zones) {
  const rng = pw.rng, w = pw.w;
  if (pw.max - pw.peds.length <= 0) return false;
  const n8 = rng.int(0, 4); let n9 = zones.cL[n8];
  if (n9 < 0 || !pw.bh[n9]) { n9 = blockType(pw, blockAt(pw, player.a, player.b)); if (!pw.bh[n9]) return false; }
  const cn = zones.cN[n8]; if (cn < 0) return false;
  const n10 = originX(pw, cn) << 8, n11 = originY(pw, cn) << 8, tab = pw.bh[n9], n12 = tab.length / 5;
  if (n12 === 0) return false;
  let n13 = rng.int(0, n12), n7 = 0, x, y, d2;
  do {
    n13 = (n13 + 1) % n12; x = nodeX(pw, n9, n13) + n10; y = nodeY(pw, n9, n13) + n11;
    const dx = x - player.a >> 8, dy = y - player.b >> 8; d2 = dx * dx + dy * dy;
  } while (n7++ < n12 && (inView(view, x - 3072, y - 6144) || inView(view, x + 3072, y) || d2 < 0 || d2 > SPAWN_DIST2));
  if (n7 >= n12) return false;
  x += rng.int(-768, 1024); y += rng.int(-768, 1024);
  const kind = rng.int(0, 100) > 40 ? 0 : 2;                                  // d.a(b,x,y,bl,n3), normal pedestrians only
  const pal = rng.int(1, 4);                                                    // b.a(d.a(1, bB[2].o >> 1)): palette 1..3 (o = 8 with night variants)
  const p = { pal, a: x, b: y, c: 0, d: 0, h: 0, dir: 0, l: 0, m: 0, L: 0, J: 0, K: 0, idx: 0, bt: 0, kind, vmax: WALK_MAX[kind], stuck: false, pa: x, pb: y, anim: null };
  setNodeLocal(pw, p, n9, n13);
  p.dir = rng.int(0, 4) << 2;
  pw.peds.push(p); return true;
}
// one game tick (bq() + per-entity c()); `view` = integer camera, `player` = {a,b} 8.8
export function pedsTick(pw, view, player) {
  const zones = cameraZones(pw, view);
  if ((pw.hd -= 100) <= 0) { spawnPed(pw, view, player, zones); pw.hd = 500 + pw.rng.int(0, 500); }
  for (const p of pw.peds) {
    p.pa = p.a; p.pb = p.b;
    p.l += 100; p.m += 100;
    move(pw, p); ai(pw, p);
  }
  // assumption: the original frees pedestrians once they are off-screen and outside the four camera blocks
  pw.peds = pw.peds.filter(p => {
    const id = blockAt(pw, p.a, p.b);
    const vis = p.a > (view.fU - 40 << 8) && p.a < (view.fU + 280 << 8) && p.b > (view.fV - 40 << 8) && p.b < (view.fV + 320 << 8);
    return vis || (id >= 0 && zones.cN.includes(id));
  });
}
