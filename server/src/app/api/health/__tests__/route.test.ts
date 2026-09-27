/**
 * GET /api/health 单测（SDLC 20260905-api-health-endpoint）
 * 三态覆盖（spec 验收断言）：
 *   1. DB 正常 → 200 成功壳，仅暴露 status/timestamp（20260908 生产审计 W1-P2-8：
 *      原返回 db/latencyMs 等内部信息，已精简）
 *   2. DB reject → 503 DB_UNAVAILABLE，固定文案不泄漏内部信息
 *   3. DB 超时（2s 护栏） → 503 同上
 */

import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: jest.fn() },
}))

const mockedQuery = prisma.$queryRaw as unknown as jest.Mock

function callGet(): Promise<Response> {
  // apiHandler 包装后的签名为 (request, context)，Next 运行时总会传 context；
  // 直调时补 undefined 与运行时行为一致
  return GET(
    new NextRequest('http://localhost:3001/api/health'),
    undefined
  ) as Promise<Response>
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

afterEach(() => {
  jest.useRealTimers()
})

describe('GET /api/health', () => {
  it('DB 正常 → 200 成功壳：仅 status/timestamp（不泄漏 DB 状态与时延）', async () => {
    mockedQuery.mockResolvedValueOnce([{ '?column?': 1 }])
    const res = await callGet()
    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body.success).toBe(true)
    const data = body.data as Record<string, unknown>
    expect(data.status).toBe('ok')
    expect(typeof data.timestamp).toBe('string')
    expect(isNaN(Date.parse(data.timestamp as string))).toBe(false)
    // 白名单负向断言：data 不得出现契约之外的键（尤其 db / latencyMs 等内部信息）
    expect(Object.keys(data).sort()).toEqual(['status', 'timestamp'])
    expect(body.message).toBe('ok')
  })

  it('DB reject → 503 失败壳 DB_UNAVAILABLE，固定文案不泄漏内部信息', async () => {
    mockedQuery.mockRejectedValueOnce(
      new Error('Connection string: postgresql://user:secret@10.0.0.9:5432/pm')
    )
    const res = await callGet()
    expect(res.status).toBe(503)
    const body = await bodyOf(res)
    expect(body.success).toBe(false)
    expect(body.message).toBe('数据库连接异常')
    const err = body.error as { code: string; message: string }
    expect(err.code).toBe('DB_UNAVAILABLE')
    // 白名单：响应体任何位置不得出现原始错误的内部信息
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('secret')
    expect(raw).not.toContain('10.0.0.9')
    expect(raw).not.toContain('postgresql')
  })

  it('DB 挂起超 2s 护栏 → 503（不无限等待拖住拨测）', async () => {
    jest.useFakeTimers()
    mockedQuery.mockReturnValueOnce(new Promise<never>(() => {}))
    const pending = callGet()
    await jest.advanceTimersByTimeAsync(2000)
    const res = await pending
    expect(res.status).toBe(503)
    const body = await bodyOf(res)
    expect((body.error as { code: string }).code).toBe('DB_UNAVAILABLE')
  })
})
