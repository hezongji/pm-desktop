/**
 * 手动催办单条交付物单测（fix-3 · 文件域催办）
 * 覆盖：纯判定（canUrgeRequirement 状态/负责人/自催、isUrgeRateLimited 24h 边界）
 *       + 服务函数（创建成功 / 24h 频控 429 / 已提交 400 / 无负责人 400 / 不可见 403 / 不存在 404）。
 * 方式：jest.mock('../prisma') 注入内存库（不连真实 PG；权限引擎 real + prisma mock，
 *       与 permission.test.ts 同款）。
 */

jest.mock('../prisma', () => ({ prisma: {} }))

import { prisma } from '../prisma'
import { invalidatePerms } from '../permission'
import {
  canUrgeRequirement,
  isUrgeRateLimited,
  urgeFileRequirement,
  UrgeError,
  URGE_RATE_LIMIT_MS,
} from '../urge'

// ───────────────────────── 内存库 fixture ─────────────────────────

interface U {
  id: string
  name: string
  role: string
  isActive: boolean
  departmentId: string | null
}
interface P {
  id: string
  code: string
  isArchived: boolean
}
interface M {
  projectId: string
  userId: string
  role: string
}
interface Ph {
  id: string
  projectId: string
  code: string
  ownerId: string | null
}
interface R {
  id: string
  projectId: string
  name: string
  status: string
  ownerId: string | null
  scope: string
  scopeRefs: unknown
  phaseCode: string | null
  dueDate: Date | null
  owner: { id: string; name: string } | null
  project: { code: string; isArchived: boolean }
}
interface Urge {
  id: string
  requirementId: string
  urgedById: string
  targetUserId: string
  status: string
  createdAt: Date
}
interface Todo {
  id: string
  userId: string
  sourceType: string
  sourceId: string
  doneAt: Date | null
}

interface DB {
  users: U[]
  projects: P[]
  members: M[]
  phases: Ph[]
  requirements: R[]
  acl: unknown[]
  urges: Urge[]
  todos: Todo[]
}

function baseDb(): DB {
  return {
    users: [
      {
        id: 'u-admin',
        name: '管理员',
        role: 'ADMIN',
        isActive: true,
        departmentId: null,
      },
      {
        id: 'u-owner',
        name: '王老板',
        role: 'MEMBER',
        isActive: true,
        departmentId: null,
      },
      {
        id: 'u-mgr',
        name: '李经理',
        role: 'MEMBER',
        isActive: true,
        departmentId: null,
      },
      {
        id: 'u-mem',
        name: '张三',
        role: 'MEMBER',
        isActive: true,
        departmentId: null,
      },
      {
        id: 'u-out',
        name: '路人甲',
        role: 'MEMBER',
        isActive: true,
        departmentId: null,
      },
    ],
    projects: [{ id: 'p1', code: 'PRJ-001', isArchived: false }],
    members: [
      { projectId: 'p1', userId: 'u-owner', role: 'OWNER' },
      { projectId: 'p1', userId: 'u-mgr', role: 'MANAGER' },
      { projectId: 'p1', userId: 'u-mem', role: 'MEMBER' },
    ],
    phases: [{ id: 'ph1', projectId: 'p1', code: 'PH01', ownerId: 'u-phase' }],
    requirements: [
      {
        id: 'r-wait',
        projectId: 'p1',
        name: '电气图纸',
        status: 'WAITING',
        ownerId: 'u-mem',
        scope: 'PUBLIC',
        scopeRefs: null,
        phaseCode: 'PH01',
        dueDate: new Date('2026-09-30'),
        owner: { id: 'u-mem', name: '张三' },
        project: { code: 'PRJ-001', isArchived: false },
      },
      {
        id: 'r-sub',
        projectId: 'p1',
        name: '结构计算书',
        status: 'SUBMITTED',
        ownerId: 'u-mem',
        scope: 'PUBLIC',
        scopeRefs: null,
        phaseCode: 'PH01',
        dueDate: null,
        owner: { id: 'u-mem', name: '张三' },
        project: { code: 'PRJ-001', isArchived: false },
      },
      {
        id: 'r-noowner',
        projectId: 'p1',
        name: '无主条目',
        status: 'WAITING',
        ownerId: null,
        scope: 'PUBLIC',
        scopeRefs: null,
        phaseCode: null,
        dueDate: null,
        owner: null,
        project: { code: 'PRJ-001', isArchived: false },
      },
      {
        id: 'r-pri',
        projectId: 'p1',
        name: '私密条目',
        status: 'WAITING',
        ownerId: 'u-mem',
        scope: 'PRIVATE',
        scopeRefs: null,
        phaseCode: null,
        dueDate: null,
        owner: { id: 'u-mem', name: '张三' },
        project: { code: 'PRJ-001', isArchived: false },
      },
    ],
    acl: [],
    urges: [],
    todos: [],
  }
}

