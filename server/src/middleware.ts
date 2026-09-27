/**
 * Host 门禁（SDLC 20260906-call-ui-wechat → IM 独立域名 im.hezongji.cn）
 *
 * 目的：IM 聊天从 im.hezongji.cn 访问（App 壳 1.8.0 起指向该域名），与 PM 管理站
 * pm.hezongji.cn 入口彻底分开。同一 Next 实例服务两域名：
 *  - im.hezongji.cn：只放行 IM 相关路径（/im /login /api /_next /downloads /socket.io），
 *    根路径跳 /im，其余页面路径一律回 /im —— PM 管理功能页在 im 域名下不可达
 *  - 其他域名：零影响（直接放行）
 */

import { NextRequest, NextResponse } from 'next/server'

const IM_HOST = process.env.IM_HOST || ''

const IM_ALLOW_PREFIXES = [
  '/im',
  '/im/diag',
  '/login',
  '/download',
  '/api/',
  '/_next/',
  '/downloads/',
  '/socket.io',
  '/favicon.ico',
  '/manifest.json',
  '/icons/',
]

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0]
  if (host !== IM_HOST) return NextResponse.next()

  const { pathname } = req.nextUrl
  // 根路径进聊天
  if (pathname === '/') return NextResponse.redirect(new URL('/im', req.url))
  const allowed = IM_ALLOW_PREFIXES.some(
    p => pathname === p || pathname.startsWith(p)
  )
  if (!allowed) return NextResponse.redirect(new URL('/im', req.url))
  return NextResponse.next()
}

export const config = {
  // 排除静态资源（middleware 只拦页面与 API 导航）
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|mp4|apk)$).*)',
  ],
}
