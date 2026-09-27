'use client'

/**
 * /im/diag —— 通话自检页（SDLC 20260906 通话故障定位）
 *
 * 目的：区分「设备/WebView 层 getUserMedia 不可用」与「通话流程 bug」。
 * 在不经过通话流程的情况下直接跑裸媒体采集矩阵 + 环境信息，结果：
 *   - 全屏展示（可截图）
 *   - 自动上报服务器日志（POST /api/im/call-diag → pm-app journal [call-diag]）
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Activity } from 'lucide-react'
import { api } from '@/services/api'

const BUILD_ID = 'diag-20260906-1'

interface Row {
  name: string
  result: string
  ok?: boolean
}

export default function CallDiagPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const push = (r: Row) => setRows(prev => [...prev, r])

  const run = async () => {
    setRunning(true)
    setRows([])
    const report: Record<string, unknown> = {
      build: BUILD_ID,
      ua: navigator.userAgent,
      ts: new Date().toISOString(),
    }

    push({ name: 'UA', result: navigator.userAgent.slice(0, 90) + '…' })
    push({
      name: '安全上下文(https)',
      result: window.isSecureContext ? '是' : '否（gUM 不可用！）',
      ok: window.isSecureContext,
    })

    // 设备枚举（权限授予后才有 label）
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioIn = devices.filter(d => d.kind === 'audioinput')
      const videoIn = devices.filter(d => d.kind === 'videoinput')
      const labeled = devices.filter(d => d.label).length
      report.devices = {
        audioIn: audioIn.length,
        videoIn: videoIn.length,
        labeled,
      }
      push({
        name: '设备枚举',
        result: `麦克风 ${audioIn.length} 个 / 摄像头 ${videoIn.length} 个${labeled ? '' : '（label 空=权限未授予）'}`,
        ok: audioIn.length + videoIn.length > 0,
      })
    } catch (e) {
      push({ name: '设备枚举', result: String(e), ok: false })
    }

    // gUM 矩阵
    const gum = async (
      name: string,
      constraints: MediaStreamConstraints,
      key: string
    ) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const kinds = stream
          .getTracks()
          .map(
            t => `${t.kind}${t.readyState === 'live' ? '' : ':' + t.readyState}`
          )
          .join('+')
        stream.getTracks().forEach(t => t.stop())
        report[key] = 'ok:' + kinds
        push({ name, result: `成功（${kinds}）`, ok: true })
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        report[key] = `fail:${err.name}:${err.message}`
        push({ name, result: `失败 ${err.name}: ${err.message}`, ok: false })
      }
    }

    await gum(
      '① 麦克风（带处理约束）',
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      'audioStrict'
    )
    await gum('② 麦克风（无约束）', { audio: true }, 'audioPlain')
    await gum('③ 摄像头', { video: true }, 'videoPlain')
    await gum('④ 摄像头+麦克风', { video: true, audio: true }, 'both')

    // WebAudio（铃声依赖）
    try {
      const ac = new AudioContext()
      report.audioContext = ac.state
      push({
        name: 'AudioContext',
        result: ac.state,
        ok: ac.state === 'running',
      })
      ac.close()
    } catch (e) {
      push({ name: 'AudioContext', result: String(e), ok: false })
    }

    // RTCPeerConnection 可用性（不连网，仅构造）
    try {
      const pc = new RTCPeerConnection({ iceServers: [] })
      report.rtcPc = true
      push({ name: 'RTCPeerConnection', result: '可用', ok: true })
      pc.close()
    } catch (e) {
      push({ name: 'RTCPeerConnection', result: String(e), ok: false })
    }

    // 上报服务器（无论成败；失败不阻塞展示）
    try {
      await api.post('/im/call-diag', report)
      push({ name: '结果上报', result: '已上报服务器', ok: true })
    } catch {
      push({ name: '结果上报', result: '上报失败（截图此页）', ok: false })
    }

    setDone(true)
    setRunning(false)
  }

  const failCount = rows.filter(r => r.ok === false).length

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header
        className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <button
          type="button"
          aria-label="返回"
          onClick={() => router.push('/im')}
          className="flex h-9 w-9 items-center justify-center rounded hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="flex items-center gap-2 text-[16px] font-semibold">
          <Activity className="h-4 w-4 text-primary" />
          通话自检
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {BUILD_ID}
        </span>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          此页直接测试设备的摄像头/麦克风采集能力（不经过通话流程），用于定位通话失败原因。
          点击开始后按提示授权。结果会自动发送给系统管理员。
        </p>

        {!running && !done && (
          <button
            type="button"
            onClick={() => void run()}
            className="w-full rounded-xl bg-primary py-3.5 text-[15px] font-medium text-primary-foreground active:scale-[0.99]"
          >
            开始检测
          </button>
        )}
        {running && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            检测中…（请对授权弹窗点允许）
          </p>
        )}

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{r.name}</span>
                <span
                  className={`text-xs ${r.ok === false ? 'text-red-500' : r.ok ? 'text-emerald-600' : 'text-muted-foreground'}`}
                >
                  {r.ok === false ? '✗ 失败' : r.ok ? '✓' : ''}
                </span>
              </div>
              <p className="mt-1 break-all text-[11px] leading-relaxed text-muted-foreground">
                {r.result}
              </p>
            </div>
          ))}
        </div>

        {done && (
          <div
            className={`rounded-xl border p-4 text-center text-sm ${failCount > 0 ? 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30' : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30'}`}
          >
            {failCount === 0
              ? '全部通过：设备采集能力正常'
              : `${failCount} 项失败：结果已上报，请联系管理员查看定位`}
          </div>
        )}
      </div>
    </div>
  )
}
