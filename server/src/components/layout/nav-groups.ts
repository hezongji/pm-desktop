'use client'

/**
 * 侧边栏导航定义（§8.1）—— 独立模块
 *
 * 从 sidebar.tsx 拆出（P3-B 桌面化）：命令面板的 Ctrl+1…8 顺序切换、移动端
 * 「更多」抽屉、帮助中心文档都引用同一份导航表，而 useGlobalHotkeys 又需要
 * 从 sidebar 侧取用——留在组件文件内会形成 sidebar ↔ hook 的循环导入，
 * 故此处作为**导航单一事实源**，sidebar.tsx 原样再导出以兼容既有引用。
 */

import {
  Briefcase,
  Building2,
  CheckSquare,
  Compass,
  FolderKanban,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  MessageSquare,
  Network,
  Settings,
  ShoppingCart,
  Workflow,
} from 'lucide-react'

export interface NavItem {
  name: string
  href: string
  icon: typeof FolderKanban
  badge?: 'unread' | 'todo' // 角标来源（占位，后续阶段接真实数据）
  exact?: boolean // 精确匹配（不匹配子路径，用于父级入口）
  pageKey?: string // 权限 V2：页面权限 key（为空 = 不参与页面权限控制）
}

export interface NavGroup {
  label: string | null // null = 无分组标题的独立入口（工作台）
  items: NavItem[]
  adminOnly?: boolean
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      {
        name: '工作台',
        href: '/',
        icon: LayoutDashboard,
        pageKey: 'dashboard',
      },
    ],
  },
  {
    label: '项目',
    items: [
      {
        name: '项目列表',
        href: '/projects',
        icon: FolderKanban,
        pageKey: 'projects',
      },
      { name: '项目任务', href: '/tasks', icon: CheckSquare, pageKey: 'tasks' },
      // 甘特图入口已移至工作台快捷区（2026-09-21），侧边栏不再重复展示
    ],
  },
  {
    label: '采购',
    items: [
      {
        name: '采购订单',
        href: '/purchase',
        icon: ShoppingCart,
        pageKey: 'purchase',
      },
    ],
  },
  {
    label: '文件',
    items: [
      { name: '文件目录', href: '/files', icon: FolderOpen, pageKey: 'files' },
    ],
  },
  {
    label: 'IM',
    items: [
      {
        name: '消息',
        href: '/messages',
        icon: MessageSquare,
        badge: 'unread',
        pageKey: 'messages',
      },
    ],
  },
  {
    label: '管理',
    adminOnly: true,
    items: [
      {
        name: '流程模板',
        href: '/process-templates',
        icon: Workflow,
        pageKey: 'process-templates',
      },
      {
        name: '组织架构',
        href: '/organization',
        icon: Network,
        exact: true,
        pageKey: 'organization',
      },
      {
        name: '外部主体',
        href: '/organization/externals',
        icon: Building2,
        pageKey: 'externals',
      },
      {
        name: '岗位字典',
        href: '/organization/job-titles',
        icon: Briefcase,
        pageKey: 'job-titles',
      },
      {
        name: '系统管理',
        href: '/settings',
        icon: Settings,
        pageKey: 'settings',
      },
    ],
  },
  {
    label: null,
    items: [
      { name: '向导中心', href: '/wizards', icon: Compass }, // 无 pageKey：不参与页面权限控制，全员可见
      { name: '帮助中心', href: '/help', icon: HelpCircle }, // 无 pageKey：不参与页面权限控制，全员可见
    ],
  },
]

/**
 * 按权限过滤后的导航项（扁平顺序 = 侧边栏展示顺序 = Ctrl+1…N 顺序）。
 * 口径与 sidebar renderNav / 命令面板 canSee 一致：非 ADMIN 只见被授权页。
 */
export function visibleNavItems(
  role: string | undefined,
  pages: string[] | undefined
): NavItem[] {
  const isAdmin = role === 'ADMIN'
  return NAV_GROUPS.filter(group => !group.adminOnly || isAdmin).flatMap(group =>
    group.items.filter(
      item => !item.pageKey || !pages || pages.includes(item.pageKey) || isAdmin
    )
  )
}
