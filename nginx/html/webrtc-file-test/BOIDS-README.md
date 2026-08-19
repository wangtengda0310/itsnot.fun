# WebRTC 鸟群/捕食者 互联演示

基于 WebRTC DataChannel 的多页面 boids 仿真。**实体归属权威**架构：
每个页面只仿真自己点击生成的实体（邻居计算包含远端实体的最新插值位置），
约 15Hz 向所有 peer 广播位置/速度快照，远端实体插值渲染 ——
两边看到的是**同一个系统**，且任一方关闭不影响另一方的实体。

## 快速开始（本机双窗口）

```powershell
npm install
node signal.js        # ws://127.0.0.1:3001
```

浏览器打开 `webrtc-boids.html` 两个窗口（`file://` 直接打开即可）：

1. 两边信令都选 **本地 signal.js**，房间名保持一致 → 点 🔌 连接
2. 窗口 A 角色选 🐦 鸟群，点击画布放鸟
3. 窗口 B 角色选 🦅 捕食者，点击画布放鹰
4. 鹰会跨页面追鸟，鸟被吃后 4 秒重生

## 信令方式（页面顶部可切换，全部免注册）

| 方式 | 地址/服务 | 适用 |
|---|---|---|
| 本地 signal.js | `ws://127.0.0.1:3001` | 本机双窗口 |
| 公共 MQTT | EMQX / Mosquitto / HiveMQ | 跨电脑、多页面 |
| PeerJS 云 | `0.peerjs.com` | 两台电脑一对一（手动交换 ID） |
| Trystero | 公共 Nostr relay | 跨电脑、多页面，零配置 |
| Itty Sockets | `wss://itty.ws` | 跨电脑、多页面，零配置 |

> ⚠️ 公共 MQTT / Itty 为公开频道，房间名建议改成独特字符串防撞车；
> 公共服务上消息对所有人可见，勿传敏感数据。
> CDN 依赖（mqtt.js / peerjs / esm.run）需要联网加载一次。

## 同步协议（DataChannel，JSON）

| 消息 | 方向 | 说明 |
|---|---|---|
| `{t:'hello', role}` | 建连时 | 角色通告 |
| `{t:'state', e:[...]}` | 15Hz 广播 | 本地实体快照 `{id,k,x,y,vx,vy,d?}` |
| `{t:'spawn'}` | 点击时 | 生成通告（即时反馈用，权威以 state 为准） |
| `{t:'clear'}` | 手动清空 | 移除该 peer 全部远端实体 |
| `{t:'ping'/'pong'}` | 测 RTT | |

mesh 组网：后到者向已在房间者发起 offer（与 webrtc-file-test v3 相同的策略）。
多页面（>2）时任意两两之间都建立 DataChannel。

## 仿真规则

- 鸟：分离 / 对齐 / 凝聚三规则 + 逃离 175px 内捕食者，最大速度 165px/s
- 捕食者：追 330px 内最近的鸟（含远端鸟），寿命 30 秒后自动消失
- 捕食判定：只杀**本地**鸟（远端鸟由其 owner 用插值位置自行判定），被吃 4 秒后重生
- 本地实体上限 300，边界 wrap-around

## 文件

- `webrtc-boids.html` — 演示页面（UI + 信令适配层 + mesh 连接层 + 渲染）
- `boids-core.js` — 仿真内核（零依赖，页面与 Node 通用）
- `test-boids.js` — 内核自测：`node test-boids.js`（19 项断言）
- `signal.js` — 本地信令服务器（已加定向转发 `msg.to`，向后兼容广播）
- `webrtc-file-test.html` — 原 v3 防呆测试页面
