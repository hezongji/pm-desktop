const jwt = require('jsonwebtoken')
const config = require('./config')

/**
 * 验证 JWT，返回 { userId, email, role, name, ver }；无效返回 null。
 * 与主服务 src/lib/auth.ts 的 verifyAuthToken 保持同一载荷约定（HS256）。
 *
 * ★ 20260908 生产审计修复 P0-新1：必须回传 ver（令牌版本）。
 *   主服务登出/改密会自增 User.tokenVersion，握手侧拿 ver 与 DB 比对即可即时吊销；
 *   此前漏传 ver 导致 server.js 恒按 0 比对 → tokenVersion>0 的用户永久连不上 IM。
 */
function verifyToken(token) {
  if (!token) return null
  if (!config.JWT_SECRET) return null
  try {
    const payload = jwt.verify(token, config.JWT_SECRET)
    if (!payload || !payload.userId) return null
    return {
      userId: payload.userId,
      email: payload.email || payload.userId,
      role: payload.role || 'USER',
      name: payload.name || payload.email || payload.userId,
      // 旧令牌无 ver 声明按 0 处理，与 DB 默认值一致
      ver: Number(payload.ver ?? 0) || 0,
    }
  } catch {
    return null
  }
}

/**
 * 从 Socket.IO 握手信息中提取 token（§9.1：URL ?token=<JWT>，兼容 Bearer / auth.token）
 */
function extractToken(handshake) {
  const query = handshake.query || {}
  const auth = handshake.auth || {}
  const headers = handshake.headers || {}

  if (typeof query.token === 'string' && query.token) return query.token
  if (typeof auth.token === 'string' && auth.token) return auth.token

  const authorization = headers.authorization || ''
  if (authorization.startsWith('Bearer ')) return authorization.substring(7)

  return null
}

module.exports = { verifyToken, extractToken }
