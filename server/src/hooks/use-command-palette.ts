'use client'

/**
 * 命令面板 / 快捷键帮助 —— 共享开关状态（P3-B 桌面化）
 *
 * 面板由 Sidebar 挂载一次；Header 的搜索触发器、useGlobalHotkeys、快捷键帮助弹窗
 * 都需要读写同一份开关状态，故用一个极小的 zustand store 承载（与项目其他 store 同构）。
 * 单一事实源：任何地方只改这里，不各自维护 useState。
 */

import { create } from 'zustand'

interface CommandPaletteState {
  /** 命令面板（Ctrl+K）是否打开 */
  open: boolean
  /**
   * 打开会话计数：每次「由关到开」自增。面板主体以它为 key 重新挂载，
   * 查询词/结果/最近使用随开随取天然干净——避免用 effect 里的 setState 做清理
   * （react-hooks/set-state-in-effect 会判为级联渲染）。
   */
  session: number
  /** 快捷键帮助弹窗（Ctrl+/）是否打开 */
  helpOpen: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  setHelpOpen: (open: boolean) => void
  /** 从面板动作打开帮助：关面板、开帮助，避免两层弹层叠加 */
  openHelp: () => void
}

export const useCommandPalette = create<CommandPaletteState>(set => ({
  open: false,
  session: 0,
  helpOpen: false,
  setOpen: open =>
    set(state => ({
      open,
      session: open && !state.open ? state.session + 1 : state.session,
    })),
  toggle: () =>
    set(state =>
      state.open
        ? { open: false }
        : { open: true, session: state.session + 1 }
    ),
  setHelpOpen: helpOpen => set({ helpOpen }),
  openHelp: () => set({ helpOpen: true, open: false }),
}))
