// 增强验证：真实密码登录 + 公网 WS 真连接（Round 3 前置）
import { io } from 'socket.io-client'

const BASE = 'https://pm.hezongji.cn'
let pass = 0,
  fail = 0
const ok = (n, c, d = '') => {
  c ? pass++ : fail++
  console.log(`${c ? '✅' : '❌'} ${n}${d ? ' · ' + d : ''}`)
}

// 1. 真实密码登录（非自签 JWT）
const lr = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'chenmuzhi@example.com',
    password: 'demo123456',
  }),
})
const lj = await lr.json()
ok(
  '真实登录 API 200 + 发 token',
  lr.status === 200 && !!lj?.data?.token,
  `HTTP ${lr.status}`
)
const token = lj?.data?.token

// 2. 真实 token 调业务 API
const ur = await fetch(`${BASE}/api/users`, {
  headers: { Authorization: `Bearer ${token}` },
})
ok('业务 API 用真实 token 200', ur.status === 200, `HTTP ${ur.status}`)

// 3. WS 公网真连接（socket.io，token 鉴权）
const connected = await new Promise(resolve => {
  const sock = io(`${BASE.replace('https://', 'wss://')}`, {
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnectionAttempts: 2,
    timeout: 15000,
  })
  const timer = setTimeout(() => {
    sock.close()
    resolve(false)
  }, 18000)
  sock.on('connect', () => {
    clearTimeout(timer)
    sock.close()
    resolve(true)
  })
  sock.on('connect_error', e => {
    clearTimeout(timer)
    sock.close()
    resolve('ERR:' + e.message)
  })
})
ok('WS 公网 socket.io 连接建立', connected === true, String(connected))

console.log(`\n增强验证: ${pass} ✅ / ${fail} ❌`)
process.exit(fail > 0 ? 1 : 0)
