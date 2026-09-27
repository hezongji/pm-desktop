/**
 * 本地运行时状态展示口径（P3-D，纯函数，便于单测）
 *
 * 数据来源：壳 getRuntimeStatus()（见 src/lib/pm-desktop.ts）。
 * 壳只暴露总体 phase，不提供逐服务探活，因此三服务状态灯按壳真实语义推导：
 *  - 数据库：ready / degraded 都算在跑 —— 看门狗只探应用与消息服务，
 *    其恢复动作（restartServers）也显式不动 PostgreSQL（local-runtime/index.ts）
 *  - 应用 / 消息服务：仅 ready 算在跑；degraded = 看门狗升级，说明健康检查已连续失败
 */

import type { DesktopRuntimeStatus } from '@/lib/pm-desktop'

export type RuntimePhase = DesktopRuntimeStatus['phase']

export const RUNTIME_PHASE_LABEL: Record<RuntimePhase, string> = {
  idle: '未启动',
  booting: '启动中',
  ready: '就绪',
  degraded: '降级',
  failed: '启动失败',
  stopped: '已停止',
}

export type PhaseBadgeVariant =
  | 'softSuccess'
  | 'softWarning'
  | 'softDestructive'
  | 'softInfo'
  | 'secondary'

export const RUNTIME_PHASE_VARIANT: Record<RuntimePhase, PhaseBadgeVariant> = {
  idle: 'secondary',
  booting: 'softInfo',
  ready: 'softSuccess',
  degraded: 'softWarning',
  failed: 'softDestructive',
  stopped: 'secondary',
}

export interface RuntimeServiceLight {
  key: 'pg' | 'api' | 'im'
  label: string
  port?: number
  up: boolean
}

/** 本地服务列表（顺序固定：数据库 → 应用服务 → 消息服务） */
export const RUNTIME_SERVICE_META: {
  key: RuntimeServiceLight['key']
  label: string
}[] = [
  { key: 'pg', label: '数据库（PostgreSQL）' },
  { key: 'api', label: '应用服务（Next.js）' },
  { key: 'im', label: '消息服务（Socket.IO）' },
]

export function deriveRuntimeServices(
  status: DesktopRuntimeStatus | null
): RuntimeServiceLight[] {
  const phase = status?.phase ?? 'idle'
  const pgUp = phase === 'ready' || phase === 'degraded'
  const appUp = phase === 'ready'
  const portOf: Record<RuntimeServiceLight['key'], number | undefined> = {
    pg: status?.pgPort,
    api: status?.apiPort,
    im: status?.wsPort,
  }
  const upOf: Record<RuntimeServiceLight['key'], boolean> = {
    pg: pgUp,
    api: appUp,
    im: appUp,
  }
  return RUNTIME_SERVICE_META.map(meta => ({
    ...meta,
    port: portOf[meta.key],
    up: upOf[meta.key],
  }))
}

/** 数据目录（壳未上报时回退到壳的固定落点 %APPDATA%\pm-desktop） */
export function displayDataDir(status: DesktopRuntimeStatus | null): string {
  return status?.dataDir ?? '%APPDATA%\\pm-desktop'
}

/** 三项用量在总用量中的占比（总为 0 时全 0，避免除零） */
export function usageShare(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.round((part / total) * 100))
}
