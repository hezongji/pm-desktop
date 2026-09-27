/**
 * ChunkLoadError 自愈单测（P2-4 / 方案 §4.8「发版后旧 chunk 404」行）
 *
 * 覆盖：
 *  - isChunkLoadError：命中 ChunkLoadError / Loading chunk … failed / 动态 import 失败等文案
 *  - isChunkLoadError：普通错误（网络 500、业务异常）不误判
 *  - installChunkLoadGuard：命中即重载一次；60s 窗口内重复命中不重载（防死循环）
 *  - installChunkLoadGuard：卸载后不再响应
 */

import { installChunkLoadGuard, isChunkLoadError } from '@/lib/chunk-reload'

describe('isChunkLoadError', () => {
  it('命中 Next/Turbopack 常见 chunk 失败文案', () => {
    expect(
      isChunkLoadError(new Error('ChunkLoadError: Loading chunk 42 failed'))
    ).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 1234 failed.'))).toBe(true)
    expect(
      isChunkLoadError(
        new Error(
          'Failed to fetch dynamically imported module: /_next/static/chunks/a.js'
        )
      )
    ).toBe(true)
    expect(
      isChunkLoadError(new Error('Importing a module script failed.'))
    ).toBe(true)
    // 错误名在 name 上、message 为空也能识别
    const named = new Error('')
    named.name = 'ChunkLoadError'
    expect(isChunkLoadError(named)).toBe(true)
    // 纯字符串形态（some frameworks reject with string）
    expect(isChunkLoadError('ChunkLoadError: boom')).toBe(true)
  })

  it('不误判普通错误', () => {
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false)
    expect(isChunkLoadError(new Error('500 Internal Server Error'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
  })
})

describe('installChunkLoadGuard', () => {
  type Handler = (event: unknown) => void

  function makeFakeWindow() {
    const listeners = new Map<string, Set<Handler>>()
    const store = new Map<string, string>()
    const reload = jest.fn()
    const fakeWindow = {
      addEventListener: (type: string, handler: Handler) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(handler)
      },
      removeEventListener: (type: string, handler: Handler) => {
        listeners.get(type)?.delete(handler)
      },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
      location: { reload },
    }
    const dispatch = (type: string, event: unknown) => {
      listeners.get(type)?.forEach(h => h(event))
    }
    return { fakeWindow, dispatch, reload, listeners }
  }

  const originalWindow = (global as { window?: unknown }).window

  afterEach(() => {
    ;(global as { window?: unknown }).window = originalWindow
    jest.resetModules()
  })

  it('命中 chunk 错误 → 重载一次；窗口内重复命中不再重载', () => {
    const { fakeWindow, dispatch, reload } = makeFakeWindow()
    ;(global as { window?: unknown }).window = fakeWindow

    const dispose = installChunkLoadGuard()
    dispatch('error', {
      error: new Error('ChunkLoadError: Loading chunk 9 failed'),
      message: '',
    })
    expect(reload).toHaveBeenCalledTimes(1)

    // 60s 窗口内再次命中（页面尚未刷新）→ 不重复重载
    dispatch('unhandledrejection', {
      reason: new Error('Loading chunk 10 failed.'),
    })
    expect(reload).toHaveBeenCalledTimes(1)

    dispose()
    dispatch('error', {
      error: new Error('ChunkLoadError: again'),
      message: '',
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('非 chunk 错误不触发重载，且卸载函数清理监听', () => {
    const { fakeWindow, dispatch, reload, listeners } = makeFakeWindow()
    ;(global as { window?: unknown }).window = fakeWindow

    const dispose = installChunkLoadGuard()
    dispatch('error', { error: new Error('Network Error'), message: '' })
    dispatch('unhandledrejection', { reason: new Error('500') })
    expect(reload).not.toHaveBeenCalled()

    dispose()
    expect(listeners.get('error')?.size ?? 0).toBe(0)
    expect(listeners.get('unhandledrejection')?.size ?? 0).toBe(0)
  })
})
