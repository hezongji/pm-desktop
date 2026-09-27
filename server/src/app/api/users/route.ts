/**
 * /api/users —— IM @提及 联想数据源（依据开发文档 §8.2⑥ / §9.2 mentions）
 *
 * GET：在职用户摘要（id/name/email/avatar），供输入框 @ 联想与 mentions 上送映射。
 * 仅登录可访问；按姓名排序，最多 200 条（覆盖中小团队）。
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ok, requireAuth } from '@/lib/api-helpers'
import { parseListSort } from '@/lib/list-sort'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (request: NextRequest) => {
  requireAuth(request)

  // 排序（20260908 修复 P1-1）：默认按姓名升序，支持 sortBy 白名单
  const orderBy = parseListSort(
    request,
    { name: 'name', email: 'email', createdAt: 'createdAt' },
    [{ name: 'asc' }]
  ) as Prisma.UserOrderByWithRelationInput[]

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, avatar: true },
    orderBy,
    take: 200,
  })

  return ok(users)
})
