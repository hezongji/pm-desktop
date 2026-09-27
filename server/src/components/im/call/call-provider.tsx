'use client'

/**
 * 通话 Provider（SDLC 20260905-im-video-call，spec.md §4 call-provider.tsx）
 *
 * 挂在 root layout（任何已登录页面可收/打电话）。职责：
 *  - 引擎单例接线：snapshot/streams → React 状态（订阅，不重渲染引擎）
 *  - 登出/无 token 时销毁引擎连接（挂载幂等，StrictMode 双挂载安全）
 *  - 非空闲时全屏渲染 CallOverlay
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useAuthStore } from '@/store/auth'
import { getCallEngine, type CallEngine } from './call-engine'
import type { CallSnapshot } from './types'
import { CallOverlay } from './call-overlay'

interface CallContextValue {
  snapshot: CallSnapshot
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  engine: CallEngine
}

const CallContext = createContext<CallContextValue | null>(null)

export function useCall(): CallContextValue {
  // 未挂 Provider 的环境（单测/异常渲染树）给 idle 缺省，保证调用方安全
  return (
    useContext(CallContext) ?? {
      snapshot: {
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
      },
      localStream: null,
      remoteStream: null,
      engine: getCallEngine(),
    }
  )
}

export function CallProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const engine = getCallEngine()
  const [snapshot, setSnapshot] = useState<CallSnapshot>(engine.getSnapshot())
  const [streams, setStreams] = useState<{
    local: MediaStream | null
    remote: MediaStream | null
  }>(engine.getStreams())

  useEffect(() => {
    const offSnap = engine.onSnapshot(setSnapshot)
    const offStreams = engine.onStreams((local, remote) =>
      setStreams({ local, remote })
    )
    return () => {
      offSnap()
      offStreams()
    }
  }, [engine])

  // 已登录即建立通话连接（被叫收如来电的常驻通道）；登出/未登录销毁
  useEffect(() => {
    if (isAuthenticated) engine.connect()
    else engine.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  return (
    <CallContext.Provider
      value={{
        snapshot,
        localStream: streams.local,
        remoteStream: streams.remote,
        engine,
      }}
    >
      {children}
      {snapshot.state !== 'idle' && (
        <CallOverlay
          snapshot={snapshot}
          localStream={streams.local}
          remoteStream={streams.remote}
          engine={engine}
        />
      )}
    </CallContext.Provider>
  )
}
