import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma'

export interface AuthUser {
  userId: string
  email: string
  role: string
  /** 令牌版本（20260908 生产审计修复 P1-3）：与 User.tokenVersion 比对，用于令牌吊销。
   *  由 verifyAuthToken 保证存在；手工构造 AuthUser 时（测试/内部调用）可省略，按 0 处理 */
  ver?: number
}

/** 统一 bcrypt 代价（20260908 生产审计 P2-9：此前 register=12 / change-password=10 / 种子=10 不一致） */
export const BCRYPT_COST = 12

/** bcrypt 只取前 72 字节，超出部分静默截断（20260908 生产审计 P2-9） */
export const MAX_PASSWORD_BYTES = 72

/** 密码是否超过 bcrypt 可表示长度（超长密码后 72 字节相同的两个不同密码等价） */
export function passwordTooLong(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
}

// JWT 密钥：优先取环境变量，未配置时用随机兜底（仅用于本地开发）
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error(
          'JWT_SECRET 未配置，生产环境必须设置环境变量 JWT_SECRET'
        )
      })()
    : 'dev-only-secret-do-not-use-in-production')

const JWT_EXPIRES_IN = '30d'

/**
 * 签发带签名的 JWT token（HS256，30 天过期）
 * ver：令牌版本，登录时取 User.tokenVersion；改密/登出/停用后服务端自增即可吊销旧令牌
 */
export function signAuthToken(user: {
  userId: string
  email: string
  role: string
  ver?: number
}): string {
  return jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      role: user.role,
      ver: user.ver ?? 0,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  )
}

/**
 * 验证 JWT token，返回用户信息；无效或过期返回 null
 */
export function verifyAuthToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload
    if (!payload || !payload.userId || !payload.email) return null
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: (payload.role as string) || 'USER',
      // 旧令牌（本机制上线前签发）无 ver 字段，按 0 处理，与 DB 默认值一致 → 不强制全员重登
      ver: typeof payload.ver === 'number' ? payload.ver : 0,
    }
  } catch {
    return null
  }
}

/**
 * 从请求的 Authorization 头中提取并验证用户
 * 返回用户信息，未提供/无效 token 时返回 null
 */
export function getAuthUser(request: NextRequest): AuthUser | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return verifyAuthToken(authHeader.substring(7))
}

// ───────────────────────── 身份实时校验（20260908 生产审计 P1-3 / P1-4） ─────────────────────────
//
// 背景：JWT 是无状态签名，登录后 30 天内角色/启用状态/密码变更都不会反映到旧令牌上。
// 方案：apiHandler 对携带 Bearer 令牌的请求做一次「实时身份」比对——
//   ver ≠ User.tokenVersion → 令牌已吊销；role 不一致 → 权限已变更；isActive=false → 已停用；
//   mustChangePassword=true → 仅放行改密相关端点。
// 为不拖慢每个请求，身份结果按 userId 缓存 15 秒；改密/登出等写路径直接更新缓存。

export interface FreshIdentity {
  role: string
  isActive: boolean
  tokenVersion: number
  mustChangePassword: boolean
}

const IDENTITY_TTL_MS = 15_000
const identityCache = new Map<
  string,
  { value: FreshIdentity | null; at: number }
>()

/** 写入身份缓存（登录、改密、登出、角色变更后调用） */
export function cacheIdentity(
  userId: string,
  value: FreshIdentity | null
): void {
  identityCache.set(userId, { value, at: Date.now() })
}

/** 丢弃身份缓存（下次请求回源 DB） */
export function dropIdentity(userId: string): void {
  identityCache.delete(userId)
}

/** 读取实时身份（带 15s 缓存）；用户不存在返回 null */
export async function getFreshIdentity(
  userId: string
): Promise<FreshIdentity | null> {
  const hit = identityCache.get(userId)
  if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.value

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      isActive: true,
      tokenVersion: true,
      mustChangePassword: true,
    },
  })
  const value: FreshIdentity | null = row
    ? {
        role: row.role as string,
        isActive: row.isActive,
        tokenVersion: row.tokenVersion,
        mustChangePassword: row.mustChangePassword ?? true,
      }
    : null
  identityCache.set(userId, { value, at: Date.now() })
  return value
}

/** 自增令牌版本（登出/改密后调用）→ 该用户所有旧令牌立即失效，并同步缓存 */
export async function bumpTokenVersion(userId: string): Promise<number> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: {
      tokenVersion: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
    },
  })
  cacheIdentity(userId, {
    role: updated.role as string,
    isActive: updated.isActive,
    tokenVersion: updated.tokenVersion,
    mustChangePassword: updated.mustChangePassword ?? true,
  })
  return updated.tokenVersion
}
