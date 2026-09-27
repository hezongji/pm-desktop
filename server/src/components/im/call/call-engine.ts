'use client'

/**
 * 通话引擎（SDLC 20260905-im-video-call，spec.md §4 call-engine.ts）
 *
 * 框架无关单例：自持专用 socket（token 缺省不连）、RTCPeerConnection 生命周期、
 * 媒体获取降级链（video→audio→media-fail）、终态资源清理清单、重连看门狗。
 * React 侧经 CallProvider 订阅 snapshot/streams；E2E 经 window.__pmCall 内省。
 *
 * 关键不变量：
 *  - 任何终态必须走 _finish() → cleanupAll()（spec 资源清理清单单一收敛点，防"卡在通话界面"）
 *  - offer 恒由 caller 创建（免 glare 协商）；ice-restart 也由 caller 发起
 *  - candidate 在 remoteDescription 就绪前入队列
 */

import { io, type Socket } from 'socket.io-client'
import type {
  CallMedia,
  CallSnapshot,
  IceServerConfig,
  PeerInfo,
  SignalData,
} from './types'
import {
  playConnectedBlip,
  startRingtone,
  startTitleFlash,
  stopRingtone,
  stopTitleFlash,
} from './ringtone'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3002'
/** 客户端引擎构建号（media-fail 上报携带，日志区分代码版本） */
const ENGINE_BUILD = 'call-20260906-3'

/** 连接态看门狗：disconnected 后等待恢复的时长 */
const RECONNECT_WATCHDOG_MS = 20000
/** 接通前看门狗：connecting 停留上限（防对端静默失败导致悬挂） */
const CONNECTING_WATCHDOG_MS = 15000
/** ended 提示停留后自动回 idle */
const ENDED_TO_IDLE_MS = 1600

const IDLE_SNAPSHOT: CallSnapshot = {
  state: 'idle',
  callId: null,
  conversationId: null,
  media: 'video',
  effectiveMedia: 'video',
  role: null,
  peer: null,
  endReason: null,
  micMuted: false,
  camOff: false,
  peerVideo: null,
  peerAudio: null,
  micUnavailable: false,
  mediaError: null,
}

export interface CallTarget {
  conversationId: string
  peer: PeerInfo
  media: CallMedia
}

type SnapshotListener = (s: CallSnapshot) => void
type StreamsListener = (
  local: MediaStream | null,
  remote: MediaStream | null
) => void

class CallEngine {
  private socket: Socket | null = null
  private snapshot: CallSnapshot = { ...IDLE_SNAPSHOT }
  private snapListeners = new Set<SnapshotListener>()
  private streamListeners = new Set<StreamsListener>()

  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private iceServers: IceServerConfig[] = []

  /** 进行中通话的标识（含 connecting；ended 后保留到回 idle） */
  private endedTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectWatchdog: ReturnType<typeof setTimeout> | null = null
  private connectingWatchdog: ReturnType<typeof setTimeout> | null = null
  private connectingExtended = false
  private pendingIncoming:
    | (SpecIncoming & { iceServers: IceServerConfig[] })
    | null = null

  /** E2E/调试探针 */
  debug = false

  // ── 订阅 ──
  onSnapshot(cb: SnapshotListener) {
    this.snapListeners.add(cb)
    cb(this.snapshot)
    return () => this.snapListeners.delete(cb)
  }
  onStreams(cb: StreamsListener) {
    this.streamListeners.add(cb)
    cb(this.localStream, this.remoteStream)
    return () => this.streamListeners.delete(cb)
  }
  getSnapshot() {
    return this.snapshot
  }
  getStreams() {
    return { local: this.localStream, remote: this.remoteStream }
  }

  private setSnap(patch: Partial<CallSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.snapListeners.forEach(l => l(this.snapshot))
  }

  /** Android 壳常亮桥（特性检测；浏览器/旧壳无此桥时静默） */
  private setKeepScreenOn(on: boolean) {
    if (typeof window === 'undefined') return
    try {
      ;(
        window as unknown as {
          AndroidBridge?: { setKeepScreenOn?: (b: boolean) => void }
        }
      ).AndroidBridge?.setKeepScreenOn?.(on)
    } catch {}
  }

