/**
 * 统一 API 响应约定（服务端）—— 依据《开发文档-项目管理系统重构》§4、§7
 *
 * 响应壳（§4）：
 *   成功：{ success: true, data: {...}, message: 'ok' }
 *   失败：{ success: false, message: '人类可读错误', error: { code, message }, errors?: [...] }
 *         （HTTP 4xx/5xx；error 为机器可读错误对象，与 message 冗余便于前端两用）
 *
 * 分页约定（§4）：
 *   请求：?page=1&limit=20（limit 上限 100）
 *   响应：data: { items: [...], pagination: { page, limit, total, pages } }
 *   ⚠️ 列表键统一为 items（旧 projects/tasks 键废弃），前端统一读 data.items
 *
 * 鉴权中间件（§4.3）：
 *   requireAuth(request) → AuthUser，未认证抛 ApiError(401)
 *   requireRole(user, ...roles) → 涉权操作不满足抛 ApiError(403)
 *   apiHandler(handler) → 统一捕获 ApiError / ZodError / 未知错误并输出统一壳
 */

import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import type { GlobalRole } from '@prisma/client'
import {
  getAuthUser,
  verifyAuthToken,
  getFreshIdentity,
  AuthUser,
} from './auth'

// ───────────────────────────── 类型 ─────────────────────────────

/** 机器可读错误对象（响应壳的 error 字段） */
export interface ApiErrorBody {
  code: string
  message: string
}

/** 统一分页元信息（§4） */
export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

/** 统一成功响应 */
export interface ApiOk<T> {
  success: true
  data: T
  message: string
}

/** 统一失败响应 */
export interface ApiFail {
  success: false
  message: string
  error: ApiErrorBody
  errors?: unknown[]
}

/** 分页数据载荷 */
export interface PaginatedData<T> {
  items: T[]
  pagination: Pagination
}

// ───────────────────────────── ApiError ─────────────────────────────

/**
 * API 业务错误：路由内任意位置 throw，由 apiHandler / handleApiError
 * 统一转换为 §4 约定的失败响应壳。status 直接对应 HTTP 状态码。
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly errors?: unknown[]

  constructor(
    status: number,
    message: string,
    code?: string,
    errors?: unknown[]
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code ?? defaultCode(status)
    this.errors = errors
  }

  /** 快捷构造 */
  static badRequest(message: string, errors?: unknown[]) {
    return new ApiError(400, message, 'BAD_REQUEST', errors)
  }
  static unauthorized(message = '未认证或登录已过期') {
    return new ApiError(401, message, 'UNAUTHORIZED')
  }
  static forbidden(message = '没有执行该操作的权限') {
    return new ApiError(403, message, 'FORBIDDEN')
  }
  static notFound(message = '资源不存在') {
    return new ApiError(404, message, 'NOT_FOUND')
  }
  static internal(message = '服务器内部错误') {
    return new ApiError(500, message, 'INTERNAL_ERROR')
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST'
    case 401:
      return 'UNAUTHORIZED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 405:
      return 'METHOD_NOT_ALLOWED'
    case 409:
      return 'CONFLICT'
    // 20260908 生产审计 P2-4：429 此前落到 INTERNAL_ERROR，前端无法区分限流
    case 429:
      return 'RATE_LIMITED'
    default:
      return 'INTERNAL_ERROR'
  }
}

// ───────────────────────────── 响应构造 ─────────────────────────────

/** 成功响应（可选自定义 message） */
export function ok<T>(data: T, message = 'ok', status = 200): NextResponse {
  const body: ApiOk<T> = { success: true, data, message }
  return NextResponse.json(body, { status })
}

/** 创建成功响应（201） */
export function created<T>(data: T, message = 'ok'): NextResponse {
  return ok(data, message, 201)
}

/** 分页成功响应：data = { items, pagination }（§4 分页约定） */
export function okPage<T>(
  items: T[],
  page: number,
  limit: number,
  total: number
): NextResponse {
  const data: PaginatedData<T> = {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  }
  return ok(data)
}

