const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')

// 按优先级加载 .env：im-server/.env > 主服务 .env > 主服务 .env.local > 已有 process.env
// dotenv 不会覆盖已存在的环境变量，因此先加载的优先。
const __srcDir = __dirname
const envFiles = [
  path.join(__srcDir, '..', '.env'), // im-server/.env
  path.join(__srcDir, '..', '..', '.env'), // 主服务 .env
  path.join(__srcDir, '..', '..', '.env.local'), // 主服务 .env.local
]
for (const p of envFiles) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p })
  }
}

// JWT 密钥：与主服务 src/lib/auth.ts 同一套（JWT_SECRET，兼容别名 SECRET）
const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET || ''

const config = {
  PORT: Number(process.env.IM_PORT || process.env.PORT || 3002),
  // 绑定地址：默认仅回环，公网访问一律经 nginx 反代（安全加固 20260908）
  HOST: process.env.IM_HOST || '127.0.0.1',
  JWT_SECRET,
  DATABASE_URL: process.env.IM_DATABASE_URL || process.env.DATABASE_URL || '',
  STORE: (process.env.IM_STORE || 'auto').toLowerCase(), // auto | memory | prisma
  HEARTBEAT_MS: Number(process.env.IM_HEARTBEAT_MS || 30000),
  HEARTBEAT_TIMEOUT_MS: Number(process.env.IM_HEARTBEAT_TIMEOUT_MS || 10000),
  NOTIFY_CHANNEL: process.env.IM_NOTIFY_CHANNEL || 'im_events',
  SEED_DEMO: (process.env.IM_SEED_DEMO || 'false').toLowerCase() === 'true',
  ROOM_CONV: id => `conv:${id}`,
  ROOM_USER: id => `user:${id}`,

  // ── 通话（SDLC 20260905-im-video-call）──
  // TURN 凭证从环境读取（不进 git）；TURN_URLS 逗号分隔
  TURN_URLS: process.env.TURN_URLS || '',
  TURN_USERNAME: process.env.TURN_USERNAME || '',
  TURN_CREDENTIAL: process.env.TURN_CREDENTIAL || '',
  CALL_RING_TIMEOUT_MS: Number(process.env.IM_CALL_RING_TIMEOUT_MS || 45000),
  CALL_GRACE_MS: Number(process.env.IM_CALL_GRACE_MS || 10000),
  CALL_ENDED_TTL_MS: Number(process.env.IM_CALL_ENDED_TTL_MS || 60000),
}

// 下发给客户端的 ICE 服务器列表（invite ack 与 call:incoming 携带）
config.iceServers = function iceServers() {
  const urls = (config.TURN_URLS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (!urls.length) return []
  const hasTurn = urls.some(u => u.startsWith('turn:'))
  if (hasTurn && config.TURN_USERNAME && config.TURN_CREDENTIAL) {
    return [
      {
        urls,
        username: config.TURN_USERNAME,
        credential: config.TURN_CREDENTIAL,
      },
    ]
  }
  return [{ urls }]
}

module.exports = config