  // ── socket（自持专用连接）──
  private ensureSocket(): Socket | null {
    if (typeof window === 'undefined') return null
    const token = localStorage.getItem('auth-token')
    if (!token) return null
    if (this.socket) return this.socket
    const socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
    })
    this.socket = socket

    socket.on(
      'call:incoming',
      (p: SpecIncoming & { iceServers?: IceServerConfig[] }) => {
        // 忙线自保：引擎非 idle 一律不响应（理论上有服务端 busy 裁决，双保险）
        if (this.snapshot.state !== 'idle') return
        this.pendingIncoming = { ...p, iceServers: p.iceServers ?? [] }
        this.iceServers = p.iceServers ?? []
        this.setSnap({
          state: 'incoming',
          callId: p.callId,
          conversationId: p.conversationId,
          media: p.media === 'audio' ? 'audio' : 'video',
          effectiveMedia: p.media === 'audio' ? 'audio' : 'video',
          role: 'callee',
          peer: { userId: p.fromUserId, name: p.fromName },
          endReason: null,
          micMuted: false,
          camOff: false,
          peerVideo: null,
          peerAudio: null,
          micUnavailable: false,
          mediaError: null,
        })
        startRingtone('incoming')
        startTitleFlash(
          `来自 ${p.fromName} 的${p.media === 'video' ? '视频' : '语音'}通话`
        )
      }
    )

    socket.on('call:accepted', () => {
      // caller 收到接通 → 建 pc + 发 offer
      if (this.snapshot.state !== 'outgoing' || this.snapshot.role !== 'caller')
        return
      void this.callerStartMedia()
    })

    socket.on('call:rejected', () => {
      if (this.snapshot.state === 'outgoing') this._finish('rejected')
    })

    socket.on('call:cancelled', (p: { reason?: string }) => {
      if (this.snapshot.state === 'incoming') {
        const reason: NonNullable<CallSnapshot['endReason']> =
          p?.reason === 'accepted-elsewhere' ? 'busy' : 'cancelled'
        this._finish(reason)
      }
    })

    socket.on('call:ended', (p: { reason?: string }) => {
      // 服务端权威终态：非 idle 即收敛（幂等）
      if (this.snapshot.state !== 'idle') {
        this._finish(
          (p?.reason as NonNullable<CallSnapshot['endReason']>) || 'bye',
          true
        )
      }
    })

    socket.on(
      'call:signal',
      (p: { callId: string; fromUserId: string; data: SignalData }) => {
        if (this.snapshot.callId !== p.callId) return
        // 状态守卫：非活跃协商态的信号丢弃（防 ended 后在途信号创建幻影 pc 污染下一次通话）
        if (
          !['connecting', 'connected', 'reconnecting'].includes(
            this.snapshot.state
          )
        )
          return
        void this.handleSignal(p.data)
      }
    )

    socket.on('connect', () => {
      // 断线重连后恢复信令绑定（宽限期内）
      const s = this.snapshot
      if (
        s.callId &&
        (s.state === 'connected' ||
          s.state === 'reconnecting' ||
          s.state === 'connecting')
      ) {
        socket.emit(
          'call:sync',
          { callId: s.callId },
          (ack?: { ok?: boolean }) => {
            if (ack?.ok) this.clearReconnectWatchdog()
          }
        )
      }
    })

    socket.on('connect_error', (err: Error) => {
      if (err?.message === 'unauthorized') {
        // token 失效：与 use-im-hooks 同策略，跳登录
        const next = encodeURIComponent(
          window.location.pathname + window.location.search
        )
        window.location.href = `/login?next=${next}`
      }
    })

    return socket
  }

  /** 断开并释放 socket（登出场景；无活动连接时 no-op） */
  destroy() {
    this.cleanupAll()
    this.socket?.disconnect()
    this.socket = null
  }

  /**
   * 建立通话 socket（已认证时由 Provider 挂载调用）。
   * 被叫收如来电依赖常驻连接；幂等（已连接则复用）。
   */
  connect(): Socket | null {
    return this.ensureSocket()
  }

  // ── 对外动作 ──

  /** 发起呼叫 */
  async startOutgoing(target: CallTarget) {
    if (this.snapshot.state !== 'idle') return
    const socket = this.ensureSocket()
    if (!socket) return
    this.setSnap({
      state: 'outgoing',
      callId: null, // invite ack 后由服务端路由，本地先生成用于事件关联
      conversationId: target.conversationId,
      media: target.media,
      effectiveMedia: target.media,
      role: 'caller',
      peer: target.peer,
      endReason: null,
      micMuted: false,
      camOff: false,
      peerVideo: null,
      peerAudio: null,
      micUnavailable: false,
      mediaError: null,
    })
    startRingtone('ringback')
    const callId = crypto.randomUUID()
    this.setSnap({ callId })
    const ack = await this.emitAck('call:invite', {
      callId,
      conversationId: target.conversationId,
      toUserId: target.peer.userId,
      media: target.media,
    })
    if (!ack?.ok) {
      const reason = (ack?.error as CallSnapshot['endReason']) || 'offline'
      this._finish(reason === 'glare' ? 'glare' : reason)
      return
    }
    this.iceServers = ack.iceServers ?? []
    // 等待 call:accepted（callerStartMedia 在 socket 事件里触发）
  }

  /** 接听来电 */
  async accept() {
    const s = this.snapshot
    if (s.state !== 'incoming' || !s.callId || !this.socket) return
    stopRingtone()
    stopTitleFlash()
    this.setSnap({ state: 'connecting' })
    const ack = await this.emitAck('call:accept', { callId: s.callId })
    if (!ack?.ok) {
      this._finish('busy') // stale（对方已取消/超时等）
      return
    }
    this.iceServers = this.pendingIncoming?.iceServers ?? this.iceServers
    this.pendingIncoming = null
    await this.calleePrepare(
      s.callId,
      ack.media === 'audio' ? 'audio' : 'video'
    )
  }

  /** 拒接 */
  reject() {
    const s = this.snapshot
    if (s.state !== 'incoming' || !s.callId) return
    void this.socket?.emit('call:reject', { callId: s.callId }, () => {})
    this._finish('rejected', true)
  }

  /** 呼叫方取消（振铃期）；接通协商期（connecting）也可取消——走 hangup 幂等终止 */
  cancel() {
    const s = this.snapshot
    if (!s.callId) return
    if (s.state === 'outgoing') {
      void this.socket?.emit('call:cancel', { callId: s.callId }, () => {})
      this._finish('cancelled', true)
      return
    }
    if (s.state === 'connecting') {
      void this.socket?.emit(
        'call:hangup',
        { callId: s.callId, reason: 'bye' },
        () => {}
      )
      this._finish('cancelled', true)
    }
  }

  /** 挂断（任意活动态） */
  hangup() {
    const s = this.snapshot
    if (s.state === 'idle' || !s.callId) return
    if (s.state === 'outgoing') return this.cancel()
    if (s.state === 'incoming') return this.reject()
    void this.socket?.emit(
      'call:hangup',
      { callId: s.callId, reason: 'bye' },
      () => {}
    )
    this._finish('bye', true)
  }

  /** 麦克风静音切换（返回切换后的状态） */
  toggleMic(): boolean {
    const next = !this.snapshot.micMuted
    this.localStream?.getAudioTracks().forEach(t => (t.enabled = !next))
    this.setSnap({ micMuted: next })
    this.emitMediaState()
    return next
  }

  /** 摄像头前后翻转（≥2 摄像头可用）；失败/单摄返回 false */
  async switchCamera(): Promise<boolean> {
    if (
      this.snapshot.state !== 'connected' ||
      this.snapshot.effectiveMedia !== 'video'
    )
      return false
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cams = devices.filter(d => d.kind === 'videoinput')
      if (cams.length < 2) return false
      const nextFacing = this.facing === 'user' ? 'environment' : 'user'
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: nextFacing,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      })
      const newTrack = stream.getVideoTracks()[0]
      const oldTrack = this.localStream?.getVideoTracks()[0]
      if (this.pc) {
        const sender = this.pc
          .getSenders()
          .find(snd => snd.track?.kind === 'video')
        if (sender) {
          await sender.replaceTrack(newTrack)
          oldTrack?.stop()
          // 同步替换 localStream 内轨道（本端小窗画面跟随）
          if (this.localStream && oldTrack) {
            this.localStream.removeTrack(oldTrack)
            this.localStream.addTrack(newTrack)
          }
          this.facing = nextFacing
          // 通知 UI
          this.streamListeners.forEach(l =>
            l(this.localStream, this.remoteStream)
          )
          return true
        }
      }
      newTrack.stop()
      return false
    } catch {
      return false
    }
  }

  /** 当前 facingMode */
  facing: 'user' | 'environment' = 'user'

  /** 摄像头开关切换（返回切换后的状态） */
  toggleCam(): boolean {
    const next = !this.snapshot.camOff
    this.localStream?.getVideoTracks().forEach(t => (t.enabled = !next))
    this.setSnap({ camOff: next })
    this.emitMediaState()
    return next
  }

  // ── 内部：WebRTC ──

  private emitAck(
    ev: string,
    payload: unknown
  ): Promise<{
    ok?: boolean
    error?: string
    iceServers?: IceServerConfig[]
    media?: string
    from?: PeerInfo
    conversationId?: string
    state?: string
  } | null> {
    return new Promise(resolve => {
      if (!this.socket) return resolve(null)
      const timer = setTimeout(() => resolve(null), 8000) // ack 超时兜底（断线时永不返回）
      this.socket.emit(ev, payload, (ack: unknown) => {
        clearTimeout(timer)
        resolve(ack as never)
      })
    })
  }

  private emitSignal(data: SignalData) {
    const callId = this.snapshot.callId
    if (!callId || !this.socket) return
    if (data.type === 'offer' || data.type === 'answer') {
      void this.emitAck('call:signal', { callId, data })
    } else {
      this.socket.emit('call:signal', { callId, data })
    }
  }

  private emitMediaState() {
    this.emitSignal({
      type: 'media-state',
      audio: !this.snapshot.micMuted && !this.snapshot.micUnavailable,
      video: this.snapshot.effectiveMedia === 'video' && !this.snapshot.camOff,
    })
  }

  /**
   * 媒体获取降级链（20260906 加固）：
   *   video：带全约束 → 去音频处理约束 → 去视频约束 → 降级纯音频（带约束 → 去约束）→ 抛错
   * 背景：部分 Android 设备/WebView 对 回声消除+降噪+自动增益 组合或高分辨率约束
   * 会抛 NotReadableError("Could not start audio source")——逐级降级可显著提高接通率。
   */
  private async acquireMedia(
    prefer: CallMedia
  ): Promise<{
    stream: MediaStream
    effective: CallMedia
    micUnavailable?: boolean
  }> {
    const gUM = navigator.mediaDevices?.getUserMedia?.bind(
      navigator.mediaDevices
    )
    if (!gUM) throw new Error('getUserMedia unavailable')

    const AUDIO_STRICT = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
    const VIDEO_STRICT = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 15, max: 24 },
      facingMode: 'user' as const,
    }

    const attempt = async (
      audio: MediaTrackConstraints | boolean,
      video: MediaTrackConstraints | boolean
    ) => {
      try {
        return { stream: await gUM({ audio, video }), ok: true as const }
      } catch (e) {
        this.lastMediaError = e instanceof Error ? e : new Error(String(e))
        return { ok: false as const }
      }
    }

    if (prefer === 'video') {
      // 1) 全约束视频+音频
      let r = await attempt(AUDIO_STRICT, VIDEO_STRICT)
      if (r.ok) return { stream: r.stream!, effective: 'video' }
      // 2) 去音频处理约束（NotReadableError audio source 高频原因）
      r = await attempt(true, VIDEO_STRICT)
      if (r.ok) return { stream: r.stream!, effective: 'video' }
      // 3) 去视频约束（分辨率/帧率不支持）
      r = await attempt(AUDIO_STRICT, true)
      if (r.ok) return { stream: r.stream!, effective: 'video' }
      r = await attempt(true, true)
      if (r.ok) return { stream: r.stream!, effective: 'video' }
      // 4) 无声视频（部分机型 WebView 麦克风完全不可用：保画面不保声音，UI 明示）
      r = await attempt(false, VIDEO_STRICT)
      if (r.ok)
        return { stream: r.stream!, effective: 'video', micUnavailable: true }
      r = await attempt(false, true)
      if (r.ok)
        return { stream: r.stream!, effective: 'video', micUnavailable: true }
      // 5) 降级纯音频
    }
    // 纯音频：带处理约束 → 去约束
    let ra = await attempt(AUDIO_STRICT, false)
    if (ra.ok) return { stream: ra.stream!, effective: 'audio' }
    ra = await attempt(true, false)
    if (ra.ok) return { stream: ra.stream!, effective: 'audio' }
    throw new Error('getUserMedia failed')
  }

  private createPc(): RTCPeerConnection {
    if (this.pc) return this.pc
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers.length
        ? this.iceServers
        : [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    this.pc = pc
    this.localStream
      ?.getTracks()
      .forEach(t => pc.addTrack(t, this.localStream!))
    pc.ontrack = ev => {
      this.remoteStream = ev.streams[0] ?? new MediaStream([ev.track])
      this.streamListeners.forEach(l => l(this.localStream, this.remoteStream))
    }
    pc.onicecandidate = ev => {
      if (ev.candidate)
        this.emitSignal({ type: 'candidate', candidate: ev.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (this.snapshot.state === 'idle' || this.snapshot.state === 'ended')
        return
      switch (pc.connectionState) {
        case 'connected':
          this.clearReconnectWatchdog()
          this.clearConnectingWatchdog()
          this.connectingExtended = false
          if (this.snapshot.state !== 'connected') {
            this.setSnap({ state: 'connected' })
            stopRingtone()
            playConnectedBlip()
            this.setKeepScreenOn(true)
          }
          break
        case 'disconnected':
          // ICE 短暂抖动：进 reconnecting + 看门狗；caller 触发 ice-restart
          if (this.snapshot.state === 'connected') {
            this.setSnap({ state: 'reconnecting' })
            this.armReconnectWatchdog()
            if (this.snapshot.role === 'caller') {
              void this.pc?.createOffer({ iceRestart: true }).then(o => {
                void this.pc?.setLocalDescription(o)
                this.emitSignal({ type: 'offer', sdp: o.sdp ?? '' })
              })
            }
          }
          break
        case 'failed':
          void this._finishAsync('media-fail')
          break
      }
    }
    return pc
  }

  private armReconnectWatchdog() {
    this.clearReconnectWatchdog()
    this.reconnectWatchdog = setTimeout(() => {
      if (this.pc?.connectionState !== 'connected') this._finish('media-fail')
    }, RECONNECT_WATCHDOG_MS)
  }

  private clearReconnectWatchdog() {
    if (this.reconnectWatchdog) {
      clearTimeout(this.reconnectWatchdog)
      this.reconnectWatchdog = null
    }
  }

  /**
   * 接通前看门狗：connecting 停留超时（对端媒体失败静默等）→ 终止防悬挂。
   * ICE 仍在 checking（跨网 TURN-TCP 桥接握手可达 20-30s）时宽限一轮，不硬杀。
   */
  private armConnectingWatchdog() {
    this.clearConnectingWatchdog()
    this.connectingWatchdog = setTimeout(() => {
      if (this.snapshot.state !== 'connecting') return
      const ice = this.pc?.iceConnectionState
      if (ice === 'checking' && !this.connectingExtended) {
        this.connectingExtended = true
        this.armConnectingWatchdog()
        return
      }
      this._finish('media-fail')
    }, CONNECTING_WATCHDOG_MS)
  }

  private clearConnectingWatchdog() {
    if (this.connectingWatchdog) {
      clearTimeout(this.connectingWatchdog)
      this.connectingWatchdog = null
    }
  }

  /** caller：收到 accepted → 取媒体 → 建 pc → 发 offer */
  private async callerStartMedia() {
    const s = this.snapshot
    if (!s.callId) return
    this.setSnap({ state: 'connecting' })
    try {
      // 先取媒体（首次通话的系统权限弹窗可能长停——看门狗不得在此期间计时）
      const { stream, effective, micUnavailable } = await this.acquireMedia(
        s.media
      )
      // 竞态：取媒体期间通话可能已被对端取消/超时终止 → 立即释放，绝不泄漏占用摄像头
      if (
        !['connecting', 'connected', 'reconnecting'].includes(
          this.snapshot.state
        )
      ) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      this.armConnectingWatchdog()
      this.localStream = stream
      this.setSnap({
        effectiveMedia: effective,
        micUnavailable: !!micUnavailable,
      })
      this.streamListeners.forEach(l => l(this.localStream, this.remoteStream))
      const pc = this.createPc()
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const ack = await this.emitAck('call:signal', {
        callId: s.callId,
        data: { type: 'offer', sdp: offer.sdp ?? '' },
      })
      if (!ack?.ok) this._finish('media-fail')
    } catch {
      this.notifyMediaFail()
      this._finish('media-fail')
    }
  }

  /** callee：accept ack 后取媒体并预建 pc（等 caller offer 到达） */
  private async calleePrepare(callId: string, media: CallMedia) {
    void callId
    try {
      // 同 callerStartMedia：权限弹窗期间不计时
      const { stream, effective, micUnavailable } =
        await this.acquireMedia(media)
      // 竞态：取媒体期间来电可能已被取消/超时 → 立即释放（防泄漏占麦克风/摄像头）
      if (
        !['connecting', 'connected', 'reconnecting'].includes(
          this.snapshot.state
        )
      ) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      this.armConnectingWatchdog()
      this.localStream = stream
      this.setSnap({
        effectiveMedia: effective,
        micUnavailable: !!micUnavailable,
      })
      this.streamListeners.forEach(l => l(this.localStream, this.remoteStream))
      const pc = this.createPc()
      // 竞态防护：offer 先于本端媒体就绪到达时 createPc 已建出无轨道 pc，
      // 此处必须补挂本端轨道，否则被叫永远不发媒体
      for (const track of stream.getTracks()) {
        if (!pc.getSenders().some(s => s.track?.kind === track.kind)) {
          pc.addTrack(track, stream)
        }
      }
    } catch {
      // 取媒体失败 → 上报错误详情（服务端日志），再终止
      this.notifyMediaFail()
      this._finish('media-fail', true)
    }
  }

  private async handleSignal(data: SignalData) {
    if (
      !['connecting', 'connected', 'reconnecting'].includes(this.snapshot.state)
    )
      return
    if (data.type === 'offer') {
      const pc = this.createPc()
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
      await this.flushPendingCandidates()
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this.emitSignal({ type: 'answer', sdp: answer.sdp ?? '' })
    } else if (data.type === 'answer') {
      if (this.pc && this.pc.signalingState !== 'stable') {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        await this.flushPendingCandidates()
      }
    } else if (data.type === 'candidate') {
      if (this.pc?.remoteDescription) {
        await this.pc.addIceCandidate(data.candidate).catch(() => {})
      } else {
        this.pendingCandidates.push(data.candidate)
      }
    } else if (data.type === 'ice-restart') {
      // callee 收 restart：等 caller 的新 offer 即可（candidate 队列已兜底）
    } else if (data.type === 'media-state') {
      // 对端媒体状态可见：降级纯音频/关摄像头时本端切头像布局（spec §4 降级"提示对方"）
      const peerVideo = data.video !== false
      const peerAudio = data.audio !== false
      this.setSnap({ peerVideo, peerAudio })
    }
  }

  private async flushPendingCandidates() {
    if (!this.pc) return
    const list = this.pendingCandidates
    this.pendingCandidates = []
    for (const c of list) {
      await this.pc.addIceCandidate(c).catch(() => {})
    }
  }

  // ── 终态：单一收敛点（spec 资源清理清单）──

  /**
   * @param reason 终态原因（UI 展示用）
   * @param localDone 本次终态由本端主动产生（不再等服务端 ended）
   */
  private async reportMediaDiagnostics() {
    // 收集 ICE 诊断（候选类型/选中对/失败原因），供服务端日志定位 NAT/中继问题
    try {
      const pc = this.pc
      if (!pc) return 'pc=null'
      const stats = await pc.getStats()
      const lines: string[] = []
      const cands = new Map<string, string>()
      stats.forEach(r => {
        if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
          cands.set(
            r.id,
            `${r.candidateType}/${r.protocol}${r.address ? '@' + r.address : ''}`
          )
        }
        if (r.type === 'candidate-pair') {
          const state = r.state
          const pair = `${cands.get(r.localCandidateId) ?? '?'} -> ${cands.get(r.remoteCandidateId) ?? '?'}`
          if (state === 'failed' || r.selected) lines.push(`[${state}] ${pair}`)
        }
      })
      const gatherer = pc.iceConnectionState
      lines.push(`iceConnectionState=${gatherer}`)
      return lines.join(' | ') || 'no pairs'
    } catch (e) {
      return `diag-error:${String(e).slice(0, 60)}`
    }
  }

  private async _finishAsync(reason: NonNullable<CallSnapshot['endReason']>) {
    const diag = await this.reportMediaDiagnostics()
    this.notifyMediaFail(diag)
    this._finish(reason, true)
  }

  /** media-fail 上报：错误名+UA+ICE 诊断（服务端日志定位用） */
  private notifyMediaFail(diag?: string) {
    try {
      const callId = this.snapshot.callId
      if (!this.socket || !callId) return
      this.socket.emit('call:hangup', {
        callId,
        reason: 'media-fail',
        diag:
          diag ||
          `error=${this.lastMediaError?.name || '?'}:${(this.lastMediaError?.message || '').slice(0, 120)}`,
        ua: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(
          0,
          160
        ),
        build: ENGINE_BUILD,
      })
    } catch {}
  }

  /** acquireMedia 失败原因暂存（notifyMediaFail 上报用） */
  private lastMediaError: Error | null = null

  /** 权限类错误（需要引导文案 + 更长停留） */
  private isPermissionError(): boolean {
    const n = this.lastMediaError?.name
    return (
      !!n &&
      [
        'NotAllowedError',
        'SecurityError',
        'NotFoundError',
        'NotReadableError',
        'OverconstrainedError',
      ].includes(n)
    )
  }

  /** ended 页"知道了"，立即回 idle（用户读完引导主动关闭） */
  dismissEnded() {
    if (this.endedTimer) {
      clearTimeout(this.endedTimer)
      this.endedTimer = null
    }
    this.setSnap({ ...IDLE_SNAPSHOT })
  }

  private _finish(
    reason: NonNullable<CallSnapshot['endReason']>,
    localDone = false
  ) {
    const prevState = this.snapshot.state
    const callId = this.snapshot.callId
    // 服务端可能仍视通话为活跃（本地媒体失败/放弃）→ 主动挂断通知（幂等，无害）
    if (
      callId &&
      prevState !== 'idle' &&
      prevState !== 'ended' &&
      this.socket
    ) {
      const payload: Record<string, unknown> = {
        callId,
        reason: reason === 'media-fail' ? 'media-fail' : 'bye',
      }
      if (reason === 'media-fail') {
        payload.diag = `error=${this.lastMediaError?.name || '?'}:${(this.lastMediaError?.message || '').slice(0, 120)}`
        payload.ua = (
          typeof navigator !== 'undefined' ? navigator.userAgent : ''
        ).slice(0, 160)
        payload.build = ENGINE_BUILD
      }
      this.socket.emit('call:hangup', payload)
    }
    const wasIdle = prevState === 'idle'
    const mediaError =
      reason === 'media-fail' ? (this.lastMediaError?.name ?? null) : null
    this.cleanupAll()
    if (wasIdle) return
    this.setSnap({ state: 'ended', endReason: reason, mediaError })
    void localDone
    const holdMs = mediaError ? ENDED_TO_IDLE_MS * 2.4 : ENDED_TO_IDLE_MS
    this.endedTimer = setTimeout(() => {
      this.endedTimer = null
      this.setSnap({ ...IDLE_SNAPSHOT })
    }, holdMs)
  }

  /** 清理清单：pc/track/流引用/铃声/定时器/提示通道 */
  private cleanupAll() {
    stopRingtone()
    stopTitleFlash()
    this.setKeepScreenOn(false)
    this.clearReconnectWatchdog()
    this.clearConnectingWatchdog()
    this.connectingExtended = false
    if (this.endedTimer) {
      clearTimeout(this.endedTimer)
      this.endedTimer = null
    }
    try {
      this.pc?.getSenders().forEach(s => {
        try {
          s.replaceTrack(null)
        } catch {}
      })
      this.pc?.close()
    } catch {}
    this.pc = null
    this.localStream?.getTracks().forEach(t => t.stop())
    this.localStream = null
    this.remoteStream = null
    this.pendingCandidates = []
    this.pendingIncoming = null
    this.streamListeners.forEach(l => l(null, null))
  }
}

interface SpecIncoming {
  callId: string
  conversationId: string
  fromUserId: string
  fromName: string
  media: CallMedia
}

/** 进程级单例（StrictMode 双挂载幂等） */
let instance: CallEngine | null = null

export function getCallEngine(): CallEngine {
  if (!instance) {
    instance = new CallEngine()
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __pmCall?: CallEngine }).__pmCall = instance
    }
  }
  return instance
}

export type { CallEngine }
