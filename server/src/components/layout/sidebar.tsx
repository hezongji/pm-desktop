'use client'

/**
 * 新侧边栏布局（P0-3）—— 依据《开发文档-项目管理系统重构》§8.1、附录 A
 *
 * 七组导航：项目 / 组织架构 / 文件 / 视图 / IM / 待办 / 管理（+顶部工作台）
 *  - 消息：角标接 chat store 的 unreadTotal（P4-3 实时未读）；待办：todoCount 接 notification store 的 todoUnread（P5 已接，免打扰开启时静默）
 *  - 管理（系统管理）：仅 ADMIN 可见
 *  - 组织架构 / 文件 / 视图(甘特·流程·表格·图表) / IM / 待办：占位页，由 P0-4 / P2 / P3 / P4 交付
 * 风格沿用现有 Radix + tailwind 组件体系（Button/Badge/cn）。
 */

import { isDesktopApp } from '@/lib/pm-desktop'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { api } from '@/services/api-instance'
import { AppDownloadDialog } from '@/components/layout/app-download-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuthStore } from '@/store/auth'
import { useLogout } from '@/hooks/use-logout'
import { useAppStore } from '@/store/app'
import { useChatStore } from '@/store/chat'
import { NotificationBell } from '@/components/layout/notification-bell'
import { Sheet } from '@/components/ui/sheet'
import {
  FolderKanban,
  CheckSquare,
  Smartphone,
  Search,
  Menu,
  X,
  LogOut,
  User as UserIcon,
  Palette,
  Minus,
  Maximize2,
  Minimize2,
  Building2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { NAV_GROUPS } from '@/components/layout/nav-groups'
import type { NavGroup, NavItem } from '@/components/layout/nav-groups'
import { CommandPalette } from '@/components/command/command-palette'
import { HotkeyHelpDialog } from '@/components/command/hotkey-help'
import { useGlobalHotkeys } from '@/hooks/use-global-hotkeys'
import { useCommandPalette } from '@/hooks/use-command-palette'

// ───────────────────────── 导航定义（§8.1）─────────────────────────
// 导航表已迁至 nav-groups.ts（P3-B：命令面板 Ctrl+1…8 与移动端抽屉共用同一事实源，
// 且避免 sidebar ↔ useGlobalHotkeys 循环导入）；此处再导出保持既有引用兼容。
export { NAV_GROUPS }
export type { NavItem, NavGroup }

/** 旧路由 → 新路由 301 重定向映射（配置在 next.config.js，此处仅作对照文档） */
export const LEGACY_REDIRECTS: { from: string; to: string; note: string }[] = [
  { from: '/dashboard', to: '/', note: '工作台迁移到根路由 (main)/page.tsx' },
  {
    from: '/teams',
    to: '/organization',
    note: '团队页由组织架构内部树替代（P0-4）',
  },
  { from: '/org', to: '/organization', note: 'P0-4 占位路由转正' },
  { from: '/gantt', to: '/views/gantt', note: '甘特图归入视图组' },
  { from: '/debug', to: '/', note: '调试页删除（附录 A）' },
]

// ───────────────────────────── Sidebar ─────────────────────────────

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname()
  const { user } = useAuthStore()
  const doLogout = useLogout()
  const { sidebarOpen, setSidebarOpen, mobileMenuOpen, setMobileMenuOpen } =
    useAppStore()
  const unreadTotal = useChatStore(s => s.unreadTotal)
  const { theme, setTheme } = useTheme()
  // 全局快捷键（P3-B）：Ctrl+K 面板 / Ctrl+1…8 切页 / Ctrl+N / Ctrl+F / Ctrl+/
  useGlobalHotkeys()
  // 分组折叠持久化（2026-08-22 UIUX P2 修复：localStorage 记忆用户偏好）
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >(() => {
    if (typeof window === 'undefined') return {}
    try {
      return JSON.parse(localStorage.getItem('pm-sidebar-collapsed') ?? '{}')
    } catch {
      return {}
    }
  })
  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups(s => {
      const next = { ...s, [groupKey]: !s[groupKey] }
      try {
        localStorage.setItem('pm-sidebar-collapsed', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const isAdmin = user?.role === 'ADMIN'
  const pages = user?.pages

  const isActive = (href: string, exact = false) =>
    href === '/'
      ? pathname === '/'
      : exact
        ? pathname === href
        : pathname === href || pathname.startsWith(href + '/')

  const handleLogout = () => {
    // 20260908 生产审计修复 P1-3：先调服务端 /api/auth/logout 吊销令牌，再清本地
    void doLogout()
  }

  const renderNav = (mobile: boolean, sbCollapsed: boolean) => (
    <nav
      className={cn(
        'flex-1 overflow-y-auto py-4',
        sbCollapsed ? 'space-y-2 px-2' : 'space-y-4 px-3'
      )}
    >
      {NAV_GROUPS.filter(g => !g.adminOnly || isAdmin)
        .map(group => ({
          ...group,
          items: group.items.filter(
            item =>
              !item.pageKey || !pages || pages.includes(item.pageKey) || isAdmin
          ),
        }))
        .filter(group => group.items.length > 0)
        .map((group, gi) => {
          const groupKey = group.label ?? `top-${gi}`
          const collapsed = collapsedGroups[groupKey]
          return (
            <div key={groupKey}>
              {group.label && !sbCollapsed && (
                <button
                  type="button"
                  onClick={() => !mobile && toggleGroup(groupKey)}
                  className="mb-1 flex w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  {group.label}
                  {!mobile && (
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform',
                        collapsed && '-rotate-90'
                      )}
                    />
                  )}
                </button>
              )}
              {group.label && sbCollapsed && (
                <div className="mb-2 border-t pt-2" />
              )}
              <div className={cn('space-y-1', collapsed && 'hidden')}>
                {group.items.map(item => {
                  const active = isActive(item.href, item.exact)
                  const badgeCount = item.badge === 'unread' ? unreadTotal : 0
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'group relative flex items-center rounded-md py-2 text-sm font-medium transition-colors duration-150',
                        sbCollapsed
                          ? 'justify-center px-0'
                          : 'justify-between px-3',
                        active
                          ? 'bg-primary/10 font-semibold text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                      onClick={() => mobile && setMobileMenuOpen(false)}
                      title={sbCollapsed ? item.name : undefined}
                    >
                      {/* Linear 风格选中指示条：左侧 2px 主色圆角短条 */}
                      {active && (
                        <span
                          aria-hidden
                          className={cn(
                            'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary',
                            sbCollapsed &&
                              'bottom-0 left-1/2 top-auto h-0.5 w-4 -translate-x-1/2 translate-y-0'
                          )}
                        />
                      )}
                      <span className="flex items-center">
                        <item.icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0 transition-transform duration-150 group-hover:scale-[1.06]',
                            !sbCollapsed && 'mr-3'
                          )}
                        />
                        {!sbCollapsed && item.name}
                      </span>
                      {!sbCollapsed && (
                        <span className="flex items-center gap-1">
                          {badgeCount > 0 && (
                            <Badge className="h-5 min-w-[20px] rounded-full px-1 text-[10px] leading-none">
                              {badgeCount > 99 ? '99+' : badgeCount}
                            </Badge>
                          )}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
    </nav>
  )

  const sidebarInner = (mobile: boolean, sbCollapsed: boolean) => (
    <>
      <div className="flex h-16 items-center gap-2 border-b px-4">
        <div className="btn-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-primary-foreground">
          <Building2 className="h-4 w-4" />
        </div>
        {!sbCollapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              项目管理系统
            </p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              本地优先 · 开源
            </p>
          </div>
        )}
        {!mobile && !sbCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => setSidebarOpen(false)}
            title="收起侧边栏"
          >
            <ChevronsLeft className="h-5 w-5" />
          </Button>
        )}
        {!mobile && sbCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="mx-auto shrink-0"
            onClick={() => setSidebarOpen(true)}
            title="展开侧边栏"
          >
            <ChevronsRight className="h-5 w-5" />
          </Button>
        )}
        {mobile && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>
      {renderNav(mobile, sbCollapsed)}
      {/* 手机 App 下载入口 —— 侧栏内弹二维码对话框（不跳 /download：桌面壳内会被困住，owner 2026-09-27） */}
      <button
        type="button"
        onClick={() => {
          setDownloadOpen(true)
          if (mobile) setMobileMenuOpen(false)
        }}
        title="手机 App 下载（PM 项目管理 + PM 聊天）"
        className={cn(
          'mx-3 mb-1 mt-auto flex items-center rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          sbCollapsed && 'justify-center px-0'
        )}
      >
        <Smartphone
          className={cn(
            'h-[18px] w-[18px] shrink-0 text-primary/70',
            !sbCollapsed && 'mr-3'
          )}
        />
        {!sbCollapsed && '手机 App 下载'}
      </button>
      <AppDownloadDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
      <div className="border-t p-3">
        <div
          className={cn(
            'flex items-center',
            sbCollapsed ? 'flex-col gap-1' : 'justify-between'
          )}
        >
          <Select value={theme || 'light'} onValueChange={setTheme}>
            <SelectTrigger
              title="切换主题"
              className={cn(
                'h-8 border-0 bg-transparent text-muted-foreground hover:text-foreground focus:ring-0',
                sbCollapsed
                  ? 'w-8 justify-center px-0'
                  : 'w-auto gap-1.5 px-1.5'
              )}
            >
              <Palette className="h-4 w-4 shrink-0" />
              {!sbCollapsed && <SelectValue />}
            </SelectTrigger>
            <SelectContent>
              {/* 主题预览色点：展示各主题品牌色（跨主题静态色，非当前主题变量） */}
              <SelectItem value="light">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ background: '#5E6AD2' }}
                />
                浅色
              </SelectItem>
              <SelectItem value="warm">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ background: '#E0662D' }}
                />
                暖阳
              </SelectItem>
              <SelectItem value="mist">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ background: '#2E7CD6' }}
                />
                晴蓝
              </SelectItem>
              <SelectItem value="mint">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ background: '#1E9A74' }}
                />
                薄荷
              </SelectItem>
              <SelectItem value="dark">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ background: '#16171C' }}
                />
                深色
              </SelectItem>
              <SelectItem value="dusk">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ background: '#E7A52C' }}
                />
                柔夜
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            title="退出登录"
            className={cn(sbCollapsed && 'w-full')}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile sidebar */}
      <div
        className={cn(
          'fixed inset-0 z-50 lg:hidden',
          mobileMenuOpen ? 'block' : 'hidden'
        )}
      >
        <div
          className="fixed inset-0 bg-gray-600 bg-opacity-75"
          onClick={() => setMobileMenuOpen(false)}
        />
        <div className="fixed inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-[hsl(var(--sidebar))] shadow-xl">
          {sidebarInner(true, false)}
        </div>
      </div>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r bg-[hsl(var(--sidebar))] lg:flex',
          sidebarOpen ? 'w-60' : 'w-16',
          className
        )}
      >
        {sidebarInner(false, !sidebarOpen)}
      </aside>

      {/* 命令面板 + 快捷键帮助（P3-B）：随 (main) 布局挂载一次，全站可用 */}
      <CommandPalette />
      <HotkeyHelpDialog />
    </>
  )
}

