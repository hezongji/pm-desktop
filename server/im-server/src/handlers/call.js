const crypto = require('crypto')
const { CALL_CLIENT, CALL_SERVER } = require('../events')
const presence = require('../presence')

/**
 * 通话信令域（SDLC 20260905-im-video-call，spec.md §2/§3）
 *
 * 服务端权威内存态（与 presence 同构生命周期，单实例约束，不落库）：
 *   calls  Map<callId, Call>   通话记录（ENDED 保留 TTL 后 GC，终态广播幂等）
 *   busyOf Map<userId, callId> 忙线索引（O(1) 裁决）
 *
 * 状态机：RINGING → IN_CALL → ENDED
 *   - RINGING 45s 服务端超时（IM_CALL_RING_TIMEOUT_MS）
 *   - IN_CALL 中 bound socket 断开挂 10s 宽限（IM_CALL_GRACE_MS），期内 call:sync 重绑恢复
 *   - RINGING 侧断开立即取消（无宽限）
 * 多设备：invite/终态走 user:{id} 房间全设备；accept 首个到达原子胜出，其余设备收
 *   cancelled{accepted-elsewhere}；SDP/candidate 仅转发对端 bound socket（物理隔离不串音）
 * glare：invite 时任一方 busy → 后到者收 busy（一期不自动转接，spec §7-3）
 */

const RINGING = 'RINGING'
const IN_CALL = 'IN_CALL'
const ENDED = 'ENDED'

/** 进程级单例状态 */
const calls = new Map()
const busyOf = new Map()

/** 生成 callId */
function newCallId() {
  return crypto.randomUUID()
}

/** 清理通话的所有定时器 */
function clearTimers(call) {
  if (call.ringTimer) {
    clearTimeout(call.ringTimer)
    call.ringTimer = null
  }
  if (call.graceTimer) {
    clearTimeout(call.graceTimer)
    call.graceTimer = null
  }
}

/**
 * 幂等终态：广播 ended 到双方 user 房间（全设备），释放 busy，TTL 后 GC。
 * 重复调用（对端 ack 竞态/重发）直接忽略。
 */
function finalize(io, config, call, reason) {
  if (call.state === ENDED) return false
  call.state = ENDED
  call.endedAt = Date.now()
  call.endedReason = reason
  clearTimers(call)
  for (const uid of [call.callerId, call.calleeId]) {
    if (busyOf.get(uid) === call.callId) busyOf.delete(uid)
  }
  const payload = { callId: call.callId, reason }
  io.to(config.ROOM_USER(call.callerId)).emit(CALL_SERVER.CALL_ENDED, payload)
  io.to(config.ROOM_USER(call.calleeId)).emit(CALL_SERVER.CALL_ENDED, payload)
  setTimeout(() => calls.delete(call.callId), config.CALL_ENDED_TTL_MS).unref()
  return true
}

/** 对端 userId */
function peerOf(call, userId) {
  return call.callerId === userId ? call.calleeId : call.callerId
}

/** 当前 socket 在该通话中的角色（非参与方返回 null） */
function roleOf(call, userId) {
  if (call.callerId === userId) return 'caller'
  if (call.calleeId === userId) return 'callee'
  return null
}

/**
 * 注册通话事件处理（server.js connection 内调用，每 socket 一次）。
 */
