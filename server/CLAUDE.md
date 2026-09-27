# CLAUDE.md — Claude Code 配置

> 完整仓库指引见 [AGENTS.md](./AGENTS.md)。本文只保留 Claude Code 高频所需。

## 项目

工程项目型企业开源管理系统（项目全生命周期 + 采购 + 费用 + 文件网盘 + 企业 IM + Android App）。
Next.js 16 (App Router) + TypeScript + Prisma + Socket.IO。

## 规则

- 改动前先读相关文件；不新建多余文档/文件
- 遵循统一 API 响应壳（`src/lib/api-helpers.ts`：`apiHandler` / `requireAuth` / `ok` / `fail`）
- 提交走 Conventional Commits，提交前跑 `npm run lint && npm run type-check`
- 不提交密钥、`.env`、证书

## 常用命令

```bash
npm run dev            # :3001
npm run build          # standalone
npm run lint && npm run type-check
npm run db:generate    # 改 schema 后
```

## 关键坑（详见 AGENTS.md）

- CJS 库（archiver）→ `serverExternalPackages` 或 `createRequire`
- `NEXT_PUBLIC_WS_URL` 只能写 origin 根域名
- 杀生产 next-server 用 `ss -tlnp` 按端口取 pid，勿用 pkill
- 任务修订走 `task-service.ts`，字段白名单 + 空修订拒绝

## UI 设计语言（2026-09-07 Linear 化定稿）

- 规范来源：awesome-design-md/linear.app DESIGN.md（lavender #5E6AD2 = 唯一强调色）
- 全部设计令牌集中在 src/app/globals.css 的 @layer base：六主题(:root 浅色/dark/warm/mist/mint/dusk) HSL CSS 变量
- 铁律：主色只用 hsl(var(--primary)) solid，禁渐变按钮；卡片 hairline 边框(hsl(var(--border)))+克制阴影；层级走 surface 阶梯；语义色 success #27A644/warning #E2A336/error #E5484D
- 改 UI 颜色一律走 globals.css 变量或 tailwind 语义类(bg-primary/text-muted-foreground/border 等)，禁内联 hex
- 主题切换机制：layout.tsx themes=['light','dark','warm','mist','mint','dusk'] + next-themes attribute=class；globals.css 中 .dark/.warm/.mist/.mint/.dusk 类名与之对应
