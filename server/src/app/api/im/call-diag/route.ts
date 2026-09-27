/**
 * POST /api/im/call-diag —— 通话自检结果上报（SDLC 20260906 故障定位）
 * 仅登录可用；结果写 pm-app 日志（[call-diag] 标签，journalctl -u pm-app 可查）。
 */

import { NextRequest } from 'next/server'
import { apiHandler, created, requireAuth } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (request: NextRequest) => {
  const user = requireAuth(request)
  const body = await request.json()
  // 结构化打点：诊断矩阵 + UA + 构建号（截断防刷日志）
  const line = JSON.stringify(body).slice(0, 1200)
  console.log(`[call-diag] user=${user.userId} ${line}`)
  return created({ received: true })
})
