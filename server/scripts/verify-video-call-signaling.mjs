// L1 信令矩阵 E2E（SDLC 20260905-im-video-call）
// 起本地 memory 模式 im-server（:3003，短定时注入），socket.io-client 双连接跑信令全矩阵。
// 不碰生产数据、不碰生产 im-server。用法：node scripts/verify-video-call-signaling.mjs
import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'

let pass = 0,
  fail = 0
const results = []
const ok = (n, c, d = '') => {
  c ? pass++ : fail++
  results.push(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' · ' + d : ''}`)
  console.log(`${c ? '✅' : '❌'} ${n}${d ? ' · ' + d : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 5000, step = 40) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = fn()
    if (v) return v
    await sleep(step)
  }
  return null
}

const env = fs.readFileSync('/opt/pm-app/.env', 'utf8')
const SECRET = env
  .split('\n')
  .find(l => l.startsWith('JWT_SECRET='))
  ?.slice('JWT_SECRET='.length)
const PORT = 3003

// ── 起本地 im-server（memory 模式，短定时）──
const srv = spawn('node', ['src/index.js'], {
  cwd: '/opt/pm-app/im-server',
  env: {
    ...process.env,
    IM_PORT: String(PORT),
    IM_STORE: 'memory',
    IM_SEED_DEMO: 'true',
    IM_CALL_RING_TIMEOUT_MS: '3000',
    IM_CALL_GRACE_MS: '1500',
    IM_CALL_ENDED_TTL_MS: '4000',
    JWT_SECRET: SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const srvLog = []
srv.stdout.on('data', d => srvLog.push(d.toString()))
srv.stderr.on('data', d => srvLog.push(d.toString()))
if (!(await waitFor(() => srvLog.join('').includes('IM 服务已启动'), 8000))) {
  console.error('本地 im-server 启动失败:\n' + srvLog.join(''))
  process.exit(1)
}
console.log('本地 im-server(:3003, memory, ring=3s, grace=1.5s) 已启动')

// ── 连接工具 ──
const mkTok = (id, name) =>
  jwt.sign(
    { userId: id, id, email: `${id}@test.local`, role: 'ADMIN', name },
    SECRET,
    { expiresIn: '1h' }
  )
const connect = (id, name) =>
  new Promise((res, rej) => {
    const s = io(`http://localhost:${PORT}`, {
      auth: { token: mkTok(id, name) },
      transports: ['websocket'],
    })
    s.on('connect', () => res(s))
    s.on('connect_error', rej)
    setTimeout(() => rej(new Error('connect timeout')), 5000)
  })
const emitAck = (s, ev, payload) => new Promise(r => s.emit(ev, payload, r))

/** 收集某 socket 上某事件的下一次负载 */
const next = (s, ev) =>
  new Promise(r => {
    const h = p => {
      s.off(ev, h)
      r(p)
    }
    s.on(ev, h)
  })

const A = 'test-user-a',
  B = 'test-user-b',
  C = 'test-user-c'
let sa = await connect(A, '甲')
let sb = await connect(B, '乙')
let sc = await connect(C, '丙')
console.log('三用户已连接')

/** 标准呼叫前置：A→B invite（返回 {incoming, inviteAck}） */
async function inviteAB(media = 'video') {
  const incomingP = next(sb, 'call:incoming')
  const inviteAck = await emitAck(sa, 'call:invite', {
    conversationId: CONV_AB,
    toUserId: B,
    media,
  })
  const incoming = inviteAck?.ok ? await incomingP : null
  return { inviteAck, incoming }
}

// 建单聊会话（memory store）
const convAck = await emitAck(sa, 'conversation:create', {
  type: 'SINGLE',
  name: null,
  memberIds: [A, B],
})
const CONV_AB = convAck?.conversation?.id
ok('前置：A-B 单聊会话创建', !!CONV_AB)
const convAC = await emitAck(sa, 'conversation:create', {
  type: 'SINGLE',
  name: null,
  memberIds: [A, C],
})
const CONV_AC = convAC?.conversation?.id
ok('前置：A-C 单聊会话创建', !!CONV_AC)

// ── 矩阵 #6：离线/无会话成员不可呼（无假振铃）──
{
  // D 从不连接 → 真离线；memory store 无用户表，成员串可直接用
  const convAD = await emitAck(sa, 'conversation:create', {
    type: 'SINGLE',
    name: null,
    memberIds: [A, 'test-user-d'],
  })
  const r = await emitAck(sa, 'call:invite', {
    conversationId: convAD.conversation.id,
    toUserId: 'test-user-d',
    media: 'video',
  })
  ok('#6a 呼离线用户 → ack offline', r?.ok === false && r?.error === 'offline')
  const r2 = await emitAck(sc, 'call:invite', {
    conversationId: CONV_AB,
    toUserId: B,
    media: 'video',
  })
  ok(
    '#6b 非成员呼叫 → forbidden',
    r2?.ok === false && r2?.error === 'forbidden'
  )
  const r3 = await emitAck(sa, 'call:invite', {
    conversationId: CONV_AB,
    toUserId: A,
    media: 'video',
  })
  ok('#6c 自呼禁止', r3?.ok === false)
}

// ── 矩阵 #1：正常呼叫→接听→signal 中继→挂断 ──
{
  const { inviteAck, incoming } = await inviteAB('video')
  ok(
    '#1a invite ack ok + iceServers',
    inviteAck?.ok === true &&
      Array.isArray(inviteAck?.iceServers) &&
      inviteAck.iceServers.length > 0
  )
  ok(
    '#1b 被叫收 call:incoming（fromName/media/iceServers 全）',
    !!incoming &&
      incoming.fromUserId === A &&
      incoming.media === 'video' &&
      !!incoming.iceServers &&
      incoming.callId
  )
  const acc = await emitAck(sb, 'call:accept', { callId: incoming.callId })
  ok(
    '#1c accept ack（media + 对端信息 + 会话）',
    acc?.ok === true &&
      acc?.media === 'video' &&
      acc?.from?.userId === A &&
      acc?.conversationId === CONV_AB
  )

  const bOffer = next(sb, 'call:signal')
  const o = await emitAck(sa, 'call:signal', {
    callId: incoming.callId,
    data: { type: 'offer', sdp: 'v=0-offer' },
  })
  const gotOffer = await bOffer
  ok(
    '#1d offer 中继到被叫（ack ok + fromUserId 正确）',
    o?.ok === true &&
      gotOffer?.data?.type === 'offer' &&
      gotOffer?.fromUserId === A
  )

  const aAnswer = next(sa, 'call:signal')
  const an = await emitAck(sb, 'call:signal', {
    callId: incoming.callId,
    data: { type: 'answer', sdp: 'v=0-answer' },
  })
  const gotAnswer = await aAnswer
  ok(
    '#1e answer 中继到呼叫方',
    an?.ok === true && gotAnswer?.data?.type === 'answer'
  )

  const bCand = next(sb, 'call:signal')
  sa.emit('call:signal', {
    callId: incoming.callId,
    data: { type: 'candidate', candidate: 'cand-1' },
  })
  const gotCand = await bCand
  ok(
    '#1f candidate 中继（无 ack 火后不管）',
    gotCand?.data?.type === 'candidate'
  )

  const aEnded = next(sa, 'call:ended')
  const bEnded = next(sb, 'call:ended')
  await emitAck(sa, 'call:hangup', { callId: incoming.callId, reason: 'bye' })
  const [ea, eb] = await Promise.all([aEnded, bEnded])
  ok(
    '#1g 挂断双方收 ended{bye}',
    ea?.reason === 'bye' &&
      eb?.reason === 'bye' &&
      ea?.callId === incoming.callId
  )
}

// ── 矩阵 #2：拒接 ──
{
  const { incoming } = await inviteAB('audio')
  const aRejected = next(sa, 'call:rejected')
  const aEnded = next(sa, 'call:ended')
  await emitAck(sb, 'call:reject', { callId: incoming.callId })
  const [rej, end] = await Promise.all([aRejected, aEnded])
  ok(
    '#2 拒接：rejected + ended{rejected}',
    rej?.callId === incoming.callId && end?.reason === 'rejected'
  )
}

// ── 矩阵 #3：振铃超时（本地注入 3s）──
{
  const { incoming } = await inviteAB('video')
  const bCancelled = next(sb, 'call:cancelled')
  const aEnded = next(sa, 'call:ended')
  const [cc, end] = await Promise.all([bCancelled, aEnded])
  ok(
    '#3 超时：被叫 cancelled{timeout} + ended{timeout}',
    cc?.reason === 'timeout' && end?.reason === 'timeout'
  )
}

// ── 矩阵 #4：呼叫方取消 ──
{
  const { incoming } = await inviteAB('video')
  const bCancelled = next(sb, 'call:cancelled')
  await emitAck(sa, 'call:cancel', { callId: incoming.callId })
  const cc = await bCancelled
  ok('#4 取消：被叫收 cancelled{caller-cancel}', cc?.reason === 'caller-cancel')
}

// ── 矩阵 #5/#7/#14：忙线 / glare / 结束后可再呼 ──
{
  const { incoming } = await inviteAB('video')
  await emitAck(sb, 'call:accept', { callId: incoming.callId })
  await sleep(80)
  const rBusy = await emitAck(sc, 'call:invite', {
    conversationId: CONV_AC,
    toUserId: B,
    media: 'audio',
  }).catch(() => null)
  // C 与 B 无共同单聊 → 先建，再测忙线
  let r = rBusy
  if (!r || r.ok === false) {
    const convBC = await emitAck(sa, 'conversation:create', {
      type: 'SINGLE',
      name: null,
      memberIds: [B, C],
    }).catch(() => null)
    const _ = convBC // C 建会话需 C 自己发起
  }
  const convBC = await emitAck(sc, 'conversation:create', {
    type: 'SINGLE',
    name: null,
    memberIds: [B, C],
  })
  r = await emitAck(sc, 'call:invite', {
    conversationId: convBC.conversation.id,
    toUserId: B,
    media: 'audio',
  })
  ok('#5 通话中呼入 → 呼叫方收 busy', r?.ok === false && r?.error === 'busy')
  // glare：B 在通话中反呼 A（用 A-B 会话保证双方都是成员）
  const r2 = await emitAck(sb, 'call:invite', {
    conversationId: CONV_AB,
    toUserId: A,
    media: 'audio',
  })
  ok(
    '#7 glare 互呼：后到者 busy（先到通话不受影响）',
    r2?.ok === false && r2?.error === 'busy'
  )

  const aEnded = next(sa, 'call:ended')
  const bEnded = next(sb, 'call:ended')
  await emitAck(sa, 'call:hangup', { callId: incoming.callId })
  await Promise.all([aEnded, bEnded])
  const r3 = await emitAck(sc, 'call:invite', {
    conversationId: convBC.conversation.id,
    toUserId: B,
    media: 'audio',
  })
  ok('#14 结束后可立即再呼', r3?.ok === true)
  const bCancelled = next(sb, 'call:cancelled')
  await emitAck(sc, 'call:cancel', { callId: r3.callId })
  await bCancelled
}

// ── 矩阵 #8：接通前被叫断线 → 呼叫方收终止（无悬挂振铃）──
{
  const { incoming } = await inviteAB('video')
  const aEnded = next(sa, 'call:ended')
  sb.disconnect()
  const end = await aEnded
  ok(
    '#8 接通前被叫断线 → 呼叫方收终止',
    !!end && end.callId === incoming.callId
  )
  sb = await connect(B, '乙')
}

// ── 矩阵 #9/#10：通话中断线宽限 + sync 重绑恢复 / 不恢复判 peer-disconnect ──
{
  const { incoming } = await inviteAB('video')
  await emitAck(sb, 'call:accept', { callId: incoming.callId })
  await sleep(80)
  // B 断线 → 1.5s 宽限内重连 + call:sync 重绑 → 通话不终止
  sb.disconnect()
  await sleep(400)
  sb = await connect(B, '乙')
  const sync = await emitAck(sb, 'call:sync', { callId: incoming.callId })
  ok(
    '#10 宽限期内 sync 重绑恢复（state=IN_CALL + peer=甲）',
    sync?.ok === true && sync?.state === 'IN_CALL' && sync?.peer?.userId === A
  )
  await sleep(1600) // 超过宽限
  const aStillNoEnd = await Promise.race([
    next(sa, 'call:ended').then(() => true),
    sleep(300).then(() => false),
  ])
  ok('#9 重绑后不被误判 peer-disconnect', sync?.ok === true && !aStillNoEnd)
  // 结束当前通话，复位 busy
  {
    const aEnd = next(sa, 'call:ended')
    const bEnd = next(sb, 'call:ended')
    await emitAck(sa, 'call:hangup', { callId: incoming.callId })
    await Promise.all([aEnd, bEnd])
  }

  // 不恢复路径
  const { incoming: inc2 } = await inviteAB('video')
  await emitAck(sb, 'call:accept', { callId: inc2.callId })
  const aEnded = next(sa, 'call:ended')
  sb.disconnect()
  const end = await aEnded
  ok(
    '#9b 不恢复 → 宽限后 ended{peer-disconnect}',
    end?.reason === 'peer-disconnect'
  )
  sb = await connect(B, '乙')
}

// ── 矩阵 #12：群聊不可呼 ──
{
  const g = await emitAck(sa, 'conversation:create', {
    type: 'GROUP',
    name: 'G',
    memberIds: [A, B, C],
  })
  const r = await emitAck(sa, 'call:invite', {
    conversationId: g.conversation.id,
    toUserId: B,
    media: 'video',
  })
  ok(
    '#12 群聊会话拒绝呼叫（single only）',
    r?.ok === false && /single/.test(r?.error || '')
  )
}

// ── 终态幂等：重复 hangup 不产生第二波 ended ──
{
  const { incoming } = await inviteAB('video')
  await emitAck(sb, 'call:accept', { callId: incoming.callId })
  const aEnded1 = next(sa, 'call:ended')
  await emitAck(sa, 'call:hangup', { callId: incoming.callId })
  await aEnded1
  let extra = 0
  const h = () => {
    extra++
  }
  sa.on('call:ended', h)
  sb.on('call:ended', h)
  await emitAck(sb, 'call:hangup', { callId: incoming.callId }) // 对已 ENDED 通话再挂
  await sleep(300)
  sa.off('call:ended', h)
  sb.off('call:ended', h)
  ok('#1h 终态幂等：ENDED 后重复操作零广播', extra === 0)
}

console.log(`\n===== L1 信令矩阵：${pass} 通过 / ${fail} 失败 =====`)
results.forEach(r => console.log(r))
sa.disconnect()
sb.disconnect()
sc?.disconnect()
srv.kill('SIGTERM')
process.exit(fail > 0 ? 1 : 0)
