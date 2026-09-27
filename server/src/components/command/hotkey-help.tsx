'use client'

/**
 * 快捷键帮助弹窗（P3-B 桌面化）
 *
 * 两条入口：Ctrl+/ 热键（useGlobalHotkeys）与命令面板「快捷键帮助」动作。
 * HOTKEY_ROWS 是快捷键清单的**单一事实源**——热键实现（use-global-hotkeys.ts）
 * 与本表必须同步修改，任何新增热键都要在此登记，否则用户无从发现。
 */

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useCommandPalette } from '@/hooks/use-command-palette'

export interface HotkeyRow {
  /** 组合键（按顺序展示，用 + 连接） */
  keys: string[]
  /** 行为说明 */
  label: string
  /** 生效范围（缺省 = 全局） */
  scope?: string
}

export const HOTKEY_ROWS: HotkeyRow[] = [
  { keys: ['Ctrl', 'K'], label: '打开 / 关闭命令面板' },
  { keys: ['Ctrl', '1…8'], label: '按侧边栏导航顺序切换到第 N 页' },
  { keys: ['Ctrl', 'N'], label: '新建任务' },
  { keys: ['Ctrl', 'F'], label: '聚焦页内搜索框' },
  { keys: ['Ctrl', '/'], label: '打开本快捷键帮助' },
  { keys: ['↑', '↓'], label: '上下移动选中项', scope: '命令面板内' },
  { keys: ['Enter'], label: '打开选中项', scope: '命令面板内' },
  { keys: ['Esc'], label: '关闭面板 / 对话框' },
]

export function HotkeyHelpDialog() {
  const helpOpen = useCommandPalette(s => s.helpOpen)
  const setHelpOpen = useCommandPalette(s => s.setHelpOpen)

  return (
    <DialogPrimitive.Root open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-[var(--popover-shadow)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="text-base font-semibold tracking-tight">
            键盘快捷键
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
            Windows 用 Ctrl，macOS 对应 ⌘。命令面板打开时，除 Ctrl+K / Esc
            外的热键一律让位给面板。
          </DialogPrimitive.Description>

          <table className="mt-4 w-full text-sm">
            <tbody>
              {HOTKEY_ROWS.map(row => (
                <tr key={row.label} className="border-b border-border/60 last:border-b-0">
                  <td className="py-2 pr-4 align-middle text-muted-foreground">
                    {row.label}
                    {row.scope && (
                      <span className="ml-2 text-[11px] text-muted-foreground/70">
                        {row.scope}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right align-middle">
                    <span className="inline-flex items-center gap-1">
                      {row.keys.map((key, index) => (
                        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
                          {index > 0 && (
                            <span className="text-[11px] text-muted-foreground">+</span>
                          )}
                          <kbd className="kbd">{key}</kbd>
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <DialogPrimitive.Close
            aria-label="关闭"
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
