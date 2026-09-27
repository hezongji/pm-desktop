// L2 生产媒体 E2E（SDLC 20260905-im-video-call）—— 部署后在生产上运行
// 双浏览器上下文（假媒体流）走真实 UI：呼叫→振铃→接听→媒体双向→静音→挂断→复位，另含 coturn 强制中继验证。
// 用法：node scripts/verify-video-call-media.mjs
import { chromium } from 'playwright-core'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'

let pass = 0,
  fail = 0
const ok = (n, c, d = '') => {
  c ? pass++ : fail++
  console.log(`${c ? '✅' : '❌'} ${n}${d ? ' · ' + d : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, ms = 12000, step = 150) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(step)
  }
  return null
}

const env = fs.readFileSync('/opt/pm-app/.env', 'utf8')
const getEnv = k =>
  env
    .split('\n')
    .find(l => l.startsWith(k + '='))
    ?.slice(k.length + 1)
const SECRET = getEnv('JWT_SECRET')
const BASE = 'https://pm.hezongji.cn'
const H = { 'Content-Type': 'application/json', Authorization: '' }

// ── 0. 数据准备：管理员 + 演示对端 + 单聊 ──
const U = {
  userId: 'cmt7cdbzv001ov55otclrv94t',
  id: 'cmt7cdbzv001ov55otclrv94t',
  email: 'chenmuzhi@example.com',
  role: 'ADMIN',
  name: '陈牧之',
}
const adminToken = jwt.sign(U, SECRET, { expiresIn: '1h' })
H.Authorization = `Bearer ${adminToken}`
const users = (await (await fetch(`${BASE}/api/users`, { headers: H })).json())
  .data
// 选演示域账号做对端（避免打扰真实员工）
const other =
  users.find(u => u.email?.endsWith('example.com') && u.id !== U.id) ??
  users.find(u => u.id !== U.id)
ok('数据准备：对端用户', !!other, other?.name)
const conv = (
  await (
    await fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ type: 'SINGLE', memberIds: [other.id] }),
    })
  ).json()
).data
ok('数据准备：单聊创建', !!conv?.id)
const B = {
  userId: other.id,
  id: other.id,
  email: other.email,
  role: other.role || 'EMPLOYEE',
  name: other.name,
}
const tokenA = adminToken
const tokenB = jwt.sign(B, SECRET, { expiresIn: '1h' })

// ── 1. 双上下文浏览器（假媒体流）──
const browser = await chromium.launch({
  executablePath:
    '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const mkCtx = async (token, user) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem('auth-token', t)
      localStorage.setItem('auth-user', JSON.stringify(u))
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: { user: u, isAuthenticated: true },
          version: 0,
        })
      )
    },
    [token, user]
  )
  await page.goto(`${BASE}/im`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  return { ctx, page }
}
const A = await mkCtx(tokenA, U)
const Bctx = await mkCtx(tokenB, B)

// ── 2. A 进入会话并发起视频通话 ──
const convItem = A.page.locator(`[data-cid="${conv.id}"]`)
if (await convItem.count()) await convItem.first().click()
else await A.page.locator('[data-cid]').first().click()
await A.page.waitForTimeout(1200)
const callBtn = A.page.locator('[data-call-media="video"]').first()
ok(
  '2a 单聊头部出现视频通话按钮（群聊不出现由 L1 覆盖）',
  (await callBtn.count()) > 0
)
await callBtn.click()
const aOutgoing = await waitFor(() =>
  A.page
    .getByText('等待对方接受…')
    .isVisible()
    .catch(() => false)
)
ok('2b 呼叫方 outgoing 覆盖层', !!aOutgoing)

// ── 3. B 全局来电 → 接听 ──
const acceptBtn = Bctx.page.getByRole('button', { name: '接听' })
const ringing = await waitFor(
  () => acceptBtn.isVisible().catch(() => false),
  12000
)
ok('3a 被叫全局来电振铃（/im 任意页可达）', !!ringing)
const peerOk = await waitFor(async () => {
  const snap = await Bctx.page.evaluate(() => window.__pmCall?.getSnapshot?.())
  return snap?.state === 'incoming' && snap?.peer?.name === '陈牧之'
}, 5000)
ok('3b 来电快照：incoming + 呼叫方姓名正确', !!peerOk)
await acceptBtn.click()
const aConnected = await waitFor(
  async () =>
    (await A.page.evaluate(() => window.__pmCall?.getSnapshot?.().state)) ===
    'connected'
)
const bConnected = await waitFor(
  async () =>
    (await Bctx.page.evaluate(() => window.__pmCall?.getSnapshot?.().state)) ===
    'connected'
)
ok('3c 双方进入 connected', !!aConnected && !!bConnected)

// ── 4. 媒体双向流动（fake device 产生真实 RTP 字节）──
const readBytes = page =>
  page.evaluate(async () => {
    const pc = window.__pmCall?.pc
    if (!pc) return 0
    const stats = await pc.getStats()
    let bytes = 0
    stats.forEach(r => {
      if (r.type === 'inbound-rtp') bytes += Number(r.bytesReceived || 0)
    })
    return bytes
  })
const aB1 = await readBytes(A.page)
const bB1 = await readBytes(Bctx.page)
await sleep(2500)
const aB2 = await readBytes(A.page)
const bB2 = await readBytes(Bctx.page)
ok('4a 呼叫方收媒体字节增长', aB2 > aB1, `${aB1} → ${aB2}`)
ok('4b 被叫收媒体字节增长', bB2 > bB1, `${bB1} → ${bB2}`)
const videos = await A.page.evaluate(() =>
  Array.from(document.querySelectorAll('video')).map(v => v.videoWidth)
)
ok(
  '4c 本端/远端 video 元素在渲染',
  videos.some(w => w > 0),
  JSON.stringify(videos)
)

// ── 5. 静音切换 ──
await A.page.getByRole('button', { name: '静音' }).click()
await sleep(300)
const muted = await A.page.evaluate(
  () => window.__pmCall?.getSnapshot?.().micMuted
)
ok('5 静音切换生效', muted === true)
await A.page.getByRole('button', { name: '取消静音' }).click()
await sleep(200)

// ── 6. 挂断 → 双方复位 → 可立即再呼/拒接 ──
await A.page.getByRole('button', { name: '挂断' }).click()
const aIdle = await waitFor(
  async () =>
    (await A.page.evaluate(() => window.__pmCall?.getSnapshot?.().state)) ===
    'idle',
  8000
)
const bIdle = await waitFor(
  async () =>
    (await Bctx.page.evaluate(() => window.__pmCall?.getSnapshot?.().state)) ===
    'idle',
  8000
)
ok('6a 挂断双方回 idle', !!aIdle && !!bIdle)

// 再呼 + 被叫拒接（矩阵 #2 生产复验）
await A.page.locator('[data-call-media="video"]').first().click()
const ringing2 = await waitFor(() =>
  Bctx.page
    .getByRole('button', { name: '接听' })
    .isVisible()
    .catch(() => false)
)
ok('6b 挂断后可立即再呼（被叫再振铃）', !!ringing2)
await Bctx.page.getByRole('button', { name: '拒接' }).click()
const aIdle2 = await waitFor(
  async () =>
    (await A.page.evaluate(() => window.__pmCall?.getSnapshot?.().state)) ===
    'idle',
  8000
)
ok('6c 拒接后呼叫方复位', !!aIdle2)

// ── 7. coturn 强制中继验证（页面内双 PC relay 策略直连 TURN）──
{
  const TURN_URLS = getEnv('TURN_URLS')
  const TURN_USERNAME = getEnv('TURN_USERNAME')
  const TURN_CREDENTIAL = getEnv('TURN_CREDENTIAL')
  const page = A.page
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const relayOk = await page.evaluate(
    async ([urls, user, cred]) => {
      const ice = [{ urls: urls.split(','), username: user, credential: cred }]
      const mk = () =>
        new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: 'relay' })
      const p1 = mk(),
        p2 = mk()
      const dc = p1.createDataChannel('t')
      const dcOpen = new Promise(
        r => (p2.ondatachannel = e => (e.channel.onmessage = () => r(true)))
      )
      p1.onicecandidate = e =>
        e.candidate && p2.addIceCandidate(e.candidate).catch(() => {})
      p2.onicecandidate = e =>
        e.candidate && p1.addIceCandidate(e.candidate).catch(() => {})
      const of = await p1.createOffer()
      await p1.setLocalDescription(of)
      await p2.setRemoteDescription(of)
      const an = await p2.createAnswer()
      await p2.setLocalDescription(an)
      await p1.setRemoteDescription(an)
      const connected = await Promise.race([
        new Promise(res => {
          const chk = () => {
            if (p1.connectionState === 'connected') res(true)
            else setTimeout(chk, 200)
          }
          chk()
        }),
        new Promise(r => setTimeout(() => r(false), 15000)),
      ])
      let echoed = false
      if (connected) {
        dc.send('ping')
        echoed = await Promise.race([
          dcOpen,
          new Promise(r => setTimeout(() => r(false), 5000)),
        ])
      }
      p1.close()
      p2.close()
      return { connected: !!connected, echoed: !!echoed }
    },
    [TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL]
  )
  ok(
    '7 coturn 强制中继（relay 策略）连通 + 数据回显',
    relayOk?.connected === true && relayOk?.echoed === true,
    JSON.stringify(relayOk)
  )
}

console.log(`\n===== L2 生产媒体 E2E：${pass} 通过 / ${fail} 失败 =====`)
await A.ctx.close()
await Bctx.ctx.close()
await browser.close()
process.exit(fail > 0 ? 1 : 0)
