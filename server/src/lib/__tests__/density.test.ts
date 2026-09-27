/**
 * 信息密度纯逻辑单测（P3-C 桌面化）
 *
 * 锁住三条容易翻车的约定：
 *  - 脏值/异常一律回退默认「舒适」档（升级前用户没有该 key；隐私模式下 localStorage 抛错）
 *  - 首屏内联脚本与 hook 用同一套 key / 取值（常量同源），脚本本身不得抛错
 *  - applyDensity 只写 <html data-density>，不碰其它 DOM
 */

import {
  applyDensity,
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_INIT_SCRIPT,
  DENSITY_OPTIONS,
  DENSITY_STORAGE_KEY,
  isDensity,
  readStoredDensity,
} from '@/lib/density'

/** 把 window/document 临时替换为测试替身（jest 跑在 node 环境，无 DOM） */
type DomStub = { window?: unknown; document?: unknown }

const g = globalThis as unknown as DomStub & {
  window?: unknown
  document?: unknown
}

function withDom<T>(dom: DomStub, fn: () => T): T {
  const prevWindow = g.window
  const prevDocument = g.document
  g.window = dom.window
  g.document = dom.document
  try {
    return fn()
  } finally {
    g.window = prevWindow
    g.document = prevDocument
  }
}

afterEach(() => {
  delete g.window
  delete g.document
})

describe('isDensity', () => {
  it('只认两档合法值', () => {
    expect(isDensity('comfortable')).toBe(true)
    expect(isDensity('compact')).toBe(true)
  })

  it('脏值/空值一律拒绝', () => {
    expect(isDensity('dense')).toBe(false)
    expect(isDensity('')).toBe(false)
    expect(isDensity(null)).toBe(false)
    expect(isDensity(undefined)).toBe(false)
    expect(isDensity(1)).toBe(false)
  })
})

describe('readStoredDensity', () => {
  it('SSR（无 window）返回默认舒适档', () => {
    expect(readStoredDensity()).toBe(DEFAULT_DENSITY)
  })

  it('读回已持久化的紧凑档', () => {
    withDom(
      {
        window: {
          localStorage: {
            getItem: (k: string) =>
              k === DENSITY_STORAGE_KEY ? 'compact' : null,
          },
        },
      },
      () => expect(readStoredDensity()).toBe('compact')
    )
  })

  it('存储里是脏值 → 回退默认档', () => {
    withDom(
      {
        window: {
          localStorage: { getItem: () => 'ultra-dense' },
        },
      },
      () => expect(readStoredDensity()).toBe(DEFAULT_DENSITY)
    )
  })

  it('localStorage 抛错（隐私模式）→ 回退默认档且不抛', () => {
    withDom(
      {
        window: {
          localStorage: {
            getItem: () => {
              throw new Error('SecurityError')
            },
          },
        },
      },
      () => expect(readStoredDensity()).toBe(DEFAULT_DENSITY)
    )
  })
})

describe('applyDensity', () => {
  it('写 <html data-density> 且返回旧值可被覆盖', () => {
    const attributes: Record<string, string> = {}
    const element = {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value
      },
    }
    withDom({ document: { documentElement: element } }, () => {
      applyDensity('compact')
      expect(attributes[DENSITY_ATTRIBUTE]).toBe('compact')
      applyDensity('comfortable')
      expect(attributes[DENSITY_ATTRIBUTE]).toBe('comfortable')
    })
  })

  it('无 document（SSR）时不抛', () => {
    expect(() => applyDensity('compact')).not.toThrow()
  })
})

describe('DENSITY_INIT_SCRIPT', () => {
  it('内联脚本可执行且把存储值写到 data-density', () => {
    const attributes: Record<string, string> = {}
    const localStorage = {
      getItem: (k: string) => (k === DENSITY_STORAGE_KEY ? 'compact' : null),
    }
    const document = {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes[name] = value
        },
      },
    }
    // eslint-disable-next-line no-new-func
    const run = new Function('localStorage', 'document', DENSITY_INIT_SCRIPT)
    expect(() => run(localStorage, document)).not.toThrow()
    expect(attributes[DENSITY_ATTRIBUTE]).toBe('compact')
  })

  it('localStorage 抛错时脚本静默（不阻断首屏）', () => {
    const document = {
      documentElement: { setAttribute: () => undefined },
    }
    const localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    // eslint-disable-next-line no-new-func
    const run = new Function('localStorage', 'document', DENSITY_INIT_SCRIPT)
    expect(() => run(localStorage, document)).not.toThrow()
  })

  it('脚本与 hook 共用同一 key / 属性名', () => {
    expect(DENSITY_INIT_SCRIPT).toContain(DENSITY_STORAGE_KEY)
    expect(DENSITY_INIT_SCRIPT).toContain(DENSITY_ATTRIBUTE)
  })
})

describe('DENSITY_OPTIONS', () => {
  it('两档齐全且默认档在首位', () => {
    expect(DENSITY_OPTIONS.map(o => o.value)).toEqual([
      'comfortable',
      'compact',
    ])
    expect(DENSITY_OPTIONS[0].value).toBe(DEFAULT_DENSITY)
  })
})
