/**
 * rejectReadonly 单测（fix-4②：PATCH 只读字段显式 400）
 * 覆盖：只读字段出现 → 400（消息指名字段）；未传 → 放行；
 *       非对象 body 放行（交 zod 报错）；仅自有属性命中（继承属性不算）。
 */

import { rejectReadonly, ApiError } from '../api-helpers'

describe('rejectReadonly', () => {
  it('出现只读字段 → 抛 ApiError，消息指名字段并引导专用接口', () => {
    expect(() =>
      rejectReadonly({ title: 'x', code: 'P001' }, ['code'])
    ).toThrow(ApiError)
    expect(() =>
      rejectReadonly({ title: 'x', code: 'P001' }, ['code'])
    ).toThrow('字段 code 只读，请通过专用接口修改')
  })

  it('机器码为 400 / BAD_REQUEST', () => {
    let err: unknown
    try {
      rejectReadonly({ status: 'DONE' }, ['id', 'status'])
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(400)
    expect(apiErr.code).toBe('BAD_REQUEST')
  })

  it('多个只读字段命中时按声明序报第一个', () => {
    expect(() =>
      rejectReadonly({ revision: 3, projectId: 'p1' }, [
        'projectId',
        'revision',
      ])
    ).toThrow('字段 projectId 只读')
  })

  it('未传只读字段 → 放行（含空对象 / 空清单）', () => {
    expect(() =>
      rejectReadonly({ done: true, dueAt: null }, ['id', 'doneAt', 'userId'])
    ).not.toThrow()
    expect(() => rejectReadonly({}, ['code'])).not.toThrow()
    expect(() => rejectReadonly({ a: 1 }, [])).not.toThrow()
  })

  it('值显式为 null 的只读字段同样拒绝（null 也是「想改」）', () => {
    expect(() =>
      rejectReadonly({ doneAt: null, done: true }, ['doneAt'])
    ).toThrow('字段 doneAt 只读')
  })

  it('非普通对象 body → 放行（交由后续 zod 校验报错）', () => {
    expect(() =>
      rejectReadonly(null as unknown as Record<string, unknown>, ['code'])
    ).not.toThrow()
    expect(() =>
      rejectReadonly([1, 2] as unknown as Record<string, unknown>, ['code'])
    ).not.toThrow()
    expect(() =>
      rejectReadonly('x' as unknown as Record<string, unknown>, ['code'])
    ).not.toThrow()
  })

  it('仅自有属性判定，原型链继承属性不算命中', () => {
    const body = Object.create({ code: 'inherited' }) as Record<string, unknown>
    expect(() => rejectReadonly(body, ['code'])).not.toThrow()
  })
})
