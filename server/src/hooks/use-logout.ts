'use client'

/**
 * useLogout —— 统一登出（20260908 生产审计修复 P1-3 前端配套）
 *
 * 背景：服务端新增 POST /api/auth/logout，会把该用户 tokenVersion 自增，
 * 从而立即吊销所有已签发令牌。若前端只清本地存储而不调该接口，
 * 旧令牌在 30 天有效期内仍可被复用（令牌吊销形同虚设）。
 *
 * 行为：先请求服务端吊销（失败也不阻塞），再清本地凭证并跳转。
 * 桌面壳（P2-6，D3）：登出时同时调 window.pmDesktop.clearSession() 清壳 HTTP 缓存，
 * 防登出后「后退」看到已鉴权页面的缓存内容；壳缺失/失败均不阻塞登出。
 * 用法：const doLogout = useLogout(); await doLogout()          // 默认跳 /login
 *       await doLogout('/login?next=%2Fim')                    // IM 壳层回跳
 */

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { desktopClearSession } from '@/lib/pm-desktop'

export function useLogout() {
  const router = useRouter()
  const logout = useAuthStore(s => s.logout)

  return useCallback(
    async (redirectTo = '/login') => {
      try {
        const token =
          typeof window !== 'undefined'
            ? localStorage.getItem('auth-token')
            : null
        if (token) {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
        }
      } catch {
        /* 网络/服务异常不阻塞本地登出：本地凭证必须清干净 */
      } finally {
        // 桌面壳：清空壳侧会话缓存（P2-6 D3）；失败不阻塞登出
        await desktopClearSession()
        logout()
        router.replace(redirectTo)
      }
    },
    [logout, router]
  )
}
