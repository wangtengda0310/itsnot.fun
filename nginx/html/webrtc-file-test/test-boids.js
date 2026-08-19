// test-boids.js — boids-core.js 的 Node 自测（非交付文件）
const C = require('./boids-core.js');

let fail = 0;
const ok = (cond, name) => { console.log((cond ? '✅' : '❌') + ' ' + name); if (!cond) fail++; };

const W = 800, H = 600;

// 1) 基础生成与步进
const w1 = C.makeWorld('A');
const spawned = C.spawnAt(w1, 'boid', 400, 300);
ok(spawned.length === C.P.perClickBoids, '点击生成鸟群数量 = ' + spawned.length);
const p = C.spawnAt(w1, 'predator', 100, 100);
ok(p.length === 1 && p[0].kind === 'predator', '点击生成捕食者');

for (let i = 0; i < 600; i++) C.step(w1, 1 / 60, W, H); // 10 秒
let nan = 0, out = 0;
for (const e of w1.local.values()) {
  if (!isFinite(e.x) || !isFinite(e.y) || !isFinite(e.vx) || !isFinite(e.vy)) nan++;
  if (e.x < -50 || e.x > W + 50 || e.y < -50 || e.y > H + 50) out++;
}
ok(nan === 0, '10 秒仿真无 NaN (' + w1.local.size + ' 实体)');
ok(out === 0, '实体全部 wrap 在边界内');

// 2) 逃逸行为：鸟在捕食者附近应远离
const w2 = C.makeWorld('A');
w2.local.clear();
const b = C.makeBoid('b1', 400, 300); b.vx = 0; b.vy = 0;
const pr = C.makePredator('p1', 430, 300); pr.vx = 0; pr.vy = 0;
w2.local.set('b1', b); w2.local.set('p1', pr);
for (let i = 0; i < 30; i++) C.step(w2, 1 / 60, W, H);
const dist = Math.hypot(b.x - pr.x, b.y - pr.y);
ok(b.vx < 0, '鸟产生远离捕食者的速度 (vx=' + b.vx.toFixed(1) + ')');

// 3) 捕食与重生
const w3 = C.makeWorld('A');
w3.local.clear();
const b3 = C.makeBoid('b1', 400, 300); b3.vx = 0; b3.vy = 0;
const p3 = C.makePredator('p1', 405, 300); p3.vx = 0; p3.vy = 0;
w3.local.set('b1', b3); w3.local.set('p1', p3);
C.step(w3, 1 / 60, W, H);
ok(b3.deadUntil > 0, '捕食者近身 → 鸟被吃 (deadUntil=' + b3.deadUntil.toFixed(2) + ')');
ok(w3.events.some(e => e.type === 'eat'), '产生 eat 事件');
for (let i = 0; i < 60 * (C.P.respawnDelay + 1); i++) C.step(w3, 1 / 60, W, H);
ok(w3.time > b3.deadUntil, '重生时间过后鸟复活');

// 4) 快照与远端应用 + 插值
const w4 = C.makeWorld('A');
C.spawnAt(w4, 'boid', 100, 100);
for (let i = 0; i < 30; i++) C.step(w4, 1 / 60, W, H);
const snap = C.snapshot(w4);
ok(snap.length === w4.local.size, '快照包含全部本地实体 (' + snap.length + ')');
ok(snap.every(s => isFinite(s.x) && isFinite(s.y)), '快照坐标有限');

const w5 = C.makeWorld('B');
C.applyRemoteState(w5, 'A', snap, 0);
ok(w5.remote.size === snap.length, '远端实体全部入库');
const first = w5.remote.values().next().value;
const r = first;
C.applyRemoteState(w5, 'A', [{ id: r.id, k: r.kind, x: r.to.x + 10, y: r.to.y, vx: 100, vy: 0 }], 0.1);
const pos = C.remotePos(r, w5.time + 0.05);
ok(isFinite(pos.x) && pos.x > r.from.x - 1, '远端插值位置有效 x=' + pos.x.toFixed(1));

// 5) 远端实体参与邻居计算：远端捕食者让本地鸟逃逸
const w6 = C.makeWorld('B');
w6.local.clear();
const b6 = C.makeBoid('b1', 400, 300); b6.vx = 0; b6.vy = 0;
w6.local.set('b1', b6);
C.applyRemoteState(w6, 'A', [{ id: 'rp', k: 'predator', x: 430, y: 300, vx: 0, vy: 0 }], 0);
for (let i = 0; i < 30; i++) C.step(w6, 1 / 60, W, H);
ok(b6.vx < 0, '本地鸟逃离远端捕食者 (vx=' + b6.vx.toFixed(1) + ')');

// 6) 远端鸟不被本地捕食者直接杀死（owner 权威）
const w7 = C.makeWorld('B');
w7.local.clear();
const p7 = C.makePredator('p1', 400, 300); p7.vx = 0; p7.vy = 0;
w7.local.set('p1', p7);
C.applyRemoteState(w7, 'A', [{ id: 'rb', k: 'boid', x: 405, y: 300, vx: 0, vy: 0 }], 0);
C.step(w7, 1 / 60, W, H);
ok(!w7.events.some(e => e.type === 'eat'), '本地捕食者不判远端鸟死亡');
ok(w7.remote.get('rb') && !w7.remote.get('rb').dead, '远端鸟状态不受本地影响');

// 7) peer 离开清理
C.removePeer(w7, 'A');
ok(w7.remote.size === 0, 'removePeer 清空其远端实体');

