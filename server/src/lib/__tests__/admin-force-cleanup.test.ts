/**
 * /api/admin/cleanup/project 强制清理通道单测（fix-4① 数据治理）
 * 覆盖：
 *   - 确认码与项目编号不符 → 400 且零删改（安全闸）
 *   - 项目不存在 → 404
 *   - dryRun=true 只统计不删（全部走 count），不删项目行、不写审计
 *   - 正式执行按外键安全序删全部关联表 → 删项目行 → 写 FORCE_CLEANUP 审计
 * 方式：jest.mock 注入内存委托（记录调用序），不连真实 PG（同 permission.test.ts 风格，
 *       委托用普通函数而非 jest.fn，规避 jest.config resetMocks 清实现）。
 */

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/admin', () => ({
  requireAdmin: async () => ({
    userId: 'u-admin',
    email: 'a@x.com',
    role: 'ADMIN',
  }),
}))

import { POST } from '@/app/api/admin/cleanup/project/route'
import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'

// ─────────────── 内存委托安装 ───────────────

type Op =
  | 'count'
  | 'deleteMany'
  | 'delete'
  | 'create'
  | 'findMany'
  | 'findUnique'

interface Call {
  model: string
  op: Op
  args?: unknown
}

const STATE = {
  project: null as { id: string; code: string; name: string } | null,
  calls: [] as Call[],
}

const MODELS = [
  'project',
  'activityLog',
  'task',
  'phase',
  'fileRequirement',
  'purchaseRequest',
  'goodsArrivalItem',
  'goodsArrival',
  'purchasePayment',
  'purchaseContract',
  'purchaseOrderItem',
  'supplierRequestItem',
  'supplierRequest',
  'purchaseOrder',
  'purchaseRequestItem',
  'expenseItem',
  'expenseClaim',
  'fileAccessLog',
  'urgeRecord',
  'file',
  'taskRevision',
  'annotation',
  'comment',
  'conversationMember',
  'message',
  'conversation',
  'todoItem',
  'notification',
  'projectMember',
  'fileCatalog',
]

/** 覆盖式安装内存委托并清空调用记录 */
function install(): void {
  STATE.calls = []
  const obj = prisma as unknown as Record<string, unknown>
  for (const m of MODELS) {
    obj[m] = {
      count: async (args: unknown) => {
        STATE.calls.push({ model: m, op: 'count', args })
        return 1
      },
      deleteMany: async (args: unknown) => {
        STATE.calls.push({ model: m, op: 'deleteMany', args })
        return { count: 1 }
      },
      delete: async (args: unknown) => {
        STATE.calls.push({ model: m, op: 'delete', args })
        return {}
      },
      create: async (args: unknown) => {
        STATE.calls.push({ model: m, op: 'create', args })
        return {}
      },
      // 源实体定位（task/phase/requirement/purchaseRequest）各返回 1 行
      findMany: async () => [{ id: `${m}-1` }],
      findUnique: async () => STATE.project,
    }
  }
  obj.$transaction = async (fn: (tx: unknown) => unknown) => fn(obj)
}

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

beforeEach(() => {
  STATE.project = { id: 'p1', code: 'YYGC26001', name: '演示项目' }
  install()
})

// ─────────────── 用例 ───────────────

