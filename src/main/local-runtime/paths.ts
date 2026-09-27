/** 本地运行时资源与数据路径。打包后资源在 process.resourcesPath，开发时在 build/stage。 */
import { app } from "electron";
import { join } from "node:path";

/** 舞台资源根目录（打包=resources/，dev=build/stage/） */
export function stageRoot(): string {
  if (app.isPackaged) return process.resourcesPath;
  // dev：__dirname = <root>/dist/main/local-runtime（esbuild 打包后实际为 dist/main）
  return join(__dirname, "..", "..", "build", "stage");
}

/** Next standalone 服务目录（含 server/server.js 与共享 node_modules） */
export function pmServerRoot(): string {
  return join(stageRoot(), "pm-server");
}

export function pmServerEntry(): string {
  return join(pmServerRoot(), "server", "server.js");
}

export function pmServerCwd(): string {
  return join(pmServerRoot(), "server");
}

export function imServerEntry(): string {
  return join(stageRoot(), "im-server", "src", "index.js");
}

export function imServerCwd(): string {
  return join(stageRoot(), "im-server");
}

export function pgBinDir(): string {
  return join(stageRoot(), "pg16", "bin");
}

export function pgBin(name: string): string {
  return join(pgBinDir(), name);
}

/** Prisma CLI 入口（随 im-server 的 node_modules 分发） */
export function prismaCliEntry(): string {
  return join(stageRoot(), "im-server", "node_modules", "prisma", "build", "index.js");
}

export function dbSchemaPath(): string {
  return join(stageRoot(), "db", "schema.prisma");
}

export function dbDir(): string {
  return join(stageRoot(), "db");
}

export function baselineSqlPath(): string {
  return join(stageRoot(), "seed", "baseline.sql");
}

// ── 数据侧（userData，卸载默认保留，见 DEVIATIONS D3-2）──

export function dataRoot(): string {
  return app.getPath("userData");
}

export function pgDataDir(): string {
  return join(dataRoot(), "pgdata");
}

export function uploadsDir(): string {
  return join(dataRoot(), "uploads");
}

export function backupsDir(): string {
  return join(dataRoot(), "backups");
}

export function runtimeStatePath(): string {
  return join(dataRoot(), "runtime.json");
}

export function pgLogPath(): string {
  return join(dataRoot(), "logs", "postgres.log");
}
