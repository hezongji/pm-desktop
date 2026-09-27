'use client'

/**
 * 手机 App 下载二维码对话框（侧栏入口用）
 *
 * 背景：/download 是手机浏览器扫码落地页（无导航布局），桌面壳内跳过去会被困住
 * （壳拦截鼠标侧键/导航键，页面无返回入口，owner 2026-09-27 实测反馈）。
 * 改为侧栏内弹对话框直接展示二维码，不再跳页。
 *
 * 二维码恒指向云端 APK 直链（见 lib/app-downloads.ts 说明）。
 */

import * as React from 'react'
import QRCode from 'qrcode'
import { FolderKanban, MessageSquare, Smartphone } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  APP_DOWNLOADS,
  appDownloadUrl,
  type AppDownloadInfo,
} from '@/lib/app-downloads'

const ICONS: Record<AppDownloadInfo['key'], React.ReactNode> = {
  pm: <FolderKanban className="h-5 w-5" />,
  chat: <MessageSquare className="h-5 w-5" />,
}

function QrCard({ app }: { app: AppDownloadInfo }) {
  const [qrDataUrl, setQrDataUrl] = React.useState('')

  React.useEffect(() => {
    QRCode.toDataURL(appDownloadUrl(app), {
      width: 220,
      margin: 1,
      color: { dark: '#1f2937', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [app])

  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-primary">
        {ICONS[app.key]}
        <span className="text-sm font-semibold text-foreground">
          {app.name}
        </span>
      </div>
      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt={`${app.name} 下载二维码`}
          width={150}
          height={150}
          className="rounded-lg"
        />
      ) : (
        <div className="flex h-[150px] w-[150px] items-center justify-center text-xs text-muted-foreground">
          二维码生成中…
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        手机扫码下载 · v{app.version}
      </p>
    </div>
  )
}

export function AppDownloadDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            手机 App 下载
          </DialogTitle>
          <DialogDescription>
            用手机系统浏览器/相机扫码下载（微信内会被拦截，请换浏览器）
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {APP_DOWNLOADS.map(app => (
            <QrCard key={app.key} app={app} />
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          安装时若提示「未知应用」，点「仍要安装」；两个 App 账号通用。App
          需连接云端或局域网主机后用 PM 账号登录。
        </p>
      </DialogContent>
    </Dialog>
  )
}
