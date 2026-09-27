/**
 * 数据主权：备份/恢复/用量统计（规格书 2.0 方案 §4.3）。
 * 备份 = pg_dump 自定义格式 + uploads 目录复制；恢复 = 停服务 → pg_restore → 起服务。
 */
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { LOCAL_DB_NAME } from "../../shared/config";
import { backupsDir, pgBin, uploadsDir } from "./paths";
import { log } from "../diagnostics";

const execFileAsync = promisify(execFile);

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export interface BackupHooks {
  pgPort: () => number;
  pgPassword: () => string;
  /** 恢复前停服务、恢复后起服务（由编排器注入） */
  stopServers: () => Promise<void>;
  startServers: () => Promise<void>;
}

/** 导出备份到指定目录；返回产物路径 */
export async function exportBackup(
  targetDir: string,
  hooks: BackupHooks,
): Promise<string> {
  const stamp = timestamp();
  const dumpFile = join(targetDir, `pm-backup-${stamp}.dump`);
  await execFileAsync(
    pgBin("pg_dump.exe"),
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(hooks.pgPort()),
      "-U",
      "postgres",
      "-d",
      LOCAL_DB_NAME,
      "-Fc",
      "-f",
      dumpFile,
    ],
    {
      timeout: 300_000,
      windowsHide: true,
      env: { ...process.env, PGPASSWORD: hooks.pgPassword() },
    },
  );
  const uploads = uploadsDir();
  if (existsSync(uploads)) {
    cpSync(uploads, join(targetDir, `pm-uploads-${stamp}`), {
      recursive: true,
    });
  }
  log.info(`[backup] 备份完成 → ${dumpFile}`);
  return dumpFile;
}

/** 从 pg_dump 自定义格式文件恢复（调用方需先确认对话框） */
export async function importBackup(
  dumpFile: string,
  hooks: BackupHooks,
): Promise<void> {
  await hooks.stopServers();
  try {
    await execFileAsync(
      pgBin("pg_restore.exe"),
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(hooks.pgPort()),
        "-U",
        "postgres",
        "-d",
        LOCAL_DB_NAME,
        "--clean",
        "--if-exists",
        dumpFile,
      ],
      {
        timeout: 300_000,
        windowsHide: true,
        env: { ...process.env, PGPASSWORD: hooks.pgPassword() },
      },
    );
    log.info(`[backup] 恢复完成 ← ${dumpFile}`);
  } finally {
    await hooks.startServers();
  }
}

function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else if (entry.isFile()) total += statSync(full).size;
    } catch {
      /* 占用中文件跳过 */
    }
  }
  return total;
}

export interface DataStats {
  pgBytes: number;
  uploadsBytes: number;
  backupsBytes: number;
  human: string;
}

export function dataStats(pgDataDir: string): DataStats {
  const pgBytes = dirSizeBytes(pgDataDir);
  const uploadsBytes = dirSizeBytes(uploadsDir());
  const backupsBytes = dirSizeBytes(backupsDir());
  const total = pgBytes + uploadsBytes + backupsBytes;
  return { pgBytes, uploadsBytes, backupsBytes, human: humanBytes(total) };
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function defaultBackupDir(): string {
  const dir = backupsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
