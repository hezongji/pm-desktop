/**
 * POST /api/auth/logout —— 登出并吊销当前令牌（20260908 生产审计 P1-3 修复）
 *
 * 服务端此前没有登出接口，JWT 又是无状态签名，登出后旧令牌在 30 天有效期内继续可用。
 * 现在登出会把该用户的 tokenVersion 自增，apiHandler 的实时身份守卫随即拒绝所有旧令牌。
 *
 * 幂等：未携带令牌 / 令牌无效时同样返回成功（客户端只需清本地凭证）。
 */

import { NextRequest } from 'next/server'
import { apiHandler, ok } from '@/lib/api-helpers'
import { getAuthUser, bumpTokenVersion } from '@/lib/auth'

export const POST = apiHandler(async (request: NextRequest) => {
  const authUser = getAuthUser(request)
  if (authUser) {
    await bumpTokenVersion(authUser.userId)
  }
  return ok({ loggedOut: true }, '已退出登录')
})
