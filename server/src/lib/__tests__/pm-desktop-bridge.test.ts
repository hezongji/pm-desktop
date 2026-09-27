/**
 * 桌面壳桥接单测（P2-1 / P2-2 / P2-6）
 *
 * 覆盖：
 *  - SSR/浏览器安全：无 window 时 isDesktopApp=false、桥函数返回 false/null 且不抛异常（浏览器零回归底线）
 *  - notify 桌面分支：窗口未聚焦 → 弹壳原生通知；窗口聚焦且非 force → 不弹
 *  - notify 桌面分支：force=true（@我）聚焦也弹；同 throttleKey 10s 内去重
 *  - notify 开关：localStorage 关闭时桌面分支不弹
 */

type FakeWindow = {
  pmDesktop?: unknown
  localStorage?: { getItem: (k: string) => string | null }
}

const originalWindow = (global as { window?: FakeWindow | undefined }).window

function setWindow(value: FakeWindow | undefined): void {
  ;(global as { window?: unknown }).window = value
  // notify.ts 的开关直读全局 localStorage（非 window.localStorage），测试需同时布置
  const custom = value?.localStorage
  ;(global as { localStorage?: unknown }).localStorage = custom
    ? { getItem: custom.getItem, setItem: () => {} }
    : { getItem: () => null, setItem: () => {} }
}

/** 每个用例重置模块，保证通知节流表等模块级状态干净 */
async function loadNotify() {
  jest.resetModules()
  return await import('@/lib/notify')
}

async function loadBridge() {
  jest.resetModules()
  return await import('@/lib/pm-desktop')
}

afterEach(() => {
  setWindow(originalWindow)
  ;(global as { document?: unknown }).document = undefined
})

describe('pm-desktop 适配器（浏览器/SSR 安全）', () => {
  it('无 window 时全部降级为安全空值', async () => {
    setWindow(undefined)
    const bridge = await loadBridge()

    expect(bridge.isDesktopApp()).toBe(false)
    expect(bridge.getDesktopBridge()).toBeNull()
    await expect(bridge.desktopNotify('标题', '正文')).resolves.toBe(false)
    await expect(bridge.desktopClearSession()).resolves.toBe(false)
    await expect(bridge.desktopSaveFile('a.txt')).resolves.toBeNull()
    await expect(bridge.desktopOpenFile()).resolves.toBeNull()
    await expect(bridge.desktopPrint('<html></html>')).resolves.toEqual({
      ok: false,
      reason: 'not-supported',
    })
    // 订阅返回可调用的取消函数（不抛异常）
    expect(typeof bridge.onDesktopOnlineChange(() => {})).toBe('function')
  })

  it('有 window 但无 pmDesktop（普通浏览器）仍视为非桌面', async () => {
    setWindow({})
    const bridge = await loadBridge()
    expect(bridge.isDesktopApp()).toBe(false)
    expect(bridge.getDesktopBridge()).toBeNull()
  })

  it('壳桥异常时吞掉错误返回安全值', async () => {
    setWindow({
      pmDesktop: {
        notify: () => Promise.reject(new Error('ipc broken')),
        clearSession: () => Promise.reject(new Error('ipc broken')),
        onOnlineChange: () => {
          throw new Error('bad subscribe')
        },
      },
    })
    const bridge = await loadBridge()
    expect(bridge.isDesktopApp()).toBe(true)
    await expect(bridge.desktopNotify('t')).resolves.toBe(false)
    await expect(bridge.desktopClearSession()).resolves.toBe(false)
    expect(typeof bridge.onDesktopOnlineChange(() => {})).toBe('function')
  })
})

describe('notify 桌面分支', () => {
  function makeDoc(opts: { hidden: boolean; focused: boolean }) {
    return { hidden: opts.hidden, hasFocus: () => opts.focused }
  }

  it('窗口未聚焦 → 调壳原生通知，且不要求浏览器 Notification 权限', async () => {
    const notifyFn = jest.fn().mockResolvedValue(undefined)
    setWindow({ pmDesktop: { notify: notifyFn } })
    ;(global as { document?: unknown }).document = makeDoc({
      hidden: false,
      focused: false,
    })

    const { notify } = await loadNotify()
    notify('张三', '你好', '/messages?conversation=c1')

    expect(notifyFn).toHaveBeenCalledWith('张三', '你好')
  })

  it('窗口聚焦且非 force → 不弹（避免打扰当前使用者）', async () => {
    const notifyFn = jest.fn().mockResolvedValue(undefined)
    setWindow({ pmDesktop: { notify: notifyFn } })
    ;(global as { document?: unknown }).document = makeDoc({
      hidden: false,
      focused: true,
    })

    const { notify } = await loadNotify()
    notify('张三', '你好', '/messages?conversation=c2')

    expect(notifyFn).not.toHaveBeenCalled()
  })

  it('force=true（@我）聚焦也弹；同 throttleKey 10s 内去重', async () => {
    const notifyFn = jest.fn().mockResolvedValue(undefined)
    setWindow({ pmDesktop: { notify: notifyFn } })
    ;(global as { document?: unknown }).document = makeDoc({
      hidden: false,
      focused: true,
    })

    const { notify } = await loadNotify()
    const options = { force: true, throttleKey: '/messages?conversation=c3' }
    notify('有人@你', '提到了你', '/messages?conversation=c3', options)
    // 服务端 notify:push 与 message:new 双通道同会话 → 10s 内只弹一次
    notify('张三', '@你的消息', '/messages?conversation=c3', options)

    expect(notifyFn).toHaveBeenCalledTimes(1)
  })

  it('通知开关关闭（pm-notify-enabled=0）→ 桌面分支不弹', async () => {
    const notifyFn = jest.fn().mockResolvedValue(undefined)
    setWindow({
      pmDesktop: { notify: notifyFn },
      localStorage: {
        getItem: (k: string) => (k === 'pm-notify-enabled' ? '0' : null),
      },
    })
    ;(global as { document?: unknown }).document = makeDoc({
      hidden: false,
      focused: false,
    })

    const { notify } = await loadNotify()
    notify('张三', '你好', '/messages?conversation=c4')

    expect(notifyFn).not.toHaveBeenCalled()
  })

  it('浏览器路径不受影响：无壳且无 Notification API 时静默返回', async () => {
    setWindow({})
    ;(global as { document?: unknown }).document = makeDoc({
      hidden: true,
      focused: false,
    })

    const { notify } = await loadNotify()
    expect(() =>
      notify('张三', '你好', '/messages?conversation=c5')
    ).not.toThrow()
  })
})
