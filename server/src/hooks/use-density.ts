'use client'

/**
 * useDensity —— 信息密度两档（P3-C 桌面化）
 *
 * 纯逻辑与常量在 src/lib/density.ts（根布局内联脚本共用），本模块只提供 React 绑定：
 *  - useSyncExternalStore：同页多个消费者读到同一值，SSR 快照=默认档
 *  - 水合后自愈：内联脚本被 CSP/扩展拦掉时，仍以 localStorage 值为准
 */

import * as React from 'react'

import {
  applyDensity,
  DEFAULT_DENSITY,
  DENSITY_CHANGE_EVENT,
  readStoredDensity,
  setStoredDensity,
  type Density,
} from '@/lib/density'

export {
  DENSITY_ATTRIBUTE,
  DENSITY_INIT_SCRIPT,
  DENSITY_OPTIONS,
  DENSITY_STORAGE_KEY,
  type Density,
} from '@/lib/density'

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(DENSITY_CHANGE_EVENT, onStoreChange)
  // 其它窗口（多开）改密度后同步；事件无载荷，回调内重读存储
  window.addEventListener('storage', onStoreChange)
  return () => {
    window.removeEventListener(DENSITY_CHANGE_EVENT, onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

export function useDensity(): {
  density: Density
  setDensity: (density: Density) => void
} {
  const density = React.useSyncExternalStore(
    subscribe,
    readStoredDensity,
    () => DEFAULT_DENSITY
  )

  // 水合后自愈：内联脚本缺失时补齐 <html data-density>
  React.useEffect(() => {
    applyDensity(density)
  }, [density])

  return { density, setDensity: setStoredDensity }
}