// ───────────────────────────── Header（§8.1 顶栏） ─────────────────────────────

interface HeaderProps {
  className?: string
}

/** /api/search 分组结果（P2-2） */
interface SearchResults {
  projects: { id: string; code: string; name: string; isArchived?: boolean }[]
  tasks: {
    id: string
    title: string
    projectId: string
    project?: { code: string }
  }[]
  users: {
    id: string
    name: string | null
    email: string
    avatar?: string | null
  }[]
}

export function Header({ className }: HeaderProps) {
  // 桌面壳内隐藏 Web 自绘窗口按钮（壳有原生标题栏，双套按钮冲突；owner 2026-09-25 指示）
  const [inDesktopShell, setInDesktopShell] = useState(false)
  useEffect(() => {
    setInDesktopShell(isDesktopApp())
  }, [])
  const { setMobileMenuOpen } = useAppStore()
  const { user } = useAuthStore()
  const router = useRouter()
  const doLogout = useLogout()
  // 命令面板开关（P3-B）：Header 中部的搜索触发器与 Ctrl+K 共用同一状态
  const setPaletteOpen = useCommandPalette(s => s.setOpen)

  // 窗口控制（类桌面应用）：全屏状态 + 最小化/最大化/关闭
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const minimizeWindow = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  const toggleMaximize = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }
  const closeApp = () => {
    // 20260908 生产审计修复 P1-3：关闭窗口=退出登录，同样吊销服务端令牌
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    void doLogout()
  }

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  // 移动端全屏搜索（2026-08-22 UIUX P1 修复）
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mobileBoxRef = useRef<HTMLDivElement>(null)

  // 移动端搜索面板打开时自动聚焦
  useEffect(() => {
    if (mobileSearchOpen) {
      const t = setTimeout(() => {
        document
          .querySelector<HTMLInputElement>('#mobile-search-input')
          ?.focus()
      }, 100)
      return () => clearTimeout(t)
    }
  }, [mobileSearchOpen])

  // 防抖 300ms 调 /api/search（§P2-2）
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setOpen(false)
      setLoading(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.get('/search', { params: { q } })
        setResults((res.data?.data as SearchResults) ?? null)
        setOpen(true)
      } catch {
        setResults(null)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // Ctrl+K 已由命令面板接管（useGlobalHotkeys + CommandPalette，P3-B）：
  // 这里不再注册键盘监听，避免与面板开关竞争。

  const go = (href: string) => {
    setOpen(false)
    setQuery('')
    setResults(null)
    router.push(href)
  }

  const hasResults =
    !!results &&
    (results.projects.length > 0 ||
      results.tasks.length > 0 ||
      results.users.length > 0)

  return (
    <header
      className={cn(
        'sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className
      )}
    >
      <div className="flex h-16 items-center gap-4 px-4 lg:px-6">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={() => setMobileMenuOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* 移动端搜索按钮（2026-08-22 UIUX P1 修复） */}
        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden"
          onClick={() => setMobileSearchOpen(true)}
          aria-label="搜索"
        >
          <Search className="h-5 w-5" />
        </Button>

        {/* 全局搜索入口（P3-B 桌面化）：伪装成输入框的触发器，点击或 Ctrl+K 唤出命令面板。
            原内联搜索下拉已由命令面板统一承载（同一 /api/search 数据源 + 最近使用）。*/}
        <div className="hidden flex-1 lg:block">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="打开命令面板"
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-secondary/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground focus-visible:border-primary/50 focus-visible:bg-background focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.15)] focus-visible:outline-none"
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground/70" />
            <span className="truncate">搜索项目、任务、成员…</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <kbd className="kbd">Ctrl</kbd>
              <kbd className="kbd">K</kbd>
            </span>
          </button>
        </div>
        <h1 className="min-w-0 flex-1 truncate px-1 text-base font-semibold lg:hidden">
          项目管理系统
        </h1>

        <div className="flex items-center space-x-2">
          {/* 通知铃 —— P5 通知中心（§8.3） */}
          <NotificationBell />

          <div className="flex items-center space-x-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserIcon className="h-4 w-4" />
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-medium">{user?.name || '未登录'}</p>
              <p className="text-xs text-muted-foreground">
                {user?.role || ''}
              </p>
            </div>
          </div>

          {/* 窗口控制（最小化/最大化/关闭）—— 仅桌面端，独立于账号操作；暗色系提高亮度（9-07 审查）
              桌面壳内不渲染：壳已有原生标题栏三键（避免双套按钮，2026-09-25） */}
          {!inDesktopShell && (
            <div className="hidden items-center gap-0.5 border-l pl-2 sm:flex">
              <button
                type="button"
                onClick={minimizeWindow}
                title="最小化"
                aria-label="最小化"
                className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleMaximize}
                title={isFullscreen ? '还原' : '最大化'}
                aria-label={isFullscreen ? '还原' : '最大化'}
                className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={closeApp}
                title="关闭"
                aria-label="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-destructive hover:text-destructive-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 移动端全屏搜索面板（2026-08-22 UIUX P1 修复） */}
      <Sheet
        open={mobileSearchOpen}
        onClose={() => setMobileSearchOpen(false)}
        title="搜索"
        maxHeight="70dvh"
      >
        <div ref={mobileBoxRef} className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="mobile-search-input"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索项目、任务、成员…"
            className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />

          {open && query.trim() && (
            <div className="mt-2 max-h-[50vh] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
              {loading ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  搜索中…
                </div>
              ) : hasResults ? (
                <div className="py-1">
                  {results!.projects.length > 0 && (
                    <SearchGroup label="项目">
                      {results!.projects.map(p => (
                        <SearchItem
                          key={p.id}
                          onClick={() => {
                            go(`/projects/${p.id}`)
                            setMobileSearchOpen(false)
                          }}
                        >
                          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-mono text-xs text-primary">
                              {p.code}
                            </span>{' '}
                            {p.name}
                          </span>
                        </SearchItem>
                      ))}
                    </SearchGroup>
                  )}
                  {results!.tasks.length > 0 && (
                    <SearchGroup label="任务">
                      {results!.tasks.map(t => (
                        <SearchItem
                          key={t.id}
                          onClick={() => {
                            go('/tasks')
                            setMobileSearchOpen(false)
                          }}
                        >
                          <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {t.title}
                            {t.project?.code && (
                              <span className="font-mono text-xs text-muted-foreground">
                                {' '}
                                · {t.project.code}
                              </span>
                            )}
                          </span>
                        </SearchItem>
                      ))}
                    </SearchGroup>
                  )}
                  {results!.users.length > 0 && (
                    <SearchGroup label="成员">
                      {results!.users.map(u => (
                        <SearchItem
                          key={u.id}
                          onClick={() => {
                            go('/organization')
                            setMobileSearchOpen(false)
                          }}
                        >
                          <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            {u.name || u.email}
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              · {u.email}
                            </span>
                          </span>
                        </SearchItem>
                      ))}
                    </SearchGroup>
                  )}
                </div>
              ) : (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  未找到匹配结果
                </div>
              )}
            </div>
          )}
        </div>
      </Sheet>
    </header>
  )
}

function SearchGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="py-1">
      <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

function SearchItem({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-muted"
    >
      {children}
    </button>
  )
}
