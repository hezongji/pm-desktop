/**
 * 手机 App 下载单一事实源（侧栏二维码对话框 + /download 落地页共用）
 * 发版时只改这里。
 */

export interface AppDownloadInfo {
  key: 'pm' | 'chat'
  name: string
  desc: string
  version: string
  apkPath: string
  sha256: string
}

/**
 * APK 直链基址：恒为云端（APK 由云端 nginx /downloads/ alias 直出）。
 * 桌面本地模式下页面 origin 是 127.0.0.1:4310，手机扫码无法访问——
 * 二维码/直链必须用云端地址，不得用 window.location.origin。
 */
export const APP_DOWNLOAD_BASE = 'https://pm.hezongji.cn'

export const APP_DOWNLOADS: AppDownloadInfo[] = [
  {
    key: 'pm',
    name: 'PM 项目管理',
    desc: '完整项目管理系统 · 工作台/项目/任务/采购/文件/IM 全功能',
    version: '1.0.0',
    apkPath: '/downloads/pm-app-1.0.0.apk',
    sha256: '3e26f5d2eda7896b8c2260fe212f3ce4454ae9b250e29f9bace82f049b89773e',
  },
  {
    key: 'chat',
    name: 'PM 聊天',
    desc: '独立 IM 应用 · 消息实时同步 + 微信式视频/语音通话',
    version: '1.8.1',
    apkPath: '/downloads/pm-chat-1.8.1.apk',
    sha256: 'cd5d2797ec104590b1992af5d4b29114c19c69ae385561d4794f16169d00be30',
  },
]

export function appDownloadUrl(app: AppDownloadInfo): string {
  return APP_DOWNLOAD_BASE + app.apkPath
}