describe('POST /api/admin/cleanup/project', () => {
  it('确认码与项目编号不符 → 400，且零删改（不进事务）', async () => {
    const res = await POST(
      makeReq({ projectId: 'p1', confirmCode: 'WRONG-CODE' }),
      {}
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.message).toContain('确认码与项目编号不符')
    expect(
      STATE.calls.filter(
        c => c.op === 'deleteMany' || c.op === 'delete' || c.op === 'create'
      )
    ).toHaveLength(0)
  })

  it('项目不存在 → 404', async () => {
    STATE.project = null
    const res = await POST(
      makeReq({ projectId: 'p404', confirmCode: 'ANY' }),
      {}
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.message).toContain('项目不存在')
  })

  it('dryRun=true：只 count 不删、不删项目行、不写审计（安全闸）', async () => {
    const res = await POST(
      makeReq({ projectId: 'p1', confirmCode: 'YYGC26001', dryRun: true }),
      {}
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.dryRun).toBe(true)
    expect(body.data.projectId).toBe('p1')
    // 29 张关联表 + project 本体，全部返回计数
    expect(
      Object.keys(body.data.deleted as Record<string, number>)
    ).toHaveLength(30)
    expect((body.data.deleted as Record<string, number>).project).toBe(1)
    // 全程只有 count / 定位查询，无任何删改与审计写入
    const ops = new Set(STATE.calls.map(c => c.op))
    expect(ops.has('deleteMany')).toBe(false)
    expect(ops.has('delete')).toBe(false)
    expect(ops.has('create')).toBe(false)
  })

  it('正式执行：按外键安全序删全部关联表 → 删项目行 → 写 FORCE_CLEANUP 审计', async () => {
    const res = await POST(
      makeReq({ projectId: 'p1', confirmCode: 'YYGC26001' }),
      {}
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.dryRun).toBe(false)
    expect((body.data.deleted as Record<string, number>).project).toBe(1)

    // deleteMany 调用序 = 外键安全序
    const order = STATE.calls
      .filter(c => c.op === 'deleteMany')
      .map(c => c.model)
    expect(order).toEqual([
      // 采购链（GoodsArrivalItem.orderItemId 隐式 Restrict → 最先）
      'goodsArrivalItem',
      'goodsArrival',
      'purchasePayment',
      'purchaseContract',
      'purchaseOrderItem',
      'supplierRequestItem',
      'supplierRequest',
      'purchaseOrder',
      'purchaseRequestItem',
      'purchaseRequest',
      // 费用链（明细先于单据）
      'expenseItem',
      'expenseClaim',
      // 文件域（FileAccessLog 先于 File 防孤儿日志；UrgeRecord 无 FK）
      'fileAccessLog',
      'urgeRecord',
      'file',
      'fileRequirement',
      // 任务域（Revision SetNull → 先删；Annotation/Comment Cascade）
      'taskRevision',
      'annotation',
      'comment',
      'task',
      'phase',
      // 会话域
      'conversationMember',
      'message',
      'conversation',
      // 无 FK 关联表
      'todoItem',
      'notification',
      // 结构与审计
      'projectMember',
      'activityLog',
      'fileCatalog',
    ])

    // 关键外键安全序不变量
    const idx = (m: string) => order.indexOf(m)
    expect(idx('goodsArrivalItem')).toBeLessThan(idx('purchaseOrderItem')) // Restrict：子表先删
    expect(idx('fileAccessLog')).toBeLessThan(idx('file')) // SetNull：防永久孤儿日志
    expect(idx('taskRevision')).toBeLessThan(idx('task')) // SetNull：防残留快照
    expect(idx('fileRequirement')).toBeLessThan(idx('fileCatalog')) // Cascade：条目先删
    expect(idx('supplierRequest')).toBeLessThan(idx('purchaseOrder'))

    // 项目行本体最后单删
    const projectDeleteIdx = STATE.calls.findIndex(
      c => c.model === 'project' && c.op === 'delete'
    )
    expect(projectDeleteIdx).toBeGreaterThan(-1)
    expect(STATE.calls[projectDeleteIdx].args).toEqual({ where: { id: 'p1' } })
    expect(projectDeleteIdx).toBeGreaterThan(
      STATE.calls.findIndex(
        c => c.model === 'fileCatalog' && c.op === 'deleteMany'
      )
    )

    // 审计留痕：FORCE_CLEANUP，projectId=null（项目行已删，FK 不可指回）
    const audit = STATE.calls.find(
      c => c.model === 'activityLog' && c.op === 'create'
    )
    expect(audit).toBeDefined()
    const auditData = (audit?.args as { data: Record<string, unknown> }).data
    expect(auditData.action).toBe('FORCE_CLEANUP')
    expect(auditData.projectId).toBeNull()
    const detail = auditData.detail as Record<string, unknown>
    expect(detail.code).toBe('YYGC26001')
    expect(detail.projectId).toBe('p1')
    expect(detail.deleted).toEqual(body.data.deleted)
  })

  it('无 FK 关联表按源实体 id / link 前缀定位（待办与通知）', async () => {
    await POST(makeReq({ projectId: 'p1', confirmCode: 'YYGC26001' }), {})

    const todoDelete = STATE.calls.find(
      c => c.model === 'todoItem' && c.op === 'deleteMany'
    )
    const todoWhere = todoDelete?.args as {
      where: { OR: Array<Record<string, unknown>> }
    }
    expect(todoWhere.where.OR).toEqual(
      expect.arrayContaining([
        { sourceType: 'TASK', sourceId: { in: ['task-1'] } },
        { sourceType: 'PHASE', sourceId: { in: ['phase-1'] } },
        { sourceType: 'FILE_REQ', sourceId: { in: ['fileRequirement-1'] } },
        {
          sourceType: 'PURCHASE_REQUEST',
          sourceId: { in: ['purchaseRequest-1'] },
        },
      ])
    )

    const notifDelete = STATE.calls.find(
      c => c.model === 'notification' && c.op === 'deleteMany'
    )
    const notifWhere = notifDelete?.args as {
      where: { OR: Array<Record<string, unknown>> }
    }
    expect(notifWhere.where.OR).toEqual(
      expect.arrayContaining([
        { link: { startsWith: '/projects/p1/' } },
        { link: { startsWith: '/files?projectId=p1' } },
        { link: '/purchase?requestId=purchaseRequest-1' },
      ])
    )
  })
})
