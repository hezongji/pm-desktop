'use client'

/**
 * /download —— PM 系统双 App 下载页（2026-08-31 双卡升级）
 *
 * 不强制登录（扫码即达）：双 App 二维码 + APK 直链 + 安装指引 + SHA-256 校验。
 * APK 由 nginx 直出（/downloads/ alias，见 deploy/nginx.conf），本页只展示与链接。
 * 发版时更新下方常量。
 */

import * as React from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import {
  Smartphone,
  Download,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  MessageSquare,
  FolderKanban,
  ArrowLeft,
} from 'lucide-react'
import {
  APP_DOWNLOADS,
  appDownloadUrl,
  type AppDownloadInfo,
} from '@/lib/app-downloads'
import { isDesktopApp } from '@/lib/pm-desktop'

const APPS: (AppDownloadInfo & { icon: React.ReactNode })[] = [
  {
    key: 'pm',
    name: 'PM 项目管理',
    desc: '完整项目管理系统 · 工作台/项目/任务/采购/文件/IM 全功能',
    icon: <FolderKanban className="h-6 w-6" />,
    apkPath: '/downloads/pm-app-1.0.0.apk',
    version: '1.0.0',
    sha256: '3e26f5d2eda7896b8c2260fe212f3ce4454ae9b250e29f9bace82f049b89773e',
  },
  {
    key: 'chat',
    name: 'PM 聊天',
    desc: '独立 IM 应用 · 消息实时同步 + 微信式视频/语音通话',
    icon: <MessageSquare className="h-6 w-6" />,
    apkPath: '/downloads/pm-chat-1.8.1.apk',
    version: '1.8.1',
    sha256: 'cd5d2797ec104590b1992af5d4b29114c19c69ae385561d4794f16169d00be30',
  },
]

function AppCard({ app }: { app: AppDownloadInfo & { icon: React.ReactNode } }) {
  const [qrDataUrl, setQrDataUrl] = React.useState<string>('')
  const [copied, setCopied] = React.useState(false)

  // 恆为云端直链（本地壳内 origin 是 127.0.0.1，手机扫了连不上）
  const apkUrl = appDownloadUrl(app)

  React.useEffect(() => {
    QRCode.toDataURL(apkUrl, {
      width: 260,
      margin: 1,
      color: { dark: '#1f2937', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [apkUrl])

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(app.sha256)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-4 rounded-2xl border bg-card p-5 shadow-sm">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {app.icon}
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">{app.name}</h2>
          <p className="mt-0.5 max-w-60 text-sm text-muted-foreground">
            {app.desc}
          </p>
        </div>
      </div>

      {/* 二维码 */}
      <div className="rounded-2xl border bg-background p-3 text-center">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`${app.name} 下载二维码`}
            width={220}
            height={220}
            className="mx-auto rounded-lg"
          />
        ) : (
          <div className="flex h-56 w-56 items-center justify-center text-sm text-muted-foreground">
            二维码生成中…
          </div>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          手机扫码下载 · 版本 v{app.version}
        </p>
      </div>

      {/* 直链下载 */}
      <a
        href={apkUrl}
        download
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
      >
        <Download className="h-4 w-4" />
        浏览器直接下载 APK
      </a>

      {/* 校验值 */}
      <div className="w-full rounded-xl border bg-muted/30 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          安全校验（SHA-256）
        </div>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">
            {app.sha256}
          </code>
          <button
            type="button"
            onClick={copyHash}
            className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted"
            title="复制校验值"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DownloadPage() {
  // 水合安全：isDesktopApp 依赖 window，SSR/客户端首帧不一致 → mounted 后再渲染返回按钮
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  return (
    <div className="min-h-dvh w-full bg-background">
      <head>
        <title>PM 系统 App 下载</title>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      {/* 桌面壳内兜底返回（手机浏览器场景不渲染，落地页纯粹） */}
      {mounted && isDesktopApp() && (
        <Link
          href="/dashboard"
          className="fixed left-4 top-4 z-50 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          返回系统
        </Link>
      )}
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col items-center gap-6 px-4 py-10">
        {/* 页头 */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PM 系统 App</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              安卓版 · 自签名分发 · 与 PM 系统数据实时同步
            </p>
          </div>
        </div>

        {/* 双 App 卡片 */}
        <div className="grid w-full gap-6 md:grid-cols-2">
          {APPS.map(app => (
            <AppCard key={app.key} app={app} />
          ))}
        </div>

        {/* 安装指引 */}
        <div className="w-full max-w-2xl space-y-3 rounded-2xl border bg-card p-5 text-sm">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            安装步骤
          </h2>
          <ol className="list-inside list-decimal space-y-2 text-muted-foreground">
            <li>
              用<strong className="text-foreground">手机系统浏览器/相机</strong>
              扫描上方二维码（微信内打开会被拦截，请换浏览器）
            </li>
            <li>
              点击下载
              APK，若提示「允许安装未知应用」，前往设置开启对应浏览器的权限
            </li>
            <li>
              安装时若出现安全提示（自签名分发，非应用商店版本），点「
              <strong className="text-foreground">仍要安装</strong>」继续
            </li>
            <li>
              打开 App 后，用 PM 系统账号登录即可使用（两个 App 账号通用）
            </li>
          </ol>
        </div>

        <p className="text-xs text-muted-foreground">
          {new Date().getFullYear()} 合纵纪 · PM 项目管理系统
        </p>
      </div>
    </div>
  )
}
