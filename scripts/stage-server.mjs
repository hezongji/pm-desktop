/**
 * Stage 1/3：把 server/ 供应商的 Next standalone + im-server + Prisma 迁移资源
 * 整理成打包舞台 build/stage/{pm-server,im-server,db}。
 *
 *   node scripts/stage-server.mjs                # 完整流程（含 next build）
 *   node scripts/stage-server.mjs --skip-build   # 复用 server/.next 已有构建产物
 *
 * 目录契约（与 src/main/local-runtime/paths.ts 对齐）：
 *   build/stage/pm-server/server/server.js       # Next standalone 入口
 *   build/stage/im-server/src/index.js           # IM 服务入口（含 node_modules，prisma CLI 随此分发）
 *   build/stage/db/schema.prisma + migrations/   # 迁移资源
 *
 * 安全红线：stage 产物中不允许出现 .env*（密钥不落安装包，verify-package.cjs 强制扫描）。
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const serverDir = join(root, "server");
const stageDir = join(root, "build", "stage");
const skipBuild = process.argv.includes("--skip-build");

// 桌面端烘焙地址（2.0）：页面里的 WS/APP/API 地址在 next build 时内联，指向本地回环首选端口。
// 端口被占用时的运行时覆盖方案见方案文档 P3 项（当前 WS 端口固定复用首选值）。
const DESKTOP_API_ORIGIN = "http://127.0.0.1:4310";
const DESKTOP_WS_ORIGIN = "http://127.0.0.1:4312";

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: options.shell === true,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    console.error(
      `[stage-server] 命令失败（退出码 ${result.status}）：${command} ${commandArgs.join(" ")}`,
    );
    process.exit(result.status ?? 1);
  }
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else if (entry.isFile()) total += statSync(full).size;
    } catch {
      /* 忽略占用文件 */
    }
  }
  return total;
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** 递归清除 .env*（密钥/连接串不得进安装包） */
function purgeEnvFiles(dir) {
  const removed = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/^\.env(\..*)?$/.test(entry.name)) {
        rmSync(full, { force: true });
        removed.push(full);
      }
    }
  };
  walk(dir);
  return removed;
}

function main() {
  if (!existsSync(join(serverDir, "package.json"))) {
    console.error("[stage-server] 缺少 server/ 供应商源码目录");
    process.exit(1);
  }

  // 1) Next 构建（standalone 产物）
  if (!skipBuild) {
    console.log("[stage-server] next build（烘焙桌面端本地地址）…");
    run("npx", ["next", "build"], {
      cwd: serverDir,
      shell: true,
      env: {
        NEXT_PUBLIC_WS_URL: DESKTOP_WS_ORIGIN,
        NEXT_PUBLIC_APP_URL: DESKTOP_API_ORIGIN,
        NEXT_PUBLIC_API_URL: DESKTOP_API_ORIGIN,
        NEXTAUTH_URL: DESKTOP_API_ORIGIN,
        NEXTAUTH_SECRET: "desktop-local-build-placeholder",
        API_BASE_URL: DESKTOP_API_ORIGIN,
      },
    });
  }

  const standaloneDir = join(serverDir, ".next", "standalone");
  const standaloneServerDir = join(standaloneDir, "server");
  if (!existsSync(join(standaloneServerDir, "server.js"))) {
    console.error(
      `[stage-server] standalone 产物缺失：${join(standaloneServerDir, "server.js")}（先跑一次完整构建）`,
    );
    process.exit(1);
  }

  // 只清自己负责的三个子目录：pg16/ 与 seed/ 由 stage-pg / stage-baseline 管理，互不清理
  for (const name of ["pm-server", "im-server", "db"]) {
    rmSync(join(stageDir, name), { recursive: true, force: true });
  }
  mkdirSync(stageDir, { recursive: true });

  // 2) pm-server = standalone 全量（含共享 node_modules 与 server/ 子目录）
  console.log("[stage-server] 复制 standalone → build/stage/pm-server …");
  cpSync(standaloneDir, join(stageDir, "pm-server"), { recursive: true });

  // standalone 不自带静态资源与 public，必须补拷（否则页面无样式/图标 404）
  const staticTarget = join(stageDir, "pm-server", "server", ".next", "static");
  rmSync(staticTarget, { recursive: true, force: true });
  cpSync(join(serverDir, ".next", "static"), staticTarget, { recursive: true });
  const publicSource = join(serverDir, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, join(stageDir, "pm-server", "server", "public"), {
      recursive: true,
    });
  }

  // 3) im-server（运行时 + 迁移用 prisma CLI 随其 node_modules 分发）
  console.log("[stage-server] 复制 im-server → build/stage/im-server …");
  const imSource = join(serverDir, "im-server");
  const imTarget = join(stageDir, "im-server");
  mkdirSync(imTarget, { recursive: true });
  for (const name of ["src", "prisma", "scripts", "package.json", ".npmrc"]) {
    const from = join(imSource, name);
    if (existsSync(from))
      cpSync(from, join(imTarget, name), { recursive: true });
  }
  cpSync(join(imSource, "node_modules"), join(imTarget, "node_modules"), {
    recursive: true,
  });

  // 4) 迁移资源（schema + migrations，供打包后的 prisma migrate deploy 使用）
  console.log("[stage-server] 复制迁移资源 → build/stage/db …");
  const dbTarget = join(stageDir, "db");
  mkdirSync(dbTarget, { recursive: true });
  cpSync(
    join(serverDir, "prisma", "schema.prisma"),
    join(dbTarget, "schema.prisma"),
  );
  cpSync(
    join(serverDir, "prisma", "migrations"),
    join(dbTarget, "migrations"),
    { recursive: true },
  );

  // 5) 红线：清除任何 .env*（源仓库的 .env.production.local 等绝不能进安装包）
  const purged = purgeEnvFiles(stageDir);
  for (const file of purged)
    console.log(`[stage-server] 已剔除敏感文件：${file}`);

  for (const name of ["pm-server", "im-server", "db"]) {
    console.log(
      `[stage-server] ${name}: ${humanBytes(dirSizeBytes(join(stageDir, name)))}`,
    );
  }
  console.log(`[stage-server] 完成 → ${stageDir}`);
}

main();
