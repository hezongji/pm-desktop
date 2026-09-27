# PM Desktop · 开源本地优先项目管理系统

一个**完全跑在本机**的开源项目管理系统桌面应用：Electron 壳 + 内嵌 Next.js 全栈服务 +
Socket.IO 即时通讯 + 嵌入式 PostgreSQL。任务、项目、采购、网盘、审批、IM、报表——
全部功能与数据都在你自己的电脑上，断网可用，不依赖任何云端。

> 设计语言：Linear 的克制 × Windows 11 Fluent（Mica 材质 / 原生对话框 / Ctrl+K 命令面板）。

## 功能特性

- **项目管理**：项目/阶段/任务三层结构，看板与列表双视图，甘特图，交付物矩阵
- **采购流**：采购申请 → 订单 → 到货 → 付款全链路，供应商与外部主体管理
- **网盘**：目录树、版本时间线、在线预览、批量下载、文件需求审批
- **即时通讯**：单聊/群聊、已读回执、@提醒、图片/语音、消息引用（Socket.IO）
- **桌面化**：Mica 材质、Ctrl+K 全局命令面板、Ctrl+1..8 分区切换、舒适/紧凑两档密度、
  深浅色跟随系统、托盘常驻、任务栏角标与下载进度、原生通知
- **数据主权**：设置页内置备份导出/导入（pg_dump）、存储用量、本地运行时三态灯与重启
- **自动更新**：electron-updater 全链路（检测→下载→静默安装），支持差量 blockmap

## 架构

```text
┌───────────── PM Desktop（Electron，单实例） ─────────────┐
│ 主进程                                                    │
│  ├─ 壳层：窗口/托盘/通知/打印/恢复决策表/更新/IPC 红线      │
│  └─ LocalRuntime                                          │
│      ├─ 端口分配（默认 4310 / 4312 / 54329，冲突自动扫描） │
│      ├─ 嵌入式 PostgreSQL（initdb → 启动 → 健康检查）      │
│      ├─ utilityProcess：Next standalone + IM 服务          │
│      ├─ 首启迁移（prisma migrate deploy）+ 基线数据回放    │
│      ├─ 健康看门狗（异常 → 恢复决策表：等待/重试/退出）    │
│      └─ 备份服务（pg_dump 导出/导入）                      │
│ 渲染层：loadURL http://127.0.0.1:4310（Web 桌面化重构）    │
└───────────────────────────────────────────────────────────┘
数据落点：%APPDATA%/pm-desktop/（pgdata · uploads · backups · logs）
```

安全红线（`scripts/verify-package.cjs` 发布扫描强制）：`contextIsolation` /
`sandbox` / `nodeIntegration:false` / `webSecurity` / IPC origin 校验 /
证书错误一律硬拒 / 外链仅 http(s) 交系统浏览器 / 日志脱敏。

## 快速开始

### 环境要求

- Windows 10/11 x64（构建）；Node.js ≥ 20；Python 3 + Pillow（仅图标生成）
- 首次构建前先准备打包舞台：`npm run stage:all`
  （内嵌 PostgreSQL 16 二进制、server standalone、IM 服务、迁移与基线数据）

### 开发

```bash
npm install
npm run stage:all     # 组装内嵌服务舞台（server 变更后重跑）
npm run dev           # 开发模式（自动开 DevTools）
npm run verify        # typecheck + 单测 + 构建 —— 提交前必跑
```

### 构建安装包

```bash
npm run dist          # NSIS 安装包 → release/
node scripts/verify-package.cjs          # 产物安全红线扫描
node scripts/smoke-local.mjs --exe="release/win-unpacked/PM桌面.exe"   # 端到端冒烟
```

### 默认账号（首次启动自动播种）

| 账号 | 密码 |
| --- | --- |
| `admin@pm.local` | `Admin@123456` |

⚠️ 首次登录后请立即修改密码。

## 目录结构

```text
src/main/            Electron 主进程（启动十步/窗口红线/恢复/更新/托盘）
src/main/local-runtime/   本地运行时九模块（端口/PG/迁移/服务/看门狗/备份…）
src/preload/         contextBridge 白名单桥（window.pmDesktop）
src/shared/          通道契约 / 纯逻辑（origin 校验/恢复决策/更新状态机）
server/              内嵌全栈：Next.js 16（133 API 路由）+ Prisma + IM 服务
scripts/             构建 / 打包舞台 / 发布 / 冒烟 / E2E / 产物安全扫描
tests/               纯逻辑单测（node --test）
```

## License

[MIT](LICENSE)。内嵌的 PostgreSQL 二进制遵循 PostgreSQL License，
`server/` 内第三方依赖的许可声明原位保留。
