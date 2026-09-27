/**
 * nav-groups 单测（P3-B 桌面化）
 *
 * visibleNavItems 是命令面板 Ctrl+1…8 顺序与侧边栏展示顺序的**同一事实源**，
 * 权限过滤口径必须与 sidebar renderNav 一致；顺序变更会直接改变快捷键语义，
 * 故用测试锁住顺序与过滤两条不变量。
 */

import { NAV_GROUPS, visibleNavItems } from '@/components/layout/nav-groups'

describe('nav-groups · visibleNavItems', () => {
  it('扁平顺序 = 侧边栏展示顺序（工作台在前，管理组在后）', () => {
    const hrefs = visibleNavItems('ADMIN', undefined).map(item => item.href)
    expect(hrefs.slice(0, 4)).toEqual(['/', '/projects', '/tasks', '/purchase'])
    // 管理组位于 IM 之后
    expect(hrefs.indexOf('/settings')).toBeGreaterThan(hrefs.indexOf('/messages'))
    // 无 pageKey 的兜底入口（向导/帮助）始终在列
    expect(hrefs).toContain('/wizards')
    expect(hrefs).toContain('/help')
  })

  it('非 ADMIN 看不到 adminOnly 管理组', () => {
    const hrefs = visibleNavItems('USER', undefined).map(item => item.href)
    expect(hrefs).not.toContain('/settings')
    expect(hrefs).not.toContain('/organization')
    expect(hrefs).toContain('/tasks')
  })

  it('pages 白名单生效：只保留被授权页 + 无 pageKey 项', () => {
    const items = visibleNavItems('USER', ['dashboard', 'tasks'])
    const hrefs = items.map(item => item.href)
    expect(hrefs).toEqual(['/', '/tasks', '/wizards', '/help'])
    // 未被授权且有 pageKey 的项被过滤
    expect(hrefs).not.toContain('/projects')
  })

  it('pages 为空数组 = 无任何页面授权（与 sidebar 同口径），只剩无 pageKey 的兜底入口', () => {
    // 空数组是真值，故 !pages 分支不生效 —— 有 pageKey 的项全部被过滤
    const hrefs = visibleNavItems('USER', []).map(item => item.href)
    expect(hrefs).toEqual(['/wizards', '/help'])
  })

  it('pages 为 undefined = 未启用页面权限，放行全部非管理项', () => {
    const hrefs = visibleNavItems('USER', undefined).map(item => item.href)
    expect(hrefs).toContain('/projects')
    expect(hrefs).not.toContain('/settings')
  })

  it('前 8 项即 Ctrl+1…8 目标，且每项 href 唯一（快捷键不歧义）', () => {
    const shortcuts = visibleNavItems('ADMIN', undefined).slice(0, 8)
    expect(shortcuts).toHaveLength(8)
    expect(new Set(shortcuts.map(item => item.href)).size).toBe(8)
  })

  it('NAV_GROUPS 每项都有 name/href（渲染与快捷键都依赖）', () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(typeof item.name).toBe('string')
        expect(item.href.startsWith('/')).toBe(true)
      }
    }
  })
})
