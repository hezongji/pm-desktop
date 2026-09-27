/**
 * 通话类型（SDLC 20260905-im-video-call，spec.md §2/§4）
 */

export type CallMedia = 'video' | 'audio'

/** UI 状态机：idle → outgoing/incoming → connecting → connected → reconnecting → ended → idle */
export type CallState =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended'

export type CallEndReason =
  | 'bye'
  | 'cancelled'
  | 'timeout'
  | 'rejected'
  | 'busy'
  | 'offline'
  | 'peer-disconnect'
  | 'media-fail'
  | 'glare'

export interface PeerInfo {
  userId: string
  name: string
}

export interface IceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface CallSnapshot {
  state: CallState
  callId: string | null
  conversationId: string | null
  media: CallMedia
  /** 实际协商媒体（降级后 = 'audio'） */
  effectiveMedia: CallMedia
  role: 'caller' | 'callee' | null
  peer: PeerInfo | null
  endReason: CallEndReason | null
  micMuted: boolean
  camOff: boolean
  /** 对端是否在发视频（media-state 信令；null=未知） */
  peerVideo: boolean | null
  /** 对端麦克风是否可用（media-state；null=未知） */
  peerAudio: boolean | null
  /** 本机麦克风不可用（WebView 设备限制 → 无声视频通话模式） */
  micUnavailable: boolean
  /** 媒体失败的错误名（media-fail 时置，供 ended 引导文案） */
  mediaError: string | null
}

/** 媒体失败引导文案（微信式可操作提示） */
export const MEDIA_ERROR_HINT: Record<string, string> = {
  NotAllowedError:
    '无法使用摄像头/麦克风。浏览器：地址栏左侧锁图标 → 网站设置 → 允许使用摄像头和麦克风后重试；App：系统设置 → 应用 → 允许相机与麦克风。',
  SecurityError:
    '浏览器拒绝了媒体访问。请确认通过 https 访问，并在网站设置中允许摄像头与麦克风。',
  NotFoundError: '未检测到可用摄像头或麦克风，请检查设备连接后重试。',
  NotReadableError: '摄像头或麦克风正被其他应用占用，请关闭占用应用后重试。',
  OverconstrainedError: '设备不支持所需的采集参数，已尝试降级仍失败。',
}

/** im-server 下发的 signal.data（spec §2 call:signal） */
export type SignalData =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'ice-restart' }
  | { type: 'media-state'; audio: boolean; video: boolean }

export const CALL_END_REASON_TEXT: Record<CallEndReason, string> = {
  bye: '通话已结束',
  cancelled: '对方已取消',
  timeout: '无人接听',
  rejected: '对方已拒绝',
  busy: '对方正在通话中',
  offline: '对方当前不在线',
  'peer-disconnect': '对方连接中断',
  'media-fail': '媒体连接失败',
  glare: '对方正在通话中',
}
