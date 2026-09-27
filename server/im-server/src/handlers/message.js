const { CLIENT, SERVER } = require('../events')
const { createSlidingWindowLimiter } = require('../ratelimit')

// ── 消息内容校验（20260908 生产审计 P2-1）──
// 原实现直接落库 payload.content，服务端无兜底：空串与 300KB 长文本均可入库。
const MAX_TEXT_LEN = 5000 // 文本消息上限（字符）
const MAX_STRUCTURED_LEN = 20000 // 卡片/文件/系统等结构化消息上限（字符）
const TEXT_ONLY_TYPES = new Set(['TEXT'])

// ── 消息发送限流（20260908 生产审计 P2-2）：每用户 20 条 / 10 秒 ──
const MESSAGE_RATE = { windowMs: 10_000, max: 20 }
const messageLimiter = createSlidingWindowLimiter(MESSAGE_RATE)

/**
 * 消息处理：message:send（校验成员 → 落库 → 广播）、message:revoke。
 * @param {object} ctx { io, store, config, log }
 */
function registerMessageHandlers(ctx, socket) {
  const { io, store, config } = ctx
  const user = socket.data.user
  const REVOKE_WINDOW_MS = 2 * 60 * 1000 // §9.2：撤回窗口 2 分钟

  socket.on(CLIENT.MESSAGE_SEND, async (payload = {}, ack) => {
    const reply = (ok, extra) =>
      typeof ack === 'function' ? ack({ ok, ...extra }) : null
    try {
      const { conversationId } = payload
      if (!conversationId)
        return reply(false, { error: 'missing conversationId' })

      // ★ P2-1：服务端内容校验（不依赖前端拦截）
      const type = String(payload.type || 'TEXT').toUpperCase()
      if (payload.content != null && typeof payload.content !== 'string') {
        return reply(false, {
          error: 'content 必须为字符串',
          code: 'CONTENT_TYPE_INVALID',
        })
      }
      const content = typeof payload.content === 'string' ? payload.content : ''
      const maxLen = TEXT_ONLY_TYPES.has(type)
        ? MAX_TEXT_LEN
        : MAX_STRUCTURED_LEN
      if (content.length > maxLen) {
        return reply(false, {
          error: `消息内容过长（${content.length} > ${maxLen} 字符）`,
          code: 'CONTENT_TOO_LONG',
        })
      }
      if (TEXT_ONLY_TYPES.has(type) && content.trim() === '') {
        return reply(false, {
          error: '消息内容不能为空',
          code: 'CONTENT_EMPTY',
        })
      }

      // ★ P2-2：每用户发送频率限制（先于成员查询，避免无效库查询被刷）
      const gate = messageLimiter.check(user.userId)
      if (!gate.ok) {
        return reply(false, {
          error: `发送过于频繁，请 ${Math.ceil(gate.retryAfterMs / 1000)} 秒后重试`,
          code: 'RATE_LIMITED',
          retryAfterMs: gate.retryAfterMs,
        })
      }

      const isMember = await store.isMember(conversationId, user.userId)
      if (!isMember) return reply(false, { error: 'forbidden: not a member' })

      const message = await store.createMessage({
        conversationId,
        senderId: user.userId,
        senderName: user.name || user.email || user.userId,
        type,
        content,
        replyToId: payload.replyToId ?? null,
        fileMeta: payload.fileMeta ?? null,
        mentions: payload.mentions ?? null,
      })
      await store.touchConversation(conversationId)

      // 广播到目标会话房间
      io.to(config.ROOM_CONV(conversationId)).emit(SERVER.MESSAGE_NEW, {
        message,
        conversationId,
      })

      // @提及 → 落库 Notification + TodoItem，并推 notify:push + todo:push（§9.2 message:new）
      if (Array.isArray(payload.mentions) && payload.mentions.length) {
        const senderLabel = user.name || user.email || user.userId
        const link = `/messages?conversation=${conversationId}`
        for (const mentionedId of payload.mentions) {
          if (!mentionedId) continue

          // 1) Notification 落库 + notify:push
          try {
            await store.writeNotification({
              userId: mentionedId,
              type: 'MENTION',
              title: '有人@你',
              body: `${senderLabel} 在会话中提到了你`,
              link,
            })
          } catch (e) {
            ctx.log.error('[message:send] writeNotification:', e.message)
          }
          io.to(config.ROOM_USER(mentionedId)).emit(SERVER.NOTIFY_PUSH, {
            title: '有人@你',
            body: `${senderLabel} 在会话中提到了你`,
            link,
          })

          // 2) TodoItem 落库 + todo:push
          // v1.2 W1 守卫：mentions>20（@所有人/大群）只写 Notification 跳过 TodoItem，
          // 避免待办洪泛（Notification 保留不动）
          if (
            Array.isArray(payload.mentions) &&
            payload.mentions.length <= 20
          ) {
            try {
              const todoItem = await store.writeTodo({
                userId: mentionedId,
                title: `${senderLabel} 在会话中@了你`,
                sourceType: 'MESSAGE',
                sourceId: message.id,
                link,
                priority: 'MEDIUM',
              })
              io.to(config.ROOM_USER(mentionedId)).emit(SERVER.TODO_PUSH, {
                todoItem,
              })
            } catch (e) {
              ctx.log.error('[message:send] writeTodo:', e.message)
            }
          }
        }
      }

      return reply(true, { message })
    } catch (e) {
      ctx.log.error('[message:send]', e.message)
      return reply(false, { error: e.message })
    }
  })

  socket.on(CLIENT.MESSAGE_REVOKE, async (payload = {}, ack) => {
    const reply = (ok, extra) =>
      typeof ack === 'function' ? ack({ ok, ...extra }) : null
    try {
      const { messageId } = payload
      if (!messageId) return reply(false, { error: 'missing messageId' })

      const existing = await store.getMessage(messageId)
      if (!existing) return reply(false, { error: 'message not found' })
      // §9.2：仅发送者本人可撤回自己的消息
      if (existing.senderId !== user.userId) {
        return reply(false, { error: 'forbidden: not the sender' })
      }
      if (existing.revoked) {
        return reply(false, { error: 'message already revoked' })
      }
      // §9.2：2 分钟内可撤回，超时拒绝
      const elapsed = Date.now() - new Date(existing.createdAt).getTime()
      if (elapsed > REVOKE_WINDOW_MS) {
        return reply(false, { error: 'exceed 2 minutes revoke window' })
      }

      const message = await store.revokeMessage(messageId)
      io.to(config.ROOM_CONV(message.conversationId)).emit(SERVER.MESSAGE_NEW, {
        message,
        conversationId: message.conversationId,
        revoked: true,
      })
      return reply(true, { message })
    } catch (e) {
      ctx.log.error('[message:revoke]', e.message)
      return reply(false, { error: e.message })
    }
  })
}

module.exports = { registerMessageHandlers }