/** 失败响应（§4：success:false + message + error + 可选 errors） */
export function fail(
  status: number,
  message: string,
  code?: string,
  errors?: unknown[]
): NextResponse {
  const body: ApiFail = {
    success: false,
    message,
    error: { code: code ?? defaultCode(status), message },
    ...(errors ? { errors } : {}),
  }
  return NextResponse.json(body, { status })
}

/**
 * 405 统一兜底工厂（20260908 生产审计 W3-P2-1）
 *
 * Next.js App Router 对「未导出该方法」的请求由框架直接返回 405 且 body 为空，
 * 不经过 apiHandler，因此无法在 apiHandler 层统一拦截。最小可行方案：
 * 路由显式导出未实现的方法并复用本工厂，保证 405 也返回统一 JSON 失败壳 + Allow 头。
 *
 * 用法：`export const POST = methodNotAllowed('GET')`
 */
export function methodNotAllowed(...allow: string[]) {
  const allowHeader = allow.join(', ')
  return async () => {
    const res = fail(405, '请求方法不被支持', 'METHOD_NOT_ALLOWED')
    res.headers.set('Allow', allowHeader)
    return res
  }
}

// ───────────────────────────── 分页解析 ─────────────────────────────

export interface ParsedPagination {
  page: number
  limit: number
  skip: number
}

/** 解析 ?page=&limit=（§4），page≥1，limit∈[1,100] */
export function parsePagination(
  request: NextRequest,
  defaultLimit = 20
): ParsedPagination {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const rawLimit = parseInt(
    searchParams.get('limit') || String(defaultLimit),
    10
  )
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit)
  )
  return { page, limit, skip: (page - 1) * limit }
}

// ───────────────────────────── 鉴权中间件 ─────────────────────────────

/**
 * 受保护接口鉴权（§4.3）：校验 Bearer Token。
 * 未认证（缺失/无效 token）→ throw ApiError(401)，由 apiHandler 统一输出。
 */
export function requireAuth(request: NextRequest): AuthUser {
  const user = getAuthUser(request)
  if (!user) {
    throw ApiError.unauthorized()
  }
  return user
}

/**
 * 涉权操作角色校验（§4.3）：全局角色不在允许集合内 → throw ApiError(403)。
 * 例：requireRole(user, 'ADMIN') / requireRole(user, 'ADMIN', 'PROJECT_MANAGER')
 */
export function requireRole(user: AuthUser, ...roles: GlobalRole[]): void {
  const role = user.role as GlobalRole
  if (!roles.includes(role)) {
    throw ApiError.forbidden(`需要角色：${roles.join(' / ')}`)
  }
}

// ───────────────────────────── 只读字段守卫 ─────────────────────────────

/**
 * PATCH 只读字段显式拒绝（fix-4② 数据治理）：
 * body 中出现任一只读字段 → throw ApiError(400)，明确提示走专用接口。
 *
 * 背景：非 strict schema 的端点对未声明字段「静默忽略」，strict schema 则给出
 * 泛化的 VALIDATION_ERROR——两者都无法让客户端意识到「该字段不可经此端点修改」。
 * 本守卫在 zod 解析前对原始 body 检查，给出字段级明确报错。
 *
 * 防御：body 非普通对象（null/数组/原始值）时直接放行，交由后续 zod 校验报错。
 */
export function rejectReadonly(
  body: Record<string, unknown>,
  readonlyFields: readonly string[]
): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return
  for (const f of readonlyFields) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      throw ApiError.badRequest(`字段 ${f} 只读，请通过专用接口修改`)
    }
  }
}

// ───────────────────────────── 路由包装 ─────────────────────────────

