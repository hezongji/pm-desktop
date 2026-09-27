/**
 * 信息密度两档 · 共享常量与纯逻辑（P3-C 桌面化）
 *
 * 无 'use client'：根布局（服务端组件）要内联执行 DENSITY_INIT_SCRIPT，
 * 从 'use client' 模块 import 会拿到客户端引用而非字符串，故常量与纯函数独立成模块，
 * 由 src/hooks/use-density.ts 提供给客户端组件消费。
 *
 * comfortable（默认，与重构前现状一致）/ compact（表格行高 32px，密度优先）。
 * 仅写 <html data-density>；globals.css 只对 compact 收紧纵向留白，默认档零回归。
 */

export type Density = 'comfortable' | 'compact'

export const DENSITY_STORAGE_KEY = 'pm-density'
export const DENSITY_ATTRIBUTE = 'data-density'
/** 同页广播事件（storage 事件只在其它标签页触发，本页需自定义事件） */
export const DENSITY_CHANGE_EVENT = 'pm-density-change'
export const DEFAULT_DENSITY: Density = 'comfortable'

/** 根布局 <head> 内联脚本：先于首帧写入 data-density，避免紧凑档闪一帧舒适留白 */
export const DENSITY_INIT_SCRIPT = `(function(){try{var d=localStorage.getItem('${DENSITY_STORAGE_KEY}');if(d==='comfortable'||d==='compact'){document.documentElement.setAttribute('${DENSITY_ATTRIBUTE}',d)}}catch(e){}})();`

export const DENSITY_OPTIONS: {
  value: Density
  label: string
  hint: string
}[] = [
  { value: 'comfortable', label: '舒适', hint: '默认留白，长文本更好读' },
  { value: 'compact', label: '紧凑', hint: '表格行高 32px，密度优先' },
]

export function isDensity(value: unknown): value is Density {
  return value === 'comfortable' || value === 'compact'
}

/** 读持久化密度（SSR / 隐私模式 / 脏值一律回退默认档） */
export function readStoredDensity(): Density {
  if (typeof window === 'undefined') return DEFAULT_DENSITY
  try {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY)
    return isDensity(stored) ? stored : DEFAULT_DENSITY
  } catch {
    return DEFAULT_DENSITY
  }
}

/** 应用密度到 <html>（不写存储；初始化脚本与水合后自愈共用） */
export function applyDensity(density: Density): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, density)
}

/** 持久化 + 应用 + 广播 */
export function setStoredDensity(density: Density): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density)
  } catch {
    /* 隐私模式：本次会话内生效 */
  }
  applyDensity(density)
  window.dispatchEvent(new Event(DENSITY_CHANGE_EVENT))
}
