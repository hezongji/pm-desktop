/**
 * ChunkLoadError 自愈（《pm-desktop-development-plan-v1.1》§4.8「发版后旧 chunk 404」P2 行）
 *
 * 场景：服务器重新构建发布后 BUILD_ID 变化，长时间挂着的旧页面再触发路由/动态 import
 *       会拿旧 chunk 名 404，页面表现为「点不动 / 白屏」。
 * 处置：捕获后做一次性 bypassCache 重载（窗口 60s 内只重载一次，防死循环）。
 *
 * 浏览器与桌面壳行为一致（该故障与壳无关，是 Web 侧问题）。
 */

/** 上次自愈重载时间戳（sessionStorage，跨刷新防循环） */
const GUARD_FLAG = 'pm-chunk-reload-at'

/** 同一会话内两次自愈重载的最小间隔 */
const GUARD_WINDOW_MS = 60_000

const CHUNK_ERROR_PATTERNS: RegExp[] = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
]

/** 判断错误是否为 chunk 加载失败（兼容 Error 实例、错误名、字符串消息） */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  const record = err as { name?: unknown; message?: unknown }
  const name = typeof record.name === 'string' ? record.name : ''
  let message = ''
  if (typeof record.message === 'string') {
    message = record.message
  } else if (typeof err === 'string') {
    message = err
  }
  const text = `${name} ${message}`
  return CHUNK_ERROR_PATTERNS.some(re => re.test(text))
}

/** 一次性重载：60s 窗口内重复命中则跳过 */
function reloadOnce(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const last = Number(window.sessionStorage.getItem(GUARD_FLAG) ?? '0')
    if (
      Number.isFinite(last) &&
      last > 0 &&
      Date.now() - last < GUARD_WINDOW_MS
    ) {
      return false
    }
    window.sessionStorage.setItem(GUARD_FLAG, String(Date.now()))
  } catch {
    // sessionStorage 不可用（隐私模式）时不重载，避免潜在循环
    return false
  }
  window.location.reload()
  return true
}

/**
 * 挂载全局监听（error + unhandledrejection）。
 * @returns 卸载函数
 */
export function installChunkLoadGuard(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onError = (event: ErrorEvent): void => {
    if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
      reloadOnce()
    }
  }
  const onRejection = (event: PromiseRejectionEvent): void => {
    if (isChunkLoadError(event.reason)) {
      reloadOnce()
    }
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
