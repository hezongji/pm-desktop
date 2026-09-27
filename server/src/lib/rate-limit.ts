/**
 * 登录速率限制（2026-08-22 深度评测 P1-3 修复；20260908 生产审计加固）
 *
 * 内存级滑动窗口，双维度计数：
 *   - 账号维度：同一账号（规范化 subject）跨 IP 累计失败 → 5 次锁定 15 分钟（防定向撞库）
 *   - IP 维度：同一出口 IP 跨账号累计失败 → 30 次锁定 15 分钟（防单 IP 广撒网）
 * 锁定期内即使密码正确也拒绝。
 *
 * 20260908 生产审计修复点：
 *   P1-1 客户端可伪造 X-Forwarded-For 绕过限流 → 只信任 nginx 注入的 X-Real-IP；
 *   P1-2 email/username/姓名三套标识符各自独立计数 → 调用方用 accountSubject() 传
 *        规范化 subject（优先 userId），同一人只有一个计数桶；
 *   P2-6 单进程内存实现（重启清零）——当前生产为 standalone 单实例，可接受；
 *        多实例部署需换 Redis 等共享存储。
 */

interface FailEntry {
  count: number
  lockedUntil: number | null
  firstFailAt: number
}

const WINDOW_MS = 15 * 60 * 1000 // 15 分钟窗口
const MAX_FAILS = 5 // 账号维度阈值
const IP_MAX_FAILS = 30 // IP 维度阈值（同出口多账号，放宽以免误伤办公网 NAT）
const LOCK_MS = 15 * 60 * 1000 // 锁定 15 分钟

const store = new Map<string, FailEntry>()

// 定期清理过期条目，防止内存膨胀
setInterval(
  () => {
    const now = Date.now()
    for (const k of Array.from(store.keys())) {
      const v = store.get(k)
      if (v && now - v.firstFailAt > WINDOW_MS * 2) store.delete(k)
    }
  },
  10 * 60 * 1000
).unref?.()

function accountKey(subject: string): string {
  return `acct:${subject.toLowerCase().trim()}`
}

function ipKey(ip: string): string {
  return `ip:${ip}`
}

/**
 * 账号维度 subject 规范化（20260908 生产审计 P1-2）：
 * 用户已解析时用 id（同一人只有一个桶）；用户不存在时回退到小写化后的原始输入。
 */
export function accountSubject(
  userId: string | null | undefined,
  rawAccount: string
): string {
  return userId ? `id:${userId}` : `raw:${rawAccount.toLowerCase().trim()}`
}

/**
 * 取客户端 IP（20260908 生产审计 P1-1）：
 * X-Real-IP 由 nginx `proxy_set_header X-Real-IP $remote_addr` 注入，客户端无法伪造；
 * X-Forwarded-For 因使用 $proxy_add_x_forwarded_for 会保留客户端自带值，
 * 故仅作回退且取最后一段（nginx 追加的真实地址）。
 */
export function getClientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')
  if (real && real.trim()) return real.trim()
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return 'unknown'
}

function lockInfo(key: string): { locked: boolean; retryAfterSec?: number } {
  const e = store.get(key)
  if (!e) return { locked: false }
  const now = Date.now()
  if (e.lockedUntil && e.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000),
    }
  }
  return { locked: false }
}

function bump(key: string, maxFails: number): boolean {
  const now = Date.now()
  const e = store.get(key)
  if (!e || now - e.firstFailAt > WINDOW_MS) {
    store.set(key, { count: 1, lockedUntil: null, firstFailAt: now })
    return false
  }
  e.count += 1
  if (e.count >= maxFails) {
    e.lockedUntil = now + LOCK_MS
    e.count = 0
    return true // 触发锁定
  }
  return false
}

/** 登录前检查：账号维度或 IP 维度任一被锁定即拒绝 */
export function isLoginLocked(
  subject: string,
  ip: string
): { locked: boolean; retryAfterSec?: number } {
  const byAccount = lockInfo(accountKey(subject))
  if (byAccount.locked) return byAccount
  return lockInfo(ipKey(ip))
}

/** 记录一次失败（账号维度或 IP 维度任一达阈值即锁定） */
export function recordLoginFail(subject: string, ip: string): boolean {
  const lockedByAccount = bump(accountKey(subject), MAX_FAILS)
  const lockedByIp = bump(ipKey(ip), IP_MAX_FAILS)
  return lockedByAccount || lockedByIp
}

/**
 * 登录/改密成功：清除该账号维度的失败记录。
 * 不清 IP 维度——否则攻击者用自己账号成功登录一次即可重置整台出口的计数。
 */
export function clearLoginFails(subject: string, _ip?: string) {
  store.delete(accountKey(subject))
}

/** 暴露配置（供测试/管理） */
export const loginRateLimitConfig = {
  MAX_FAILS,
  IP_MAX_FAILS,
  WINDOW_MS,
  LOCK_MS,
}
