// test-mesh.js — mesh-core 单测 + signal.js 集成测试（Node 直接跑）
const M = require('./mesh-core.js');
const { spawn } = require('child_process');
const path = require('path');

let fail = 0;
const ok = (cond, name) => { console.log((cond ? '✅' : '❌') + ' ' + name); if (!cond) fail++; };

// ================= mesh-core 单测 =================

// 1) 发起方唯一性（两侧独立计算必须恰好一个发起）
ok(M.shouldInitiate('a', 'b') !== M.shouldInitiate('b', 'a'), 'tie-break 唯一发起方 (a,b)');
ok(M.shouldInitiate('0', '1') !== M.shouldInitiate('1', '0'), 'tie-break 数字字符串一致 (0,1)');
ok(M.shouldInitiate('10', '2') !== M.shouldInitiate('2', '10'), 'tie-break 字典序自洽 (10,2)');

// 2) 新 peer presence：发起方立即 initiate，被动方无动作
{
  const A = M.makeMesh('a'), B = M.makeMesh('b'); // a < b → a 发起
  const actA = M.onPresence(A, 'b', 1000);
  const actB = M.onPresence(B, 'a', 1000);
  ok(actA.length === 1 && actA[0].type === 'initiate' && actA[0].id === 'b', 'a 侧发起 initiate');
  ok(actB.length === 0, 'b 侧等待 offer（无动作）');
}

// 3) 协商中不重复发起；超时后 tick 重试；连接打开后不再动作
{
  const A = M.makeMesh('a');
  M.onPresence(A, 'b', 1000); // → negotiating, lastAttempt=1000
  const again = M.onPresence(A, 'b', 2000);
  ok(again.length === 0, '协商中收到重复 presence 不重复发起');
  ok(M.tick(A, 1000 + M.RETRY_MS).length === 0, '恰好到重试时间不触发（边界 > 而非 >=）');
  const retry = M.tick(A, 1000 + M.RETRY_MS + 1);
  ok(retry.length === 1 && retry[0].type === 'initiate' && retry[0].retry === true, '超时后 tick 触发重试');
  M.setConn(A, 'b', 'open');
  ok(M.tick(A, 1000 + M.RETRY_MS * 3).filter(a => a.type === 'initiate').length === 0, '连接打开后不再发起');
}

// 4) ICE failed → tick 重新发起（仅发起方）
{
  const A = M.makeMesh('a'), B = M.makeMesh('b');
  M.onPresence(A, 'b', 0); M.onPresence(B, 'a', 0);
  M.setConn(A, 'b', 'failed'); M.setConn(B, 'a', 'failed');
  ok(M.tick(A, 100).some(a => a.type === 'initiate'), '发起方 failed → 立即重试');
  ok(!M.tick(B, 100).some(a => a.type === 'initiate'), '被动方 failed → 不主动发起（等对端重试）');
}

// 5) bye → teardown + 移除；再次 presence → 重新发起
{
  const A = M.makeMesh('a');
  M.onPresence(A, 'b', 0); M.setConn(A, 'b', 'open');
  const bye = M.onBye(A, 'b');
  ok(bye.length === 1 && bye[0].type === 'teardown', 'bye → teardown 动作');
  const re = M.onPresence(A, 'b', 100);
  ok(re.length === 1 && re[0].type === 'initiate', 'bye 后再次 presence → 重新发起（自愈）');
}

// 6) 心跳型 presence：到时 announce + TTL 过期 teardown；无心跳模式不过期
{
  const A = M.makeMesh('a', { heartbeatMs: 5000 });
  M.onPresence(A, 'b', 0);
  const t1 = M.tick(A, 5000);
  ok(t1.some(a => a.type === 'announce'), '心跳间隔到 → announce 动作');
  const t2 = M.tick(A, M.PRESENCE_TTL + 1);
  ok(t2.some(a => a.type === 'teardown' && a.reason === 'presence-expired'), '心跳停发 → TTL 过期 teardown');
  const L = M.makeMesh('x'); // heartbeatMs=0：本地信令
  M.onPresence(L, 'y', 0);
  ok(!M.tick(L, 999999).some(a => a.type === 'teardown'), '无心跳模式 presence 不过期');
}

// 7) 6 页面全网状：每个页面恰有 5 个 peer，全房间 initiate 总数 = 15（每对恰好一次）
{
  const ids = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const meshes = new Map(ids.map(id => [id, M.makeMesh(id)]));
  let initiates = 0;
  for (const id of ids) for (const other of ids) {
    if (id !== other) initiates += M.onPresence(meshes.get(id), other, 0).filter(a => a.type === 'initiate').length;
  }
  ok(initiates === 15, '6 页 mesh initiate 总数 = C(6,2)=15（实际 ' + initiates + '）');
  ok([...meshes.values()].every(m => m.peers.size === 5), '每页恰好记录 5 个 peer');
}

