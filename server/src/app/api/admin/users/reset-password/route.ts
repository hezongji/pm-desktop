/**
 * /api/admin/users/reset-password —— 管理员重置用户密码（P1-5 兜底方案）
 *
 * POST  ADMIN  { userId, newPassword }
 *   - ADMIN 权限（实时 DB 角色校验，同 requireAdmin）
 *   - bcrypt cost=12（与 register/login 一致）
 *   - 返回目标用户简要信息；不返回密码
 */

import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { apiHandler, ok, ApiError } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/admin'
import { dropIdentity } from '@/lib/auth'
import { emitEntityChanged } from '@/lib/entity-sync'

export const dynamic = 'force-dynamic'

const resetPasswordSchema = z.object({
  userId: z.string().min(1, 'userId 不能为空'),
  newPassword: z.string().min(8, '新密码至少需要8个字符'),
})

export const POST = apiHandler(async (request: NextRequest) => {
  await requireAdmin(request)

  const body = resetPasswordSchema.parse(await request.json())

  const target = await prisma.user.findUnique({ where: { id: body.userId } })
  if (!target) throw ApiError.notFound('用户不存在')

  const hashedPassword = await bcrypt.hash(body.newPassword, 12)

  await prisma.user.update({
    where: { id: body.userId },
    data: {
      password: hashedPassword,
      mustChangePassword: true, // 重置后下次登录强制改密（2026-09-02 评测 fix-1）
      // 20260908 回归修复：重置密码必须吊销旧令牌，否则被盗令牌在 30 天内仍可用
      tokenVersion: { increment: 1 },
    },
  })
  dropIdentity(body.userId)

  // 数据同步根治（WP6）：重置密码（mustChangePassword 变更）→ 广播 entity:changed
  await emitEntityChanged('user', body.userId)

  return ok(
    {
      id: target.id,
      email: target.email,
      username: target.username,
      name: target.name,
    },
    '密码已重置'
  )
})
