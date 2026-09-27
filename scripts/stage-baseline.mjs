/**
 * Stage 3/3：生成首启基线数据 build/stage/seed/baseline.sql。
 * 流程：临时 PG（54999 端口，trust）→ migrate deploy → seed-baseline → data-only dump。
 * 运行时首启在 migrate deploy 之后回放该文件（仅空库执行，天然幂等）。
 *
 *   node scripts/stage-baseline.mjs            # 已存在则跳过
 *   node scripts/stage-baseline.mjs --force    # 强制重新生成
 *
 * 注意：务必在 stage-server / 本机 PG 可用后运行；临时库全程在 build/.baseline-pgdata，结束即清理。
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const serverDir = join(root, "server");
const force = process.argv.includes("--force");
const SCRATCH_PORT = 54999;
const SCRATCH_DB = "pm_baseline";
const scratchDir = join(root, "build", ".baseline-pgdata");
const scratchLog = join(root, "build", ".baseline-postgres.log");
const seedDir = join(root, "build", "stage", "seed");
const outputFile = join(seedDir, "baseline.sql");

const pgCandidates = [
  join(root, "build", "stage", "pg16", "bin"),
  process.env.PG_SOURCE_DIR ? join(process.env.PG_SOURCE_DIR, "bin") : "",
  join("C:\\", "Program Files", "PostgreSQL", "16", "bin"),
].filter(Boolean);
const pgBinDir = pgCandidates.find((dir) =>
  existsSync(join(dir, "initdb.exe")),
);

const databaseUrl = `postgresql://postgres@127.0.0.1:${SCRATCH_PORT}/${SCRATCH_DB}`;
let postgresChild = null;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: options.shell === true,
    windowsHide: true,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    throw new Error(
      `命令失败（退出码 ${result.status}）：${command} ${commandArgs.join(" ")}`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitPgReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = spawnSync(
      join(pgBinDir, "pg_isready.exe"),
      ["-h", "127.0.0.1", "-p", String(SCRATCH_PORT), "-t", "1"],
      { windowsHide: true },
    );
    if (result.status === 0) return;
    if (Date.now() > deadline) throw new Error("临时 PostgreSQL 40 秒内未就绪");
    await sleep(500);
  }
}

function stopScratchPg() {
  if (!postgresChild) return;
  const pid = postgresChild.pid;
  try {
    spawnSync(
      join(pgBinDir, "pg_ctl.exe"),
      ["-D", scratchDir, "stop", "-m", "fast", "-t", "10"],
      { windowsHide: true },
    );
  } catch {
    /* 继续走强杀 */
  }
  if (pid) {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      /* 已退出 */
    }
  }
  postgresChild = null;
}

process.on("exit", () => {
  // 兜底：脚本被外部终止时尽量不要留下 54999 占用
  if (postgresChild?.pid) {
    try {
      spawnSync("taskkill", ["/PID", String(postgresChild.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      /* 忽略 */
    }
  }
});

async function main() {
  if (existsSync(outputFile) && !force) {
    console.log(
      `[stage-baseline] 已存在，跳过（--force 重新生成）：${outputFile}`,
    );
    return;
  }
  if (!pgBinDir) {
    console.error(
      "[stage-baseline] 找不到 PostgreSQL 二进制（先跑 stage-pg，或安装 PG16）",
    );
    process.exit(1);
  }
  if (
    !existsSync(join(serverDir, "node_modules", "prisma", "build", "index.js"))
  ) {
    console.error(
      "[stage-baseline] server/node_modules 缺 prisma CLI（先在 server/ 下 npm ci）",
    );
    process.exit(1);
  }

  mkdirSync(seedDir, { recursive: true });
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(scratchDir, { recursive: true });

  try {
    console.log(`[stage-baseline] initdb（${pgBinDir}）…`);
    run(join(pgBinDir, "initdb.exe"), [
      "-D",
      scratchDir,
      "-U",
      "postgres",
      "-E",
      "UTF8",
      "--locale=C",
      "-A",
      "trust",
    ]);

    console.log(
      `[stage-baseline] 启动临时 PostgreSQL（127.0.0.1:${SCRATCH_PORT}）…`,
    );
    // stdio 传数字 fd（同步打开）：WriteStream 的 fd 是异步分配的，spawn 时可能尚未就绪
    const pgLogFd = openSync(scratchLog, "a");
    postgresChild = spawn(
      join(pgBinDir, "postgres.exe"),
      ["-D", scratchDir, "-p", String(SCRATCH_PORT), "-h", "127.0.0.1"],
      { stdio: ["ignore", pgLogFd, pgLogFd], windowsHide: true },
    );
    closeSync(pgLogFd);
    await waitPgReady(40_000);

    console.log("[stage-baseline] 建库 + 结构迁移…");
    run(join(pgBinDir, "createdb.exe"), [
      "-h",
      "127.0.0.1",
      "-p",
      String(SCRATCH_PORT),
      "-U",
      "postgres",
      SCRATCH_DB,
    ]);
    run(
      process.execPath,
      [
        join(serverDir, "node_modules", "prisma", "build", "index.js"),
        "migrate",
        "deploy",
        "--schema",
        join(serverDir, "prisma", "schema.prisma"),
      ],
      { env: { DATABASE_URL: databaseUrl } },
    );

    console.log("[stage-baseline] 回放基线播种（seed-baseline.ts）…");
    run("npx", ["tsx", "prisma/seed-baseline.ts"], {
      cwd: serverDir,
      shell: true,
      env: { DATABASE_URL: databaseUrl },
    });

    console.log(
      "[stage-baseline] 导出 data-only dump → build/stage/seed/baseline.sql …",
    );
    // --disable-triggers：业务表存在跨表循环外键（Department↔User 等），
    // data-only 回放时先 DISABLE TRIGGER ALL 绕过插入顺序约束，结束后 ENABLE
    run(join(pgBinDir, "pg_dump.exe"), [
      "-h",
      "127.0.0.1",
      "-p",
      String(SCRATCH_PORT),
      "-U",
      "postgres",
      "-d",
      SCRATCH_DB,
      "--data-only",
      "--disable-triggers",
      "--exclude-table-data=_prisma_migrations",
      "-f",
      outputFile,
    ]);
  } finally {
    stopScratchPg();
    rmSync(scratchDir, { recursive: true, force: true });
    rmSync(scratchLog, { force: true });
  }

  if (!existsSync(outputFile)) {
    console.error("[stage-baseline] 导出失败：baseline.sql 未生成");
    process.exit(1);
  }
  console.log(`[stage-baseline] 完成 → ${outputFile}`);
}

main().catch((error) => {
  console.error(
    `[stage-baseline] 失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
