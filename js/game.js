// Browser shell: fixed 100 ms tick (as the original run() loop), state machine T, rendering to a 240x320 canvas.
import { loadMap, loadSprite, drawFrame } from './engine.js';
import { Input } from './input.js';
import * as S from './sim.js';
import * as P from './peds.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const dbg = document.getElementById('info');
const params = new URLSearchParams(location.search);
const input = new Input(); input.attach(window);
let showColl = params.has('coll');
addEventListener('keydown', e => { if (e.code === 'KeyC') showColl = !showColl; });

// T: game state, a small subset of the original numbering (d.ac()): 2 = level load, 7 = in-game.
let T = 2;
let world, mapImg, spr, sprPal, st, anim, pw, ctrOff = { x: 0, y: -18 };
let prev = null;                                        // state at the previous tick, for interpolation
const snap = () => ({ a: st.p.a, b: st.p.b, fW: st.cam.fW, fX: st.cam.fX });
const COLL_COLORS = ['rgba(0,255,0,.28)', 'rgba(0,120,255,.28)', 'rgba(255,0,0,.35)', 'rgba(255,255,0,.45)'];

async function load() {
  const tag = params.get('map') || 'city1_h';
  const [tables, map, objects] = await Promise.all([fetch('assets/tables/tables.json').then(r => r.json()), loadMap(tag), fetch(`assets/maps/${tag}_objects.json`).then(r => r.json())]);
  world = S.makeWorld(map.data, tables); mapImg = map.image;
  pw = P.makePedWorld(world, objects, params.has('seed') ? +params.get('seed') : (Date.now() & 0xFFFF));
  spr = await loadSprite('i_00');                       // player on foot: bB[2], animations d()*30 (+2 walking)
  sprPal = [spr, ...await Promise.all([1, 2, 3].map(n => loadSprite('i_00', n)))];   // pedestrian palettes
  anim = new S.AnimPlayer(spr.info);
  const sp = S.findSpawn(world);
  const p = S.makePlayer(sp.x, sp.y, 12), cam = S.makeCamera();
  S.cameraSnap(world, cam, p.a - 30720, p.b - 35328);
  st = { p, cam, tick: 0 };
  prev = snap();
  T = 7;
}

function playerSprite() {                               // current frame + bbox centre (stands in for b.m()/b.n())
  const a = anim.cur(); if (!a) return null;
  const im = spr.frames[a.frame], m = spr.info.frames[a.frame];
  return { a, im, m };
}

function update() {                                     // one tick of at()
  prev = snap();
  input.tick();
  const now = st.tick * S.TICK_MS;
  const dir = S.keyDirection(input.an);
  S.gameTick(world, st, dir, now, ctrOff);
  anim.set(S.playerAnimIndex(st.p)); anim.tick();
  const view = { fU: st.cam.fW >> 8, fV: st.cam.fX >> 8 };
  P.pedsTick(pw, view, st.p);                         // bq(): spawn + every pedestrian's c()
  for (const q of pw.peds) {
    q.anim ||= new S.AnimPlayer(spr.info);
    q.anim.set(P.pedAnim(q));
    const vis = (q.a >> 8) > view.fU - 30 && (q.a >> 8) < view.fU + 270 && (q.b >> 8) > view.fV - 30 && (q.b >> 8) < view.fV + 310;
    if (vis) q.anim.tick();                           // original only animates entities that are drawn
  }
  const f = playerSprite();
  if (f && f.im && f.m) ctrOff = { x: f.m.ox + (f.im.width >> 1), y: f.m.oy + (f.im.height >> 1) };
  st.tick++;
}

// Logic runs at 10 ticks/s like the original; drawing runs every display frame and blends the previous and
// current tick (alpha 0..1) so movement and camera are smooth. Sprite animation frames still change per tick.
function draw(alpha = 1) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 240, 320);
  const lerp = (x0, x1) => x0 + (x1 - x0) * alpha;
  const camW = lerp(prev.fW, st.cam.fW), camX = lerp(prev.fX, st.cam.fX);
  const pa = lerp(prev.a, st.p.a), pb = lerp(prev.b, st.p.b);
  const fU = Math.round(camW / 256), fV = Math.round(camX / 256);
  ctx.save(); ctx.beginPath(); ctx.rect(S.VIEW_X, S.VIEW_Y, S.VIEW_W, S.VIEW_H); ctx.clip();
  ctx.drawImage(mapImg, fU, fV, S.VIEW_W, S.VIEW_H, S.VIEW_X, S.VIEW_Y, S.VIEW_W, S.VIEW_H);
  if (showColl) {
    const T24 = world.T;
    for (let ty = Math.floor(fV / T24); ty <= Math.floor((fV + S.VIEW_H) / T24); ty++)
      for (let tx = Math.floor(fU / T24); tx <= Math.floor((fU + S.VIEW_W) / T24); tx++) {
        ctx.fillStyle = COLL_COLORS[world.collisionAt((tx * T24 + 1) << 8, (ty * T24 + 1) << 8)];
        ctx.fillRect(tx * T24 - fU, ty * T24 - fV + S.VIEW_Y, T24, T24);
      }
  }
  const px = Math.round(pa / 256) - fU, py = Math.round(pb / 256) - fV + S.VIEW_Y;
  const ents = pw.peds.map(q => ({ b: lerp(q.pb, q.b), x: Math.round(lerp(q.pa, q.a) / 256) - fU, y: Math.round(lerp(q.pb, q.b) / 256) - fV + S.VIEW_Y, anim: q.anim, spr: sprPal[q.pal] }));
  ents.push({ b: pb, x: px, y: py, anim, spr, player: true });
  ents.sort((u, v) => u.b - v.b);                     // assumption: draw order by depth (original uses layer lists)
  for (const e of ents) {
    const a = e.anim && e.anim.cur(); if (!a) continue;
    if (e.x < -40 || e.x > 280 || e.y < -20 || e.y > 340) continue;
    drawFrame(ctx, e.spr, a.frame, e.x + a.dx, e.y + a.dy, a.flip);
  }
  if (showColl) {                                       // hitboxes (21x15 px around the anchor)
    ctx.strokeStyle = '#fff'; ctx.strokeRect(px - 10.5, py - 7.5, 21, 15);
    ctx.strokeStyle = '#0ff'; for (const e of ents) if (!e.player) ctx.strokeRect(e.x - 10.5, e.y - 7.5, 21, 15);
  }
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = '9px monospace'; ctx.textBaseline = 'top';
  ctx.fillText('x ' + (st.p.a >> 8) + ' y ' + (st.p.b >> 8), 2, 4);
  dbg.textContent = `T=${T} tick=${st.tick} dir=${st.p.dir} h=${st.p.h} cam=${st.cam.fW >> 8},${st.cam.fX >> 8} пешеходов=${pw.peds.length}  [C — коллизии]`;
}

let last = performance.now(), acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (T !== 7) return;
  acc += Math.min(t - last, 500); last = t;
  while (acc >= S.TICK_MS) { acc -= S.TICK_MS; update(); }
  draw(acc / S.TICK_MS);
}
await load(); draw(1); requestAnimationFrame(frame);
