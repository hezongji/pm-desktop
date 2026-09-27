/**
 * 桌面壳桥接适配器（window.pmDesktop）
 *
 * 规格：《pm-desktop-development-plan-v1.1》§4.6 IPC 白名单 + §8 P2 表
 * 约定：壳由 Electron 注入 window.pmDesktop；浏览器端不存在该对象。
 *       本模块所有函数做存在性判断 —— 浏览器端调用安全返回，行为零回归。
 * 冻结契约名：window.pmDesktop（D5 裁决，双端统一）。
 */

/** 文件对话框过滤器（对应 Electron dialog filters） */
export interface DesktopFileFilter {
  name: string
  extensions: string[]
}

export interface DesktopAppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  appUrl: string
}

export interface DesktopOnlineChange {
  online: boolean
}

export interface DesktopUpdaterProgress {
  percent: number
}

export interface DesktopUpdaterStatus {
  state: string
}

// ── 本地运行时与数据主权（2.0 全本地模式，壳侧 pm-desktop/src/shared/types.ts 同名同构） ──

export interface DesktopRuntimeStatus {
  mode: 'local' | 'cloud'
  phase: 'idle' | 'booting' | 'ready' | 'degraded' | 'failed' | 'stopped'
  apiPort?: number
  wsPort?: number
  pgPort?: number
  dataDir?: string
  bootStage?: string
  error?: string
  startedAt?: string
}

/** 存储用量（壳实测目录大小；human 为三项合计） */
export interface DesktopDataStats {
  pgBytes: number
  uploadsBytes: number
  backupsBytes: number
  human: string
}

export interface DesktopActionResult {
  ok: boolean
  error?: string
}

export interface DesktopBackupResult {
  ok: boolean
  path?: string
  reason?: string
}

/**
 * 壳暴露的 API 面。壳侧允许只提供子集（版本差异），
 * 因此字段均为可选，调用方须经下方封装函数（自带存在性判断）。
 */
export interface PmDesktopBridge {
  getAppInfo?: () => Promise<DesktopAppInfo>
  checkForUpdates?: () => Promise<unknown>
  downloadUpdate?: () => Promise<unknown>
  notify?: (title: string, body?: string) => Promise<void>
  saveFile?: (
    defaultName?: string,
    filters?: DesktopFileFilter[]
  ) => Promise<string | null>
  openFile?: (filters?: DesktopFileFilter[]) => Promise<string | null>
  print?: (urlOrHtml: string) => Promise<{ ok: boolean; reason?: string }>
  getServerUrl?: () => Promise<string>
  setServerUrl?: (url: string) => Promise<{ ok: boolean; reason?: string }>
  clearSession?: () => Promise<void>
  revealLog?: () => Promise<void>
  onOnlineChange?: (cb: (payload: DesktopOnlineChange) => void) => () => void
  onUpdaterProgress?: (
    cb: (payload: DesktopUpdaterProgress) => void
  ) => () => void
  onUpdaterStatus?: (cb: (payload: DesktopUpdaterStatus) => void) => () => void
  getRuntimeStatus?: () => Promise<DesktopRuntimeStatus>
  retryLocalRuntime?: () => Promise<DesktopActionResult>
  restartLocalServices?: () => Promise<DesktopActionResult>
  backupData?: (targetDir?: string) => Promise<DesktopBackupResult>
  restoreData?: (dumpFile: string) => Promise<DesktopActionResult>
  openDataFolder?: () => Promise<boolean>
  getDataStats?: () => Promise<DesktopDataStats>
}

declare global {
  interface Window {
    pmDesktop?: PmDesktopBridge
  }
}

/** 取壳桥（浏览器/SSR 返回 null） */
export function getDesktopBridge(): PmDesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.pmDesktop
  return bridge && typeof bridge === 'object' ? bridge : null
}

/** 是否运行在桌面壳内 */
export function isDesktopApp(): boolean {
  return getDesktopBridge() !== null
}

/** 弹原生系统通知（壳负责点击聚焦窗口）；壳缺失或未实现时返回 false */
export async function desktopNotify(
  title: string,
  body?: string
): Promise<boolean> {
  const fn = getDesktopBridge()?.notify
  if (!fn) return false
  try {
    await fn(title, body)
    return true
  } catch {
    return false
  }
}

/**
 * 登出时清空壳会话缓存（§4.3 D3：防 HTTP 缓存后退查看）；
 * 壳缺失或失败均不抛出 —— 登出流程不可被壳阻塞。
 */
export async function desktopClearSession(): Promise<boolean> {
  const fn = getDesktopBridge()?.clearSession
  if (!fn) return false
  try {
    await fn()
    return true
  } catch {
    return false
  }
}