// 8) 数量上限
const w8 = C.makeWorld('A');
let total = 0;
for (let i = 0; i < 100; i++) total += C.spawnAt(w8, 'boid', 0, 0).length;
ok(total === C.P.maxBoids, '本地实体上限生效 total=' + total);

// 9) 长时间稳定性（60 秒，含捕食者过期）
const w9 = C.makeWorld('A');
C.spawnAt(w9, 'boid', 200, 200); C.spawnAt(w9, 'boid', 600, 400);
C.spawnAt(w9, 'predator', 400, 300);
for (let i = 0; i < 60 * 60; i++) C.step(w9, 1 / 60, W, H);
let bad = 0;
for (const e of w9.local.values()) if (!isFinite(e.x + e.y + e.vx + e.vy)) bad++;
ok(bad === 0, '60 秒长跑无 NaN');
ok([...w9.local.values()].filter(e => e.kind === 'predator').length === 0, '捕食者寿命到期自动移除');

// 10) 远端穿边界渲染连续性（回归：此前跨屏插值导致瞬移）
// 注意：remotePos 返回归一化坐标，穿缝时 799→1 是正确渲染；视觉连续性要用环面距离衡量
{
  const A = C.makeWorld('A'); A.local.clear();
  const bw = C.makeBoid('wb', 750, 300); bw.vx = 165; bw.vy = 0;
  A.local.set('wb', bw);
  const Bw = C.makeWorld('B');
  let sent = -1, prevX = null, maxJump = 0;
  for (let t = 0; t < 1.2; t += 1 / 60) {
    C.step(A, 1 / 60, W, H);
    if (t - sent >= 0.066) { sent = t; C.applyRemoteState(Bw, 'A', C.snapshot(A, W, H), Bw.time, W, H); }
    C.step(Bw, 1 / 60, W, H);
    const r = Bw.remote.get('wb');
    if (!r) continue;
    const p = C.remotePos(r, Bw.time, W, H);
    if (prevX !== null) maxJump = Math.max(maxJump, Math.abs(C.wrapDelta(p.x - prevX, W)));
    prevX = p.x;
  }
  ok(maxJump < 30, '远端鸟穿边界渲染连续 maxJump(环面)=' + maxJump.toFixed(1) + 'px/帧（修复前 ~800px）');
}

// 11) 跨缝逃逸：本地鸟在左边缘，远端捕食者在右边缘（环面上捕食者在鸟左侧 10px，鸟应向右逃）
{
  const ws = C.makeWorld('B'); ws.local.clear();
  const bs = C.makeBoid('b1', 5, 300); bs.vx = 0; bs.vy = 0;
  ws.local.set('b1', bs);
  C.applyRemoteState(ws, 'A', [{ id: 'rp', k: 'predator', x: 795, y: 300, vx: 0, vy: 0 }], 0, W, H);
  for (let i = 0; i < 30; i++) C.step(ws, 1 / 60, W, H);
  ok(bs.vx > 0, '本地鸟跨缝逃离远端捕食者 (vx=' + bs.vx.toFixed(1) + '，向右远离左侧的鹰)');
}

// 12) 跨缝追猎：本地捕食者在右边缘追左边缘的本地鸟
{
  const wc = C.makeWorld('A'); wc.local.clear();
  const bc = C.makeBoid('b1', 5, 300); bc.vx = 0; bc.vy = 0;
  const pc = C.makePredator('p1', 790, 300); pc.vx = 0; pc.vy = 0;
  wc.local.set('b1', bc); wc.local.set('p1', pc);
  C.step(wc, 1 / 60, W, H);
  ok(pc.vx > 0, '捕食者跨缝追猎 vx=' + pc.vx.toFixed(1) + '（向右穿出边界）');
}

// 13) 平稳飞行远端渲染平滑（回归：此前插值段重叠导致周期性前跳）
// 环面距离测量：排除穿缝时归一化坐标表示的合法跳变
{
  const A4 = C.makeWorld('A'); A4.local.clear();
  const b4 = C.makeBoid('s1', 200, 200); b4.vx = 165; b4.vy = 0;
  A4.local.set('s1', b4);
  const B4 = C.makeWorld('B');
  let sent4 = -1, prev4 = null; const ds = [];
  for (let t = 0; t < 0.5; t += 1 / 60) {
    C.step(A4, 1 / 60, W, H);
    if (t - sent4 >= 0.066) { sent4 = t; C.applyRemoteState(B4, 'A', C.snapshot(A4, W, H), B4.time, W, H); }
    C.step(B4, 1 / 60, W, H);
    const r = B4.remote.get('s1');
    if (!r) continue;
    const p = C.remotePos(r, B4.time, W, H);
    if (prev4 !== null) ds.push(C.wrapDelta(p.x - prev4, W));
    prev4 = p.x;
  }
  const jit = ds.filter(d => d > 4 || (d !== 0 && d < 1.5)).length; // d=0 为收到首个快照前的暖启动帧
  ok(jit === 0, '远端匀速渲染平滑无抖动 (' + jit + '/' + ds.length + '，修复前 9/30)');
}

// 14) 无 w/h 调用向后兼容
{
  const Bc = C.makeWorld('B');
  C.applyRemoteState(Bc, 'A', [{ id: 'x', k: 'boid', x: 10, y: 10, vx: 0, vy: 0 }], 0);
  const r = Bc.remote.get('x');
  const p = C.remotePos(r, 0);
  ok(isFinite(p.x) && isFinite(p.y), 'remotePos/applyRemoteState 不传 w/h 仍可用');
}

console.log(fail === 0 ? '\n全部通过 🎉' : '\n有 ' + fail + ' 项失败');
process.exit(fail ? 1 : 0);
