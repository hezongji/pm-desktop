'use client'

/**
 * 全局命令面板（P3-B 桌面化，Ctrl+K）
 *
 * 依据：docs/p3-ui-plan.md §P3-B、docs/local-native-refactor-plan-v1.md §2 清单 3/4
 * 设计铁律（Linear × Fluent）：单一强调色 accent、选中态=中性底（bg-accent）不铺紫底、
 *   动效 200ms cubic-bezier(0.2,0,0,1) 淡入+8px 上移、禁弹跳。
 *
 * 数据源：GET /api/search?q=（实际返回 { projects, tasks, users } 三组，见
 *   src/app/api/search/route.ts —— 任务/项目/成员即后端全部搜索源，无会话/文件源），
 *   250ms 防抖 + 请求序号防竞态；静态动作与「最近使用」在前，搜索分组在后。
 *
 * 结构：外壳只负责 Radix Dialog；主体 PaletteBody 以 store 的 session 为 key，
 *   每次「由关到开」重新挂载，查询/结果/最近使用天然回到初始态（不用 effect 里 setState 清理）。
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  CornerDownLeft,
  FolderKanban,
  FolderOpen,
  Keyboard,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sun,
  User as UserIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api-instance'
import { useAuthStore } from '@/store/auth'
import { useCommandPalette } from '@/hooks/use-command-palette'

/** /api/search 分组结果（与后端 route.ts 的 select 字段一一对应） */
interface SearchResults {
  projects: { id: string; code: string; name: string; isArchived?: boolean }[]
  tasks: {
    id: string
    title: string
    projectId: string
    project?: { code: string }
  }[]
  users: { id: string; name: string | null; email: string }[]
}

/** 最近使用条目（类型 + id + 标题 + 跳转地址） */
interface RecentEntry {
  kind: 'project' | 'task' | 'user'
  id: string
  title: string
  href: string
}

interface PaletteAction {
  id: string
  label: string
  hint?: [string, string]
  icon: typeof CheckSquare
  run: () => void
}

const RECENT_KEY = 'pm-command-recent'
const RECENT_MAX = 8

function readRecent(): RecentEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is RecentEntry =>
          !!item &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.href === 'string'
      )
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

function pushRecent(entry: RecentEntry): void {
  try {
    const next = [
      entry,
      ...readRecent().filter(
        item => !(item.kind === entry.kind && item.id === entry.id)
      ),
    ].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式等写不进去：最近使用降级为不记录，不影响面板功能 */
  }
}

/** 列表项统一样式（cmdk Item 实际渲染 div + role=option；选中态由 data-selected 标记） */
const ITEM_CLASS = cn(
  'flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none',
  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
)

const RECENT_ICON: Record<RecentEntry['kind'], typeof CheckSquare> = {
  project: FolderKanban,
  task: CheckSquare,
  user: UserIcon,
}

