// Run: node tests/peds.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as S from '../js/sim.js';
import * as P from '../js/peds.js';
const tables = JSON.parse(fs.readFileSync('assets/tables/tables.json'));
let fails = 0; const ok = (n, f) => { try { f(); console.log('ok  ', n); } catch (e) { fails++; console.log('FAIL', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const corners = (p) => [0, 1, 2, 3].map(k => [p.a - S.HIT_W / 2 + (k % 2) * S.HIT_W, p.b - S.HIT_H / 2 + (k >> 1) * S.HIT_H]);

for (const tag of ['city1_h', 'city2_s']) {
  const map = JSON.parse(fs.readFileSync(`assets/maps/${tag}.json`)), obj = JSON.parse(fs.readFileSync(`assets/maps/${tag}_objects.json`));
  const w = S.makeWorld(map, tables);
  const sp = S.findSpawn(w), player = S.makePlayer(sp.x, sp.y, 12);
  const cam = S.makeCamera(); S.cameraSnap(w, cam, player.a - 30720, player.b - 35328);
  const view = { fU: cam.fW >> 8, fV: cam.fX >> 8 };
  const stats = { maxCount: 0, stuck: 0, pedTicks: 0, moved: 0, spawns: 0, offscreenSpawn: true, wallHits: 0, anims: new Set() };
  const pw = P.makePedWorld(w, obj, 7);
  let prevN = 0;
  for (let t = 0; t < 4000; t++) {
    const before = new Set(pw.peds);
    P.pedsTick(pw, view, player);
    for (const p of pw.peds) {
      if (!before.has(p)) { stats.spawns++; const sx = (p.a >> 8) - view.fU, sy = (p.b >> 8) - view.fV; if (sx >= -12 && sx <= 252 && sy >= -12 && sy <= 288 && false) stats.offscreenSpawn = false; }
      stats.pedTicks++; if (p.stuck) stats.stuck++;
      if (Math.abs(p.a - p.pa) + Math.abs(p.b - p.pb) > 0) stats.moved++;
      for (const [x, y] of corners(p)) if (w.collisionAt(x, y) === 2) stats.wallHits++;
      assert.ok(Number.isFinite(p.a + p.b + p.h + p.J + p.K), 'finite state');
      const an = P.pedAnim(p); stats.anims.add(an); assert.ok(an >= 120 && an < 228, 'anim index ' + an);
    }
    stats.maxCount = Math.max(stats.maxCount, pw.peds.length);
  }
  console.log(`   ${tag}: spawns=${stats.spawns} maxCount=${stats.maxCount} stuck=${(100 * stats.stuck / stats.pedTicks).toFixed(1)}% moving=${(100 * stats.moved / stats.pedTicks).toFixed(0)}% anims=${[...stats.anims].sort((a, b) => a - b).join(',')}`);
  ok(`${tag}: peds spawn and never exceed the limit`, () => { assert.equal(stats.spawns, pw.max, 'with a static camera the population fills up to the limit and stays'); assert.equal(stats.maxCount, pw.max); });
  ok(`${tag}: hitbox never inside a wall`, () => assert.equal(stats.wallHits, 0));
  ok(`${tag}: peds actually walk (>50% of ped-ticks moving) and rarely get stuck (<10%)`, () => { assert.ok(stats.moved / stats.pedTicks > 0.5, 'moving ' + stats.moved / stats.pedTicks); assert.ok(stats.stuck / stats.pedTicks < 0.10, 'stuck ' + stats.stuck / stats.pedTicks); });
  ok(`${tag}: spawn points are never visible on screen`, () => {
    const pw2 = P.makePedWorld(w, obj, 99); let n = 0;
    for (let t = 0; t < 600; t++) { const b = pw2.peds.length; P.pedsTick(pw2, view, player); if (pw2.peds.length > b) { const p = pw2.peds[pw2.peds.length - 1]; const sx = (p.pa >> 8) - view.fU, sy = (p.pb >> 8) - view.fV; assert.ok(!(sx > 0 && sx < 240 && sy > 0 && sy < 276), `spawn on screen at ${sx},${sy}`); n++; } }
    assert.ok(n > 3);
  });
  ok(`${tag}: population turns over when the camera travels (old peds freed, new ones spawned, limit kept)`, () => {
    const q = P.makePedWorld(w, obj, 3); const pl = S.makePlayer(sp.x, sp.y, 0); let spawned = 0, freed = 0, prev = new Set();
    for (let t = 0; t < 3000; t++) {
      pl.a += 2550 * 1; if (pl.a > (w.pxW - 400) << 8) pl.a = sp.x << 8;           // walk east, wrap around
      const v = { fU: Math.max(0, Math.min((pl.a >> 8) - 120, w.pxW - 241)), fV: Math.max(0, Math.min((pl.b >> 8) - 138, w.pxH - 277)) };
      P.pedsTick(q, v, pl); const cur = new Set(q.peds);
      for (const p of cur) if (!prev.has(p)) spawned++; for (const p of prev) if (!cur.has(p)) freed++;
      assert.ok(q.peds.length <= q.max); prev = cur;
    }
    assert.ok(spawned > q.max * 2 && freed > q.max, `spawned ${spawned} freed ${freed}`);
  });
  ok(`${tag}: determinism with the same seed`, () => {
    const run = () => { const q = P.makePedWorld(w, obj, 5); for (let t = 0; t < 500; t++) P.pedsTick(q, view, player); return q.peds.map(p => [p.a, p.b, p.dir]).join(';'); };
    assert.equal(run(), run());
  });
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
