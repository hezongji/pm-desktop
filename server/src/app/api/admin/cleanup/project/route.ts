/**
 * /api/admin/cleanup/project —— ADMIN 项目强制清理通道（fix-4① 数据治理）
 *
 * POST  ADMIN  body { projectId, confirmCode, dryRun? }
 *   - confirmCode 必须等于目标项目 code（二次确认安全闸）→ 不符 400
 *   - dryRun=true（默认 false）仅统计各表将删除条数，不落任何删改（安全预览）
 *   - 事务内按外键安全序全量清理项目域数据，最后删项目行
 *   - 每步记数 → 返回 { deleted: {table: count}, projectId }；
 *     正式执行另写一条 ActivityLog(action='FORCE_CLEANUP'，projectId=null：
 *     项目行已删，FK 不可指回，明细内携带 projectId/code)
 *
 * 与 /api/projects/[id] DELETE 的区别：常规删除有引用保护（存在采购订单即拒绝）
 * 且保留审计链（活动日志/修订快照 SET NULL 存续）；本通道是 ADMIN 兜底强删，
 * 清空项目全部痕迹（含活动日志、修订快照、访问日志），不受引用保护拦截。
 *
 * 删除顺序依据 prisma/schema.prisma 实际外键（Prisma 默认：未标注 onDelete 的
 * 必选关系=Restrict、可选关系=SetNull）：
 *   1. GoodsArrivalItem 最先（orderItemId→PurchaseOrderItem 为隐式 Restrict）
 *   2. 付款/合同/明细 → 订单本体（对 order 均 Cascade，显式删保统计准确）
 *   3. SupplierRequest 先于 PurchaseOrder/PurchaseRequest 删（其 orderId/requestId
 *      为 SetNull 无阻断，先删免解链步骤）
 *   4. 费用明细先于报销单（Cascade，显式删保统计）
 *   5. FileAccessLog 必须先于 File（fileId 为 SetNull，File 先删将留永久孤儿日志）
 *   6. UrgeRecord.projectId/requirementId 无 FK（纯字符串列），按 projectId 直删
 *   7. File → FileRequirement → FileCatalog（requirement/folder 均 SetNull；
 *      Requirement.catalog 为 Cascade，须先删条目再删目录）
 *   8. TaskRevision/Annotation/Comment 先于 Task（Revision.taskId 为 SetNull，
 *      Task 先删会解链残留快照——本通道目标是清空，故先删再删任务）
 *   9. 会话成员 → 消息 → 会话（对 conversation 均 Cascade，显式删保统计）
 *  10. TodoItem/Notification 无项目 FK，按 sourceId/link 前缀定位
 *      （须先收集 task/phase/requirement/purchaseRequest id，口径同 projects/[id] DELETE）
 *  11. ProjectMember / ActivityLog（本通道不保留审计链）/ FileCatalog → Project 行
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { apiHandler, ok, ApiError } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/admin'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  projectId: z.string().min(1, 'projectId 必填'),
  confirmCode: z.string().min(1, 'confirmCode 必填（须为目标项目编号 code）'),
  dryRun: z.boolean().optional().default(false),
})

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await requireAdmin(request)

  const { projectId, confirmCode, dryRun } = bodySchema.parse(
    await request.json().catch(() => ({}))
  )

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, name: true },
  })
  if (!project) throw ApiError.notFound('项目不存在')
  if (confirmCode !== project.code) {
    throw ApiError.badRequest(
      '确认码与项目编号不符（confirmCode 须等于目标项目的 code）'
    )
  }

  const deleted: Record<string, number> = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const counts: Record<string, number> = {}

      /** dryRun 只 count 不 deleteMany；where 与正式执行完全同口径 */
      const runStep = async (
        table: string,
        // any：各表委托泛型签名不同，此处只需 count/deleteMany 两个方法的结构
        delegate: {
          count(args: { where: any }): Promise<number>
          deleteMany(args: { where: any }): Promise<{ count: number }>
        },
        where: Record<string, unknown>
      ): Promise<void> => {
        counts[table] = dryRun
          ? await delegate.count({ where })
          : (await delegate.deleteMany({ where })).count
      }

      // 无 FK 关联表（待办/通知）的定位源：删除前先收集源实体 id
      const [taskRows, phaseRows, requirementRows, purchaseRequestRows] =
        await Promise.all([
          tx.task.findMany({ where: { projectId }, select: { id: true } }),
          tx.phase.findMany({ where: { projectId }, select: { id: true } }),
          tx.fileRequirement.findMany({
            where: { projectId },
            select: { id: true },
          }),
          tx.purchaseRequest.findMany({
            where: { projectId },
            select: { id: true },
          }),
        ])
      const taskIds = taskRows.map(r => r.id)
      const phaseIds = phaseRows.map(r => r.id)
      const requirementIds = requirementRows.map(r => r.id)
      const purchaseRequestIds = purchaseRequestRows.map(r => r.id)

      // ── 采购链（GoodsArrivalItem.orderItemId 隐式 Restrict → 最先删）──
      await runStep('goodsArrivalItems', tx.goodsArrivalItem, {
        arrival: { projectId },
      })
      await runStep('goodsArrivals', tx.goodsArrival, { projectId })
      await runStep('purchasePayments', tx.purchasePayment, {
        order: { projectId },
      })
      await runStep('purchaseContracts', tx.purchaseContract, {
        order: { projectId },
      })
      await runStep('purchaseOrderItems', tx.purchaseOrderItem, {
        order: { projectId },
      })
      await runStep('supplierRequestItems', tx.supplierRequestItem, {
        supplierRequest: { projectId },
      })
      await runStep('supplierRequests', tx.supplierRequest, { projectId })
      await runStep('purchaseOrders', tx.purchaseOrder, { projectId })
      await runStep('purchaseRequestItems', tx.purchaseRequestItem, {
        request: { projectId },
      })
      await runStep('purchaseRequests', tx.purchaseRequest, { projectId })

      // ── 费用链（明细先于报销单）──
      await runStep('expenseItems', tx.expenseItem, { claim: { projectId } })
      await runStep('expenseClaims', tx.expenseClaim, { projectId })

      // ── 文件域（FileAccessLog 先于 File：fileId SetNull，后删留永久孤儿日志）──
      await runStep('fileAccessLogs', tx.fileAccessLog, { file: { projectId } })
      await runStep('urgeRecords', tx.urgeRecord, { projectId })
      await runStep('files', tx.file, { projectId })
      await runStep('fileRequirements', tx.fileRequirement, { projectId })

      // ── 任务域（Revision.taskId SetNull → 先删；Annotation/Comment Cascade）──
      await runStep('taskRevisions', tx.taskRevision, { task: { projectId } })
      await runStep('annotations', tx.annotation, { task: { projectId } })
      await runStep('comments', tx.comment, { task: { projectId } })
      await runStep('tasks', tx.task, { projectId })
      await runStep('phases', tx.phase, { projectId })

      // ── 会话域（成员/消息对 conversation Cascade，显式删保统计）──
      await runStep('conversationMembers', tx.conversationMember, {
        conversation: { projectId },
      })
      await runStep('messages', tx.message, { conversation: { projectId } })
      await runStep('conversations', tx.conversation, { projectId })

      // ── 无 FK 关联表（按源实体 id / link 前缀定位，口径同 projects/[id] DELETE）──
      const todoBranches = [
        ...(taskIds.length
          ? [{ sourceType: 'TASK' as const, sourceId: { in: taskIds } }]
          : []),
        ...(phaseIds.length
          ? [{ sourceType: 'PHASE' as const, sourceId: { in: phaseIds } }]
          : []),
        ...(requirementIds.length
          ? [
              {
                sourceType: 'FILE_REQ' as const,
                sourceId: { in: requirementIds },
              },
            ]
          : []),
        ...(purchaseRequestIds.length
          ? [
              {
                sourceType: 'PURCHASE_REQUEST' as const,
                sourceId: { in: purchaseRequestIds },
              },
            ]
          : []),
      ]
      await runStep(
        'todoItems',
        tx.todoItem,
        todoBranches.length ? { OR: todoBranches } : { id: { in: [] } }
      )
      await runStep('notifications', tx.notification, {
        OR: [
          { link: { startsWith: `/projects/${projectId}/` } },
          { link: { startsWith: `/files?projectId=${projectId}` } },
          ...purchaseRequestIds.map(rid => ({
            link: `/purchase?requestId=${rid}`,
          })),
        ],
      })

      // ── 结构与审计（本通道审计链不保留）──
      await runStep('projectMembers', tx.projectMember, { projectId })
      await runStep('activityLogs', tx.activityLog, { projectId })
      await runStep('fileCatalogs', tx.fileCatalog, { projectId })

      if (!dryRun) {
        await tx.project.delete({ where: { id: projectId } })
      }
      counts.project = 1
      return counts
    }
  )

  // 审计留痕（仅正式执行）：projectId 必须为 null（项目行已删，ActivityLog.projectId FK）
  if (!dryRun) {
    await prisma.activityLog.create({
      data: {
        projectId: null,
        userId: user.userId,
        action: 'FORCE_CLEANUP',
        detail: {
          target: 'project',
          projectId: project.id,
          code: project.code,
          name: project.name,
          deleted,
        } as unknown as Prisma.InputJsonValue,
      },
    })
  }

  return ok(
    {
      projectId: project.id,
      code: project.code,
      name: project.name,
      dryRun,
      deleted,
    },
    dryRun
      ? `试运行完成：项目「${project.code}」可清理数据如下（未执行删除）`
      : `项目「${project.code}」已强制清理`
  )
})