export function CommandPalette() {
  const open = useCommandPalette(s => s.open)
  const setOpen = useCommandPalette(s => s.setOpen)
  // 每次由关到开自增：用于强制重挂主体，得到干净的初始状态
  const session = useCommandPalette(s => s.session)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          // 不用 Radix 的自动聚焦：改由主体自身聚焦搜索框（cmdk 不自行聚焦输入框）
          onOpenAutoFocus={event => event.preventDefault()}
          className={cn(
            'fixed left-1/2 top-[12vh] z-50 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[var(--popover-shadow)]',
            // Fluent 动效：200ms 淡入 + 8px 上移，减速曲线，禁弹跳
            'duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2'
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            命令面板
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            搜索项目、任务、成员，或执行新建任务、切换主题等快捷操作
          </DialogPrimitive.Description>
          <PaletteBody key={session} onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

interface PaletteBodyProps {
  /** 请求关闭（选中动作/结果后收起面板） */
  onClose: () => void
}

function PaletteBody({ onClose }: PaletteBodyProps) {
  const router = useRouter()
  const openHelp = useCommandPalette(s => s.openHelp)
  const role = useAuthStore(s => s.user?.role)
  const pages = useAuthStore(s => s.user?.pages)
  const { theme, resolvedTheme, setTheme } = useTheme()

  const inputRef = React.useRef<HTMLInputElement>(null)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResults | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [recent] = React.useState<RecentEntry[]>(readRecent)

  // 打开即聚焦搜索框（面板每次打开都是新实例，故只需 mount 时执行一次）
  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 动态搜索：250ms 防抖 + 请求序号防竞态（慢响应不覆盖新结果）
  const requestRef = React.useRef(0)
  React.useEffect(() => {
    const q = query.trim()
    if (!q) return
    const requestId = ++requestRef.current
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.get('/search', { params: { q } })
        if (requestRef.current !== requestId) return
        setResults((res.data?.data as SearchResults) ?? null)
      } catch {
        if (requestRef.current === requestId) setResults(null)
      } finally {
        if (requestRef.current === requestId) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const trimmed = query.trim()
  const isSearching = loading && trimmed.length > 0

  const go = React.useCallback(
    (href: string, entry?: RecentEntry) => {
      if (entry) pushRecent(entry)
      onClose()
      router.push(href)
    },
    [onClose, router]
  )

  // 与服务端侧边栏同口径的可见性判定（非 ADMIN 只见被授权页；无 pages = 未启用页面权限）
  const canSee = React.useCallback(
    (pageKey: string) => role === 'ADMIN' || !pages || pages.includes(pageKey),
    [role, pages]
  )

  const isDark = (resolvedTheme ?? theme) === 'dark'

  const actions = React.useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = []
    if (canSee('tasks'))
      list.push({
        id: 'new-task',
        label: '新建任务',
        hint: ['Ctrl', 'N'],
        icon: CheckSquare,
        run: () => go('/tasks?new=1'),
      })
    if (canSee('messages'))
      list.push({
        id: 'go-messages',
        label: '去消息',
        icon: MessageSquare,
        run: () => go('/messages'),
      })
    if (canSee('files'))
      list.push({
        id: 'go-files',
        label: '打开网盘',
        icon: FolderOpen,
        run: () => go('/files'),
      })
    if (canSee('settings'))
      list.push({
        id: 'go-settings',
        label: '去设置',
        icon: Settings,
        run: () => go('/settings'),
      })
    list.push({
      id: 'toggle-theme',
      label: isDark ? '切换到浅色主题' : '切换到深色主题',
      icon: isDark ? Sun : Moon,
      run: () => {
        setTheme(isDark ? 'light' : 'dark')
        onClose()
      },
    })
    list.push({
      id: 'hotkeys',
      label: '快捷键帮助',
      hint: ['Ctrl', '/'],
      icon: Keyboard,
      run: () => openHelp(),
    })
    return list
  }, [canSee, go, isDark, setTheme, onClose, openHelp])

  const hasResults =
    !!results &&
    (results.projects.length > 0 ||
      results.tasks.length > 0 ||
      results.users.length > 0)

  return (
    <Command
      loop
      label="命令面板"
      className={cn(
        // cmdk 内部节点样式（cmdk 0.2.x 以属性标记内部节点，须用属性选择器覆写）
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground',
        '[&_[cmdk-group]]:py-0.5',
        '[&_[cmdk-item]_svg]:shrink-0 [&_[cmdk-item]_svg]:text-muted-foreground',
        '[&_[cmdk-item][data-selected=true]_svg]:text-primary'
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder="搜索项目、任务、成员，或输入动作…"
          aria-label="命令面板搜索"
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
        />
        <kbd className="kbd shrink-0">Esc</kbd>
      </div>

      <Command.List className="max-h-[min(60vh,24rem)] overflow-y-auto overflow-x-hidden p-2">
        {!isSearching && (
          <Command.Empty className="px-3 py-10 text-center text-sm text-muted-foreground">
            未找到匹配结果
          </Command.Empty>
        )}
        {isSearching && (
          <Command.Loading className="px-3 py-1.5 text-xs text-muted-foreground">
            搜索中…
          </Command.Loading>
        )}

        <Command.Group heading="动作">
          {actions.map(action => (
            <Command.Item
              key={action.id}
              value={`${action.label} ${action.id}`}
              onSelect={() => action.run()}
              className={ITEM_CLASS}
            >
              <action.icon className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              {action.hint && (
                <span className="flex shrink-0 items-center gap-1">
                  <kbd className="kbd">{action.hint[0]}</kbd>
                  <kbd className="kbd">{action.hint[1]}</kbd>
                </span>
              )}
            </Command.Item>
          ))}
        </Command.Group>

        {!trimmed && recent.length > 0 && (
          <Command.Group heading="最近使用">
            {recent.map(entry => {
              const Icon = RECENT_ICON[entry.kind] ?? Search
              return (
                <Command.Item
                  key={`recent-${entry.kind}-${entry.id}`}
                  value={`${entry.title} ${entry.href}`}
                  onSelect={() => go(entry.href, entry)}
                  className={ITEM_CLASS}
                >
                  <Icon className="h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                </Command.Item>
              )
            })}
          </Command.Group>
        )}

        {hasResults && results!.projects.length > 0 && (
          <Command.Group heading="项目">
            {results!.projects.map(project => (
              <Command.Item
                key={`project-${project.id}`}
                value={`项目 ${project.code} ${project.name}`}
                onSelect={() =>
                  go(`/projects/${project.id}`, {
                    kind: 'project',
                    id: project.id,
                    title: `${project.code} ${project.name}`,
                    href: `/projects/${project.id}`,
                  })
                }
                className={ITEM_CLASS}
              >
                <FolderKanban className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-xs text-primary">
                    {project.code}
                  </span>{' '}
                  {project.name}
                </span>
                {project.isArchived && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    已归档
                  </span>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {hasResults && results!.tasks.length > 0 && (
          <Command.Group heading="任务">
            {results!.tasks.map(task => (
              <Command.Item
                key={`task-${task.id}`}
                value={`任务 ${task.title} ${task.project?.code ?? ''}`}
                onSelect={() =>
                  go('/tasks', {
                    kind: 'task',
                    id: task.id,
                    title: task.title,
                    href: '/tasks',
                  })
                }
                className={ITEM_CLASS}
              >
                <CheckSquare className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">
                  {task.title}
                  {task.project?.code && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {' '}
                      · {task.project.code}
                    </span>
                  )}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {hasResults && results!.users.length > 0 && (
          <Command.Group heading="成员">
            {results!.users.map(member => (
              <Command.Item
                key={`user-${member.id}`}
                value={`成员 ${member.name ?? ''} ${member.email}`}
                onSelect={() =>
                  go('/organization', {
                    kind: 'user',
                    id: member.id,
                    title: member.name || member.email,
                    href: '/organization',
                  })
                }
                className={ITEM_CLASS}
              >
                <UserIcon className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">
                  {member.name || member.email}
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · {member.email}
                  </span>
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>

      <footer className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <ArrowUp className="h-3 w-3" />
          <ArrowDown className="h-3 w-3" />
          移动
        </span>
        <span className="flex items-center gap-1">
          <CornerDownLeft className="h-3 w-3" />
          打开
        </span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <kbd className="kbd">Ctrl</kbd>
          <kbd className="kbd">/</kbd>
          快捷键
        </span>
      </footer>
    </Command>
  )
}
