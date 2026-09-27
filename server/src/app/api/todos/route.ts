/**
 * /api/todos —— 依据《开发文档-项目管理系统重构》§7.9「待办收件箱」
 *
 * GET /api/todos?done=0|1&limit=  我的待办（全源聚合）
 *   - done=0（默认）：未完成（doneAt=null）
 *   - done=1：已完成（doneAt 非空）
 *   - 排序：priority 降序（URGENT>HIGH>MEDIUM>LOW）→ createdAt 倒序
 *   - 返回含 sourceType（前端按 sourceType 映射来源图标）、link、dueAt、doneAt
 *   - limit 可选（默认 500，上限 1000），便于顶栏角标取数
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  apiHandler,
  ok,
  created,
  requireAuth,
  ApiError,
} from '@/lib/api-helpers'
import { emitEntityChanged } from '@/lib/entity-sync'

export const dynamic = 'force-dynamic'

const PRIORITY_WEIGHT: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

export const GET = apiHandler(async (request: NextRequest) => {
  const user = requireAuth(request)
  const { searchParams } = new URL(request.url)

  const done = searchParams.get('done')
  const rawLimit = parseInt(searchParams.get('limit') || '500', 10)
  const limit = Math.min(
    1000,
    Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 500)
  )

  // 分页（20260908 修复 P2-2）：补 page 支持，修「page=999999 仍返回数据」的深分页失效
  const rawPage = parseInt(searchParams.get('page') || '1', 10)
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1)
  const skip = (page - 1) * limit

  // 排序（20260908 修复 P1-1）：sortBy ∈ priority|dueAt|createdAt（默认 priority 权重降序）
  const sortBy = (searchParams.get('sortBy') || '').trim()
  const rawDir = (
    searchParams.get('sortOrder') ||
    searchParams.get('order') ||
    ''
  )
    .trim()
    .toLowerCase()
  const dir: 'asc' | 'desc' = rawDir === 'asc' ? 'asc' : 'desc'

  const where = {
    userId: user.userId,
    doneAt: done === '1' ? { not: null } : null,
  }

  const items = await prisma.todoItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  })

  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'dueAt' || sortBy === 'createdAt') {
      const key: 'dueAt' | 'createdAt' =
        sortBy === 'dueAt' ? 'dueAt' : 'createdAt'
      const av = a[key] ? new Date(a[key] as Date).getTime() : null
      const bv = b[key] ? new Date(b[key] as Date).getTime() : null
      // 空值恒排末尾
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return dir === 'asc' ? av - bv : bv - av
    }
    // priority 枚举无原生排序权重 → JS 侧按权重排序，再按创建时间倒序
    const wa = PRIORITY_WEIGHT[a.priority] ?? 0
    const wb = PRIORITY_WEIGHT[b.priority] ?? 0
    if (wb !== wa) return dir === 'asc' ? wa - wb : wb - wa
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  return ok(sorted)
})

/**
 * POST /api/todos —— 手动创建待办（§7.9，TodoSrc.MANUAL）
 * body { title(必填), dueAt?, priority?, link? }
 */
const createTodoSchema = z.object({
  title: z.string().trim().min(1, '待办标题不能为空').max(200),
  dueAt: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  link: z
    .string()
    .max(500)
    .refine(v => !v || v.startsWith('/'), '仅允许站内链接')
    .optional(),
})

export const POST = apiHandler(async (request: NextRequest) => {
  const user = requireAuth(request)

  const raw = await request.json().catch(() => {
    throw ApiError.badRequest('请求体必须是 JSON')
  })
  const data = createTodoSchema.parse(raw)

  const todo = await prisma.todoItem.create({
    data: {
      userId: user.userId,
      title: data.title,
      sourceType: 'MANUAL',
      sourceId: null,
      link: data.link ?? null,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      priority: data.priority ?? 'MEDIUM',
    },
  })

  // 数据同步根治（WP6）：待办创建成功 → 广播 entity:changed
  await emitEntityChanged('todo', todo.id)

  return created(todo, '待办创建成功')
})
