/**
 * POST /api/auth/change-password —— 首登/重置后强制改密（2026-09-02 评测 fix-1 / S1）
 *
 * body: { oldPassword, newPassword }
 * - 验证旧密码（防会话劫持后改密）
 * - 新密码强度：≥8 位且含字母与数字，且不超过 bcrypt 72 字节上限
 * - 成功后 mustChangePassword 置 false，并自增 tokenVersion 吊销该用户全部旧令牌
 *   （20260908 生产审计 P1-3）；响应返回新 token 供客户端替换。
 * - 复用登录的失败限速防暴破旧密码（subject 用 userId，与登录同一计数桶）
 */

import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { apiHandler, ok, requireAuth, ApiError } from '@/lib/api-helpers'
import {
  recordLoginFail,
  clearLoginFails,
  getClientIp,
  isLoginLocked,
  accountSubject,
} from '@/lib/rate-limit'
import {
  signAuthToken,
  cacheIdentity,
  BCRYPT_COST,
  passwordTooLong,
  MAX_PASSWORD_BYTES,
} from '@/lib/auth'
import { z } from 'zod'

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z
    .string()
    .min(8, '新密码至少 8 位')
    .regex(/[A-Za-z]/, '新密码需包含字母')
    .regex(/[0-9]/, '新密码需包含数字'),
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authUser = requireAuth(request)
  const body = await request.json().catch(() => {
    throw ApiError.badRequest('请求体必须是合法 JSON')
  })
  const { oldPassword, newPassword } = changePasswordSchema.parse(body)
  const ip = getClientIp(request)
  const subject = accountSubject(authUser.userId, authUser.email)

  const lock = isLoginLocked(subject, ip)
  if (lock.locked) {
    throw new ApiError(
      429,
      `尝试次数过多，请 ${lock.retryAfterSec ?? 15 * 60} 秒后重试`
    )
  }

  if (passwordTooLong(newPassword)) {
    throw ApiError.badRequest(`新密码不能超过 ${MAX_PASSWORD_BYTES} 字节`)
  }

  const user = await prisma.user.findUnique({ where: { id: authUser.userId } })
  if (!user || !user.password) {
    throw new ApiError(404, '用户不存在')
  }

  const oldValid = await bcrypt.compare(oldPassword, user.password)
  if (!oldValid) {
    recordLoginFail(subject, ip)
    throw new ApiError(401, '当前密码错误')
  }

  if (oldPassword === newPassword) {
    throw new ApiError(400, '新密码不能与当前密码相同')
  }

  clearLoginFails(subject, ip)
  const hashed = await bcrypt.hash(newPassword, BCRYPT_COST)
  // 原子更新：改密 + 取消强制改密 + 自增令牌版本（吊销所有旧令牌）
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      mustChangePassword: false,
      tokenVersion: { increment: 1 },
    },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      tokenVersion: true,
      mustChangePassword: true,
    },
  })
  // 同步身份缓存，避免 15s 缓存窗口内旧令牌仍可用
  cacheIdentity(updated.id, {
    role: updated.role as string,
    isActive: updated.isActive,
    tokenVersion: updated.tokenVersion,
    mustChangePassword: updated.mustChangePassword,
  })

  // 返回新令牌：客户端需替换 localStorage 中的 auth-token（旧令牌已随 tokenVersion 自增失效）
  const token = signAuthToken({
    userId: updated.id,
    email: updated.email,
    role: updated.role,
    ver: updated.tokenVersion,
  })

  return ok({ changed: true, token }, '密码修改成功')
})
