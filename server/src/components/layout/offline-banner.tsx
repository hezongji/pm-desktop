'use client'

/**
 * 断网提示条（P2-3）
 *
 * 数据源：桌面壳 Electron online/offline 事件（app:online-change → window.pmDesktop.onOnlineChange）。
 * 浏览器无该事件源 → 组件不渲染（零回归）。
 *
 * 表现：红底白字通栏，固定顶部；断网时滑入、恢复时滑出（300ms 过渡）。
 * 初始态由壳订阅回调首次下发决定（壳未下发前保持隐藏，符合「不误报」原则）。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import { isDesktopApp, onDesktopOnlineChange } from '@/lib/pm-desktop'

/** 「是否在壳内」在运行期不变，订阅源为空实现 */
const noopUnsubscribe = () => {}

export function OfflineBanner() {
  // 服务端/水合期返回 false，水合完成后读真实值（避免 hydration 不一致）
  const inDesktop = useSyncExternalStore(
    () => noopUnsubscribe,
    isDesktopApp,
    () => false
  )
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!inDesktop) return
    return onDesktopOnlineChange(({ online }) => setOffline(!online))
  }, [inDesktop])

  if (!inDesktop) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[80] flex items-center justify-center gap-2 bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-md transition-transform duration-300 ${
        offline ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      网络连接已断开，正在重连…
    </div>
  )
}
