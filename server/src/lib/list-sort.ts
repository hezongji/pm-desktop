/**
 * 列表排序参数解析（20260908 生产审计修复 P1-1）
 *
 * 背景：前端列表页（项目/任务/用户/通知等）的排序下拉传了 sortBy/sortOrder，
 * 但后端 GET 一律硬编码 orderBy、完全不读参数 —— 表现为「点了没反应」的静默哑按钮。
 *
 * 契约：
 *   - 查询参数：sortBy（字段）+ sortOrder（asc|desc，兼容旧命名 order）
 *   - 字段必须命中 fieldMap 白名单，否则静默回退默认排序（绝不因非法参数 500）
 *   - 方向仅接受 asc/desc（大小写不敏感），其余回退默认方向
 *   - 返回 Prisma orderBy 数组；多字段排序用 readonly string[] 表达
 */

import type { NextRequest } from 'next/server'

export type SortDirection = 'asc' | 'desc'

export function parseListSort<F extends string>(
  request: NextRequest,
  fieldMap: Record<F, string | readonly string[]>,
  fallback: readonly Record<string, SortDirection>[]
): Array<Record<string, SortDirection>> {
  const { searchParams } = new URL(request.url)
  const rawField = (searchParams.get('sortBy') || '').trim()
  const rawDir = (
    searchParams.get('sortOrder') ||
    searchParams.get('order') ||
    ''
  )
    .trim()
    .toLowerCase()

  const target =
    rawField && Object.prototype.hasOwnProperty.call(fieldMap, rawField)
      ? fieldMap[rawField as F]
      : undefined
  if (!target) return fallback.map(o => ({ ...o }))

  const fallbackDir = (
    fallback[0] ? Object.values(fallback[0])[0] : 'desc'
  ) as SortDirection
  const dir: SortDirection =
    rawDir === 'asc' ? 'asc' : rawDir === 'desc' ? 'desc' : fallbackDir
  const fields: readonly string[] = Array.isArray(target)
    ? target
    : [target as string]
  return fields.map(f => ({ [f]: dir }))
}
