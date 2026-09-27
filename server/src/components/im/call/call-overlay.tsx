'use client'

/**
 * 通话全屏覆盖层 —— 微信风格（SDLC 20260906-call-ui-wechat）
 *
 * 视觉范式：
 *  来电（浅色页）：对方大头像+名字居中，底部左红拒接 / 右绿接听（#FA5151 / #07C160）
 *  呼出/接通中（深色）：头像+名字+"等待对方接受…"，底部中央红挂断
 *  语音通话中（深色）：头像+名字+通话时长，底部三格钮（静音 / 挂断 / 对称占位）
 *  视频通话中：对方全屏画面、顶部"名字·时长"胶囊、右上自拍小窗、底部三格钮 + 翻转
 *  结束页：原因 + 媒体失败引导（错误分类文案 + "知道了"）
 *
 * 兼容约定：引擎动作与 aria-label（接听/拒接/挂断/静音/取消静音/取消）保持不变，
 * L2/回归脚本零改动；remote 音频统一由唯一 video 元素播放（语音态透明占位）。
 */

import { useEffect, useRef, useState } from 'react'
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Video,
  VideoOff,
} from 'lucide-react'
import type { CallEngine } from './call-engine'
import type { CallSnapshot } from './types'
import { CALL_END_REASON_TEXT, MEDIA_ERROR_HINT } from './types'

interface Props {
  snapshot: CallSnapshot
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  engine: CallEngine
}

/** 微信绿 / 微信红 */
const WX_GREEN = 'bg-[#07C160]'
const WX_RED = 'bg-[#FA5151]'

/** 名字末字头像（无真实头像时的微信式占位） */
function Avatar({
  name,
  light,
  size,
}: {
  name: string
  light?: boolean
  size: 'lg' | 'md' | 'sm'
}) {
  const t = name.trim()
  const ch = t ? t[t.length - 1] : '?'
  const cls =
    size === 'lg'
      ? 'h-24 w-24 text-4xl'
      : size === 'md'
        ? 'h-20 w-20 text-3xl'
        : 'h-16 w-16 text-2xl'
  return (
    <div
      className={`flex ${cls} select-none items-center justify-center rounded-full font-medium ${
        light ? 'bg-white text-neutral-400 shadow-md' : 'bg-white/15 text-white'
      }`}
    >
      {ch}
    </div>
  )
}