/** 把内存库装进 mock prisma（含 jest.fn 记录写入调用，供断言） */
function install(db: DB) {
  const mock = {
    user: {
      findUnique: jest.fn(
        (args: { where: { id: string } }) =>
          db.users.find(u => u.id === args.where.id) ?? null
      ),
    },
    project: {
      findUnique: jest.fn(
        (args: { where: { id: string } }) =>
          db.projects.find(p => p.id === args.where.id) ?? null
      ),
    },
    projectMember: {
      findUnique: jest.fn(
        (args: {
          where: { projectId_userId: { projectId: string; userId: string } }
        }) => {
          const w = args.where.projectId_userId
          return (
            db.members.find(
              m => m.projectId === w.projectId && m.userId === w.userId
            ) ?? null
          )
        }
      ),
    },
    phase: {
      findUnique: jest.fn(
        (args: {
          where: { projectId_code: { projectId: string; code: string } }
        }) => {
          const pc = args.where.projectId_code
          return (
            db.phases.find(
              p => p.projectId === pc.projectId && p.code === pc.code
            ) ?? null
          )
        }
      ),
    },
    fileRequirement: {
      findUnique: jest.fn(
        (args: { where: { id: string } }) =>
          db.requirements.find(r => r.id === args.where.id) ?? null
      ),
    },
    resourcePermission: {
      findMany: jest.fn(() => db.acl),
    },
    urgeRecord: {
      findFirst: jest.fn(
        (args: {
          where: { requirementId: string; urgedById: string; status: string }
        }) => {
          const hits = db.urges
            .filter(
              u =>
                u.requirementId === args.where.requirementId &&
                u.urgedById === args.where.urgedById &&
                u.status === args.where.status
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          return hits[0] ? { createdAt: hits[0].createdAt } : null
        }
      ),
      create: jest.fn((args: { data: Omit<Urge, 'id' | 'createdAt'> }) => {
        db.urges.push({
          id: `ug-${db.urges.length + 1}`,
          createdAt: new Date(),
          ...args.data,
        })
        return { id: `ug-${db.urges.length}` }
      }),
    },
    notification: {
      create: jest.fn((args: { data: Record<string, unknown> }) => ({
        id: 'n-1',
        ...args.data,
      })),
    },
    todoItem: {
      findFirst: jest.fn(
        (args: {
          where: {
            userId: string
            sourceType: string
            sourceId: string
            doneAt: null
          }
        }) =>
          db.todos.find(
            t =>
              t.userId === args.where.userId &&
              t.sourceType === args.where.sourceType &&
              t.sourceId === args.where.sourceId &&
              t.doneAt === null
          ) ?? null
      ),
      create: jest.fn((args: { data: Omit<Todo, 'id'> }) => {
        db.todos.push({ id: `td-${db.todos.length + 1}`, ...args.data })
        return { id: `td-${db.todos.length}` }
      }),
    },
    $executeRaw: jest.fn(async () => 0),
  }
  Object.assign(prisma as unknown as Record<string, unknown>, mock)
  return mock
}

let db: DB
let mock: ReturnType<typeof install>
const NOW = new Date('2026-09-02T12:00:00Z')

beforeEach(() => {
  db = baseDb()
  mock = install(db)
  invalidatePerms() // 清权限缓存，隔离用例
})

// ───────────────────────── 纯判定：canUrgeRequirement ─────────────────────────

describe('canUrgeRequirement（可催判定）', () => {
  it('WAITING + 有负责人 + 非本人 → ok 且 targetUserId=负责人', () => {
    expect(
      canUrgeRequirement({ status: 'WAITING', ownerId: 'u-mem' }, 'u-mgr')
    ).toEqual({
      ok: true,
      targetUserId: 'u-mem',
    })
  })

  it('已提交（非 WAITING）→ 拒绝', () => {
    for (const status of [
      'SUBMITTED',
      'REVIEWING',
      'APPROVED',
      'REJECTED',
      'NA',
      'OBSOLETED',
    ]) {
      const d = canUrgeRequirement({ status, ownerId: 'u-mem' }, 'u-mgr')
      expect(d.ok).toBe(false)
      if (!d.ok) expect(d.message).toContain('仅「待提交」状态可催办')
    }
  })

  it('无负责人 → 拒绝（该交付物无负责人，无法催办）', () => {
    const d = canUrgeRequirement({ status: 'WAITING', ownerId: null }, 'u-mgr')
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.message).toBe('该交付物无负责人，无法催办')
  })

  it('负责人本人 → 拒绝（无需催办自己）', () => {
    const d = canUrgeRequirement(
      { status: 'WAITING', ownerId: 'u-mem' },
      'u-mem'
    )
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.message).toContain('无需催办自己')
  })
})

