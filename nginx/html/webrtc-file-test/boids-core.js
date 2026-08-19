// boids-core.js — 鸟群/捕食者 仿真内核（零依赖，可同时跑在页面与 Node 自测脚本）
// 实体归属权威：每个页面只仿真 all=true 的本地实体；远端实体仅作插值渲染与邻居输入。
(function (global) {
  'use strict';

  // ---- 参数（两端必须一致）----
  const P = {
    maxBoids: 300,            // 本地实体总数上限（鸟+捕食者合计）
    perClickBoids: 5,         // 鸟群角色每次点击生成几只
    perClickPredators: 1,     // 捕食者角色每次点击生成几只
    maxSpeed: 165,            // 鸟最大速度 px/s
    minSpeed: 55,
    maxForce: 430,            // 鸟最大转向力
    predatorMaxSpeed: 138,
    predatorMaxForce: 320,
    perception: 72,           // 邻居感知半径
    separationDist: 26,       // 分离半径
    wSep: 1.55,               // 分离权重
    wAli: 1.0,                // 对齐权重
    wCoh: 0.9,                // 凝聚权重
    wFlee: 2.7,               // 逃逸权重
    wChase: 1.0,              // 捕食者追逐权重
    fleeRadius: 175,          // 鸟感知捕食者半径
    chaseRadius: 330,         // 捕食者感知鸟半径
    catchRadius: 10,          // 捕食判定半径
    respawnDelay: 4.0,        // 鸟被吃后重生秒数
    predatorLife: 30,         // 捕食者寿命（秒，0=无限）
    margin: 4,
  };

  let _seq = 0;
  const uid = (peerId) =>
    (peerId || 'local') + '-' + (++_seq) + '-' + Math.random().toString(36).slice(2, 7);

  function makeWorld(peerId) {
    return {
      peerId,
      time: 0,
      local: new Map(),     // id -> 本地实体（我仿真）
      remote: new Map(),    // id -> 远端实体快照（含 from/to 插值段）
      remotePeers: new Set(),
      events: [],           // 供 UI 读取：{type:'eat'|'join'|...}
    };
  }

  function makeBoid(id, x, y) {
    const a = Math.random() * Math.PI * 2;
    const sp = P.minSpeed + Math.random() * (P.maxSpeed - P.minSpeed) * 0.6;
    return {
      id, kind: 'boid', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      deadUntil: 0,
    };
  }

  function makePredator(id, x, y) {
    const a = Math.random() * Math.PI * 2;
    return {
      id, kind: 'predator', x, y,
      vx: Math.cos(a) * 80, vy: Math.sin(a) * 80,
      bornAt: 0, // 由 world.time 赋值
    };
  }

  // 点击生成：返回需要广播给远端的新实体列表
  function spawnAt(world, role, x, y) {
    const out = [];
    const room = P.maxBoids - world.local.size;
    if (room <= 0) return out;
    const n = role === 'predator' ? P.perClickPredators : P.perClickBoids;
    for (let i = 0; i < Math.min(n, room); i++) {
      const id = uid(world.peerId);
      const jx = x + (Math.random() - 0.5) * 24;
      const jy = y + (Math.random() - 0.5) * 24;
      const e = role === 'predator' ? makePredator(id, jx, jy) : makeBoid(id, jx, jy);
      e.bornAt = world.time;
      world.local.set(id, e);
      out.push(e);
    }
    return out;
  }

  // ---- 远端快照应用 ----
  function applyRemoteState(world, peerId, entities, msgTime) {
    world.remotePeers.add(peerId);
    const now = world.time;
    const liveIds = new Set();
    for (const s of entities) {
      liveIds.add(s.id);
      let r = world.remote.get(s.id);
      if (!r) {
        r = { id: s.id, kind: s.k, owner: peerId, from: null, to: null, x: s.x, y: s.y, vx: 0, vy: 0 };
        world.remote.set(s.id, r);
      }
      // 上一段终点作为新起点
      const px = r.to ? r.to.x : s.x, py = r.to ? r.to.y : s.y;
      r.from = { t: now, x: px, y: py };
      r.to = { t: now + 0.1, x: s.x, y: s.y }; // 假设 10Hz，段长 100ms
      r.vx = s.vx; r.vy = s.vy;
      r.dead = !!s.d;
      r.lastMsg = msgTime || now;
    }
    // 对方不再广播的实体 → 移除（被吃/过期/离开）
    for (const [id, r] of world.remote) {
      if (r.owner === peerId && !liveIds.has(id)) world.remote.delete(id);
    }
  }

  function removePeer(world, peerId) {
    world.remotePeers.delete(peerId);
    for (const [id, r] of world.remote) if (r.owner === peerId) world.remote.delete(id);
  }

  // 远端实体当前渲染位置（线性插值 + 速度外推兜底）
  function remotePos(r, now) {
    if (!r.from || !r.to) return { x: r.x, y: r.y };
    const span = r.to.t - r.from.t || 0.1;
    let a = (now - r.from.t) / span;
    if (a > 1.6) a = 1.6; // 允许少量外推
    return { x: r.from.x + (r.to.x - r.from.x) * a, y: r.from.y + (r.to.y - r.from.y) * a };
  }

  // ---- 邻居收集：本地活体 + 远端插值位置 ----
  function collectNeighbors(world, now) {
    const list = [];
    for (const e of world.local.values()) {
      if (e.kind === 'boid' && now < e.deadUntil) continue;
      list.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, kind: e.kind, ref: e, remote: false });
    }
    for (const r of world.remote.values()) {
      if (r.dead) continue;
      const p = remotePos(r, now);
      list.push({ x: p.x, y: p.y, vx: r.vx, vy: r.vy, kind: r.kind, ref: r, remote: true });
    }
    return list;
  }

  function wrap(e, w, h) {
    if (e.x < -P.margin) e.x = w + P.margin; else if (e.x > w + P.margin) e.x = -P.margin;
    if (e.y < -P.margin) e.y = h + P.margin; else if (e.y > h + P.margin) e.y = -P.margin;
  }

  function limit(vx, vy, max) {
    const m = Math.hypot(vx, vy);
    if (m > max && m > 0) { const k = max / m; return [vx * k, vy * k]; }
    return [vx, vy];
  }

  // ---- 主步进 ----
  function step(world, dt, w, h) {
    world.time += dt;
    const now = world.time;
    const neighbors = collectNeighbors(world, now);
    const sepR2 = P.separationDist * P.separationDist;
    const perR2 = P.perception * P.perception;

    for (const e of world.local.values()) {
      if (e.kind === 'boid') {
        if (now < e.deadUntil) continue; // 被吃等待重生
        let sepX = 0, sepY = 0, sepN = 0;
        let aliX = 0, aliY = 0, aliN = 0;
        let cohX = 0, cohY = 0, cohN = 0;
        let fleeX = 0, fleeY = 0, fleeN = 0;

        for (const n of neighbors) {
          if (n.ref === e) continue;
          const dx = e.x - n.x, dy = e.y - n.y;
          const d2 = dx * dx + dy * dy;
          if (n.kind === 'predator') {
            if (d2 < P.fleeRadius * P.fleeRadius) {
              const d = Math.sqrt(d2) || 1;
              fleeX += dx / d; fleeY += dy / d; fleeN++;
            }
          } else {
            if (d2 < sepR2) { const d = Math.sqrt(d2) || 1; sepX += dx / d / d; sepY += dy / d / d; sepN++; }
            if (d2 < perR2) { aliX += n.vx; aliY += n.vy; aliN++; cohX += n.x; cohY += n.y; cohN++; }
          }
        }

        let ax = 0, ay = 0;
        if (sepN) { ax += sepX * P.wSep * 60; ay += sepY * P.wSep * 60; }
        if (aliN) { ax += ((aliX / aliN) - e.vx) * P.wAli; ay += ((aliY / aliN) - e.vy) * P.wAli; }
        if (cohN) { ax += ((cohX / cohN) - e.x) * P.wCoh; ay += ((cohY / cohN) - e.y) * P.wCoh; }
        if (fleeN) { ax += (fleeX / fleeN) * P.wFlee * 160; ay += (fleeY / fleeN) * P.wFlee * 160; }

        [ax, ay] = limit(ax, ay, P.maxForce);
        e.vx += ax * dt; e.vy += ay * dt;
        let sp = Math.hypot(e.vx, e.vy);
        if (sp > P.maxSpeed) { e.vx *= P.maxSpeed / sp; e.vy *= P.maxSpeed / sp; }
        else if (sp < P.minSpeed && sp > 0) { e.vx *= P.minSpeed / sp; e.vy *= P.minSpeed / sp; }
        e.x += e.vx * dt; e.y += e.vy * dt;
        wrap(e, w, h);
      } else {
        // ---- 捕食者：追最近的鸟（含远端鸟），到期自毁 ----
        if (P.predatorLife > 0 && now - e.bornAt > P.predatorLife) {
          world.local.delete(e.id);
          continue;
        }
        let best = null, bestD2 = P.chaseRadius * P.chaseRadius;
        for (const n of neighbors) {
          if (n.kind !== 'boid') continue;
          const dx = n.x - e.x, dy = n.y - e.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; best = n; }
        }
        let ax = 0, ay = 0;
        if (best) {
          const d = Math.sqrt(bestD2) || 1;
          ax = ((best.x - e.x) / d) * P.wChase * 260 + (best.vx - e.vx) * 0.6;
          ay = ((best.y - e.y) / d) * P.wChase * 260 + (best.vy - e.vy) * 0.6;
          // 捕食判定：只杀本地鸟；远端鸟由其 owner 自己判定（用远端插值位置）
          if (!best.remote && d < P.catchRadius) {
            best.ref.deadUntil = now + P.respawnDelay;
            world.events.push({ type: 'eat', x: best.ref.x, y: best.ref.y, t: now });
          }
        } else {
          // 无目标时漫游
          ax = Math.cos(now * 0.9 + e.x * 0.01) * 60;
          ay = Math.sin(now * 1.1 + e.y * 0.01) * 60;
        }
        [ax, ay] = limit(ax, ay, P.predatorMaxForce);
        e.vx += ax * dt; e.vy += ay * dt;
        [e.vx, e.vy] = limit(e.vx, e.vy, P.predatorMaxSpeed);
        e.x += e.vx * dt; e.y += e.vy * dt;
        wrap(e, w, h);
      }
    }
  }

  // 本地实体 → 广播快照（死的鸟也广播 d 标志，让远端显示消散）
  function snapshot(world) {
    const out = [];
    const now = world.time;
    for (const e of world.local.values()) {
      if (e.kind === 'boid' && now < e.deadUntil) {
        out.push({ id: e.id, k: 'boid', x: e.x, y: e.y, vx: 0, vy: 0, d: 1 });
      } else {
        out.push({ id: e.id, k: e.kind, x: +e.x.toFixed(1), y: +e.y.toFixed(1), vx: +e.vx.toFixed(1), vy: +e.vy.toFixed(1) });
      }
    }
    return out;
  }

  const api = { P, makeWorld, makeBoid, makePredator, spawnAt, applyRemoteState, removePeer, remotePos, step, snapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.BoidsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