/** 将任意路由内错误转换为统一失败响应壳 */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return fail(error.status, error.message, error.code, error.errors)
  }
  // permission.ts 的同名 ApiError（requireCan 抑 403）：结构同构（status/code/message），
  // 鸭子类型兼容，避免两套类型互相 import 造成循环依赖
  if (
    error instanceof Error &&
    error.name === 'ApiError' &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    const e = error as Error & { status: number; code?: string }
    return fail(e.status, e.message, e.code)
  }
  if (error instanceof ZodError) {
    // 20260920 容错性优化：message 附带字段级明细（前 3 条），便于用户/前端定位问题；
    // errors 数组保持原样，结构化消费方不受影响
    const details = error.errors
      .slice(0, 3)
      .map(e =>
        e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message
      )
      .join('；')
    return fail(
      400,
      details ? `输入数据格式错误（${details}）` : '输入数据格式错误',
      'VALIDATION_ERROR',
      error.errors
    )
  }
  // 20260908 生产审计 P2-3：非法 JSON 请求体此前冒泡成 500 + 日志污染
  if (error instanceof SyntaxError) {
    return fail(400, '请求体必须是合法 JSON', 'VALIDATION_ERROR')
  }
  // 20260920 错误提示明确化：Prisma 常见数据库错误 → 具体原因 + 补救指引，
  // 不再一律裸 500「服务器内部错误」
  const prismaErr = prismaErrorToResponse(error)
  if (prismaErr)
    return fail(prismaErr.status, prismaErr.message, prismaErr.code)
  console.error('[api] unhandled error:', error)
  return fail(
    500,
    '服务器内部错误：操作未能完成，请稍后重试；若反复出现请联系管理员并提供操作时间'
  )
}

/**
 * Prisma 已知请求错误 → 人类可读的具体提示（20260920）
 * 覆盖全系统所有未单独兜 Prisma 异常的路由： duplicate / 外键 / 记录不存在 / 超长 / 必填缺失。
 * 返回 null 表示非 Prisma 已知错误，走原有 500 兜底。
 */
function prismaErrorToResponse(error: unknown): {
  status: number
  message: string
  code: string
} | null {
  if (
    !(error instanceof Error) ||
    error.name !== 'PrismaClientKnownRequestError'
  ) {
    return null
  }
  const e = error as Error & {
    code?: string
    meta?: { target?: string | string[]; cause?: string }
  }
  const target = Array.isArray(e.meta?.target)
    ? e.meta.target.join('、')
    : typeof e.meta?.target === 'string'
      ? e.meta.target
      : ''
  switch (e.code) {
    case 'P2002':
      return {
        status: 409,
        code: 'DUPLICATE',
        message: `保存失败：${target ? `「${target}」` : '该数据'}已存在相同记录。请检查编号/名称是否已被占用，修改后重试，或刷新页面查看最新数据`,
      }
    case 'P2003':
      return {
        status: 400,
        code: 'FK_VIOLATION',
        message:
          '保存失败：所引用的关联数据不存在或已被删除（如选择的负责人已离职、关联的项目/模板/客户已被删除）。请刷新页面后重新选择再提交',
      }
    case 'P2025':
      return {
        status: 404,
        code: 'NOT_FOUND',
        message: '操作的对象不存在或已被他人删除，请刷新页面后重试',
      }
    case 'P2000':
      return {
        status: 400,
        code: 'VALUE_TOO_LONG',
        message: `保存失败：填写的内容超出长度限制（${target || '某个字段'}），请精简后重试`,
      }
    case 'P2011':
      return {
        status: 400,
        code: 'NULL_CONSTRAINT',
        message:
          '保存失败：有必填项未填写（数据库非空约束），请补全必填内容后重试',
      }
    default:
      return {
        status: 500,
        code: 'DB_ERROR',
        message: `数据库操作失败（${e.code ?? '未知原因'}），请稍后重试；若反复出现请联系管理员`,
      }
  }
}

/**
 * 携带令牌时无需实时身份校验的公开端点：
 * 客户端 axios 拦截器会给所有请求带上 localStorage 里的旧令牌，
 * 若在此处拒绝，用户拿着已失效令牌将无法重新登录。
 */
