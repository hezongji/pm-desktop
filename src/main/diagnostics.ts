/**
 * 日志与崩溃上报（规格书 §4.1 第 3 步 / §6 第 5 条 / §8 P3.2）。
 * - electron-log：%APPDATA%/pm-desktop/logs/main.log，单文件 5MB 轮转，保留 3 份
 * - Sentry：仅在提供 SENTRY_DSN 时启用；beforeSend 深拷贝脱敏 JWT/口令
 */
import { app } from 'electron';
import log from 'electron-log/main';
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { REDACTED, redactInPlace, redactText, redactValue } from '../shared/logic/redact';
import { resolvedLogFilePath, resolvedLogsDir } from './app-paths';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const KEEP_ARCHIVES = 3;

export interface RendererErrorPayload {
  message: string;
  stack?: string;
  source?: string;
  kind: 'error' | 'unhandledrejection';
}

let sentryEnabled = false;

/** 保留 3 份历史日志：main.log → main.1.log → main.2.log */
function rotateArchive(logFile: string): void {
  if (!existsSync(logFile)) return;
  const archives = Array.from({ length: KEEP_ARCHIVES }, (_, index) =>
    index === 0 ? `${logFile}.old` : `${logFile}.old.${index}`,
  );
  const oldest = archives[archives.length - 1];
  if (existsSync(oldest)) {
    try {
      unlinkSync(oldest);
    } catch {
      // 归档清理失败不阻断日志写入
    }
  }
  for (let index = archives.length - 2; index >= 0; index -= 1) {
    const from = archives[index];
    const to = archives[index + 1];
    if (existsSync(from)) {
      try {
        renameSync(from, to);
      } catch {
        // 忽略单次归档失败
      }
    }
  }
  try {
    renameSync(logFile, archives[0]);
  } catch {
    // 忽略
  }
}

export function initDiagnostics(appVersion: string): string {
  const logFile = resolvedLogFilePath();
  log.transports.file.resolvePathFn = () => logFile;
  log.transports.file.level = 'info';
  log.transports.file.maxSize = MAX_LOG_BYTES;
  log.transports.file.archiveLogFn = (file: { path: string }) => rotateArchive(file.path);
  log.transports.console.level = app.isPackaged ? 'info' : 'debug';

  log.hooks.push((message) => {
    const redacted = message.data.map((item) =>
      typeof item === 'string' ? redactText(item) : redactValue(item),
    );
    return { ...message, data: redacted as unknown[] };
  });

  log.info(
    `[boot] pm-desktop ${appVersion} 启动 electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} packaged=${app.isPackaged}`,
  );
  if (existsSync(logFile)) {
    try {
      log.info(`[boot] 当前日志大小 ${statSync(logFile).size} 字节，日志目录 ${resolvedLogsDir()}`);
    } catch {
      // 忽略
    }
  }
  return logFile;
}

export interface SentryInitResult {
  enabled: boolean;
  reason?: string;
}

/** Sentry 初始化：无 DSN 时完全禁用（规格书 §3 依赖说明） */
export async function initSentry(appVersion: string): Promise<SentryInitResult> {
  const dsn = process.env.SENTRY_DSN ?? '';
  if (dsn.trim() === '') {
    log.info('[sentry] 未配置 SENTRY_DSN，崩溃上报已禁用');
    return { enabled: false, reason: 'no-dsn' };
  }
  try {
    const Sentry = await import('@sentry/electron/main');
    Sentry.init({
      dsn,
      release: `pm-desktop@${appVersion}`,
      environment: app.isPackaged ? 'production' : 'development',
      tracesSampleRate: 0,
      beforeSend(event) {
        // 原地脱敏：敏感键替换为 [已脱敏]，字符串值中的 JWT/Bearer 串一并清洗
        redactInPlace(event);
        return event;
      },
    });
    sentryEnabled = true;
    log.info('[sentry] 已启用（beforeSend 脱敏：敏感键与 JWT 串）');
    return { enabled: true };
  } catch (error) {
    log.warn(`[sentry] 初始化失败，已降级为仅本地日志：${String(error)}`);
    return { enabled: false, reason: 'init-failed' };
  }
}

/** 渲染进程异常（preload 经 IPC 转发，规格书 §8 P3.2） */
export function captureRendererError(payload: RendererErrorPayload): void {
  log.warn(`[renderer:${payload.kind}] ${payload.message}${payload.source ? ` @ ${payload.source}` : ''}`);
  if (!sentryEnabled) return;
  void import('@sentry/electron/main').then((Sentry) => {
    Sentry.captureMessage(`renderer-${payload.kind}: ${payload.message}`, {
      level: 'error',
      extra: { stack: payload.stack, source: payload.source },
    });
  });
}

export { log };
export const REDACTION_MARKER = REDACTED;
export function logFileLocation(): string {
  return resolvedLogFilePath();
}
export function logDirLocation(): string {
  return resolvedLogsDir();
}
export function sentryStatus(): boolean {
  return sentryEnabled;
}
export function joinLogFile(dir: string, name: string): string {
  return join(dir, name);
}
