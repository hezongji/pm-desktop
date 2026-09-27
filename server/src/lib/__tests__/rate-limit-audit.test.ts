/**
 * 登录限流加固单测（20260908 生产审计修复 P1-1 / P1-2 / P2-6）
 *
 * 覆盖：
 *  - getClientIp 只信任 nginx 注入的 X-Real-IP，客户端伪造 X-Forwarded-For 不再生效
 *  - X-Real-IP 缺失时回退到 XFF 的**最后一段**（nginx 追加的真实地址）
 *  - 账号维度跨 IP 累计失败即锁定（同一人换 IP 无法绕过）
 *  - IP 维度跨账号累计失败即锁定（单 IP 广撒网无法绕过）
 *  - 成功登录清账号桶但不重置 IP 桶（否则可用自己账号重置整台出口计数）
 */

import {
  getClientIp,
  isLoginLocked,
  recordLoginFail,
  clearLoginFails,
  accountSubject,
  loginRateLimitConfig,
} from '@/lib/rate-limit'

function reqWith(headers: Record<string, string>): Request {
  return { headers: new Headers(headers) } as unknown as Request
}

describe('getClientIp（P1-1 XFF 伪造绕过）', () => {
  it('同时存在 X-Real-IP 与伪造 XFF 时，取 X-Real-IP', () => {
    const ip = getClientIp(
      reqWith({
        'x-real-ip': '203.0.113.9',
        'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.9',
      })
    )
    expect(ip).toBe('203.0.113.9')
  })

  it('无 X-Real-IP 时取 XFF 最后一段（不是客户端可控的第一段）', () => {
    expect(
      getClientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))
    ).toBe('5.6.7.8')
  })

  it('两个头都缺失时返回 unknown', () => {
    expect(getClientIp(reqWith({}))).toBe('unknown')
  })
})

describe('accountSubject（P1-2 三套标识符独立计数）', () => {
  it('用户已解析时用 userId 归一，同一人只有一个计数桶', () => {
    expect(accountSubject('u-1', 'SUNRUOQING@EXAMPLE.COM')).toBe('id:u-1')
    expect(accountSubject('u-1', 'sunruoqing')).toBe('id:u-1')
    expect(accountSubject('u-1', '孙若清')).toBe('id:u-1')
  })

  it('用户不存在时回退到小写化原始输入', () => {
    expect(accountSubject(null, '  Ghost@Example.com ')).toBe(
      'raw:ghost@example.com'
    )
  })
})

describe('双维度锁定', () => {
  it('账号维度：同一账号换不同 IP 仍被锁定', () => {
    const subject = accountSubject('u-lock-acct', 'a@x.com')
    for (let i = 0; i < loginRateLimitConfig.MAX_FAILS; i++) {
      recordLoginFail(subject, `10.0.0.${i}`)
    }
    expect(isLoginLocked(subject, '198.51.100.77').locked).toBe(true)
  })

  it('IP 维度：同一 IP 换不同账号达阈值后锁定', () => {
    const ip = '198.51.100.42'
    for (let i = 0; i < loginRateLimitConfig.IP_MAX_FAILS; i++) {
      recordLoginFail(accountSubject(null, `spray-${i}@x.com`), ip)
    }
    expect(
      isLoginLocked(accountSubject(null, 'another@x.com'), ip).locked
    ).toBe(true)
  })

  it('成功登录只清账号桶，IP 桶保留', () => {
    const ip = '198.51.100.99'
    const subject = accountSubject('u-clear', 'b@x.com')
    for (let i = 0; i < loginRateLimitConfig.MAX_FAILS; i++) {
      recordLoginFail(subject, ip)
    }
    clearLoginFails(subject, ip)
    expect(isLoginLocked(subject, ip).locked).toBe(false)
    // IP 桶仍记录了这批失败 → 继续刷其他账号很快会被 IP 维度拦住
    for (let i = 1; i < loginRateLimitConfig.IP_MAX_FAILS; i++) {
      recordLoginFail(accountSubject(null, `filler-${i}@x.com`), ip)
    }
    expect(
      isLoginLocked(accountSubject(null, 'filler-final@x.com'), ip).locked
    ).toBe(true)
  })
})
