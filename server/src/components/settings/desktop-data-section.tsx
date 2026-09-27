'use client'

/**
 * 数据与备份 —— 桌面端数据主权区（P3-D）
 *
 * 仅在 Electron 壳内渲染（window.pmDesktop 存在）；浏览器直跑时整个 tab 不显示。
 * 全部数据来自壳 IPC（本地运行时状态 / 目录用量 / 备份导出导入 / 打开数据目录），
 * 壳缺失时 lib/pm-desktop.ts 的封装已降级为安全默认值，本组件不再重复判空。
 */

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  ServerCog,
  Upload,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import {
  desktopBackupData,
  desktopGetDataStats,
  desktopGetRuntimeStatus,
  desktopOpenDataFolder,
  desktopOpenFile,
  desktopRestoreData,
  desktopRestartServices,
  desktopRetryRuntime,
  isDesktopApp,
  type DesktopDataStats,
  type DesktopRuntimeStatus,
} from '@/lib/pm-desktop'
import {
  deriveRuntimeServices,
  displayDataDir,
  RUNTIME_PHASE_LABEL,
  RUNTIME_PHASE_VARIANT,
  usageShare,
} from '@/components/settings/desktop-runtime'
import { bytesToSize, cn } from '@/lib/utils'

/** 是否运行在桌面壳内（SSR 与浏览器首帧为 false，挂载后修正，不产生水合不一致） */
export function useDesktopAppAvailable(): boolean {
  const [available, setAvailable] = React.useState(false)
  React.useEffect(() => setAvailable(isDesktopApp()), [])
  return available
}

type BusyAction = 'backup' | 'restore' | 'restart' | 'retry' | 'folder'

const STATUS_POLL_MS = 5_000