// ================= signal.js 集成测试 =================
async function integrationTest() {
  const WebSocket = require('ws');
  const PORT = 3219;
  const srv = spawn(process.execPath, [path.join(__dirname, 'signal.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    srv.stdout.on('data', d => { if (String(d).includes('listening')) res(); });
    srv.stderr.on('data', d => console.error('[signal]', String(d)));
    setTimeout(() => rej(new Error('signal.js 启动超时')), 5000);
  });

  const url = 'ws://127.0.0.1:' + PORT;
  const mk = () => new WebSocket(url);
  const waitMsg = (ws, pred, ms) => new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('等消息超时')), ms || 3000);
    ws.on('message', function h(raw) {
      const m = JSON.parse(raw);
      if (pred(m)) { clearTimeout(to); ws.off('message', h); res(m); }
    });
  });
  const join = async (ws, room) => { const p = waitMsg(ws, m => m.type === 'joined'); ws.send(JSON.stringify({ type: 'join', room })); return p; };

  try {
    const c1 = mk(), c2 = mk(), c3 = mk();
    await Promise.all([c1, c2, c3].map(ws => new Promise(r => ws.on('open', r))));
    const j1 = await join(c1, 'it-room');
    const j2 = await join(c2, 'it-room');
    const pJoined3 = waitMsg(c1, m => m.type === 'peer-joined' && m.peerId === 2);
    const j3 = await join(c3, 'it-room');
    ok(j1.peerId === 0 && j1.existing.length === 0, 'c1 joined peerId=0 existing=[]');
    ok(j2.peerId === 1 && j2.existing.join() === '0', 'c2 joined peerId=1 existing=[0]');
    ok(j3.peerId === 2 && j3.existing.join() === '0,1', 'c3 joined peerId=2 existing=[0,1]');
    await pJoined3;
    ok(true, 'c1 收到 peer-joined(2)');

    // 定向 offer：c3 → c1，必须带 from=2，且 c2 收不到
    const offerP = waitMsg(c1, m => m.type === 'offer');
    const c2Silent = new Promise(res => setTimeout(res, 400));
    let c2Got = null;
    c2.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'offer') c2Got = m; });
    c3.send(JSON.stringify({ type: 'offer', to: 0, sdp: { type: 'offer', sdp: 'x' } }));
    const offer = await offerP;
    ok(offer.from === 2, '定向 offer 携带服务端盖章 from=2（实际 ' + offer.from + '）');
    await c2Silent;
    ok(c2Got === null, 'c2 收不到发给 c1 的定向 offer');

    // 定向 answer：c1 → c3，from=0
    const ansP = waitMsg(c3, m => m.type === 'answer');
    c1.send(JSON.stringify({ type: 'answer', to: 2, sdp: { type: 'answer', sdp: 'y' } }));
    const ans = await ansP;
    ok(ans.from === 0, '定向 answer 携带 from=0');

    // 广播 candidate（无 to）：c2、c3 都收到且 from=0，c1 自己收不到
    const b2 = waitMsg(c2, m => m.type === 'candidate');
    const b3 = waitMsg(c3, m => m.type === 'candidate');
    let c1Self = null;
    c1.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'candidate') c1Self = m; });
    c1.send(JSON.stringify({ type: 'candidate', candidate: { candidate: 'z' } }));
    const [m2, m3] = await Promise.all([b2, b3]);
    ok(m2.from === 0 && m3.from === 0, '广播 candidate 携带 from=0 且两人都收到');
    await new Promise(res => setTimeout(res, 400));
    ok(c1Self === null, '发送者自己收不到广播');

    // 离开通知
    const leftP = waitMsg(c1, m => m.type === 'peer-left' && m.peerId === 2);
    c3.close();
    await leftP;
    ok(true, 'c3 断开 → c1 收到 peer-left(2)');

    c1.close(); c2.close();
  } finally {
    srv.kill();
  }
}

(async () => {
  try {
    await integrationTest();
  } catch (e) {
    console.log('❌ 集成测试异常: ' + e.message);
    fail++;
  }
  console.log(fail === 0 ? '\n全部通过 🎉' : '\n有 ' + fail + ' 项失败');
  process.exit(fail ? 1 : 0);
})();