// ───────────────────────── 纯判定：isUrgeRateLimited（24h 边界） ─────────────────────────

describe('isUrgeRateLimited（24h 频控边界）', () => {
  it('无历史记录 → 不限流', () => {
    expect(isUrgeRateLimited(null, NOW)).toBe(false)
    expect(isUrgeRateLimited(undefined, NOW)).toBe(false)
  })

  it('距上次催办 < 24h → 限流', () => {
    expect(isUrgeRateLimited(new Date(NOW.getTime() - 2 * 3600_000), NOW)).toBe(
      true
    )
    expect(
      isUrgeRateLimited(
        new Date(NOW.getTime() - URGE_RATE_LIMIT_MS + 1_000),
        NOW
      )
    ).toBe(true)
  })

  it('距上次催办 ≥ 24h → 放行', () => {
    expect(
      isUrgeRateLimited(new Date(NOW.getTime() - URGE_RATE_LIMIT_MS), NOW)
    ).toBe(false)
    expect(
      isUrgeRateLimited(new Date(NOW.getTime() - 25 * 3600_000), NOW)
    ).toBe(false)
  })
})

// ───────────────────────── 服务函数：urgeFileRequirement ─────────────────────────

describe('urgeFileRequirement（服务）', () => {
  it('创建成功：写 UrgeRecord（冗余字段）+ Notification + 待办 + pg_notify', async () => {
    const result = await urgeFileRequirement({
      requirementId: 'r-wait',
      urgedById: 'u-mgr',
      now: NOW,
    })

    expect(result.urge).toMatchObject({
      requirementId: 'r-wait',
      requirementName: '电气图纸',
      targetUserId: 'u-mem',
      targetUserName: '张三',
      status: 'ACTIVE',
    })
    // UrgeRecord：冗余字段照 model 注释（projectId/projectCode/requirementName）
    expect(mock.urgeRecord.create).toHaveBeenCalledTimes(1)
    expect(mock.urgeRecord.create.mock.calls[0][0].data).toMatchObject({
      projectId: 'p1',
      projectCode: 'PRJ-001',
      requirementId: 'r-wait',
      requirementName: '电气图纸',
      urgedById: 'u-mgr',
      targetUserId: 'u-mem',
      status: 'ACTIVE',
    })
    // 通知：站内 Notification（SYSTEM）+ IM pg_notify
    expect(mock.notification.create).toHaveBeenCalledTimes(1)
    expect(mock.notification.create.mock.calls[0][0].data).toMatchObject({
      userId: 'u-mem',
      type: 'SYSTEM',
      link: '/files?projectId=p1&requirementId=r-wait',
    })
    expect(mock.$executeRaw).toHaveBeenCalledTimes(1)
    // 待办：HIGH 优先级，FILE_REQ 来源
    expect(mock.todoItem.create).toHaveBeenCalledTimes(1)
    expect(mock.todoItem.create.mock.calls[0][0].data).toMatchObject({
      userId: 'u-mem',
      sourceType: 'FILE_REQ',
      sourceId: 'r-wait',
      priority: 'HIGH',
    })
    expect(result.todoCreated).toBe(true)
  })

  it('创建成功：已有未完成 FILE_REQ 待办 → 幂等跳过不重复建', async () => {
    db.todos.push({
      id: 'td-x',
      userId: 'u-mem',
      sourceType: 'FILE_REQ',
      sourceId: 'r-wait',
      doneAt: null,
    })
    const result = await urgeFileRequirement({
      requirementId: 'r-wait',
      urgedById: 'u-mgr',
      now: NOW,
    })
    expect(mock.todoItem.create).not.toHaveBeenCalled()
    expect(result.todoCreated).toBe(false)
  })

  it('24h 频控：同条目同发起人 2h 前已催（ACTIVE）→ 429 且不再写记录', async () => {
    db.urges.push({
      id: 'ug-seed',
      requirementId: 'r-wait',
      urgedById: 'u-mgr',
      targetUserId: 'u-mem',
      status: 'ACTIVE',
      createdAt: new Date(NOW.getTime() - 2 * 3600_000),
    })
    await expect(
      urgeFileRequirement({
        requirementId: 'r-wait',
        urgedById: 'u-mgr',
        now: NOW,
      })
    ).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('24 小时内已催办过'),
    })
    expect(mock.urgeRecord.create).not.toHaveBeenCalled()
    expect(mock.notification.create).not.toHaveBeenCalled()
  })

  it('频控放行：上次催办已超 24h → 允许再次催办', async () => {
    db.urges.push({
      id: 'ug-seed',
      requirementId: 'r-wait',
      urgedById: 'u-mgr',
      targetUserId: 'u-mem',
      status: 'ACTIVE',
      createdAt: new Date(NOW.getTime() - 25 * 3600_000),
    })
    const result = await urgeFileRequirement({
      requirementId: 'r-wait',
      urgedById: 'u-mgr',
      now: NOW,
    })
    expect(result.urge.targetUserId).toBe('u-mem')
    expect(mock.urgeRecord.create).toHaveBeenCalledTimes(1)
  })

  it('频控不误伤：24h 内是「他人」催过 → 本人仍可催', async () => {
    db.urges.push({
      id: 'ug-seed',
      requirementId: 'r-wait',
      urgedById: 'u-owner',
      targetUserId: 'u-mem',
      status: 'ACTIVE',
      createdAt: new Date(NOW.getTime() - 3600_000),
    })
    const result = await urgeFileRequirement({
      requirementId: 'r-wait',
      urgedById: 'u-mgr',
      now: NOW,
    })
    expect(result.urge.targetUserId).toBe('u-mem')
  })

  it('已提交（SUBMITTED）→ 400', async () => {
    await expect(
      urgeFileRequirement({
        requirementId: 'r-sub',
        urgedById: 'u-mgr',
        now: NOW,
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('已提交'),
    })
    expect(mock.urgeRecord.create).not.toHaveBeenCalled()
  })

  it('无负责人 → 400「该交付物无负责人，无法催办」', async () => {
    await expect(
      urgeFileRequirement({
        requirementId: 'r-noowner',
        urgedById: 'u-mgr',
        now: NOW,
      })
    ).rejects.toMatchObject({
      status: 400,
      message: '该交付物无负责人，无法催办',
    })
    expect(mock.urgeRecord.create).not.toHaveBeenCalled()
  })

  it('不可见（非成员催 PRIVATE 条目）→ 403', async () => {
    await expect(
      urgeFileRequirement({
        requirementId: 'r-pri',
        urgedById: 'u-out',
        now: NOW,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(mock.urgeRecord.create).not.toHaveBeenCalled()
    expect(mock.notification.create).not.toHaveBeenCalled()
  })

  it('条目不存在 → 404', async () => {
    await expect(
      urgeFileRequirement({
        requirementId: 'r-ghost',
        urgedById: 'u-mgr',
        now: NOW,
      })
    ).rejects.toMatchObject({ status: 404, message: '文件条目不存在' })
  })

  it('错误为 UrgeError 实例（路由层可按 status/code 映射统一壳）', async () => {
    const p = urgeFileRequirement({
      requirementId: 'r-sub',
      urgedById: 'u-mgr',
      now: NOW,
    })
    await expect(p).rejects.toBeInstanceOf(UrgeError)
  })
})