const IDENTITY_GUARD_SKIP = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/health',
  // 20260908 回归修复（V2 P2-新1）：登出必须幂等。
  // 客户端网络重试 / 多标签页重复登出时，旧令牌已被吊销，若此处再拦 TOKEN_REVOKED，
  // 前端 axios 拦截器会误判为「登录已失效」并弹窗跳转。登出本身对任何令牌都无副作用。
  '/api/auth/logout',
])

/** 强制改密状态下仍允许访问的端点（改密本身 + 身份查询 + 登出） */
const PASSWORD_CHANGE_ALLOW = new Set([
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
])

/**
 * 实时身份守卫（20260908 生产审计 P1-3 / P1-4 / P2-5）
 *
 * 仅当请求携带 Bearer 令牌时生效（未携带的交给各路由的 requireAuth 处理，语义不变）：
 *   1. 账户不存在 → 401
 *   2. 账户已停用 → 401 ACCOUNT_DISABLED
 *   3. 令牌版本与 User.tokenVersion 不一致（登出/改密后）→ 401 TOKEN_REVOKED
 *   4. 令牌角色与 DB 实时角色不一致（降级/升级后）→ 401 TOKEN_STALE，强制重登
 *   5. mustChangePassword=true → 除改密相关端点外一律 403 PASSWORD_CHANGE_REQUIRED
 *
 * 第 4 条同时消除了 requireRole「只信任 JWT 角色快照」的越权窗口：
 * 角色漂移的令牌在进入路由前就被拒绝，因此 requireRole 拿到的角色必然是最新的。
 *
 * 已由 apiHandler 自动调用；未使用 apiHandler 的路由（当前仅 3 个文件流式下载端点）
 * 需在 requireAuth 之前手动 `await assertIdentityFresh(request)`。
 */
export async function assertIdentityFresh(request: NextRequest): Promise<void> {
  // 容错：单元测试会用 { json } 之类的轻量替身代替 NextRequest
  const headers = request?.headers
  if (!headers || typeof headers.get !== 'function') return

  const authHeader = headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return

  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return
  }
  if (IDENTITY_GUARD_SKIP.has(pathname)) return

  const tokenUser = verifyAuthToken(authHeader.substring(7))
  // 令牌本身无效/过期：保持原有 401 语义，交由路由内 requireAuth 抛出
  if (!tokenUser) return

  let fresh: Awaited<ReturnType<typeof getFreshIdentity>>
  try {
    fresh = await getFreshIdentity(tokenUser.userId)
  } catch (err) {
    // 身份库不可用（DB 抖动/测试替身）→ 不拦截，交回各路由原有鉴权逻辑，避免把故障放大成 500
    console.warn('[auth] 实时身份校验失败，降级为 JWT 校验:', err)
    return
  }
  if (!fresh) throw ApiError.unauthorized('账户不存在，请重新登录')
  if (!fresh.isActive)
    throw new ApiError(401, '账户已被禁用', 'ACCOUNT_DISABLED')
  if ((tokenUser.ver ?? 0) !== fresh.tokenVersion) {
    throw new ApiError(401, '登录状态已失效，请重新登录', 'TOKEN_REVOKED')
  }
  if (tokenUser.role !== fresh.role) {
    throw new ApiError(401, '账户权限已变更，请重新登录', 'TOKEN_STALE')
  }
  if (fresh.mustChangePassword && !PASSWORD_CHANGE_ALLOW.has(pathname)) {
    throw new ApiError(
      403,
      '请先修改初始密码后再使用系统',
      'PASSWORD_CHANGE_REQUIRED'
    )
  }
}

/**
 * 路由高阶包装：
 *   export const GET = apiHandler(async (request) => { ... })
 * 内部 throw ApiError / ZodError 即自动转为 §4 统一失败壳，路由代码不再手写 try/catch。
 */

export function apiHandler<C = any>(
  handler: (request: NextRequest, context: C) => Promise<NextResponse>
): (request: NextRequest, context: C) => Promise<NextResponse> {
  return async (request, context) => {
    try {
      await assertIdentityFresh(request)
      return await handler(request, context)
    } catch (error) {
      return handleApiError(error)
    }
  }
}
