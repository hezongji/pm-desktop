/**
 * 本地运行时编排器：把「端口→PG→迁移→播种→双服务→看门狗」串成一条启动链。
 * 对接：index.ts 启动序（步骤 4.5）、recovery 兜底页、托盘/IPC 数据管理入口。
 */
import { existsSync, mkdirSync } from "node:fs";
import {
  bootStageText,
  buildDatabaseUrl,
  type BootProgressEvent,
  type BootStage,
  type RuntimePorts,
} from "../../shared/logic/local-runtime-policy";
import { LOCAL_DB_NAME } from "../../shared/config";
import { log } from "../diagnostics";
import {
  dataRoot,
  baselineSqlPath,
  dbSchemaPath,
  imServerEntry,
  pgBin,
  pgDataDir,
  pmServerEntry,
  prismaCliEntry,
  uploadsDir,
} from "./paths";
import {
  ensureSecrets,
  markSeeded,
  persistPorts,
  readRuntimeState,
  type RuntimeSecrets,
} from "./secrets";
import { allocatePorts } from "./ports";
import { PgService } from "./pg";
import { ServerProcesses, waitHttpReady, type ServerEnv } from "./servers";
import { applyBaseline, runMigrateDeploy } from "./migrate";
import { HealthWatchdog } from "./watchdog";
import {
  dataStats,
  defaultBackupDir,
  exportBackup,
  importBackup,
  type DataStats,
} from "./backup";

export type RuntimePhase =
  | "idle"
  | "booting"
  | "ready"
  | "degraded"
  | "failed"
  | "stopped";

export interface LocalRuntimeStatus {
  mode: "local";
  phase: RuntimePhase;
  apiPort?: number;
  wsPort?: number;
  pgPort?: number;
  dataDir?: string;
  bootStage?: string;
  error?: string;
  startedAt?: string;
}

export class BootError extends Error {
  constructor(
    public readonly stage: BootStage,
    message: string,
  ) {
    super(message);
    this.name = "BootError";
  }
}

export interface LocalRuntimeDeps {
  onProgress: (event: BootProgressEvent) => void;
  /** 看门狗最终升级：服务重启后仍不健康（展示兜底页/对话框由调用方决定） */
  onEscalate: (detail: string) => void;
}

export class LocalRuntime {
  private phase: RuntimePhase = "idle";
  private ports: RuntimePorts | null = null;
  private secrets: RuntimeSecrets | null = null;
  private pg = new PgService();
  private servers: ServerProcesses;
  private watchdog: HealthWatchdog | null = null;
  private startedAt: string | null = null;
  private lastError: string | null = null;
  private lastStage: BootStage | null = null;

  constructor(private deps: LocalRuntimeDeps) {
    this.servers = new ServerProcesses((name) => {
      if (this.phase === "ready") this.watchdog?.notifyProcessExit(name);
    });
  }

  private progress(stage: BootStage): void {
    this.lastStage = stage;
    this.deps.onProgress({ stage, text: bootStageText(stage) });
  }

  private fail(stage: BootStage, error: unknown): BootError {
    const message = error instanceof Error ? error.message : String(error);
    this.phase = "failed";
    this.lastError = message;
    this.deps.onProgress({
      stage: "error",
      text: bootStageText(stage),
      detail: message,
    });
    return new BootError(stage, message);
  }

  /** 快速准备（建窗口前）：资源校验 → 目录 → 密钥 → 端口。失败抛 BootError('prepare') */
  async prepare(): Promise<{ appUrl: string; wsPort: number }> {
    this.phase = "booting";
    this.progress("prepare");
    try {
      const required = [
        pmServerEntry(),
        imServerEntry(),
        prismaCliEntry(),
        dbSchemaPath(),
        pgBin("postgres.exe"),
        pgBin("initdb.exe"),
        pgBin("psql.exe"),
        pgBin("pg_dump.exe"),
        baselineSqlPath(),
      ];
      const missing = required.filter((p) => !existsSync(p));
      if (missing.length > 0) {
        throw new Error(
          `运行资源缺失（安装包损坏？）：\n${missing.join("\n")}`,
        );
      }
      mkdirSync(dataRoot(), { recursive: true });
      mkdirSync(uploadsDir(), { recursive: true });
      const state = readRuntimeState();
      const ensured = ensureSecrets(state);
      this.secrets = ensured.secrets;
      const ports = await allocatePorts(state?.ports);
      if (!ports)
        throw new Error(
          "4310/4312/54329 及其候选端口均被占用，请关闭占用程序后重试",
        );
      persistPorts(ports);
      this.ports = ports;
      log.info(
        `[runtime] 端口分配 api=${ports.apiPort} ws=${ports.wsPort} pg=${ports.pgPort}`,
      );
      return {
        appUrl: `http://127.0.0.1:${ports.apiPort}`,
        wsPort: ports.wsPort,
      };
    } catch (error) {
      throw this.fail("prepare", error);
    }
  }