/** 保存文件对话框（返回选定路径；壳缺失返回 null） */
export async function desktopSaveFile(
  defaultName?: string,
  filters?: DesktopFileFilter[]
): Promise<string | null> {
  const fn = getDesktopBridge()?.saveFile
  if (!fn) return null
  try {
    return await fn(defaultName, filters)
  } catch {
    return null
  }
}

/** 打开文件对话框（返回选定路径；壳缺失返回 null） */
export async function desktopOpenFile(
  filters?: DesktopFileFilter[]
): Promise<string | null> {
  const fn = getDesktopBridge()?.openFile
  if (!fn) return null
  try {
    return await fn(filters)
  } catch {
    return null
  }
}

/** 调系统打印（壳缺失返回 not-supported） */
export async function desktopPrint(
  urlOrHtml: string
): Promise<{ ok: boolean; reason?: string }> {
  const fn = getDesktopBridge()?.print
  if (!fn) return { ok: false, reason: 'not-supported' }
  try {
    return await fn(urlOrHtml)
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/**
 * 订阅网络在线状态变化（仅桌面壳有该事件源）。
 * @returns 取消订阅函数（浏览器端为 no-op）
 */
export function onDesktopOnlineChange(
  cb: (payload: DesktopOnlineChange) => void
): () => void {
  const fn = getDesktopBridge()?.onOnlineChange
  if (!fn) return () => {}
  try {
    const dispose = fn(cb)
    return typeof dispose === 'function' ? dispose : () => {}
  } catch {
    return () => {}
  }
}

// ── 本地运行时与数据主权（2.0 全本地模式）─────────────────────────
// 约定：浏览器直跑（无壳）时全部降级为安全默认值，调用方无需先判存在性；
//       只有需要区分「失败原因」的场景才读取 reason/error 字段。

/** 浏览器 / 云端模式下的运行时状态（无本地服务） */
export const CLOUD_RUNTIME_STATUS: DesktopRuntimeStatus = {
  mode: 'cloud',
  phase: 'idle',
}

/** 浏览器 / 云端模式下的空用量 */
export const EMPTY_DATA_STATS: DesktopDataStats = {
  pgBytes: 0,
  uploadsBytes: 0,
  backupsBytes: 0,
  human: '0 B',
}

/** 本地运行时状态（壳缺失或调用失败 → 云端空状态） */
export async function desktopGetRuntimeStatus(): Promise<DesktopRuntimeStatus> {
  const fn = getDesktopBridge()?.getRuntimeStatus
  if (!fn) return CLOUD_RUNTIME_STATUS
  try {
    return await fn()
  } catch {
    return CLOUD_RUNTIME_STATUS
  }
}

/** 启动失败后重跑整条本地启动链（启动页「重试」的等价入口） */
export async function desktopRetryRuntime(): Promise<DesktopActionResult> {
  const fn = getDesktopBridge()?.retryLocalRuntime
  if (!fn) return { ok: false, error: 'not-desktop' }
  try {
    return await fn()
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/** 重启应用服务与实时消息服务（数据库不动） */
export async function desktopRestartServices(): Promise<DesktopActionResult> {
  const fn = getDesktopBridge()?.restartLocalServices
  if (!fn) return { ok: false, error: 'not-desktop' }
  try {
    return await fn()
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/** 导出备份（targetDir 省略时落壳默认备份目录，完成后壳在文件管理器中定位） */
export async function desktopBackupData(
  targetDir?: string
): Promise<DesktopBackupResult> {
  const fn = getDesktopBridge()?.backupData
  if (!fn) return { ok: false, reason: 'not-desktop' }
  try {
    return await fn(targetDir)
  } catch (error) {
    return { ok: false, reason: String(error) }
  }
}

/** 从 .dump 备份还原（壳会再弹一次原生确认框） */
export async function desktopRestoreData(
  dumpFile: string
): Promise<DesktopActionResult> {
  const fn = getDesktopBridge()?.restoreData
  if (!fn) return { ok: false, error: 'not-desktop' }
  try {
    return await fn(dumpFile)
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/** 在文件管理器中打开数据目录（返回 false = 壳未实现或打开失败） */
export async function desktopOpenDataFolder(): Promise<boolean> {
  const fn = getDesktopBridge()?.openDataFolder
  if (!fn) return false
  try {
    return await fn()
  } catch {
    return false
  }
}

/** 本地数据占用（壳实测；壳缺失 → 全零） */
export async function desktopGetDataStats(): Promise<DesktopDataStats> {
  const fn = getDesktopBridge()?.getDataStats
  if (!fn) return EMPTY_DATA_STATS
  try {
    return await fn()
  } catch {
    return EMPTY_DATA_STATS
  }
}
