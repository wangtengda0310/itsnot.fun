// signal.js — WebRTC 信令中继（房间广播模式）
// 用法: node signal.js

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebRTC Signaling Server\n');
});

const wss = new WebSocket.Server({ server });

// rooms: { roomName: [ws1, ws2, ...] }
const rooms = new Map();

function getRoomList(roomName) {
  if (!rooms.has(roomName)) rooms.set(roomName, []);
  return rooms.get(roomName);
}

wss.on('connection', (ws) => {
  ws._peerId = null;
  ws._room = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ---- join ----
    if (msg.type === 'join') {
      const room = msg.room || 'default';
      ws._room = room;
      const list = getRoomList(room);

      // 分配 peerId
      const peerId = list.length;
      ws._peerId = peerId;

      // 通知自己 joined（附带 peerId 供客户端回填 from）
      ws.send(JSON.stringify({
        type: 'joined',
        peerId: peerId,
        existing: list.map(c => c._peerId)
      }));

      // 通知其他人 peer-joined
      list.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'peer-joined', peerId }));
        }
      });

      // 加入房间
      list.push(ws);
      console.log(`[join] room=${room} peerId=${peerId} total=${list.length}`);
      return;
    }

    // ---- 转发 offer / answer / candidate ----
    // 服务端盖章发送方 peerId（多页面 mesh 路由必需），客户端不可伪造自己身份
    // msg.to 存在时定向转发，否则广播（向后兼容）
    if (['offer', 'answer', 'candidate'].includes(msg.type)) {
      const room = ws._room;
      if (!room) return;
      const out = JSON.stringify(Object.assign({}, msg, { from: ws._peerId }));
      const list = rooms.get(room) || [];
      list.forEach(client => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (msg.to != null) {
          if (client._peerId === msg.to) client.send(out);
        } else if (client !== ws) {
          client.send(out);
        }
      });
    }
  });

  ws.on('close', () => {
    if (ws._room) {
      const list = rooms.get(ws._room);
      if (list) {
        const idx = list.indexOf(ws);
        if (idx >= 0) list.splice(idx, 1);
        // 通知剩余成员
        list.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'peer-left', peerId: ws._peerId }));
          }
        });
        console.log(`[leave] room=${ws._room} peerId=${ws._peerId} remaining=${list.length}`);
      }
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Signaling server listening on ws://127.0.0.1:${PORT}`);
});
