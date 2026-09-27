'use client'

/**
 * 通话入口按钮（SDLC 20260905-im-video-call，spec.md §4 call-button.tsx）
 *
 * 仅单聊渲染（isSingle 门控，群聊一期不可呼）。视频/语音两个入口。
 * 引擎非 idle 时禁用（服务端 busy 裁决兜底，双保险防并发呼叫）。
 */

import { Phone, Video } from 'lucide-react'
import type { ConversationItem } from '@/components/im/use-im-hooks'
import { useCall } from './call-provider'
import type { CallMedia } from './types'

export function CallButton({
  conversation,
  meId,
  media,
}: {
  conversation: Pick<ConversationItem, 'id' | 'type' | 'members'>
  meId?: string
  media: CallMedia
}) {
  const { snapshot, engine } = useCall()
  // 一期仅单聊（spec 异常矩阵 #12）
  if (conversation.type !== 'SINGLE') return null
  const other =
    conversation.members.find(m => m.userId !== meId) ?? conversation.members[0]
  if (!other) return null
  const busy = snapshot.state !== 'idle'

  return (
    <button
      type="button"
      disabled={busy}
      title={media === 'video' ? '视频通话' : '语音通话'}
      aria-label={media === 'video' ? '视频通话' : '语音通话'}
      data-call-media={media}
      onClick={() =>
        void engine.startOutgoing({
          conversationId: conversation.id,
          peer: { userId: other.userId, name: other.name },
          media,
        })
      }
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {media === 'video' ? (
        <Video className="h-[18px] w-[18px]" />
      ) : (
        <Phone className="h-4 w-4" />
      )}
    </button>
  )
}
