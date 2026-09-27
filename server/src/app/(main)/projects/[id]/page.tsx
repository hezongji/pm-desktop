'use client'

/**
 * /projects/[id] 项目详情（根树页）—— 依据《开发文档-项目管理系统重构》§7.4、§8.2①
 *
 * 页头：项目基本信息卡（编号/状态/金额/合同/地点/日期/进度环大号/myRole）
 *       + [编辑]（can.edit → PATCH 基本信息弹窗）+ [归档]（can.archive → 拦截缺项清单展示）
 * 主体：<PhaseTree projectId>（§8.2① 契约组件，同 queryKey 共享缓存）
 * 文件汇总条：fileSummary（required/approved/waiting/rejected）
 */

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  FileCheck2,
  Loader2,
  MapPin,
  Pencil,
  Archive,
  Hash,
  CalendarRange,
  Banknote,
  FileWarning,
  FolderArchive,
  Users,
  UserPlus,
  UserMinus,
  ClipboardList,
  BarChart3,
  ShoppingCart,
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageBackButton } from '@/components/layout/page-back-button'
import { GanttView } from '@/app/(main)/views/gantt/gantt-view'
import { useAuthStore } from '@/store/auth'
import { MobilePageHeader } from '@/components/mobile/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PhaseMatrix, buildPhaseRows } from '@/components/projects/phase-matrix'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { MobileProjectDetail } from '@/components/mobile/project-detail'
import { ProgressRing } from '@/components/projects/progress-ring'
import { ImAvatar } from '@/components/im/message-bubble'
import { MemberPicker, type PickerMember } from '@/components/im/member-picker'
import { DeliverableBoard } from '@/components/projects/deliverable-board'
import { ExpenseClaimCard } from '@/components/expense/expense-claim-card'
import { ApiService } from '@/services/api'
import {
  ProjectDetailService,
  ArchiveBlockedError,
} from '@/services/project-detail'
import { label, FILE_STATUS, TASK_STATUS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { ArchiveBlocker, TreeProject } from '@/types/project-tree'
import type { FileRequirementItem } from '@/types/files'

const STATUS_TEXT: Record<string, string> = {
  ACTIVE: '进行中',
  ON_HOLD: '暂停',
  COMPLETED: '已完成',
  CANCELLED: '已作废',
}
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  ON_HOLD: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
  COMPLETED: 'bg-green-100 text-green-700 hover:bg-green-100',
  CANCELLED: 'bg-red-100 text-red-700 hover:bg-red-100',
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('zh-CN') : '—'
const fmtAmount = (n: number | null) =>
  n === null ? '—' : `¥${n.toLocaleString('zh-CN')}`

const MEMBER_ROLE_TEXT: Record<string, string> = {
  OWNER: '负责人',
  MANAGER: '经理',
  MEMBER: '成员',
  VIEWER: '访客',
}

/** 历史台账项目档案卡（isLegacy=true 时替代空 PhaseTree，见 audit P0-2） */
function LegacyProjectCard({ project }: { project: TreeProject }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: '项目编号',
      value: <span className="font-mono">{project.code}</span>,
    },
    { label: '项目名称', value: project.name },
    { label: '合同号', value: project.contractNo || '—' },
    { label: '施工地点', value: project.location || '—' },
    { label: '签约日期', value: fmtDate(project.signedAt) },
    { label: '合同金额', value: fmtAmount(project.amount) },
    { label: '客户', value: project.customer?.name || '—' },
    { label: '状态', value: STATUS_TEXT[project.status] ?? project.status },
    { label: '归档标识', value: project.isArchived ? '已归档' : '未归档' },
  ]

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <FolderArchive className="h-5 w-5 text-muted-foreground" />
          <span className="text-base font-semibold">历史台账项目档案</span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 md:grid-cols-3">
          {rows.map(r => (
            <div key={r.label} className="space-y-1">
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd className="text-sm font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          该台账项目未走线上流程，仅存档
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * 板块排序控件（20260921）：悬浮在板块上沿右侧的上移/下移按钮。
 * 顺序按「人」全局存 localStorage（20260924：调一次 → 全部项目生效），完全由操作人员自由调整。
 */
function SectionMoveChip({
  title,
  index,
  total,
  onMove,
}: {
  title: string
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
}) {
  return (
    <div
      className="absolute -top-3 right-3 z-20 flex items-center gap-0.5 rounded-full border bg-background/95 px-1 py-0.5 shadow-sm"
      title={`调整「${title}」板块顺序`}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
        disabled={index <= 0}
        onClick={() => onMove(-1)}
        title={`上移「${title}」`}
      >
        <ChevronUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
        disabled={index >= total - 1}
        onClick={() => onMove(1)}
        title={`下移「${title}」`}
      >
        <ChevronDown className="h-3 w-3" />
      </Button>
    </div>
  )
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const router = useRouter()
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // 项目域写操作后的统一失效：全局 staleTime 5min 且不随窗口聚焦刷新，
  // 因此编辑/归档/状态/删除后必须显式失效列表与工作台缓存。
  const invalidateProjectScope = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-projects'] }),
    ])
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['project', projectId, 'tree'],
    queryFn: () => ProjectDetailService.getTree(projectId),
  })

  // ── 编辑弹窗 ──
  const [editOpen, setEditOpen] = React.useState(false)
  const [form, setForm] = React.useState({
    name: '',
    description: '',
    location: '',
    amount: '',
  })
  const [saving, setSaving] = React.useState(false)

  // ── 归档 ──
  const [archiving, setArchiving] = React.useState(false)
  const [blockers, setBlockers] = React.useState<ArchiveBlocker[] | null>(null)

  // ── 项目状态直改（20260920：状态由操作人自由选择，无流转限制）──
  const [statusChanging, setStatusChanging] = React.useState(false)
  const changeStatus = async (status: string) => {
    if (!tree || status === tree.project.status) return
    setStatusChanging(true)
    try {
      await ProjectDetailService.patchProject(projectId, {
        status: status as 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED',
      })
      toast({
        description: `项目状态已更新为「${STATUS_TEXT[status] ?? status}」`,
      })
      queryClient.invalidateQueries({
        queryKey: ['project', projectId, 'tree'],
      })
      invalidateProjectScope()
    } catch (e) {
      toast({
        title: '状态更新失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setStatusChanging(false)
    }
  }

  // ── 成员管理（P0-8）──
  const [memberPickerOpen, setMemberPickerOpen] = React.useState(false)
  const [boardOpen, setBoardOpen] = React.useState(false)
  const [addingMember, setAddingMember] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  // 甘特图内嵌模式（2026-09-22）：true 时内容区渲染本项目的 GanttView（桌面/移动同）
  const [ganttOpen, setGanttOpen] = React.useState(false)
  // ── 删除项目（删除工程第 2 棒：仅 ADMIN / OWNER，二次确认 + 级联影响告知）──
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const doDeleteProject = async () => {
    setDeleting(true)
    try {
      await ApiService.delete(`/projects/${projectId}`)
      toast({ description: '项目已删除' })
      setDeleteOpen(false)
      invalidateProjectScope()
      router.push('/projects')
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }
  // ★ AI 汇总（S4）：POST /api/ai/summarize {type:'project'}
  const [aiOpen, setAiOpen] = React.useState(false)
  // ── 删除工程第 4 棒：文件卡片删除入口（仅 WAITING；owner/reviewer/ADMIN；服务端终审）──
  const { data: me } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () =>
      ApiService.get<{
        id: string
        role: string
        department?: { id: string; name: string } | null
      }>('/auth/me').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  // ── 板块排序（20260921 上线；20260924 升级：按「人」全局存 localStorage，
  //     调一次全部项目生效（含新建）；老的「人+项目」记录自动迁移）──
  // 20260925 系统默认顺序固化：采用系统管理员在页面上调整后的次序（流程阶段/成员/文件提前，
  // 采购/费用报销后置）。未自定义过的所有登录用户统一按此默认展示；已保存个人偏好的仍按本人设置。
  const SECTION_IDS = [
    'info',
    'phases',
    'members',
    'files',
    'purchase',
    'expense',
  ] as const
  type SectionId = (typeof SECTION_IDS)[number]
  const SECTION_TITLES: Record<SectionId, string> = {
    info: '项目信息',
    purchase: '采购',
    expense: '费用报销',
    members: '项目成员',
    files: '项目文件',
    phases: '流程阶段',
  }
  // uid 取自 auth-store（登录时同步写入、zustand persist 同步恢复）——绝不用异步
  // /auth/me 的 me?.id：接口未返回的窗口期 key 会临时变 anon，写入落临时键、读取
  // 找真键 → 调整丢失/显示默认（2026-09-25 用户回归根因①）。
  const uid = useAuthStore(s => s.user?.id)
  const sectionStorageKey = `pm:section-order:${uid ?? 'anon'}`
  const [savedOrder, setSavedOrder] = React.useState<string[] | null>(null)
  React.useEffect(() => {
    setSavedOrder(null)
    try {
      const raw = localStorage.getItem(sectionStorageKey)
      if (raw) {
        setSavedOrder(JSON.parse(raw))
        return
      }
      // 自愈迁移（只读旧键、绝不删除用户数据）：收编全部历史形态——
      //   pm:section-order:<uid>:<pid>（老「人+项目」）/ anon:<pid> / 裸 anon
      //   （旧竞态写入的丢失调整就落在这里）→ 取最后插入的一份写入全局 key。
      let legacy: string | null = null
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || k === sectionStorageKey || !k.startsWith('pm:section-order:'))
          continue
        const owner = k.slice('pm:section-order:'.length).split(':')[0]
        if (owner !== (uid ?? 'anon') && owner !== 'anon') continue
        const v = localStorage.getItem(k)
        if (!v) continue
        try {
          if (Array.isArray(JSON.parse(v))) legacy = v
        } catch {
          /* 单条损坏跳过，不影响其余候选 */
        }
      }
      if (legacy) {
        localStorage.setItem(sectionStorageKey, legacy)
        setSavedOrder(JSON.parse(legacy))
      }
    } catch {
      /* 顺序数据损坏/不可用时按默认顺序展示，不报错 */
    }
  }, [sectionStorageKey, uid])
  // 有效顺序：本地已存顺序（过滤非法/未知项）+ 新增板块按默认位置补在末尾
  const effectiveOrder: SectionId[] = React.useMemo(() => {
    const known = new Set<string>(SECTION_IDS)
    const fromSaved = (savedOrder ?? []).filter((id): id is SectionId =>
      known.has(id)
    )
    const missing = SECTION_IDS.filter(id => !fromSaved.includes(id))
    return [...fromSaved, ...missing]
  }, [savedOrder])
  const sectionIndex = (id: SectionId) => effectiveOrder.indexOf(id)
  const moveSection = (id: SectionId, dir: -1 | 1) => {
    const idx = sectionIndex(id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= effectiveOrder.length) return
    const next = [...effectiveOrder]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setSavedOrder(next)
    try {
      localStorage.setItem(sectionStorageKey, JSON.stringify(next))
    } catch {
      /* 存储不可用时仅本次会话生效，不报错 */
    }
  }
  const sectionChip = (id: SectionId) => (
    <SectionMoveChip
      title={SECTION_TITLES[id]}
      index={sectionIndex(id)}
      total={effectiveOrder.length}
      onMove={d => moveSection(id, d)}
    />
  )

  const [fileReqDeleting, setFileReqDeleting] =
    React.useState<FileRequirementItem | null>(null)
  const [fileReqDeleteBusy, setFileReqDeleteBusy] = React.useState(false)
  const doDeleteFileReq = async () => {
    if (!fileReqDeleting) return
    setFileReqDeleteBusy(true)
    try {
      await ApiService.delete(`/file-requirements/${fileReqDeleting.id}`)
      toast({ description: `文件条目「${fileReqDeleting.name}」已删除` })
      setFileReqDeleting(null)
      // 条目副芘2（同步修复）：删除后同步失效其他持有文件条目数据的缓存，
      // 避免files 页/工作台仍是已删条目
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['project-files', projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ['file-requirements'] }),
        queryClient.invalidateQueries({ queryKey: ['my-deliverables'] }),
        queryClient.invalidateQueries({ queryKey: ['deliverable-board'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
      ])
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setFileReqDeleteBusy(false)
    }
  }
  const [aiBusy, setAiBusy] = React.useState(false)
  const [aiSummary, setAiSummary] = React.useState<{
    projectLabel?: string
    summary: string
    stats?: {
      progressPercent?: number
      taskStats?: Record<string, number>
      fileStats?: Record<string, number>
      phaseCount?: number
    }
  } | null>(null)
  const runAiSummary = async () => {
    if (aiBusy || !projectId) return
    setAiOpen(true)
    setAiBusy(true)
    setAiSummary(null)
    try {
      const res = await ApiService.post<{
        projectLabel?: string
        summary: string
        stats?: {
          progressPercent?: number
          taskStats?: Record<string, number>
          fileStats?: Record<string, number>
          phaseCount?: number
        }
      }>('/ai/summarize', { type: 'project', projectId }, { timeout: 120_000 })
      setAiSummary(res.data ?? null)
    } catch (e) {
      setAiSummary({
        summary: `AI 汇总失败：${e instanceof Error ? e.message : '请稍后重试'}`,
      })
    } finally {
      setAiBusy(false)
    }
  }

  // ── 项目文件条目（§7.7：项目文件列表 + 状态）──
  const { data: fileReqs } = useQuery({
    queryKey: ['project-files', projectId],
    queryFn: () =>
      ApiService.get<{ items: FileRequirementItem[] }>(
        `/file-requirements?projectId=${projectId}&limit=50`
      ),
    enabled: !!projectId,
  })
  const projectFiles = fileReqs?.data?.items ?? []

  const tree = data?.data

  // ── 成员管理：加人 / 移除（P0-8）──
  const handleAddMembers = async (selected: PickerMember[]) => {
    const userIds = selected.map(s => s.id)
    if (userIds.length === 0) return
    setAddingMember(true)
    try {
      await ApiService.post(`/projects/${projectId}/members`, { userIds })
      toast({ description: `已添加 ${userIds.length} 名成员` })
      queryClient.invalidateQueries({
        queryKey: ['project', projectId, 'tree'],
      })
      void queryClient.invalidateQueries({ queryKey: ['project-members'] })
      setMemberPickerOpen(false) // 添加成功即关弹窗
    } catch (e) {
      toast({
        variant: 'destructive',
        description: e instanceof Error ? e.message : '添加失败',
      })
    } finally {
      setAddingMember(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    setRemovingId(userId)
    try {
      await ApiService.delete(`/projects/${projectId}/members/${userId}`)
      toast({ description: '已移除成员' })
      queryClient.invalidateQueries({
        queryKey: ['project', projectId, 'tree'],
      })
      void queryClient.invalidateQueries({ queryKey: ['project-members'] })
    } catch (e) {
      toast({
        variant: 'destructive',
        description: e instanceof Error ? e.message : '移除失败',
      })
    } finally {
      setRemovingId(null)
    }
  }

  const openEdit = () => {
    if (!tree) return
    setForm({
      name: tree.project.name,
      description: '',
      location: tree.project.location ?? '',
      amount: tree.project.amount === null ? '' : String(tree.project.amount),
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      await ProjectDetailService.patchProject(projectId, {
        name: form.name.trim(),
        ...(form.location.trim() ? { location: form.location.trim() } : {}),
        ...(form.amount === '' ? {} : { amount: Number(form.amount) }),
        ...(form.description.trim()
          ? { description: form.description.trim() }
          : {}),
      })
      toast({ description: '项目信息已更新' })
      setEditOpen(false)
      queryClient.invalidateQueries({
        queryKey: ['project', projectId, 'tree'],
      })
      invalidateProjectScope()
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const doArchive = async () => {
    setArchiving(true)
    try {
      await ProjectDetailService.archive(projectId)
      toast({ description: '项目已归档（对非管理员转为只读）' })
      queryClient.invalidateQueries({
        queryKey: ['project', projectId, 'tree'],
      })
      invalidateProjectScope()
      setBlockers(null)
    } catch (e) {
      if (e instanceof ArchiveBlockedError) {
        setBlockers(e.blockers ?? [])
      } else {
        toast({
          title: '归档失败',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      }
    } finally {
      setArchiving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        正在加载项目…
      </div>
    )
  }

  if (error || !tree) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="mb-3 text-muted-foreground">
          {error instanceof Error
            ? error.message
            : '项目加载失败（可能无权限或不存在）'}
        </p>
        <Button variant="outline" onClick={() => router.push('/projects')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回项目列表
        </Button>
      </div>
    )
  }

  const { project, fileSummary, isLegacy, members } = tree

  // 删除权限：仅系统管理员或项目负责人（与服务端 DELETE 鉴权口径一致）
  const canDeleteProject =
    project.myRole === 'ADMIN' || project.myRole === 'OWNER'

  return (
    <>
      {isMobile ? (
        ganttOpen ? (
          /* 甘特图内嵌（移动）：页头返回即回项目详情，不离开本页 */
          <div className="-mx-3 -mt-6 sm:-mx-4 lg:-mx-6">
            <MobilePageHeader
              title="甘特图"
              onBack={() => setGanttOpen(false)}
            />
            <div className="p-3">
              <GanttView projectId={params.id} embedded />
            </div>
          </div>
        ) : (
          <MobileProjectDetail
            project={project}
            fileSummary={fileSummary}
            isLegacy={isLegacy}
            members={members}
            phasesCount={tree.phases.length}
            projectFiles={projectFiles}
            me={me}
            actions={{
              edit: project.can.edit ? openEdit : null,
              gantt: () => setGanttOpen(true),
              ai: runAiSummary,
              aiBusy,
              archive: project.can.archive ? doArchive : null,
              archiving,
              deleteProject: canDeleteProject
                ? () => setDeleteOpen(true)
                : null,
              board: project.can.edit ? () => setBoardOpen(true) : null,
              addMember: project.can.edit
                ? () => setMemberPickerOpen(true)
                : null,
              removeMember: handleRemoveMember,
              removingId,
              deleteFileReq: f => setFileReqDeleting(f),
              goFiles: requirementId =>
                router.push(
                  `/files?projectId=${projectId}&requirementId=${requirementId}`
                ),
            }}
            extraCards={
              <>
                <PurchaseSummaryCard projectId={params.id} />
                <ExpenseClaimCard
                  projectId={params.id}
                  myRole={project.myRole}
                  me={me}
                />
              </>
            }
            legacyCard={<LegacyProjectCard project={project} />}
          />
        )
      ) : (
        <div className="flex w-full flex-col gap-6 p-4 md:p-6">
          {/* ── 项目头卡 ── */}
          <div className="relative" style={{ order: sectionIndex('info') }}>
            {sectionChip('info')}
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {/* 智能返回：回到跳转来源（列表/工作台/消息卡片），直开时兜底项目列表 */}
                      <PageBackButton
                        fallbackHref="/projects"
                        className="h-7 px-2"
                      />
                      <span className="font-mono">{project.code}</span>
                      {/* 20260920：状态由操作人自由选择（有编辑权限时为下拉，无权限时仅展示） */}
                      {project.can.edit ? (
                        <Select
                          value={project.status}
                          onValueChange={v => void changeStatus(v)}
                          disabled={statusChanging}
                        >
                          <SelectTrigger
                            className={cn(
                              'h-7 w-auto gap-1 border-0 px-2 text-xs shadow-none focus:ring-0',
                              STATUS_BADGE[project.status] ?? ''
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_TEXT).map(([k, t]) => (
                              <SelectItem key={k} value={k}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          variant="secondary"
                          className={STATUS_BADGE[project.status] ?? ''}
                        >
                          {STATUS_TEXT[project.status] ?? project.status}
                        </Badge>
                      )}
                      {project.myRole && (
                        <Badge variant="outline" className="text-xs">
                          我的角色：
                          {project.myRole === 'ADMIN'
                            ? '系统管理员'
                            : project.myRole}
                        </Badge>
                      )}
                    </div>
                    <h1 className="truncate text-xl font-semibold md:text-2xl">
                      {project.name}
                    </h1>
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Banknote className="h-4 w-4" />
                        {fmtAmount(project.amount)}
                      </span>
                      {project.contractNo && (
                        <span className="inline-flex items-center gap-1.5">
                          <Hash className="h-4 w-4" />
                          合同 {project.contractNo}
                        </span>
                      )}
                      {project.location && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-4 w-4" />
                          {project.location}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarRange className="h-4 w-4" />
                        {fmtDate(project.plannedStart)} ~{' '}
                        {fmtDate(project.plannedEnd)}
                      </span>
                      {isLegacy ? (
                        <span className="inline-flex items-center gap-1.5">
                          <FileCheck2 className="h-4 w-4" />
                          无文件记录
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <FileCheck2 className="h-4 w-4" />
                          必需文件 {fileSummary.approved}/{fileSummary.required}{' '}
                          通过
                          {fileSummary.rejected > 0 && (
                            <span className="text-red-600">
                              （{fileSummary.rejected} 驳回）
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {isLegacy ? (
                      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-2 text-muted-foreground">
                        <FolderArchive className="h-8 w-8" />
                        <p className="text-xs">历史台账</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <ProgressRing
                          value={project.progress}
                          size={64}
                          stroke={6}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          总进度
                        </p>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      {project.can.edit && (
                        <Button variant="outline" size="sm" onClick={openEdit}>
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          编辑
                        </Button>
                      )}
                      {/* 甘特图内嵌切换（2026-09-22）：不再弹窗选视图，直接在本页切换 */}
                      <Button
                        variant={ganttOpen ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => setGanttOpen(v => !v)}
                      >
                        <BarChart3 className="mr-1 h-3.5 w-3.5" />
                        {ganttOpen ? '返回详情' : '甘特图'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runAiSummary}
                        disabled={aiBusy}
                      >
                        <Sparkles className="mr-1 h-3.5 w-3.5 text-primary" />
                        {aiBusy ? 'AI 汇总中…' : 'AI 汇总'}
                      </Button>
                      {project.can.archive && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-amber-700 hover:text-amber-800"
                          disabled={archiving}
                          onClick={doArchive}
                        >
                          {archiving ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Archive className="mr-1 h-3.5 w-3.5" />
                          )}
                          归档
                        </Button>
                      )}
                      {canDeleteProject && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleting || project.isArchived}
                          title={
                            project.isArchived
                              ? '已归档项目不可删除，请先解除归档'
                              : '删除项目（不可恢复，需二次确认）'
                          }
                          onClick={() => setDeleteOpen(true)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          删除
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 归档拦截缺项清单（§7.7 errors[] 格式渲染） */}
                {blockers && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                      <FileWarning className="h-4 w-4" />
                      存在未通过的必需文件，无法归档（{blockers.length} 项）
                    </p>
                    <ul className="space-y-1 text-sm">
                      {blockers.map((b, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {label(FILE_STATUS, b.status)}
                          </Badge>
                          <span>{b.name}</span>
                          <span className="text-xs text-muted-foreground">
                            责任人：{b.owner ?? '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 甘特图模式（2026-09-22）：替换下方全部板块，页头卡保留（含切换按钮） */}
          {ganttOpen ? (
            <div
              className="relative"
              style={{ order: sectionIndex('purchase') }}
            >
              <GanttView projectId={params.id} embedded />
            </div>
          ) : (
            <>
              {/* ── 采购概览卡片（2026-08-22 采购模块 Step 3）── */}
              <div
                className="relative"
                style={{ order: sectionIndex('purchase') }}
              >
                {sectionChip('purchase')}
                <PurchaseSummaryCard projectId={params.id} />
              </div>

              {/* ── 费用报销卡片（F3-R2：报销单+明细+审批流）── */}
              <div
                className="relative"
                style={{ order: sectionIndex('expense') }}
              >
                {sectionChip('expense')}
                <ExpenseClaimCard
                  projectId={params.id}
                  myRole={project.myRole}
                  me={me}
                />
              </div>

              {/* ── 项目成员卡片区（P0-8）── */}
              <div
                className="relative"
                style={{ order: sectionIndex('members') }}
              >
                {sectionChip('members')}
                <Card>
                  <CardContent className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-base font-semibold">
                        <Users className="h-4 w-4" />
                        项目成员
                        <Badge variant="secondary" className="font-normal">
                          {members.length}
                        </Badge>
                      </h2>
                      {project.can.edit && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setBoardOpen(true)}
                          >
                            <ClipboardList className="mr-1 h-3.5 w-3.5" />
                            交付物看板
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMemberPickerOpen(true)}
                          >
                            <UserPlus className="mr-1 h-3.5 w-3.5" />
                            添加成员
                          </Button>
                        </div>
                      )}
                    </div>
                    {members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">暂无成员</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {members.map(m => (
                          <div
                            key={m.userId}
                            className="flex items-center gap-3 rounded-lg border p-3"
                          >
                            <ImAvatar
                              name={m.name}
                              className="h-10 w-10 text-sm"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">
                                {m.name}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {MEMBER_ROLE_TEXT[m.role] ?? m.role}
                                {m.title ? ` · ${m.title}` : ''}
                              </div>
                            </div>
                            {project.can.edit && m.role !== 'OWNER' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                                disabled={removingId === m.userId}
                                onClick={() => handleRemoveMember(m.userId)}
                                title="移除成员"
                              >
                                {removingId === m.userId ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <UserMinus className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* ── 阶段根树（§8.2① PhaseTree 契约组件）；历史台账项目改渲染档案卡 ── */}
              {isLegacy ? (
                <div
                  className="relative"
                  style={{ order: sectionIndex('phases') }}
                >
                  {sectionChip('phases')}
                  <LegacyProjectCard project={project} />
                </div>
              ) : (
                <>
                  <div
                    className="relative space-y-2"
                    style={{ order: sectionIndex('files') }}
                  >
                    {sectionChip('files')}
                    {/* 项目文件（条目 + 状态） */}
                    <h2 className="flex items-center gap-2 text-base font-semibold">
                      项目文件
                      <Badge variant="secondary" className="font-normal">
                        {projectFiles.length} 个条目
                      </Badge>
                    </h2>
                    {projectFiles.length === 0 ? (
                      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                        暂无文件条目，前往「文件目录」创建
                      </div>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {projectFiles.map(f => {
                          const st = FILE_STATUS[f.status] ?? f.status
                          const statusCls =
                            f.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-700'
                              : f.status === 'REJECTED'
                                ? 'bg-red-100 text-red-600'
                                : f.status === 'WAITING'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-blue-100 text-blue-700'
                          return (
                            <div
                              key={f.id}
                              onClick={() =>
                                router.push(
                                  `/files?projectId=${projectId}&requirementId=${f.id}`
                                )
                              }
                              className="flex cursor-pointer items-start justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/40"
                              title="点击查看文件详情 / 提交"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {f.name}
                                </div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {f.catalog.name}
                                  {f.owner?.name ? ` · ${f.owner.name}` : ''}
                                  {f.files[0]
                                    ? ` · v${f.files[0].version}`
                                    : ''}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                    statusCls
                                  )}
                                >
                                  {st}
                                </span>
                                {f.status === 'WAITING' &&
                                  !!me &&
                                  (me.role === 'ADMIN' ||
                                    f.ownerId === me.id ||
                                    f.reviewerId === me.id) && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-[11px] text-red-600 hover:text-red-700"
                                      onClick={e => {
                                        e.stopPropagation()
                                        setFileReqDeleting(f)
                                      }}
                                      title="删除该条目（仅未提交状态可删，不可恢复）"
                                    >
                                      <Trash2 className="mr-0.5 h-3 w-3" />
                                      删除
                                    </Button>
                                  )}
                                {(f.status === 'WAITING' ||
                                  f.status === 'REJECTED') &&
                                  f.permissions?.upload === true && (
                                    <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                                      去提交
                                    </span>
                                  )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div
                    className="relative space-y-2"
                    style={{ order: sectionIndex('phases') }}
                  >
                    {sectionChip('phases')}
                    <h2 className="flex items-center gap-2 text-base font-semibold">
                      流程阶段
                      <Badge variant="secondary" className="font-normal">
                        {tree.phases.length} 个阶段
                      </Badge>
                    </h2>
                    <PhaseMatrix
                      rows={buildPhaseRows(tree.phases)}
                      projectCode={project.code}
                      onRowClick={r =>
                        router.push(`/projects/${projectId}/phases/${r.id}`)
                      }
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 编辑弹窗（桌面/移动共用，Portal 渲染） ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑项目信息</DialogTitle>
            <DialogDescription>
              {project.code} · 基本信息维护（PATCH /api/projects/:id）
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">
                项目名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                maxLength={200}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="p-location">施工地点</Label>
                <Input
                  id="p-location"
                  value={form.location}
                  onChange={e =>
                    setForm(f => ({ ...f, location: e.target.value }))
                  }
                  maxLength={200}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-amount">合同金额（元）</Label>
                <Input
                  id="p-amount"
                  type="number"
                  min={0}
                  value={form.amount}
                  onChange={e =>
                    setForm(f => ({ ...f, amount: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-desc">备注说明</Label>
              <Textarea
                id="p-desc"
                rows={3}
                value={form.description}
                onChange={e =>
                  setForm(f => ({ ...f, description: e.target.value }))
                }
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button
              disabled={saving || form.name.trim() === ''}
              onClick={saveEdit}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 删除项目二次确认（删除工程第 2 棒）── */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`删除项目「${project.name}」`}
        description={
          '将永久删除：全部阶段与任务（含修订/批注/评论）、文件目录与文件条目（含已上传文件）、相关待办/通知/催办，并解除项目群成员关联（会话记录保留）。存在采购订单时将被拒绝（财务审计链）。该操作不可恢复。'
        }
        confirmText="永久删除"
        destructive
        loading={deleting}
        onConfirm={doDeleteProject}
      />

      {/* ── 删除文件条目二次确认（删除工程第 4 棒）── */}
      <ConfirmDialog
        open={fileReqDeleting !== null}
        onOpenChange={v => !v && setFileReqDeleting(null)}
        title={`删除文件条目「${fileReqDeleting?.name ?? ''}」`}
        description={
          '仅未提交（待提交）条目可删除；其关联文件、待办与通知将一并清理。该操作不可恢复。'
        }
        confirmText="删除"
        destructive
        loading={fileReqDeleteBusy}
        onConfirm={doDeleteFileReq}
      />

      {/* ── 添加成员选人弹窗（P0-8）── */}
      <MemberPicker
        open={memberPickerOpen}
        onOpenChange={setMemberPickerOpen}
        mode="multi"
        title="添加项目成员"
        description="选择要加入该项目的成员（将同步拉入项目群）"
        confirmText={n => (n > 0 ? `添加成员（${n} 人）` : '添加成员')}
        excludeIds={members.map(m => m.userId)}
        loading={addingMember}
        onConfirm={handleAddMembers}
      />

      {/* ── 交付物看板弹窗（2026-08-21 个人交付物）── */}
      <DeliverableBoard
        projectId={projectId}
        open={boardOpen}
        onOpenChange={setBoardOpen}
      />

      {/* ── AI 汇总弹窗（S4）── */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> AI 项目汇总
            </DialogTitle>
            <DialogDescription>
              {aiSummary?.projectLabel ?? project.code + ' ' + project.name}
            </DialogDescription>
          </DialogHeader>
          {aiBusy ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> AI 正在汇总项目状态…
            </div>
          ) : (
            <div className="space-y-3">
              {aiSummary?.stats && (
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {typeof aiSummary.stats.progressPercent === 'number' && (
                    <Badge variant="secondary">
                      总进度 {aiSummary.stats.progressPercent}%
                    </Badge>
                  )}
                  {typeof aiSummary.stats.phaseCount === 'number' && (
                    <Badge variant="secondary">
                      阶段 {aiSummary.stats.phaseCount}
                    </Badge>
                  )}
                  {aiSummary.stats.taskStats &&
                    Object.entries(aiSummary.stats.taskStats).map(([k, v]) => (
                      <Badge key={k} variant="outline">
                        {label(TASK_STATUS, k)} {v}
                      </Badge>
                    ))}
                  {aiSummary.stats.fileStats &&
                    Object.entries(aiSummary.stats.fileStats).map(([k, v]) => (
                      <Badge key={k} variant="outline">
                        {label(FILE_STATUS, k)} {v}
                      </Badge>
                    ))}
                </div>
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {aiSummary?.summary ?? '未返回内容'}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 视图弹窗已移除（2026-09-22）：甘特图直接内嵌本页，流程阶段入口不再提供 */}
    </>
  )
}

/** 采购概览卡片（2026-08-22 采购模块 Step 3）：订单数 + 总金额（脱敏），点击进采购页 */
function PurchaseSummaryCard({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { data } = useQuery({
    queryKey: ['purchase-summary', projectId],
    queryFn: () =>
      ApiService.get<{
        orders: {
          count: number
          totalAmount: number | null
          inTransit: number
        }
      }>(`/projects/${projectId}/purchase-summary`).then(r => r.data),
  })

  if (!data) return null

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => router.push(`/purchase?projectId=${projectId}`)}
    >
      <CardContent className="flex items-center justify-between p-5">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold">采购</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.orders.count} 张订单
              {data.orders.inTransit > 0 && ` · ${data.orders.inTransit} 在途`}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">总金额</p>
          <p className="font-mono text-sm font-semibold">
            {data.orders.totalAmount == null
              ? '—'
              : `¥${Number(data.orders.totalAmount).toLocaleString('zh-CN')}`}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
