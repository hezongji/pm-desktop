/**
 * 结构迁移与基线数据：prisma migrate deploy（随包 CLI）+ 首启 baseline.sql 数据回放。
 * baseline.sql 由构建期 scripts/stage-baseline.mjs 生成（migrate deploy + seed-baseline 后的
 * data-only dump，排除 _prisma_migrations），首启在 migrate 之后回放，天然幂等（仅空库执行）。
 *
 * 迁移进程的拉法（重要）：用 child_process.spawn + ELECTRON_RUN_AS_NODE=1 复用壳内嵌 Node，
 * 而不是 utilityProcess.fork —— utilityProcess 子进程带父进程消息通道，事件循环无法自然排空，
 * prisma CLI 依赖排空退出（不显式 process.exit），直跑会永远挂起（2.0 冒烟实证）。
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { LOCAL_DB_NAME } from "../../shared/config";
import { baselineSqlPath, dbDir, dbSchemaPath, pgBin, prismaCliEntry } from "./paths";
import { log } from "../diagnostics";

const execFileAsync = promisify(execFile);

/** 执行 prisma migrate deploy；失败抛出含输出尾巴的错误 */
export function runMigrateDeploy(databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    log.info(`[migrate] 启动 migrate deploy：${prismaCliEntry()}`);
    const child = spawn(
      process.execPath,
      [prismaCliEntry(), "migrate", "deploy", "--schema", dbSchemaPath()],
      {
        cwd: dbDir(),
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          DATABASE_URL: databaseUrl,
        } as Record<string, string>,
      },
    );
    log.info(`[migrate] 迁移进程已拉起（pid=${String(child.pid)}）`);
    let output = "";
    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > 64_000) output = output.slice(-64_000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      log.error("[migrate] migrate deploy 超时（180s），强杀");
      child.kill();
      reject(new Error("数据结构迁移超时（180 秒未完成）"));
    }, 180_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        log.info("[migrate] migrate deploy 完成");
        resolve();
      } else {
        log.error(`[migrate] migrate deploy 失败 code=${String(code)}\n${output.slice(-2000)}`);
        reject(new Error(`数据结构迁移失败（退出码 ${String(code)}）：${output.slice(-400)}`));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      log.error(`[migrate] 迁移进程异常：${String(error)}`);
      reject(new Error(`数据结构迁移进程异常：${String(error)}`));
    });
  });
}

/** 首启空库：回放 baseline.sql（psql -v ON_ERROR_STOP=1 -f） */
export async function applyBaseline(pgPort: number, pgPassword: string): Promise<void> {
  const sql = baselineSqlPath();
  if (!existsSync(sql)) throw new Error(`基线数据文件缺失：${sql}`);
  await execFileAsync(pgBin("psql.exe"), [
    "-h", "127.0.0.1",
    "-p", String(pgPort),
    "-U", "postgres",
    "-d", LOCAL_DB_NAME,
    "-v", "ON_ERROR_STOP=1",
    "-f", sql,
  ], {
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, PGPASSWORD: pgPassword },
  });
  log.info("[migrate] 基线数据回放完成");
}
