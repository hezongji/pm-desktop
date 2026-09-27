import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { resolveUserPages } from '@/lib/page-permissions'
import { signAuthToken, BCRYPT_COST, passwordTooLong } from '@/lib/auth'
import { apiHandler, ok, ApiError } from '@/lib/api-helpers'
import {
  isLoginLocked,
  recordLoginFail,
  clearLoginFails,
  getClientIp,
  accountSubject,
} from '@/lib/rate-limit'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().min(1, '请输入账号'),
  password: z.string().min(1, '请输入密码'),
})

/**
 * 账号不存在时执行一次等价代价的 bcrypt 比对（20260908 生产审计 P2-1）：
 * 此前不存在账号直接跳过 bcrypt，响应时间差约 2.4 倍，可枚举账号是否存在。
 */
let dummyHash: string | null = null
async function equalizeTiming(password: string): Promise<void> {
  try {
    if (!dummyHash)
      dummyHash = await bcrypt.hash(
        'timing-equalizer-not-a-real-password',
        BCRYPT_COST
      )
    await bcrypt.compare(password, dummyHash)
  } catch {
    /* 计时拉平失败不影响主流程 */
  }
}

/** POST /api/auth/login → { user, token }（§7.1，登录接口沿用现有）
 *  账号支持三种：邮箱 / 用户名 / 姓名（组织架构人员名，如「陈牧之」） */
export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => {
    throw ApiError.badRequest('请求体必须是合法 JSON')
  })
  const validatedData = loginSchema.parse(body)
  const account = validatedData.email.trim()
  const ip = getClientIp(request)

  // 先解析用户，再用「规范化 subject」做限流（20260908 生产审计 P1-2）：
  // 此前用原始输入做键，同一人的邮箱/用户名/姓名各占一个计数桶，可绕过 + 可定向锁定
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        // 邮箱大小写不敏感（20260908 生产审计 P2-2）
        { email: { equals: account, mode: 'insensitive' } },
        { username: account },
        { name: account },
      ],
    },
  })
  const subject = accountSubject(user?.id, account)

  // 速率限制（2026-08-22 P1-3 修复 + 20260908 加固）：5 次失败锁 15 分钟，防暴力破解/撞库
  const lock = isLoginLocked(subject, ip)
  if (lock.locked) {
    throw new ApiError(
      429,
      '尝试次数过多，账号已临时锁定（约 15 分钟内自动解锁）'
    )
  }

  // bcrypt 只取前 72 字节，超长密码一律视为无效（20260908 生产审计 P2-9）
  if (passwordTooLong(validatedData.password)) {
    recordLoginFail(subject, ip)
    await equalizeTiming(validatedData.password)
    throw new ApiError(401, '邮箱或密码错误')
  }

  if (!user || !user.password) {
    recordLoginFail(subject, ip)
    await equalizeTiming(validatedData.password)
    throw new ApiError(401, '邮箱或密码错误')
  }

  const isPasswordValid = await bcrypt.compare(
    validatedData.password,
    user.password
  )
  if (!isPasswordValid) {
    recordLoginFail(subject, ip)
    throw new ApiError(401, '邮箱或密码错误')
  }

  if (!user.isActive) {
    throw new ApiError(401, '账户已被禁用')
  }

  // 登录成功：清除该账号维度的失败计数
  clearLoginFails(subject, ip)

  // 更新最后登录时间（schema v1.1 字段：lastLoginAt）
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  // 生成带签名的 JWT token（ver = 当前令牌版本，改密/登出后自增即吊销）
  const token = signAuthToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    ver: user.tokenVersion,
  })

  const userResponse = {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    departmentId: user.departmentId,
    jobTitle: user.jobTitle,
    isActive: user.isActive,
    createdAt: user.createdAt,
    mustChangePassword: user.mustChangePassword ?? true,
    // 权限 V2：最终可见页面集（管理员分配，null 时按角色默认）
    pages: resolveUserPages(user.role, user.pagePermissions as string[] | null),
    extraVisibleProjectIds: user.extraVisibleProjectIds,
  }

  return ok({ user: userResponse, token }, '登录成功')
})
