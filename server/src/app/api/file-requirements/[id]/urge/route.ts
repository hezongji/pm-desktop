/**
 * POST /api/file-requirements/:id/urge —— 手动催办单条交付物（fix-3 · 文件域）
 *
 * 给「能看见该条目」的成员补催办入口（此前仅交付物看板批量催办 MANAGER/OWNER/ADMIN）：
 *   - 鉴权：requireAuth；可见性/状态/负责人/24h 频控均由 src/lib/urge.ts 服务终审
 *     （可见性 can 'view' FILE_REQ，与 GET 详情同口径；不可见 = 不可催）
 *   - 副作用：UrgeRecord + Notification(SYSTEM) + TodoItem(FILE_REQ, 幂等) + IM notify:push；
 *     被催人提交后 submit 路由既有逻辑把 ACTIVE 置 DONE（催办闭环）
 *   - 错误：UrgeError → ApiError 统一响应壳（404/403/400/429）
 */

import { NextRequest } from 'next/server'
import { apiHandler, created, requireAuth, ApiError } from '@/lib/api-helpers'
import { urgeFileRequirement, UrgeError } from '@/lib/urge'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** UrgeError → api-helpers ApiError（统一响应壳） */
function toApiError(e: unknown): never {
  if (e instanceof UrgeError) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 400
    throw new ApiError(status, e.message, e.code || 'BAD_REQUEST')
  }
  throw e
}

export const POST = apiHandler<Ctx>(
  async (request: NextRequest, { params }) => {
    const { id } = await params
    const user = requireAuth(request)

    try {
      const result = await urgeFileRequirement({
        requirementId: id,
        urgedById: user.userId,
      })
      return created(
        result,
        `已催办「${result.urge.requirementName}」，将通知 ${result.urge.targetUserName ?? '负责人'}`
      )
    } catch (e) {
      toApiError(e)
    }
  }
)
