// 事件名（对照开发文档 §9.2 事件表）

// C → S（客户端 → 服务端）
const CLIENT = {
  MESSAGE_SEND: 'message:send', // {conversationId, type, content, replyToId?, fileMeta?, mentions?}
  MESSAGE_REVOKE: 'message:revoke', // {messageId}
  TYPING: 'typing', // {conversationId, userId, name}
  READ_ACK: 'read:ack', // {conversationId, lastReadAt}
  CONV_JOIN: 'conversation:join', // {conversationId}（骨架扩展：手动入房）
  CONV_LEAVE: 'conversation:leave', // {conversationId}（骨架扩展：手动退房）
  CONV_CREATE: 'conversation:create', // {type, name, memberIds}（骨架扩展：正式由主服务 REST 建群）
}

// S → C（服务端 → 客户端）
const SERVER = {
  MESSAGE_NEW: 'message:new', // {message, conversationId}
  READ_SYNC: 'read:sync', // {conversationId, userIds:[]}
  PRESENCE_SYNC: 'presence:sync', // {conversationId, onlineUserIds:[]}
  CONV_CREATED: 'conv:created', // {conversation}
  NOTIFY_PUSH: 'notify:push', // {title, body, link}
  TODO_PUSH: 'todo:push', // {todoItem}
  ENTITY_CHANGED: 'entity:changed', // {entity, id, at}（20260921 数据同步：实体变更全局广播）
}

// 心跳（应用层；引擎层另有 pingInterval/pingTimeout）
const HEARTBEAT = {
  PING: 'ping',
  PONG: 'pong',
}

// ── 通话信令（SDLC 20260905-im-video-call，仅新增，既有事件零改动）──

// C → S（全部带 ack，除 CALL_SIGNAL candidate 语义火后不管）
const CALL_CLIENT = {
  CALL_INVITE: 'call:invite', // {callId, conversationId, toUserId, media:'video'|'audio'} → ack {ok, iceServers} | {ok:false, error, activeCallId?}
  CALL_ACCEPT: 'call:accept', // {callId} → ack {ok, media, from} | {ok:false, state:'ended'}
  CALL_REJECT: 'call:reject', // {callId, reason?} → ack {ok}
  CALL_CANCEL: 'call:cancel', // {callId} → ack {ok}（幂等）
  CALL_HANGUP: 'call:hangup', // {callId, reason?} → ack {ok}（幂等）
  CALL_SIGNAL: 'call:signal', // {callId, data:{type:'offer'|'answer'|'candidate'|'ice-restart'|'media-state', ...}}；offer/answer 带 ack
  CALL_SYNC: 'call:sync', // {callId} → ack {ok, state, role, peer}（断线重连重绑）
}

// S → C
const CALL_SERVER = {
  CALL_INCOMING: 'call:incoming', // {callId, conversationId, fromUserId, fromName, media, iceServers}
  CALL_ACCEPTED: 'call:accepted', // {callId, byUserId}
  CALL_REJECTED: 'call:rejected', // {callId, reason}
  CALL_CANCELLED: 'call:cancelled', // {callId, reason:'caller-cancel'|'timeout'|'accepted-elsewhere'}
  CALL_ENDED: 'call:ended', // {callId, reason:'bye'|'cancelled'|'timeout'|'rejected'|'busy'|'offline'|'peer-disconnect'|'media-fail'|'glare'}
  CALL_SIGNAL: 'call:signal', // {callId, fromUserId, data}（仅转发对端 bound socket）
}

module.exports = { CLIENT, SERVER, HEARTBEAT, CALL_CLIENT, CALL_SERVER }