export function CallOverlay({
  snapshot: s,
  localStream,
  remoteStream,
  engine,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null) // 远端（画面+音频统一播放器）
  const localRef = useRef<HTMLVideoElement | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [canFlip, setCanFlip] = useState(false)

  const inCall = s.state === 'connected' || s.state === 'reconnecting'
  const isIncoming = s.state === 'incoming'
  const isOutgoing = s.state === 'outgoing' || s.state === 'connecting'

  // 远端流 → video（任何通话态都挂载；视频态铺满、语音态透明占位播音频）
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = remoteStream
  }, [remoteStream])
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream
  }, [localStream])

  // 通话计时
  useEffect(() => {
    if (!inCall) {
      setElapsed(0)
      return
    }
    const t0 = Date.now()
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - t0) / 1000)),
      1000
    )
    return () => clearInterval(t)
  }, [inCall])

  // 可翻转摄像头（≥2 摄像头才显示翻转入口）
  useEffect(() => {
    if (s.effectiveMedia !== 'video') return
    let alive = true
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then(ds => {
        if (alive)
          setCanFlip(ds.filter(d => d.kind === 'videoinput').length >= 2)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [s.effectiveMedia])

  const fmt = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
  const peerName = s.peer?.name ?? '对方'
  const peerAudioOnly = s.peerVideo === false
  const showVideo = inCall && s.effectiveMedia === 'video' && !peerAudioOnly
  const statusText =
    s.state === 'incoming'
      ? s.media === 'video'
        ? '邀请你视频通话…'
        : '邀请你语音通话…'
      : s.state === 'outgoing'
        ? '等待对方接受…'
        : s.state === 'connecting'
          ? '正在接通…'
          : s.state === 'reconnecting'
            ? '网络不稳定，正在重连…'
            : ''

  return (
    <div
      className={`fixed inset-0 z-[100] flex h-dvh w-full select-none flex-col overflow-hidden ${
        isIncoming
          ? 'bg-[#eef0f2] text-neutral-900'
          : 'bg-neutral-950 text-white'
      }`}
    >
      {/* ── 内容区（视觉层） ── */}
      <main className="relative min-h-0 flex-1">
        {/* 远端画面 / 音频播放器（语音态透明占位继续播声音） */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={
            showVideo
              ? 'absolute inset-0 h-full w-full bg-black object-cover'
              : 'pointer-events-none absolute h-px w-px opacity-0'
          }
        />

        {/* 来电（浅色微信页） */}
        {isIncoming && (
          <div className="absolute inset-0 flex flex-col items-center">
            <p className="mt-14 text-sm text-neutral-400">
              {s.media === 'video' ? '视频通话' : '语音通话'}
            </p>
            <div className="flex flex-1 flex-col items-center justify-center gap-5">
              <div
                className={
                  isIncoming
                    ? 'animate-[wxPulse_1.6s_ease-in-out_infinite]'
                    : ''
                }
              >
                <Avatar name={peerName} light size="lg" />
              </div>
              <div className="text-center">
                <p className="text-2xl font-semibold tracking-tight">
                  {peerName}
                </p>
                <p className="mt-2 text-sm text-neutral-400">
                  正在邀请你{s.media === 'video' ? '视频' : '语音'}通话…
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 呼出 / 接通中（深色） */}
        {isOutgoing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
            <div className={s.state === 'outgoing' ? 'animate-pulse' : ''}>
              <Avatar name={peerName} size="md" />
            </div>
            <div className="text-center">
              <p className="text-xl font-medium tracking-tight">{peerName}</p>
              <p className="mt-2 text-sm text-white/50">{statusText}</p>
            </div>
            {s.effectiveMedia === 'audio' && s.media === 'video' && (
              <p className="text-xs text-white/40">（已降级为语音通话）</p>
            )}
          </div>
        )}

        {/* 通话中-语音（深色头像居中） */}
        {inCall && !showVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {peerAudioOnly && (
              <span className="absolute top-6 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                对方已转为语音通话
              </span>
            )}
            {s.micUnavailable && (
              <span className="absolute top-6 rounded-full bg-amber-500/85 px-3 py-1 text-xs text-white">
                本机麦克风不可用·对方听不到你
              </span>
            )}
            {!s.micUnavailable && s.peerAudio === false && (
              <span className="absolute top-6 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                对方麦克风不可用（听不到对方）
              </span>
            )}
            <Avatar name={peerName} size="sm" />
            <p className="mt-4 text-lg font-medium tracking-tight">
              {peerName}
            </p>
            <p className="mt-1.5 text-sm tabular-nums text-white/50">
              {s.state === 'reconnecting' ? statusText : fmt(elapsed)}
            </p>
          </div>
        )}

        {/* 通话中-视频（对方全屏 + 顶部胶囊 + 翻转 + 自拍小窗） */}
        {inCall && showVideo && (
          <>
            {/* 顶部信息胶囊 */}
            <div className="absolute left-1/2 top-5 -translate-x-1/2">
              <span className="rounded-full bg-black/45 px-3.5 py-1.5 text-xs tabular-nums text-white/90 backdrop-blur-sm">
                {peerName} ·{' '}
                {s.state === 'reconnecting' ? '重连中…' : fmt(elapsed)}
              </span>
            </div>
            {/* 媒体状态提示（本机/对端无声模式） */}
            {s.micUnavailable && (
              <span className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-amber-500/85 px-3 py-1 text-xs text-white">
                本机麦克风不可用·无声模式
              </span>
            )}
            {!s.micUnavailable && s.peerAudio === false && (
              <span className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs text-white/85">
                对方麦克风不可用（听不到对方）
              </span>
            )}
            {/* 摄像头翻转（多摄） */}
            {canFlip && (
              <button
                type="button"
                aria-label="切换摄像头"
                title="切换摄像头"
                onClick={() => void engine.switchCamera()}
                className="absolute left-3 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm active:scale-95"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            {/* 本端自拍小窗 */}
            <div className="absolute right-3 top-14 overflow-hidden rounded-2xl border border-white/25 bg-black shadow-2xl">
              <video
                ref={localRef}
                autoPlay
                playsInline
                muted
                className={`h-40 w-24 object-cover ${s.camOff ? 'opacity-20' : ''}`}
              />
              {s.micMuted && (
                <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white">
                  <MicOff className="h-3 w-3" />
                </span>
              )}
              {s.camOff && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-white/70">
                  摄像头已关闭
                </span>
              )}
            </div>
          </>
        )}

        {/* ended 结束层：原因 + 权限引导 */}
        {s.state === 'ended' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
            <div className="flex flex-col items-center px-10 text-center">
              <p className="text-lg font-medium text-white">
                {s.endReason ? CALL_END_REASON_TEXT[s.endReason] : '通话已结束'}
              </p>
              {s.mediaError ? (
                <>
                  <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-white/70">
                    {MEDIA_ERROR_HINT[s.mediaError] ??
                      '媒体设备开启失败，请检查后重试。'}
                  </p>
                  <button
                    type="button"
                    aria-label="知道了"
                    onClick={() => engine.dismissEnded()}
                    className="mt-6 rounded-full border border-white/25 px-8 py-2 text-sm text-white active:scale-95"
                  >
                    知道了
                  </button>
                </>
              ) : (
                <p className="mt-3 text-xs text-white/50">正在返回…</p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── 操作区（微信圆钮） ── */}
      <footer
        className={`shrink-0 ${
          isIncoming
            ? 'pb-[max(2.5rem,env(safe-area-inset-bottom))]'
            : 'bg-gradient-to-t from-black/70 via-black/20 to-transparent pb-[max(1.75rem,env(safe-area-inset-bottom))]'
        }`}
      >
        {isIncoming && (
          <div className="flex items-center justify-center gap-20 px-10">
            <button
              type="button"
              aria-label="拒接"
              title="拒接"
              onClick={() => engine.reject()}
              className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-90 ${WX_RED}`}
            >
              <PhoneOff className="h-6 w-6" />
            </button>
            <button
              type="button"
              aria-label="接听"
              title="接听"
              onClick={() => void engine.accept()}
              className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-90 ${WX_GREEN}`}
            >
              {s.media === 'video' ? (
                <Video className="h-6 w-6" />
              ) : (
                <Phone className="h-6 w-6" />
              )}
            </button>
          </div>
        )}

        {isOutgoing && (
          <div className="flex items-center justify-center">
            <button
              type="button"
              aria-label="取消"
              title="取消"
              onClick={() => engine.cancel()}
              className={`flex h-[72px] w-[72px] items-center justify-center rounded-full text-white shadow-xl transition-transform active:scale-90 ${WX_RED}`}
            >
              <PhoneOff className="h-7 w-7" />
            </button>
          </div>
        )}

        {inCall && (
          <div className="flex items-center justify-center gap-14">
            {/* 静音 */}
            <button
              type="button"
              aria-label={s.micMuted ? '取消静音' : '静音'}
              title={s.micMuted ? '取消静音' : '静音'}
              onClick={() => engine.toggleMic()}
              className={`flex h-[60px] w-[60px] items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-90 ${
                s.micMuted ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/25'
              }`}
            >
              {s.micMuted ? (
                <MicOff className="h-6 w-6 text-red-300" />
              ) : (
                <Mic className="h-6 w-6" />
              )}
            </button>
            {/* 挂断（中央大） */}
            <button
              type="button"
              aria-label="挂断"
              title="挂断"
              onClick={() => engine.hangup()}
              className={`flex h-[72px] w-[72px] items-center justify-center rounded-full text-white shadow-xl transition-transform active:scale-90 ${WX_RED}`}
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            {/* 视频：关闭/打开摄像头；语音：对称占位 */}
            {showVideo ? (
              <button
                type="button"
                aria-label={s.camOff ? '打开摄像头' : '关闭摄像头'}
                title={s.camOff ? '打开摄像头' : '关闭摄像头'}
                onClick={() => engine.toggleCam()}
                className={`flex h-[60px] w-[60px] items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-90 ${
                  s.camOff ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/25'
                }`}
              >
                {s.camOff ? (
                  <VideoOff className="h-6 w-6 text-red-300" />
                ) : (
                  <Video className="h-6 w-6" />
                )}
              </button>
            ) : (
              <div className="h-[60px] w-[60px]" />
            )}
          </div>
        )}
      </footer>

      {/* 微信来电呼吸动画 */}
      <style jsx global>{`
        @keyframes wxPulse {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.06);
          }
        }
      `}</style>
    </div>
  )
}
