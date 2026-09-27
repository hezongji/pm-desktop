/**
 * 应用服务进程：Next standalone 与 im-server，经 Electron utilityProcess.fork
 * 复用壳内置 Node 运行（不额外捆绑 node.exe，见方案 D3-3）。
 */
import { utilityProcess, type UtilityProcess } from "electron";
import {
  imServerCwd,
  imServerEntry,
  pmServerCwd,
  pmServerEntry,
} from "./paths";
import { log } from "../diagnostics";

export interface ServerEnv {
  apiPort: number;
  wsPort: number;
  databaseUrl: string;
  jwtSecret: string;
  uploadsDir: string;
}

export type ServerExitHandler = (
  name: "server" | "im",
  code: number | null,
) => void;

function pipeToLog(child: UtilityProcess, name: string): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim() !== "") log.info(`[${name}] ${line}`);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim() !== "") log.warn(`[${name}:err] ${line}`);
    }
  });
}

export class ServerProcesses {
  private server: UtilityProcess | null = null;
  private im: UtilityProcess | null = null;

  constructor(private onExit: ServerExitHandler) {}

  startAll(env: ServerEnv): void {
    this.startAppServer(env);
    this.startImServer(env);
  }

  private startAppServer(env: ServerEnv): void {
    const child = utilityProcess.fork(pmServerEntry(), [], {
      cwd: pmServerCwd(),
      serviceName: "pm-app-server",
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(env.apiPort),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: env.databaseUrl,
        JWT_SECRET: env.jwtSecret,
        FILE_ROOT: env.uploadsDir,
      } as Record<string, string>,
    });
    pipeToLog(child, "server");
    child.on("exit", (code) => {
      log.warn(`[server] 进程退出 code=${String(code)}`);
      this.server = null;
      this.onExit("server", code);
    });
    this.server = child;
    log.info(`[server] 已启动（pid=${String(child.pid)} port=${env.apiPort}）`);
  }

  private startImServer(env: ServerEnv): void {
    const child = utilityProcess.fork(imServerEntry(), [], {
      cwd: imServerCwd(),
      serviceName: "pm-im-server",
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        IM_PORT: String(env.wsPort),
        IM_HOST: "127.0.0.1",
        IM_DATABASE_URL: env.databaseUrl,
        JWT_SECRET: env.jwtSecret,
      } as Record<string, string>,
    });
    pipeToLog(child, "im");
    child.on("exit", (code) => {
      log.warn(`[im] 进程退出 code=${String(code)}`);
      this.im = null;
      this.onExit("im", code);
    });
    this.im = child;
    log.info(`[im] 已启动（pid=${String(child.pid)} port=${env.wsPort}）`);
  }

  isRunning(): boolean {
    return this.server !== null && this.im !== null;
  }

  killAll(): void {
    for (const child of [this.server, this.im]) {
      try {
        child?.kill();
      } catch {
        /* 已退出 */
      }
    }
    this.server = null;
    this.im = null;
  }
}

/** 等待 HTTP 端点就绪（返回 2xx） */
export async function waitHttpReady(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status >= 200 && response.status < 300) return true;
    } catch {
      /* 未就绪 */
    }
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