function registerCallHandlers(ctx, socket) {
  const { io, store, config, log } = ctx
  const user = socket.data.user

  const reply = (ack, ok, extra) =>
    typeof ack === 'function' ? ack({ ok, ...extra }) : null

  // ── 呼叫 ──
  socket.on(CALL_CLIENT.CALL_INVITE, async (payload = {}, ack) => {
    try {
      const { conversationId, toUserId } = payload
      const media = payload.media === 'audio' ? 'audio' : 'video'
      if (!conversationId || !toUserId) {
        return reply(ack, false, { error: 'missing conversationId/toUserId' })
      }
      if (toUserId === user.userId) {
        return reply(ack, false, { error: 'forbidden: self call' })
      }
      // 会话存在、单聊、双方是成员
      const conv = await store.getConversation(conversationId)
      if (!conv) return reply(ack, false, { error: 'forbidden' })
      if (conv.type !== 'SINGLE')
        return reply(ack, false, { error: 'forbidden: single only' })
      if (
        !(await store.isMember(conversationId, user.userId)) ||
        !(await store.isMember(conversationId, toUserId))
      ) {
        return reply(ack, false, { error: 'forbidden' })
      }
      // 忙线（glare 消解：先到先得，后到者 busy；含自己已 in-call）
      const myActive = busyOf.get(user.userId)
      if (myActive) {
        return reply(ack, false, { error: 'busy', activeCallId: myActive })
      }
      const peerActive = busyOf.get(toUserId)
      if (peerActive) {
        return reply(ack, false, { error: 'busy', activeCallId: peerActive })
      }
      // 在线校验（无推送：离线不可达，杜绝假振铃）
      if (!presence.isOnline(toUserId)) {
        return reply(ack, false, { error: 'offline' })
      }

      // callId：优先采用客户端 UUID（信号关联/飞行中取消需要），非法或冲突则服务端生成
      let callId = newCallId()
      if (
        typeof payload.callId === 'string' &&
        payload.callId.length > 0 &&
        payload.callId.length <= 64 &&
        !calls.has(payload.callId)
      ) {
        callId = payload.callId
      }
      const call = {
        callId,
        conversationId,
        callerId: user.userId,
        callerName: user.name,
        calleeId: toUserId,
        media,
        state: RINGING,
        callerSocketId: socket.id,
        calleeSocketId: null,
        ringTimer: null,
        graceTimer: null,
        endedAt: 0,
        endedReason: null,
      }
      calls.set(callId, call)
      busyOf.set(user.userId, callId)
      busyOf.set(toUserId, callId)

      // 45s 无人接听 → 双方超时终止
      call.ringTimer = setTimeout(() => {
        if (call.state !== RINGING) return
        io.to(config.ROOM_USER(call.calleeId)).emit(
          CALL_SERVER.CALL_CANCELLED,
          {
            callId,
            reason: 'timeout',
          }
        )
        finalize(io, config, call, 'timeout')
      }, config.CALL_RING_TIMEOUT_MS)

      io.to(config.ROOM_USER(toUserId)).emit(CALL_SERVER.CALL_INCOMING, {
        callId,
        conversationId,
        fromUserId: user.userId,
        fromName: user.name,
        media,
        iceServers: config.iceServers(),
      })
      log.info(`[call] ${user.userId} → ${toUserId} (${media}) call=${callId}`)
      return reply(ack, true, { iceServers: config.iceServers() })
    } catch (e) {
      log.error('[call:invite]', e)
      return reply(ack, false, { error: 'invite failed' })
    }
  })

  // ── 接听（首个到达原子胜出）──
  socket.on(CALL_CLIENT.CALL_ACCEPT, async (payload = {}, ack) => {
    const call = calls.get(payload.callId)
    if (
      !call ||
      call.state !== RINGING ||
      roleOf(call, user.userId) !== 'callee'
    ) {
      return reply(ack, false, { state: 'ended' })
    }
    call.state = IN_CALL
    call.calleeSocketId = socket.id
    call.calleeName = user.name
    if (call.ringTimer) {
      clearTimeout(call.ringTimer)
      call.ringTimer = null
    }
    // 呼叫方全设备：接通；被叫其他设备：免打扰收尾
    io.to(config.ROOM_USER(call.callerId)).emit(CALL_SERVER.CALL_ACCEPTED, {
      callId: call.callId,
      byUserId: user.userId,
    })
    io.to(config.ROOM_USER(call.calleeId))
      .except(socket.id)
      .emit(CALL_SERVER.CALL_CANCELLED, {
        callId: call.callId,
        reason: 'accepted-elsewhere',
      })
    log.info(`[call] accepted call=${call.callId} by ${user.userId}`)
    return reply(ack, true, {
      media: call.media,
      from: { userId: call.callerId, name: call.callerName },
      conversationId: call.conversationId,
    })
  })

  // ── 拒接 ──
  socket.on(CALL_CLIENT.CALL_REJECT, async (payload = {}, ack) => {
    const call = calls.get(payload.callId)
    if (
      call &&
      call.state === RINGING &&
      roleOf(call, user.userId) === 'callee'
    ) {
      io.to(config.ROOM_USER(call.callerId)).emit(CALL_SERVER.CALL_REJECTED, {
        callId: call.callId,
        reason: payload.reason || null,
      })
      finalize(io, config, call, 'rejected')
    }
    return reply(ack, true)
  })

  // ── 呼叫方取消（振铃期）──
  socket.on(CALL_CLIENT.CALL_CANCEL, async (payload = {}, ack) => {
    const call = calls.get(payload.callId)
    if (
      call &&
      call.state === RINGING &&
      roleOf(call, user.userId) === 'caller'
    ) {
      io.to(config.ROOM_USER(call.calleeId)).emit(CALL_SERVER.CALL_CANCELLED, {
        callId: call.callId,
        reason: 'caller-cancel',
      })
      finalize(io, config, call, 'cancelled')
    }
    return reply(ack, true)
  })

  // ── 挂断（IN_CALL 任意一方；幂等）──
  // reason 白名单透传：media-fail 需要让对端看到真实原因，其余一律 bye
  socket.on(CALL_CLIENT.CALL_HANGUP, async (payload = {}, ack) => {
    const call = calls.get(payload.callId)
    if (call && call.state !== ENDED && roleOf(call, user.userId)) {
      if (payload.reason === 'media-fail') {
        const ua = String(payload.ua || '').slice(0, 160)
        const build = String(payload.build || 'unknown').slice(0, 40)
        log.warn(
          `[call] media-fail call=${call.callId} 诊断: ${String(payload.diag || 'none').slice(0, 400)} UA: ${ua} build: ${build}`
        )
      }
      finalize(
        io,
        config,
        call,
        payload.reason === 'media-fail' ? 'media-fail' : 'bye'
      )
    }
    return reply(ack, true)
  })

  // ── WebRTC 信号中继（仅转发对端 bound socket）──
  socket.on(CALL_CLIENT.CALL_SIGNAL, async (payload = {}, ack) => {
    const call = calls.get(payload.callId)
    const data = payload.data
    if (!call || !data || call.state !== IN_CALL) {
      return reply(ack, false, { error: 'no active call' })
    }
    const role = roleOf(call, user.userId)
    if (!role) return reply(ack, false, { error: 'forbidden' })
    const peerSocketId =
      role === 'caller' ? call.calleeSocketId : call.callerSocketId
    if (!peerSocketId) return reply(ack, false, { error: 'peer not ready' })
    io.to(peerSocketId).emit(CALL_SERVER.CALL_SIGNAL, {
      callId: call.callId,
      fromUserId: user.userId,
      data,
    })
    // offer/answer 走可靠 ack；candidate 火后不管
    if (data.type === 'offer' || data.type === 'answer') {
      return reply(ack, true)
    }
    return null
  })

  // ── 断线重连重绑/恢复 ──
  socket.on(CALL_CLIENT.CALL_SYNC, async (payload = {}, ack) => {
    const call = calls.get(payload.callId)
    const role = call ? roleOf(call, user.userId) : null
    if (!call || call.state === ENDED || !role) {
      return reply(ack, false, { error: 'no such call' })
    }
    // 重绑当前 socket（断线方在 disconnect 时已被置空）；双方均就绪才解除宽限
    if (role === 'caller') call.callerSocketId = socket.id
    else call.calleeSocketId = socket.id
    if (call.graceTimer && call.callerSocketId && call.calleeSocketId) {
      clearTimeout(call.graceTimer)
      call.graceTimer = null
    }
    const peerId = peerOf(call, user.userId)
    return reply(ack, true, {
      state: call.state,
      role,
      peer: {
        userId: peerId,
        name: role === 'caller' ? call.calleeName : call.callerName,
      },
      media: call.media,
    })
  })

  // ── 断线：RINGING 立即取消；IN_CALL 宽限后判 peer-disconnect ──
  socket.on('disconnect', () => {
    for (const call of calls.values()) {
      if (call.state === ENDED) continue
      const role = roleOf(call, user.userId)
      if (!role) continue
      const bound =
        role === 'caller' ? call.callerSocketId : call.calleeSocketId
      if (bound !== socket.id) continue // 该用户其他设备仍在线，不影响通话

      if (call.state === RINGING) {
        if (role === 'caller') {
          io.to(config.ROOM_USER(call.calleeId)).emit(
            CALL_SERVER.CALL_CANCELLED,
            {
              callId: call.callId,
              reason: 'caller-cancel',
            }
          )
          finalize(io, config, call, 'cancelled')
        } else {
          io.to(config.ROOM_USER(call.callerId)).emit(
            CALL_SERVER.CALL_REJECTED,
            {
              callId: call.callId,
              reason: null,
            }
          )
          finalize(io, config, call, 'rejected')
        }
      } else if (call.state === IN_CALL) {
        // 断开方置空：sync 重绑时只有双方均就绪才清宽限（防双断线单方回归误清）
        if (role === 'caller') call.callerSocketId = null
        else call.calleeSocketId = null
        if (!call.graceTimer) {
          log.warn(
            `[call] IN_CALL 断线，${config.CALL_GRACE_MS}ms 宽限 call=${call.callId} (${role})`
          )
          call.graceTimer = setTimeout(() => {
            finalize(io, config, call, 'peer-disconnect')
          }, config.CALL_GRACE_MS)
        }
      }
    }
  })
}

/** 测试/运维内省（不对外暴露） */
function _debugState() {
  return { calls: calls.size, busy: busyOf.size }
}

module.exports = { registerCallHandlers, _debugState }
