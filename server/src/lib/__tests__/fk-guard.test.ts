/**
 * fk-guard 纯函数测试（fix-5）
 *
 * 覆盖：
 *  - isForeignKeyViolation：Prisma P2003 判定（构造同名 Error 模拟，
 *    不依赖真实 Prisma 客户端；判定本身为鸭子类型）
 *  - missingActiveUserIds：建群/拉人前「请求成员 vs 在职成员」差集
 *    （脏 userId 场景：不存在的 id、已离职被过滤的 id、重复提交的 id）
 */

import { isForeignKeyViolation, missingActiveUserIds } from '../fk-guard'

/** 构造 Prisma 已知错误形态（跨版本稳定：name + code） */
function prismaKnownError(code: string): Error {
  const e = new Error(`Foreign key constraint failed on the field: \`userId\``)
  e.name = 'PrismaClientKnownRequestError'
  Object.assign(e, { code, clientVersion: '6.14.0' })
  return e
}

describe('isForeignKeyViolation', () => {
  it('P2003 外键违规 → true', () => {
    expect(isForeignKeyViolation(prismaKnownError('P2003'))).toBe(true)
  })

  it('其他 Prisma 已知错误码（P2002 唯一冲突等）→ false', () => {
    expect(isForeignKeyViolation(prismaKnownError('P2002'))).toBe(false)
    expect(isForeignKeyViolation(prismaKnownError('P2025'))).toBe(false)
  })

  it('普通 Error / 非 Error → false', () => {
    expect(isForeignKeyViolation(new Error('P2003'))).toBe(false) // 文本含 P2003 但 name 不符
    expect(isForeignKeyViolation({ code: 'P2003' })).toBe(false) // 非 Error 实例
    expect(isForeignKeyViolation(null)).toBe(false)
    expect(isForeignKeyViolation(undefined)).toBe(false)
    expect(isForeignKeyViolation('P2003')).toBe(false)
  })

  it('事务回滚透传的 P2003（$reject 场景同构）→ true', async () => {
    // prisma.$transaction 里抛出的错误原样向上传播，形态不变
    const tx = async (): Promise<never> => {
      throw prismaKnownError('P2003')
    }
    let caught = null as unknown
    try {
      await tx()
    } catch (e) {
      caught = e
    }
    expect(isForeignKeyViolation(caught)).toBe(true)
  })
})

describe('missingActiveUserIds', () => {
  it('全部在职 → 空数组（建群放行）', () => {
    expect(missingActiveUserIds(['u1', 'u2'], ['u1', 'u2', 'u3'])).toEqual([])
  })

  it('混入不存在的脏 userId → 返回脏 id（建群应整体 400）', () => {
    expect(missingActiveUserIds(['u1', 'ghost', 'u2'], ['u1', 'u2'])).toEqual([
      'ghost',
    ])
  })

  it('多个脏 id 全部返回', () => {
    expect(missingActiveUserIds(['a', 'b', 'c', 'd'], ['b'])).toEqual([
      'a',
      'c',
      'd',
    ])
  })

  it('requested 去重：同一脏 id 只报一次', () => {
    expect(missingActiveUserIds(['x', 'x', 'u1'], ['u1'])).toEqual(['x'])
  })

  it('foundActive 含重复不影响判定', () => {
    expect(missingActiveUserIds(['u1'], ['u1', 'u1'])).toEqual([])
  })

  it('空入参 → 空数组', () => {
    expect(missingActiveUserIds([], [])).toEqual([])
    expect(missingActiveUserIds([], ['u1'])).toEqual([])
  })
})