export function DesktopDataSection() {
  const { toast } = useToast()
  const [status, setStatus] = React.useState<DesktopRuntimeStatus | null>(null)
  const [stats, setStats] = React.useState<DesktopDataStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<BusyAction | null>(null)
  const [restoreCandidate, setRestoreCandidate] = React.useState<string | null>(
    null
  )
  const [lastBackupPath, setLastBackupPath] = React.useState<string | null>(
    null
  )
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = React.useCallback(async () => {
    const [nextStatus, nextStats] = await Promise.all([
      desktopGetRuntimeStatus(),
      desktopGetDataStats(),
    ])
    if (!mountedRef.current) return
    setStatus(nextStatus)
    setStats(nextStats)
  }, [])

  // 首次加载 + 轻量轮询（相位/用量会随启动、重启、备份变化）
  React.useEffect(() => {
    void refresh().finally(() => {
      if (mountedRef.current) setLoading(false)
    })
    const timer = window.setInterval(() => void refresh(), STATUS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function handleOpenFolder() {
    setBusy('folder')
    try {
      const ok = await desktopOpenDataFolder()
      if (!ok) {
        toast({
          title: '打开数据目录失败',
          description: '壳未能打开该目录，可在日志中查看详情',
          variant: 'destructive',
        })
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleBackup() {
    setBusy('backup')
    try {
      const result = await desktopBackupData()
      if (result.ok) {
        setLastBackupPath(result.path ?? null)
        toast({
          title: '备份完成',
          description: result.path
            ? `已导出并在资源管理器中定位：${result.path}`
            : '备份文件已导出到备份目录',
        })
        await refresh()
      } else {
        toast({
          title: '备份失败',
          description: result.reason ?? '未知原因',
          variant: 'destructive',
        })
      }
    } finally {
      setBusy(null)
    }
  }

  async function handlePickRestoreFile() {
    const picked = await desktopOpenFile([
      { name: '数据库备份', extensions: ['dump'] },
    ])
    if (!picked) return
    setRestoreCandidate(picked)
  }

  async function handleConfirmRestore() {
    if (!restoreCandidate) return
    setBusy('restore')
    try {
      const result = await desktopRestoreData(restoreCandidate)
      if (result.ok) {
        toast({
          title: '恢复完成',
          description: '本地服务已用备份数据重新启动',
        })
      } else {
        toast({
          title: '恢复未执行',
          description: result.error ?? '未知原因',
          variant: 'destructive',
        })
      }
      await refresh()
    } finally {
      setBusy(null)
      setRestoreCandidate(null)
    }
  }

  async function handleRestart() {
    setBusy('restart')
    try {
      const result = await desktopRestartServices()
      if (result.ok) {
        toast({ title: '服务已重启', description: '应用服务与消息服务已恢复' })
      } else {
        toast({
          title: '服务重启失败',
          description: result.error ?? '详见日志',
          variant: 'destructive',
        })
      }
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  async function handleRetryRuntime() {
    setBusy('retry')
    try {
      const result = await desktopRetryRuntime()
      if (result.ok) {
        toast({ title: '本地运行时已重新启动' })
      } else {
        toast({
          title: '重新启动失败',
          description: result.error ?? '详见日志',
          variant: 'destructive',
        })
      }
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const phase = status?.phase ?? 'idle'
  const services = deriveRuntimeServices(status)
  const pgBytes = stats?.pgBytes ?? 0
  const uploadsBytes = stats?.uploadsBytes ?? 0
  const backupsBytes = stats?.backupsBytes ?? 0
  const totalBytes = pgBytes + uploadsBytes + backupsBytes
  const usageRows = [
    { key: 'pg', label: '数据库（pgdata）', bytes: pgBytes, icon: Database },
    {
      key: 'uploads',
      label: '业务文件（uploads）',
      bytes: uploadsBytes,
      icon: FileArchive,
    },
    {
      key: 'backups',
      label: '备份文件（backups）',
      bytes: backupsBytes,
      icon: HardDrive,
    },
  ]
  const canRestart = phase === 'ready' || phase === 'degraded'

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          本机数据主权：所有业务数据与文件都保存在本机数据目录，可随时导出备份。
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={busy !== null}
        >
          <RefreshCw className="mr-1 h-4 w-4" /> 刷新
        </Button>
      </div>

      {/* ── 数据位置 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" /> 数据位置
          </CardTitle>
          <CardDescription>
            数据库、上传文件、备份与日志都在此目录；卸载应用不会删除该目录。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <code className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">
            {displayDataDir(status)}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleOpenFolder()}
            disabled={busy !== null || phase === 'idle'}
          >
            {busy === 'folder' ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="mr-1 h-4 w-4" />
            )}
            打开数据目录
          </Button>
        </CardContent>
      </Card>

      {/* ── 存储用量 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" /> 存储用量
          </CardTitle>
          <CardDescription>
            合计 {stats?.human ?? bytesToSize(totalBytes)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {usageRows.map(row => {
            const Icon = row.icon
            const percent = usageShare(row.bytes, totalBytes)
            return (
              <div key={row.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {row.label}
                  </span>
                  <span className="font-medium">
                    {bytesToSize(row.bytes)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {percent}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      // Tailwind 3.4 不生成 duration-[var(--x)] / ease-[var(--x)]，用任意属性语法
                      'h-full rounded-full bg-primary [transition-duration:var(--dur-panel)] [transition-property:width] [transition-timing-function:var(--ease-fluent)]',
                      row.key === 'uploads' && 'bg-primary/70',
                      row.key === 'backups' && 'bg-primary/45'
                    )}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* ── 备份与恢复 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-4 w-4 text-primary" /> 备份与恢复
          </CardTitle>
          <CardDescription>
            导出为 .dump
            文件（导出期间服务短暂暂停，完成后自动恢复并定位文件）；
            恢复会覆盖当前全部本地数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void handleBackup()}
            disabled={busy !== null || !canRestart}
          >
            {busy === 'backup' ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            导出备份
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handlePickRestoreFile()}
            disabled={busy !== null || !canRestart}
          >
            <Upload className="mr-1 h-4 w-4" /> 导入备份
          </Button>
          {lastBackupPath && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              最近导出：
              <code className="max-w-[22rem] truncate">{lastBackupPath}</code>
            </span>
          )}
        </CardContent>
      </Card>

      {/* ── 本地运行时 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="h-4 w-4 text-primary" /> 本地运行时
            <Badge variant={RUNTIME_PHASE_VARIANT[phase]}>
              {RUNTIME_PHASE_LABEL[phase]}
            </Badge>
          </CardTitle>
          <CardDescription>
            数据库 / 应用服务 / 消息服务的本机运行状态（跟随运行时总体相位）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="divide-y rounded-md border">
            {services.map(service => (
              <div
                key={service.key}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      service.up ? 'bg-success' : 'bg-muted-foreground/40',
                      phase === 'booting' && 'animate-pulse'
                    )}
                  />
                  {service.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {service.port ? `端口 ${service.port}` : '未启动'}
                </span>
              </div>
            ))}
          </div>

          {status?.error && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {status.error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRestart()}
              disabled={busy !== null || !canRestart}
            >
              {busy === 'restart' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              重启服务
            </Button>
            {phase === 'failed' && (
              <Button
                size="sm"
                onClick={() => void handleRetryRuntime()}
                disabled={busy !== null}
              >
                {busy === 'retry' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                重新启动本地服务
              </Button>
            )}
            {status?.startedAt && (
              <span className="text-xs text-muted-foreground">
                启动于{' '}
                {new Date(status.startedAt).toLocaleString('zh-CN', {
                  hour12: false,
                })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={restoreCandidate !== null}
        onOpenChange={open => {
          if (!open) setRestoreCandidate(null)
        }}
        title="从备份恢复数据"
        description={`将停止本地服务并用备份覆盖当前全部数据，此操作不可撤销。备份文件：${restoreCandidate ?? ''}`}
        confirmText="确认恢复"
        destructive
        loading={busy === 'restore'}
        onConfirm={handleConfirmRestore}
      />
    </div>
  )
}
