// mesh-core.js — mesh 组网策略（纯逻辑零依赖，Node/浏览器通用）
// 页面只负责执行动作（建 PC / 发心跳 / 拆除），所有"谁发起、何时重试、谁已离线"的决策都在这里，可测试。
(function (global) {
  'use strict';

  const HEARTBEAT_MS = 5000;   // 在线名单心跳间隔（仅 MQTT/Itty 等会丢消息的信令需要）
  const RETRY_MS = 8000;       // 协商未成功时的重试间隔
  const PRESENCE_TTL = 16000;  // 心跳型 presence 超过此时长未刷新 → 判定离线（>2 次心跳）

  // 确定唯一发起方：字典序小的一侧发 offer。两侧独立计算结果一致 → 无双向同时发（glare）
  // 注意：对数字字符串按字典序也自洽（'10'<'2' 虽数值不对，但两边算出来一样，够用）
  function shouldInitiate(selfId, peerId) {
    return String(selfId) < String(peerId);
  }

  // connState 由页面镜像写入：'none' | 'negotiating' | 'open' | 'failed'
  function makeMesh(selfId, opts) {
    opts = opts || {};
    return {
      selfId: String(selfId),
      heartbeatMs: opts.heartbeatMs || 0, // 0 = 信令层 presence 可靠（本地 signal.js / Trystero），无需心跳
      peers: new Map(),                   // id -> { lastSeen, conn, lastAttempt, initiator }
      lastAnnounce: 0,
    };
  }

  // 收到某 peer 的 presence（join / hi / hello / 心跳）
  // 返回动作数组，页面逐条执行。动作: {type:'initiate'|'announce-back'|'teardown', id}
  function onPresence(mesh, peerId, now) {
    peerId = String(peerId);
    if (peerId === mesh.selfId) return [];
    let p = mesh.peers.get(peerId);
    const isNew = !p;
    if (isNew) {
      p = { lastSeen: 0, conn: 'none', lastAttempt: 0, initiator: shouldInitiate(mesh.selfId, peerId) };
      mesh.peers.set(peerId, p);
    }
    p.lastSeen = now;
    // 已有连接或正在协商 → 无需动作（重试交给 tick）
    if (p.conn === 'open' || p.conn === 'negotiating') return [];
    if (p.conn === 'failed' || p.conn === 'none') {
      if (p.initiator) {
        p.conn = 'negotiating';
        p.lastAttempt = now;
        return [{ type: 'initiate', id: peerId }];
      }
      return []; // 被动方：等 offer（offer 到达时页面会建 PC）
    }
    return [];
  }

  // 显式离开（bye / peer-left）
  function onBye(mesh, peerId) {
    peerId = String(peerId);
    if (!mesh.peers.has(peerId)) return [];
    mesh.peers.delete(peerId);
    return [{ type: 'teardown', id: peerId }];
  }

  // 页面镜像连接状态
  function setConn(mesh, peerId, conn) {
    const p = mesh.peers.get(String(peerId));
    if (p) p.conn = conn;
  }

  // 周期检查：心跳 / 超时重试 / presence 过期
  function tick(mesh, now) {
    const actions = [];
    if (mesh.heartbeatMs > 0 && now - mesh.lastAnnounce >= mesh.heartbeatMs) {
      mesh.lastAnnounce = now;
      actions.push({ type: 'announce' });
    }
    for (const [id, p] of mesh.peers) {
      if (mesh.heartbeatMs > 0 && now - p.lastSeen > PRESENCE_TTL) {
        mesh.peers.delete(id);
        actions.push({ type: 'teardown', id, reason: 'presence-expired' });
        continue;
      }
      if (p.conn === 'open') continue;
      if (!p.initiator) continue; // 被动方只等 offer
      if (p.conn === 'failed' || (p.conn === 'negotiating' && now - p.lastAttempt > RETRY_MS)) {
        p.conn = 'negotiating';
        p.lastAttempt = now;
        actions.push({ type: 'initiate', id, retry: true });
      }
    }
    return actions;
  }

  const api = { HEARTBEAT_MS, RETRY_MS, PRESENCE_TTL, shouldInitiate, makeMesh, onPresence, onBye, setConn, tick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MeshCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
