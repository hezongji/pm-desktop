/**
 * GET /api/health —— 主应用健康探针（SDLC 20260905-api-health-endpoint）
 *
 * 设计意图（spec.md）：
 *   - 无鉴权：拨测脚本（probe-pm.sh）无凭据可用；安全面由响应体字段白名单控制，
 *     任何异常只回固定文案，不回 error.message / 堆栈 / 连接串
 *   - force-dynamic：防 Next 静态优化把结果缓存成「DB 挂了仍 200」
 *   - 一切 DB 异常（reject / 超时）在此自行 catch 转为 ApiError(503)，
 *     不漏给 apiHandler 的未知错误兜底（那会 console.error 原始错误并回 500）
 */

import { NextRequest } from 'next/server'
import { apiHandler, ok, ApiError } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** DB 探测超时：连接池 hang 时快速失败，防拖住拨测（spec：2s） */
const DB_PROBE_TIMEOUT_MS = 2000

export const GET = apiHandler(async (_request: NextRequest) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('db probe timeout')),
          DB_PROBE_TIMEOUT_MS
        )
      }),
    ])
  } catch {
    throw new ApiError(503, '数据库连接异常', 'DB_UNAVAILABLE')
  } finally {
    clearTimeout(timer)
  }
  // 返回体精简（20260908 修复 W1-P2-8）：去掉 DB 时延等内部信息，仅保留拨测所需状态位
  return ok({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})
