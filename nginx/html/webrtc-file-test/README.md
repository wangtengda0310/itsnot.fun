# WebRTC file:// 防呆测试 v3

## 修复内容（v3）

### v2 的 Bug
B 收到 `joined` 消息时，如果 `existing.length > 0`，代码**没有触发 offer**，
只等 `peer-joined` 事件。但 B 作为后到者，必须在收到 `joined(existing>0)` 时立即发 offer。

### v3 的修复
1. **B 在 `joined` 事件里检查 `existing.length > 0` → 立即 `createPCAndOffer()`**
2. 增加 `offerPending` 标志，防止重复协商
3. `setTimeout(50ms)` 确保信令消息顺序处理完再创建 PC
4. ICE 收集完成增加日志
5. `peer-left` 事件处理

## 使用步骤

```powershell
# 1. 安装依赖
npm install

# 2. 启动信令服务器
node signal.js
# → Signaling server listening on ws://127.0.0.1:3001

# 3. 浏览器打开 webrtc-file-test.html（两个窗口）
#    窗口 A：选 🅰️ 页面 A → 点 🔌 连接信令
#    窗口 B：选 🅱️ 页面 B → 点 🔌 连接信令
#    等 ✅✅✅ DataChannel 已打开！
#    互发消息验证
```

## 预期日志（成功）

### 页面 A（先开）
```
📋 页面就绪（file:// 模式 v3）
🎯 角色: 🅰️ 页面A（先到者/answerer）
🔌 连接信令: ws://127.0.0.1:3001
✅ 信令 WS 已连接
📨 join → [boids-test-001]  myId=xxxx
📩 joined (peerId=0) existing=[]
   → 我是房间第一个人，等待对方加入…
📩 peer-joined (peerId=1)
   → 我是A，等待B的offer…
📩 收到 Offer (SDP)
📥 设置 Remote Offer 完成
📤 发送 Answer (SDP)
📤 发送 ICE candidate
🔄 PC 状态: connected
✅✅✅ DataChannel 已打开！可以发消息了
```

### 页面 B（后开）
```
📋 页面就绪（file:// 模式 v3）
🎯 角色: 🅱️ 页面B（后到者/offerer）
🔌 连接信令: ws://127.0.0.1:3001
✅ 信令 WS 已连接
📨 join → [boids-test-001]  myId=yyyy
📩 joined (peerId=1) existing=[0]
   → 我是B，房间已有 1 人，立即发起 offer  ← v3 修复点
🔧 创建 RTCPeerConnection（B/offerer）
📡 DataChannel [B 创建]
📤 发送 Offer (SDP)
📩 收到 Answer (SDP)
📤 发送 ICE candidate
📤 ICE 收集完成
🔄 PC 状态: connected
✅✅✅ DataChannel 已打开！可以发消息了
```

## 文件清单
- `webrtc-file-test.html` — 测试页面（v3 修复版）
- `signal.js` — 本地信令服务器
- `package.json` — 依赖声明
- `README.md` — 本文件
