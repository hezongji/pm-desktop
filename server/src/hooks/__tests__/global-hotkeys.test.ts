/**
 * use-global-hotkeys 守卫逻辑单测（P3-B 桌面化）
 *
 * 热键最常见的翻车是「用户正在输入框打字却触发快捷键」，故用测试锁住两条守卫：
 *  - isEditableTarget：输入框/文本域/下拉/富文本内不触发 Ctrl+N、Ctrl+F
 *  - findPageSearchInput：只在可见、非顶栏的页内搜索框上接管 Ctrl+F
 */

import {
  findPageSearchInput,
  isEditableTarget,
} from '@/hooks/use-global-hotkeys'

const asTarget = (value: unknown): EventTarget => value as EventTarget

describe('isEditableTarget', () => {
  it('输入框/文本域/下拉 → 可编辑', () => {
    expect(isEditableTarget(asTarget({ tagName: 'INPUT' }))).toBe(true)
    expect(isEditableTarget(asTarget({ tagName: 'input' }))).toBe(true)
    expect(isEditableTarget(asTarget({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isEditableTarget(asTarget({ tagName: 'SELECT' }))).toBe(true)
  })

  it('contenteditable 富文本 → 可编辑', () => {
    expect(
      isEditableTarget(asTarget({ tagName: 'DIV', isContentEditable: true }))
    ).toBe(true)
  })

  it('普通元素 / 空值 → 不可编辑（允许触发热键）', () => {
    expect(isEditableTarget(asTarget({ tagName: 'DIV' }))).toBe(false)
    expect(isEditableTarget(asTarget({ tagName: 'BUTTON' }))).toBe(false)
    expect(isEditableTarget(asTarget({ tagName: 'DIV', isContentEditable: false }))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(asTarget({}))).toBe(false)
  })
})

describe('findPageSearchInput', () => {
  interface FakeEl {
    tagName: string
    disabled?: boolean
    readOnly?: boolean
    isContentEditable?: boolean
    inHeader?: boolean
    size?: [number, number]
    closest: (selector: string) => unknown
    getBoundingClientRect: () => { width: number; height: number }
  }

  const makeEl = (over: Partial<FakeEl> = {}): FakeEl => ({
    tagName: 'INPUT',
    disabled: false,
    readOnly: false,
    inHeader: false,
    size: [200, 36],
    closest(selector: string) {
      return selector === 'header' && this.inHeader ? { tagName: 'HEADER' } : null
    },
    getBoundingClientRect() {
      const [width, height] = this.size ?? [0, 0]
      return { width, height }
    },
    ...over,
  })

  const withDocument = (elements: FakeEl[], run: () => void): void => {
    const original = (global as { document?: unknown }).document
    ;(global as { document?: unknown }).document = {
      querySelectorAll: () => elements,
    }
    try {
      run()
    } finally {
      ;(global as { document?: unknown }).document = original
    }
  }

  it('无 document（服务端渲染）→ 安全返回 null，不抛错', () => {
    expect(findPageSearchInput()).toBeNull()
  })

  it('取第一个可见且不在顶栏的搜索框', () => {
    const hidden = makeEl({ size: [0, 0] })
    const inHeader = makeEl({ inHeader: true })
    const target = makeEl({ size: [240, 36] })
    withDocument([hidden, inHeader, target], () => {
      expect(findPageSearchInput()).toBe(target)
    })
  })

  it('跳过 disabled / readonly，全被排除时返回 null', () => {
    withDocument(
      [makeEl({ disabled: true }), makeEl({ readOnly: true })],
      () => {
        expect(findPageSearchInput()).toBeNull()
      }
    )
  })
})