  /** 重活启动链（窗口启动页展示进度）；就绪后返回 */
  async boot(): Promise<void> {
    if (!this.ports || !this.secrets)
      throw this.fail("prepare", new Error("prepare() 未执行"));
    const ports = this.ports;
    const secrets = this.secrets;
    const databaseUrl = (): string =>
      buildDatabaseUrl(ports.pgPort, secrets.pgPassword, LOCAL_DB_NAME);
    try {
      // 1. 数据库集群（首次 initdb）
      if (!this.pg.isInitialized()) {
        this.progress("initdb");
        await this.pg.initCluster();
      }
      // 2. 启动 PG（scram 后用真实密码；trust 首启阶段该密码被忽略）
      this.progress("start-pg");
      await this.pg.start(ports.pgPort, secrets.pgPassword);
      if (!this.pg.isHardened()) {
        // 首次：trust 启动后立刻加固为 scram-sha-256
        await this.pg.harden(secrets.pgPassword);
      }
      await this.pg.ensureDatabase();
      // 3. 结构迁移（版本升级自动前滚）
      this.progress("migrate");
      await runMigrateDeploy(databaseUrl());
      // 4. 首启空库播种
      const users = await this.pg.countUsers();
      if (users === 0) {
        this.progress("seed");
        await applyBaseline(ports.pgPort, secrets.pgPassword);
        markSeeded();
      }
      // 5. 双服务
      this.progress("start-server");
      this.startServers();
      const healthUrl = `http://127.0.0.1:${ports.apiPort}/api/health`;
      const serverUp = await waitHttpReady(healthUrl, 60_000);
      if (!serverUp) throw new Error("应用服务 60 秒内未就绪（详见日志）");
      this.progress("start-im");
      const imUp = await waitHttpReady(
        `http://127.0.0.1:${ports.wsPort}/socket.io/?EIO=4&transport=polling`,
        30_000,
      );
      if (!imUp) throw new Error("实时消息服务 30 秒内未就绪（详见日志）");
      // 6. 看门狗
      this.watchdog = new HealthWatchdog({
        healthUrl: () => healthUrl,
        onRestartServers: () => this.restartServers(),
        onEscalate: (detail) => {
          this.phase = "degraded";
          this.deps.onEscalate(detail);
        },
      });
      this.watchdog.start();
      this.phase = "ready";
      this.startedAt = new Date().toISOString();
      this.progress("ready");
      log.info("[runtime] 本地运行时全部就绪");
    } catch (error) {
      const stage = this.lastStage ?? "prepare";
      throw this.fail(stage, error);
    }
  }

  private serverEnv(): ServerEnv {
    if (!this.ports || !this.secrets) throw new Error("运行时尚未准备");
    return {
      apiPort: this.ports.apiPort,
      wsPort: this.ports.wsPort,
      databaseUrl: buildDatabaseUrl(
        this.ports.pgPort,
        this.secrets.pgPassword,
        LOCAL_DB_NAME,
      ),
      jwtSecret: this.secrets.jwtSecret,
      uploadsDir: uploadsDir(),
    };
  }

  private startServers(): void {
    this.servers.killAll();
    this.servers.startAll(this.serverEnv());
  }

  /** 看门狗/手动触发的服务重启（PG 不动） */
  async restartServers(): Promise<boolean> {
    if (!this.ports) return false;
    try {
      log.warn("[runtime] 重启应用服务与实时服务…");
      this.startServers();
      const ok = await waitHttpReady(
        `http://127.0.0.1:${this.ports.apiPort}/api/health`,
        45_000,
      );
      if (ok) {
        this.watchdog?.reset();
        if (this.phase !== "ready") this.phase = "ready";
      }
      return ok;
    } catch (error) {
      log.error(`[runtime] 重启服务失败：${String(error)}`);
      return false;
    }
  }

  /** 启动页「重试」：清残留后重跑整条链 */
  async retry(): Promise<void> {
    this.watchdog?.stop();
    this.servers.killAll();
    // PG 保留运行（若是 PG 挂了，pg.start 会因 child 为 null 重新拉起；端口占用则由 allocatePorts 规避）
    if (this.pg.isRunning() === false && this.ports && this.secrets) {
      await this.pg.start(this.ports.pgPort, this.secrets.pgPassword);
    }
    this.phase = "booting";
    await this.boot();
  }

  async stop(): Promise<void> {
    this.phase = "stopped";
    this.watchdog?.stop();
    this.servers.killAll();
    await this.pg.stop();
    log.info("[runtime] 本地运行时已全部停止");
  }

  /** 更新安装链路的同步快杀：不等待优雅停库（quitAndInstall 不容许异步拦截） */
  stopFast(): void {
    this.phase = "stopped";
    this.watchdog?.stop();
    this.servers.killAll();
    this.pg.killFast();
    log.info("[runtime] 本地运行时已快速停止（更新安装链路）");
  }

  status(): LocalRuntimeStatus {
    const base: LocalRuntimeStatus = {
      mode: "local",
      phase: this.phase,
      dataDir: dataRoot(),
    };
    if (this.ports) {
      base.apiPort = this.ports.apiPort;
      base.wsPort = this.ports.wsPort;
      base.pgPort = this.ports.pgPort;
    }
    if (this.lastStage) base.bootStage = this.lastStage;
    if (this.lastError) base.error = this.lastError;
    if (this.startedAt) base.startedAt = this.startedAt;
    return base;
  }

  async backup(targetDir?: string): Promise<string> {
    if (!this.ports || !this.secrets) throw new Error("运行时尚未就绪");
    const dir = targetDir ?? defaultBackupDir();
    mkdirSync(dir, { recursive: true });
    return exportBackup(dir, {
      pgPort: () => this.ports!.pgPort,
      pgPassword: () => this.secrets!.pgPassword,
      stopServers: async () => {
        this.servers.killAll();
      },
      startServers: async () => {
        this.startServers();
      },
    });
  }

  async restore(dumpFile: string): Promise<void> {
    if (!this.ports || !this.secrets) throw new Error("运行时尚未就绪");
    this.watchdog?.stop();
    try {
      await importBackup(dumpFile, {
        pgPort: () => this.ports!.pgPort,
        pgPassword: () => this.secrets!.pgPassword,
        stopServers: async () => {
          this.servers.killAll();
        },
        startServers: async () => {
          this.startServers();
        },
      });
    } finally {
      this.watchdog?.start();
    }
  }

  stats(): DataStats {
    return dataStats(pgDataDir());
  }
}
