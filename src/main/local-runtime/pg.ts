/**
 * 嵌入式 PostgreSQL 生命周期：initdb → 启动 → 就绪等待 → 加固 → 停止。
 * 二进制随安装包分发（resources/pg16，打包自 PostgreSQL 16 EDB 二进制，许可证见 build/stage/pg16/LICENSE）。
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { LOCAL_DB_NAME } from "../../shared/config";
import { pgBin, pgDataDir, pgLogPath } from "./paths";
import { log } from "../diagnostics";

const execFileAsync = promisify(execFile);

export class PgService {
  private child: ChildProcess | null = null;
  private port = 0;
  private password = "";

  /** 数据库集群是否已初始化（PG_VERSION 存在即视为已初始化） */
  isInitialized(): boolean {
    return existsSync(join(pgDataDir(), "PG_VERSION"));
  }

  /** 主进程是否在本壳内运行中 */
  isRunning(): boolean {
    return this.child !== null;
  }

  /** 是否已加固（pg_hba.conf 不再含 trust 认证行） */
  isHardened(): boolean {
    const hbaPath = join(pgDataDir(), "pg_hba.conf");
    if (!existsSync(hbaPath)) return false;
    const hba = readFileSync(hbaPath, "utf8");
    return !/^\s*host\s+.*\btrust\s*$/m.test(hba);
  }

  /** 首次启动：initdb（trust 临时认证，启动后立刻加固为 scram-sha-256） */
  async initCluster(): Promise<void> {
    const dataDir = pgDataDir();
    mkdirSync(dirname(dataDir), { recursive: true });
    log.info(`[pg] initdb 开始：${dataDir}`);
    await execFileAsync(
      pgBin("initdb.exe"),
      [
        "-D",
        dataDir,
        "-U",
        "postgres",
        "-E",
        "UTF8",
        "--locale=C",
        "-A",
        "trust",
      ],
      { timeout: 120_000, windowsHide: true },
    );
    log.info("[pg] initdb 完成");
  }

  /** 启动 postgres 主进程（stdio 落 userData/logs/postgres.log） */
  async start(port: number, password: string): Promise<void> {
    if (this.child) throw new Error("PgService 已在运行");
    this.port = port;
    this.password = password;
    const logFile = pgLogPath();
    mkdirSync(dirname(logFile), { recursive: true });
    // stdio 传数字 fd（同步打开）：WriteStream 的 fd 是异步分配的，spawn 时可能尚未就绪
    const logFd = openSync(logFile, "a");
    this.child = spawn(
      pgBin("postgres.exe"),
      ["-D", pgDataDir(), "-p", String(port), "-h", "127.0.0.1"],
      { stdio: ["ignore", logFd, logFd], windowsHide: true },
    );
    closeSync(logFd);
    this.child.on("exit", (code, signal) => {
      log.warn(
        `[pg] postgres 退出 code=${String(code)} signal=${String(signal)}`,
      );
      this.child = null;
    });
    await this.waitReady(40_000);
  }

  private async waitReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await execFileAsync(
          pgBin("pg_isready.exe"),
          ["-h", "127.0.0.1", "-p", String(this.port), "-t", "1"],
          { timeout: 3_000, windowsHide: true },
        );
        return;
      } catch {
        if (Date.now() > deadline)
          throw new Error("PostgreSQL 启动后 40 秒仍未就绪");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  /** 执行 psql 命令（自动带 PGPASSWORD；trust 阶段该变量无害） */
  async psql(args: string[], database = "postgres"): Promise<string> {
    const { stdout } = await execFileAsync(
      pgBin("psql.exe"),
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(this.port),
        "-U",
        "postgres",
        "-d",
        database,
        "-tA",
        ...args,
      ],
      {
        timeout: 60_000,
        windowsHide: true,
        env: { ...process.env, PGPASSWORD: this.password },
      },
    );
    return stdout.trim();
  }

  /** 首次启动后加固：设密码 + pg_hba trust→scram-sha-256 + reload */
  async harden(password: string): Promise<void> {
    const escaped = password.replace(/'/g, "''");
    await this.psql(["-c", `ALTER USER postgres PASSWORD '${escaped}'`]);
    const hbaPath = join(pgDataDir(), "pg_hba.conf");
    const hba = readFileSync(hbaPath, "utf8");
    const hardened = hba.replace(
      /^(\s*host\s+.*?)\btrust\s*$/gm,
      "$1scram-sha-256",
    );
    if (hardened !== hba) {
      writeFileSync(hbaPath, hardened, "utf8");
      await this.psql(["-c", "SELECT pg_reload_conf()"]);
      log.info("[pg] 已加固为 scram-sha-256 密码认证");
    }
    this.password = password;
  }

  /** 确保业务库存在 */
  async ensureDatabase(): Promise<void> {
    const found = await this.psql([
      "-c",
      `SELECT 1 FROM pg_database WHERE datname='${LOCAL_DB_NAME}'`,
    ]);
    if (found === "1") return;
    await execFileAsync(
      pgBin("createdb.exe"),
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(this.port),
        "-U",
        "postgres",
        LOCAL_DB_NAME,
      ],
      {
        timeout: 30_000,
        windowsHide: true,
        env: { ...process.env, PGPASSWORD: this.password },
      },
    );
    log.info(`[pg] 已创建数据库 ${LOCAL_DB_NAME}`);
  }

  /** 查询用户数（判断空库；表不存在视为查询失败→返回 null 由调用方处理） */
  async countUsers(): Promise<number | null> {
    try {
      const out = await this.psql(
        ["-c", 'SELECT count(*) FROM "User"'],
        LOCAL_DB_NAME,
      );
      const n = Number.parseInt(out, 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /** 优雅停止（pg_ctl fast），超时兜底强杀 */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      await execFileAsync(
        pgBin("pg_ctl.exe"),
        ["-D", pgDataDir(), "stop", "-m", "fast", "-t", "10"],
        { timeout: 15_000, windowsHide: true },
      );
    } catch (error) {
      log.warn(`[pg] pg_ctl stop 异常，兜底强杀：${String(error)}`);
      child.kill();
    }
    this.child = null;
    log.info("[pg] 已停止");
  }

  /** 同步快杀（仅用于更新安装链路；非正常关闭，下次启动 PG 走 WAL 崩溃恢复） */
  killFast(): void {
    try {
      this.child?.kill();
    } catch {
      /* 已退出 */
    }
    this.child = null;
  }
}
