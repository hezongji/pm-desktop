'use client'

/**
 * 全局快捷键（P3-B 桌面化）
 *
 * 清单的单一事实源在 components/command/hotkey-help.tsx 的 HOTKEY_ROWS，
 * 本文件实现必须与其保持同步。规则（依据 docs/p3-ui-plan.md §P3-B）：
 *  - Ctrl+K   打开/关闭命令面板（任何位置都生效，含输入框内）
 *  - Ctrl+1…8 按 visibleNavItems 顺序切换页面；跳到当前页不重复 push
 *  - Ctrl+N   新建任务；焦点在输入框/文本域/contenteditable 时不触发
 *  - Ctrl+F   聚焦页内搜索框；焦点在输入框时不触发；无页内搜索框时，
 *             桌面壳内退化为打开命令面板（替代无用的浏览器查找栏），
 *             浏览器内则放行给浏览器原生查找（不劫持网页用户）
 *  - Ctrl+/   快捷键帮助
 *  - 命令面板/快捷键帮助打开时，除 Ctrl+K、Esc 外热键一律让位
 *
 * 单键热键：本应用未使用（避免与输入冲突），故无「单键在输入框内不触发」分支。
 */

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { visibleNavItems } from '@/components/layout/nav-groups'
import { useAuthStore } from '@/store/auth'
import { useCommandPalette } from '@/hooks/use-command-palette'
import { isDesktopApp } from '@/lib/pm-desktop'

/** 焦点是否在可编辑元素内（输入框/文本域/下拉/富文本） */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return element.isContentEditable === true
}

/**
 * 页内搜索框查找：优先显式标记 data-page-search，其次 type=search，
 * 最后回退到列表页「搜索…」占位符约定（tasks/projects 等页既有写法）。
 * 排除顶栏（命令面板触发器所在处）与不可见元素。
 */
export function findPageSearchInput(): HTMLInputElement | null {
  if (typeof document === 'undefined') return null
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-page-search], input[type="search"], input[placeholder^="搜索"]'
    )
  )
  for (const element of candidates) {
    if (element.disabled || element.readOnly) continue
    if (element.closest('header')) continue
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return element
  }
  return null
}

export function useGlobalHotkeys(): void {
  const router = useRouter()
  const pathname = usePathname()
  const role = useAuthStore(s => s.user?.role)
  const pages = useAuthStore(s => s.user?.pages)
  const open = useCommandPalette(s => s.open)
  const helpOpen = useCommandPalette(s => s.helpOpen)
  const setOpen = useCommandPalette(s => s.setOpen)
  const toggle = useCommandPalette(s => s.toggle)
  const openHelp = useCommandPalette(s => s.openHelp)

  // Ctrl+1…8 目标（前 8 个导航项）
  const shortcuts = useMemo(
    () => visibleNavItems(role, pages).slice(0, 8),
    [role, pages]
  )

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const key = event.key
      const lower = typeof key === 'string' ? key.toLowerCase() : ''

      // 命令面板开关（唯一在面板打开时仍生效的热键）
      if (mod && lower === 'k') {
        event.preventDefault()
        toggle()
        return
      }

      // 面板/帮助打开时其余热键让位（Esc 由 Radix Dialog 处理）
      if (open || helpOpen) return

      if (!mod) return

      // Ctrl+/ —— 快捷键帮助（部分布局 / 需 Shift，一并接受）
      if (key === '/' || key === '?') {
        event.preventDefault()
        openHelp()
        return
      }

      // Ctrl+1…8 —— 导航顺序切换
      if (key >= '1' && key <= '8') {
        const target = shortcuts[Number(key) - 1]
        if (!target) return
        event.preventDefault()
        if (pathname !== target.href) router.push(target.href)
        return
      }

      // Ctrl+N —— 新建任务
      if (lower === 'n') {
        if (isEditableTarget(event.target)) return
        event.preventDefault()
        router.push('/tasks?new=1')
        return
      }

      // Ctrl+F —— 页内搜索
      if (lower === 'f') {
        if (isEditableTarget(event.target)) return
        const input = findPageSearchInput()
        if (input) {
          event.preventDefault()
          input.focus()
          input.select()
        } else if (isDesktopApp()) {
          // 桌面壳内无页内搜索框：打开命令面板替代浏览器查找栏
          event.preventDefault()
          setOpen(true)
        }
        // 浏览器内保持原生查找，不劫持
      }
    }

    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [
    open,
    helpOpen,
    pathname,
    router,
    shortcuts,
    toggle,
    setOpen,
    openHelp,
  ])
}
