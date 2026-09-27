/**
 * 手动催办单个交付物条目（fix-3 · 文件域催办补全，2026-09-02）
 *
 * 与既有催办链路的关系：
 *   - phase-engine.urgeRequirements：交付物看板批量催办（MANAGER/OWNER/ADMIN，整批生成待办）
 *   - 本模块：文件条目维度的单人催办（任何「能看见该条目」的成员都可催负责人），
 *     补 24h 频控 + 单条目状态/负责人校验，前端入口 = 文件目录列表/详情抽屉「催办」按钮
 *
 * 设计约束（与 file-review.ts 同款）：
 *   - 零 next/server 依赖（可独立单测）；业务错误抛 UrgeError（带 status/code），
 *     路由层 toApiError 映射为 api-helpers.ApiError 统一响应壳
 *   - 通知链复用既有体系：Notification（站内，NotifType 无催办专用枚举 → SYSTEM）
 *     + TodoItem（FILE_REQ 来源，幂等去重）+ IM notify:push（pg_notify im_events）
 *   - 催办闭环：被催人提交后 submit 路由把 ACTIVE 记录置 DONE（已有逻辑，无需改动）
 */

import { prisma } from './prisma'
import { can } from './permission'

/** 同条目 + 同发起人的催办频控窗口（24h） */
export const URGE_RATE_LIMIT_MS = 24 * 60 * 60 * 1000

// ───────────────────────────── 业务错误 ─────────────────────────────

/**
 * 催办业务错误：路由层捕获后转换为 api-helpers 的 ApiError（含 status）。
 * （不直接复用 api-helpers.ApiError，保持本模块零 next/server 依赖，可独立单测。）
 */
export class UrgeError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code = 'BAD_REQUEST') {
    super(message)
    this.name = 'UrgeError'
    this.status = status
    this.code = code
  }
}

// ───────────────────────────── 纯判定函数（可单测） ─────────────────────────────

/** 可催判定结果 */
export type UrgeDecision =
  | { ok: true; targetUserId: string }
  | { ok: false; message: string }

/**
 * 单条目可催判定（纯函数）：
 *   - 仅 WAITING（未提交，与 DELETE 路由「仅 WAITING 可物理删」同语义）可催，
 *     已提交/已进入流程 → 400
 *   - 无负责人（ownerId 空）→ 400「该交付物无负责人，无法催办」
 *   - 负责人本人不可催自己 → 400
 */
export function canUrgeRequirement(
  requirement: { status: string; ownerId: string | null },
  urgedById: string
): UrgeDecision {
  if (requirement.status !== 'WAITING') {
    return {
      ok: false,
      message: '该交付物已提交或已进入流程，仅「待提交」状态可催办',
    }
  }
  if (!requirement.ownerId) {
    return { ok: false, message: '该交付物无负责人，无法催办' }
  }
  if (requirement.ownerId === urgedById) {
    return { ok: false, message: '该交付物由你负责，无需催办自己' }
  }
  return { ok: true, targetUserId: requirement.ownerId }
}

/**
 * 24h 频控判定（纯函数）：最近一次 ACTIVE 催办距今不足 24h → true。
 * 无历史记录（未催过 / 均已闭环 DONE 且被清理）→ false。
 */
export function isUrgeRateLimited(
  lastCreatedAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastCreatedAt) return false
  return now.getTime() - lastCreatedAt.getTime() < URGE_RATE_LIMIT_MS
}

// ───────────────────────────── 服务函数 ─────────────────────────────

/** 催办结果（路由响应体 + 单测断言用） */
export interface UrgeOutcome {
  urge: {
    id: string
    requirementId: string
    requirementName: string
    targetUserId: string
    /** 被催人姓名（前端 toast 用；owner 已随条目查出，免二次查询） */
    targetUserName: string | null
    status: string
  }
  /** 是否新写了待办（已有未完成 FILE_REQ 待办时幂等跳过） */
  todoCreated: boolean
}

/**
 * 手动催办单个文件条目：
 *   1. 条目存在（404）+ 可见性（can 'view' FILE_REQ，与 GET 详情同口径 → 403）
 *   2. 项目归档拒绝（403，与 submit「已归档禁止上传」同口径）
 *   3. canUrgeRequirement 状态/负责人/自催校验（400）
 *   4. 24h 频控：同条目同发起人最近 ACTIVE 催办 < 24h → 429
 *   5. 落库 UrgeRecord（projectId/projectCode/requirementName 冗余，schema 注释口径）
 *      + Notification(SYSTEM) + TodoItem(FILE_REQ, HIGH, 幂等) + IM notify:push
 */
