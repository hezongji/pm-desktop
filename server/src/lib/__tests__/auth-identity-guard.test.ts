/**
 * apiHandler 实时身份守卫单测（20260908 生产审计修复 P1-3 / P1-4 / P2-5）
 *
 * 覆盖：
 *  - tokenVersion 不一致 → 401 TOKEN_REVOKED（登出/改密后旧令牌失效）
 *  - JWT 角色与 DB 实时角色不一致 → 401 TOKEN_STALE（降级后旧令牌失效，封住 requireRole 快照窗口）
 *  - 账户停用 → 401 ACCOUNT_DISABLED
 *  - mustChangePassword=true → 除改密相关端点外 403 PASSWORD_CHANGE_REQUIRED
 *  - 公开端点（/api/auth/login）携带已吊销令牌仍放行，保证用户能重新登录
 *  - 未携带令牌 → 不干预，交给路由内 requireAuth
 */

jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}))

import { apiHandler, ok } from '@/lib/api-helpers'
import { signAuthToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'

const findUnique = prisma.user.findUnique as unknown as jest.Mock
const handler = apiHandler(async () => ok({ hit: true }))

function makeReq(path: string, token?: string): NextRequest {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return {
    headers,
    url: `https://pm.example.com${path}`,
  } as unknown as NextRequest
}

function identity(
  over: Partial<{
    role: string
    isActive: boolean
    tokenVersion: number
    mustChangePassword: boolean
  }> = {}
) {
  return {
    role: 'MEMBER',
    isActive: true,
    tokenVersion: 0,
    mustChangePassword: false,
    ...over,
  }
}

async function call(path: string, token: string) {
  const res = await handler(makeReq(path, token), {})
  return { status: res.status, body: await res.json() }
}

describe('apiHandler 实时身份守卫', () => {
  it('身份一致 → 放行', async () => {
    findUnique.mockResolvedValue(identity())
    const token = signAuthToken({
      userId: 'g-ok',
      email: 'a@x.com',
      role: 'MEMBER',
      ver: 0,
    })
    const { status } = await call('/api/projects', token)
    expect(status).toBe(200)
  })

  it('tokenVersion 不一致 → 401 TOKEN_REVOKED', async () => {
    findUnique.mockResolvedValue(identity({ tokenVersion: 3 }))
    const token = signAuthToken({
      userId: 'g-revoked',
      email: 'a@x.com',
      role: 'MEMBER',
      ver: 0,
    })
    const { status, body } = await call('/api/projects', token)
    expect(status).toBe(401)
    expect(body.error.code).toBe('TOKEN_REVOKED')
  })

  it('角色降级后旧令牌 → 401 TOKEN_STALE', async () => {
    findUnique.mockResolvedValue(identity({ role: 'MEMBER' }))
    const token = signAuthToken({
      userId: 'g-stale',
      email: 'a@x.com',
      role: 'ADMIN',
      ver: 0,
    })
    const { status, body } = await call('/api/departments', token)
    expect(status).toBe(401)
    expect(body.error.code).toBe('TOKEN_STALE')
  })

  it('账户停用 → 401 ACCOUNT_DISABLED', async () => {
    findUnique.mockResolvedValue(identity({ isActive: false }))
    const token = signAuthToken({
      userId: 'g-disabled',
      email: 'a@x.com',
      role: 'MEMBER',
      ver: 0,
    })
    const { status, body } = await call('/api/projects', token)
    expect(status).toBe(401)
    expect(body.error.code).toBe('ACCOUNT_DISABLED')
  })

  it('mustChangePassword=true → 业务端点 403 PASSWORD_CHANGE_REQUIRED', async () => {
    findUnique.mockResolvedValue(identity({ mustChangePassword: true }))
    const token = signAuthToken({
      userId: 'g-must',
      email: 'a@x.com',
      role: 'MEMBER',
      ver: 0,
    })
    const { status, body } = await call('/api/projects', token)
    expect(status).toBe(403)
    expect(body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('mustChangePassword=true 时改密相关端点仍放行', async () => {
    findUnique.mockResolvedValue(identity({ mustChangePassword: true }))
    const token = signAuthToken({
      userId: 'g-must-allow',
      email: 'a@x.com',
      role: 'MEMBER',
      ver: 0,
    })
    for (const path of [
      '/api/auth/me',
      '/api/auth/change-password',
      '/api/auth/logout',
    ]) {
      const { status } = await call(path, token)
      expect(status).toBe(200)
    }
  })

  it('公开端点携带已吊销令牌仍放行（否则无法重新登录）', async () => {
    findUnique.mockResolvedValue(identity({ tokenVersion: 9 }))
    const token = signAuthToken({
      userId: 'g-public',
      email: 'a@x.com',
      role: 'MEMBER',
      ver: 0,
    })
    const { status } = await call('/api/auth/login', token)
    expect(status).toBe(200)
  })

  it('未携带令牌 → 不干预', async () => {
    const res = await handler(makeReq('/api/projects'), {})
    expect(res.status).toBe(200)
    expect(findUnique).not.toHaveBeenCalled()
  })
})
