/**
 * /api/projects/[id]/archive —— 依据《开发文档-项目管理系统重构》§7.4、§7.7
 *
 * POST  项目 archive  ★ 归档拦截：必需条目（required=true）非 APPROVED 全量列出并 400
 *
 * 拦截响应（§7.7 归档拦截响应示例，逐字段对齐）：
 *   400 { success:false, message:"存在未通过的必需文件，无法归档",
 *         errors: [ { name, status, owner } ] }   ← owner 为负责人姓名
 *
 * 通过 → isArchived=true + archivedAt=now，记 ActivityLog，失效权限缓存
 * （归档后项目对非 ADMIN 只剩 view/download，§6.1 归档终审）
 *
 * 口径说明：非 APPROVED = status NOT IN (APPROVED, NA)。NA（不适用）条目为
 * §7.7 明确提供的豁免操作（POST /file-requirements/:id/na，备注原因），不应拦截；
 * 其余状态（WAITING/SUBMITTED/REVIEWING/REJECTED/OBSOLETED）一律视为未通过。
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ok, requireAuth, ApiError } from '@/lib/api-helpers'
import { requireCan, invalidateProject } from '@/lib/permission'
import { emitEntityChanged } from '@/lib/entity-sync'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const POST = apiHandler<Ctx>(
  async (request: NextRequest, { params }) => {
    const { id } = await params
    const user = requireAuth(request)

    // 20260908 修复 W7-P2-4：先判存在/归档态，再校权限——
    // 原先 requireCan 先抛 403（已归档项目只读），使「重复归档」语义失真
    const project = await prisma.project.findUnique({
      where: { id: id },
      select: { id: true, code: true, isArchived: true },
    })
    if (!project) throw ApiError.notFound('项目不存在')
    if (project.isArchived) throw ApiError.badRequest('项目已归档')

    await requireCan(user.userId, 'archive', { type: 'PROJECT', id: id })

    // 必需条目非 APPROVED（NA 豁免）全量列出
    const blockers = await prisma.fileRequirement.findMany({
      where: {
        projectId: id,
        required: true,
        status: { notIn: ['APPROVED', 'NA'] },
      },
      select: { name: true, status: true, owner: { select: { name: true } } },
      orderBy: { code: 'asc' },
    })

    if (blockers.length > 0) {
      // §7.7 响应示例格式：errors[] = { name, status, owner }
      throw ApiError.badRequest(
        '存在未通过的必需文件，无法归档',
        blockers.map(b => ({
          name: b.name,
          status: b.status,
          owner: b.owner?.name ?? null,
        }))
      )
    }

    const updated = await prisma.$transaction(async tx => {
      const row = await tx.project.update({
        where: { id: id },
        data: { isArchived: true, archivedAt: new Date() },
      })
      await tx.activityLog.create({
        data: {
          projectId: id,
          userId: user.userId,
          action: 'project.archive',
          detail: { isArchived: [false, true] },
        },
      })
      return row
    })

    invalidateProject(id)

    // 数据同步根治（WP6）：项目归档成功 → 广播 entity:changed
    await emitEntityChanged('project', id)

    return ok({
      project: {
        id: updated.id,
        code: updated.code,
        isArchived: updated.isArchived,
        archivedAt: updated.archivedAt,
      },
    })
  }
)
