import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { getAuthUser } from '@/lib/auth'
import { assertIdentityFresh } from '@/lib/api-helpers'
import { registerMcpTools } from '@/lib/mcp/tools'

/**
 * 内置 MCP（Model Context Protocol）端点 —— 学 Kaneo：让 Claude/Cursor/Codex
 * 等 AI 客户端直接管理本系统的项目与任务。
 *
 * 协议：Streamable HTTP（stateful，服务端签发 session id）
 * 鉴权：复用系统 JWT（Authorization: Bearer <token>），每个会话绑定对应用户权限。
 * 用法示例（Claude Code / Cursor 的 mcp 配置）：
 *   { "mcpServers": { "pm": {
 *       "type": "http",
 *       "url": "https://pm.hezongji.cn/api/mcp",
 *       "headers": { "Authorization": "Bearer <你的登录 token>" }
 *   } } }
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// session id → transport（进程内缓存，standalone 单实例部署，跨请求保持 SSE 流与消息历史）
const sessions = new Map<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; expires: number }
>()
// 20260915 audit SEC-01/SEC-04: session TTL 30min idle reclaim
const MCP_SESSION_TTL_MS = 30 * 60 * 1000
function sweepSessions() {
  const now = Date.now()
  sessions.forEach((entry, sid) => {
    if (now > entry.expires) {
      entry.transport.close().catch(() => {})
      sessions.delete(sid)
    }
  })
}

// CORS（20260908 修复 W1-P2-9）：原先 ACAO:* 与固定 Origin 并存，现收敛为明确白名单回显；
// 非浏览器客户端（Claude Code / Cursor 等不带 Origin）不受影响。
const MCP_ALLOWED_ORIGINS = [
  'https://pm.hezongji.cn',
  'http://localhost:3000',
  'http://localhost:3001',
]

function buildCors(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin')
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, mcp-session-id, mcp-protocol-version',
  }
  if (origin && MCP_ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function unauthorized(CORS: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: 'Unauthorized: invalid or expired Bearer Token' }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS },
    }
  )
}

async function handleMcp(request: NextRequest): Promise<Response> {
  const CORS = buildCors(request)
  sweepSessions()
  // 20260915 audit SEC-01: every request (incl. session reuse) passes identity freshness guard
  const preUser = getAuthUser(request)
  if (!preUser) {
    return unauthorized(CORS)
  }
  try {
    await assertIdentityFresh(request)
  } catch {
    return unauthorized(CORS)
  }
  // 已有会话直接复用（session 建立时已鉴权，后续 GET SSE / DELETE 无需重复带 token）
  const sessionId = request.headers.get('mcp-session-id')
  const entry = sessionId ? sessions.get(sessionId) : undefined
  let transport = entry?.transport

  if (!transport) {
    const user = getAuthUser(request)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: 缺少或无效的 Bearer Token' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS },
        }
      )
    }

    const server = new McpServer({ name: 'pm-mcp', version: '1.0.0' })
    registerMcpTools(server, user)

    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: sid => {
        sessions.set(sid, {
          transport: transport!,
          expires: Date.now() + MCP_SESSION_TTL_MS,
        })
      },
      onsessionclosed: sid => {
        sessions.delete(sid)
      },
    })
    await server.connect(transport)
  }

  if (entry) entry.expires = Date.now() + MCP_SESSION_TTL_MS
  const response = await transport.handleRequest(request)
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function POST(request: NextRequest) {
  return handleMcp(request)
}

export async function GET(request: NextRequest) {
  return handleMcp(request)
}

export async function DELETE(request: NextRequest) {
  return handleMcp(request)
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: buildCors(request) })
}
