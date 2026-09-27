'use client'

/**
 * /views/table —— 表格视图（TableView，P3 交付）
 *
 * 依据《开发文档-项目管理系统重构》§8.2⑤：
 *   TableView : TanStack Table 全字段矩阵 + 导出 xlsx（sheetjs）
 *
 * 实现说明：矩阵表格本体已抽取为共享组件
 *   @/components/projects/phase-matrix（PhaseMatrix + buildPhaseRows），
 *   与 /projects/[id] 详情页的「流程阶段」板块共用同一份实现，保证口径一致。
 *
 * 视图契约：顶部挂 <ProjectViewPicker />（读 ?projectId=），无 projectId 引导选择。
 * ⚠️ ProjectViewPicker / 本页内容均用 useSearchParams，须 <Suspense> 包裹。
 */

import { Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban, Table2 } from 'lucide-react'

import { ProjectViewPicker } from '@/components/views/project-view-picker'
import { PageBackButton } from '@/components/layout/page-back-button'
import { api } from '@/services/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  PhaseMatrix,
  buildPhaseRows,
  type MatrixPhaseInput,
} from '@/components/projects/phase-matrix'

interface TreeBody {
  project?: { code?: string; name?: string }
  phases?: MatrixPhaseInput[]
}

// ───────────────────────────── 主内容（读 ?projectId=）─────────────────────────────

function TableView() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('projectId') ?? ''

  const { data: tree, isLoading } = useQuery({
    queryKey: ['project', projectId, 'tree'],
    enabled: !!projectId,
    queryFn: async (): Promise<TreeBody> => {
      const res = await api.get(`/projects/${projectId}/tree`)
      const body = res.data as { data?: TreeBody }
      return body?.data ?? { phases: [] }
    },
  })

  const rows = useMemo(() => buildPhaseRows(tree?.phases), [tree])

  if (!projectId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <FolderKanban className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            请先在顶部选择一个项目，以查看该项目的阶段全字段矩阵。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Table2 className="h-5 w-5" />
          阶段全字段矩阵
        </CardTitle>
        <CardDescription>
          {tree?.project?.name ? `${tree.project.name} · ` : ''}共 {rows.length}{' '}
          个阶段 · 支持列排序与状态筛选 · 可导出 Excel
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <PhaseMatrix rows={rows} projectCode={tree?.project?.code} />
        )}
      </CardContent>
    </Card>
  )
}

// ───────────────────────────── 页面出口 ─────────────────────────────

export default function TableViewPage() {
  return (
    <div className="space-y-6">
      {/* 智能返回：该页已不在侧边栏，唯一入口是项目详情「视图」弹窗等跳转，返回即回来源 */}
      <PageBackButton fallbackHref="/projects" className="-ml-2" />
      <Suspense
        fallback={<div className="h-10 animate-pulse rounded bg-muted" />}
      >
        <ProjectViewPicker />
      </Suspense>
      <Suspense
        fallback={<div className="h-32 animate-pulse rounded bg-muted" />}
      >
        <TableView />
      </Suspense>
    </div>
  )
}