export async function urgeFileRequirement(opts: {
  requirementId: string
  urgedById: string
  now?: Date
}): Promise<UrgeOutcome> {
  const { requirementId, urgedById } = opts
  const now = opts.now ?? new Date()

  const requirement = await prisma.fileRequirement.findUnique({
    where: { id: requirementId },
    select: {
      id: true,
      projectId: true,
      name: true,
      status: true,
      ownerId: true,
      dueDate: true,
      owner: { select: { id: true, name: true } },
      project: { select: { code: true, isArchived: true } },
    },
  })
  if (!requirement) throw new UrgeError(404, '文件条目不存在', 'NOT_FOUND')

  // 可见性终审（与 GET /api/file-requirements/:id 的 requireCan 'view' 同口径；
  // 不可见 = 不可催，无权限者即使猜 URL 也催不了）
  const visible = await can(urgedById, 'view', {
    type: 'FILE_REQ',
    id: requirementId,
  })
  if (!visible)
    throw new UrgeError(403, '无权查看该文件条目，无法催办', 'FORBIDDEN')

  if (requirement.project.isArchived) {
    throw new UrgeError(403, '项目已归档，禁止催办', 'FORBIDDEN')
  }

  const decision = canUrgeRequirement(requirement, urgedById)
  if (!decision.ok) throw new UrgeError(400, decision.message, 'BAD_REQUEST')
  const targetUserId = decision.targetUserId

  // 24h 频控：取同条目同发起人最近一条 ACTIVE 催办
  const lastUrge = await prisma.urgeRecord.findFirst({
    where: { requirementId, urgedById, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (isUrgeRateLimited(lastUrge?.createdAt, now)) {
    throw new UrgeError(
      429,
      '24 小时内已催办过，请稍后再试',
      'URGE_RATE_LIMITED'
    )
  }

  // 发起人姓名（通知文案用；AuthUser 无 name，DB 查一次）
  const urger = await prisma.user.findUnique({
    where: { id: urgedById },
    select: { name: true },
  })

  // ── 落库催办记录（冗余字段照 model 注释：列表展示免 join） ──
  const urge = await prisma.urgeRecord.create({
    data: {
      projectId: requirement.projectId,
      projectCode: requirement.project.code,
      requirementId: requirement.id,
      requirementName: requirement.name,
      urgedById,
      targetUserId,
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  // ── 通知被催人：站内 Notification + IM notify:push（与 file-review/submit 同链路） ──
  const link = `/files?projectId=${requirement.projectId}&requirementId=${requirement.id}`
  const title = `文件催办：${requirement.name}`
  const body = `${urger?.name ?? '有同事'} 催办你提交「${requirement.name}」（项目 ${requirement.project.code}），请尽快上传`
  await prisma.notification.create({
    data: { userId: targetUserId, type: 'SYSTEM', title, body, link },
  })

  // ── 待办（FILE_REQ 来源，幂等：已有未完成待办不重复建，与 submit/自动催办同口径） ──
  const existingTodo = await prisma.todoItem.findFirst({
    where: {
      userId: targetUserId,
      sourceType: 'FILE_REQ',
      sourceId: requirement.id,
      doneAt: null,
    },
    select: { id: true },
  })
  let todoCreated = false
  if (!existingTodo) {
    await prisma.todoItem.create({
      data: {
        userId: targetUserId,
        title: `【催办】${requirement.name}`,
        sourceType: 'FILE_REQ',
        sourceId: requirement.id,
        link,
        dueAt: requirement.dueDate,
        priority: 'HIGH',
      },
    })
    todoCreated = true
  }

  // IM 在线推送（§9.4 pg_notify im_events；提交即投递）
  await prisma.$executeRaw`SELECT pg_notify('im_events', ${JSON.stringify({
    event: 'notify:push',
    userId: targetUserId,
    title,
    body,
    link,
  })})`

  return {
    urge: {
      id: urge.id,
      requirementId: requirement.id,
      requirementName: requirement.name,
      targetUserId,
      targetUserName: requirement.owner?.name ?? null,
      status: 'ACTIVE',
    },
    todoCreated,
  }
}
