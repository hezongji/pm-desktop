/**
 * GET /api/files/:id/preview —— 依据《开发文档-项目管理系统重构》§7.7
 *
 * view 权限 → PDF/图片内联预览（Content-Type + inline disposition，§7.7），
 * 写 FileAccessLog(VIEW)（§5）。支持 HTTP Range（206 分段，PDF 分页/视频拖动）。
 *
 * 仅 image/* 与 application/pdf 允许内联预览；其余类型返回 415（前端可回退下载）。
 * 计划外文件（requirementId=null）回退项目 view 权限（见 lib/file-access.ts 文件头）。
 */

import { NextRequest } from 'next/server'
import {
  requireAuth,
  handleApiError,
  ApiError,
  assertIdentityFresh,
  methodNotAllowed,
} from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { accessFile } from '@/lib/file-access'

export const dynamic = 'force-dynamic'

// 20260908 生产审计修复 W3-P2-1：未实现方法返回统一 JSON 405
export const POST = methodNotAllowed('GET')
export const PUT = methodNotAllowed('GET')
export const PATCH = methodNotAllowed('GET')
export const DELETE = methodNotAllowed('GET')

type RouteContext = { params: Promise<{ id: string }> }

const PREVIEWABLE = ['image/', 'application/pdf']

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    // 20260908 生产审计修复 P1-3/P1-4：本路由不走 apiHandler，需手动做实时身份校验。
    await assertIdentityFresh(request)
    const user = requireAuth(request)
    const { id } = await context.params

    const file = await prisma.file.findUnique({
      where: { id },
      select: { mimeType: true },
    })
    if (!file) throw ApiError.notFound('文件不存在')

    const mime = file.mimeType.toLowerCase()
    if (mime === 'image/svg+xml' || mime === 'text/html') {
      throw new ApiError(
        415,
        'SVG/HTML 不支持在线预览（安全限制），请使用下载',
        'UNSUPPORTED_MEDIA_TYPE'
      )
    }
    const previewable = PREVIEWABLE.some(p => mime.startsWith(p))
    if (!previewable) {
      throw new ApiError(
        415,
        `该文件类型（${file.mimeType}）不支持内联预览，请使用下载`,
        'UNSUPPORTED_MEDIA_TYPE'
      )
    }

    return await accessFile(request, id, 'VIEW', user.userId)
  } catch (e) {
    return handleApiError(e)
  }
}
