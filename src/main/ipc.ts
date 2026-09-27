/**
 * IPC 白名单注册（规格书 §4.6）：preload 只转发，主进程统一校验来源与参数。
 * 每个 handler 先校验 senderFrame origin ∈ {APP_URL 域}，不匹配一律拒绝。
 */
import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { existsSync } from "node:fs";
import { IPC } from "../shared/ipc-channels";
import { BUILD_CHANNEL } from "../shared/config";
import { isLocalToolPageUrl, isTrustedFrameUrl } from "../shared/logic/origin";
import { normalizeServerUrl } from "../shared/logic/app-config";
import type {
  AppInfo,
  BackupResult,
  DataStatsInfo,
  FileFilter,
  PrintOptions,
  PrintResult,
  RuntimeActionResult,
  RuntimeStatusInfo,
  SaveFileResult,
  ClearSessionResult,
  OpenFileResult,
  UpdateCheckResult,
} from "../shared/types";
import {
  configFileLocation,
  readLocalConfig,
  writeLocalConfig,
} from "./app-config-io";
import { log, logDirLocation, sentryStatus } from "./diagnostics";
import { showOpenDialog, showSaveDialog } from "./dialogs";
import { notify } from "./notifications";
import { printCurrentPage } from "./printing";
import { clearAppSession } from "./session";
import { setTrayUnread } from "./tray";
import { checkForUpdates, downloadUpdate } from "./updater";
import type { LocalRuntime } from "./local-runtime";

export interface IpcContext {
  getAppUrl: () => string;
  getWindow: () => BrowserWindow | null;
  /** 渲染进程异常转发（规格书 §8 P3.2） */
  onRendererError: (
    message: string,
    kind: "error" | "unhandledrejection",
    source?: string,
    stack?: string,
  ) => void;
  onServerUrlChanged: (url: string) => void;
  /** 本地运行时（云端薄壳模式为 null，相关通道返回降级结果） */
  getRuntime: () => LocalRuntime | null;
}

export interface RendererErrorPayload {
  message?: unknown;
  kind?: unknown;
  source?: unknown;
  stack?: unknown;
}

function asFilters(value: unknown): FileFilter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filters: FileFilter[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !Array.isArray(record.extensions))
      continue;
    filters.push({
      name: record.name,
      extensions: record.extensions.filter(
        (ext): ext is string => typeof ext === "string",
      ),
    });
  }
  return filters.length > 0 ? filters : undefined;
}

function asPrintOptions(value: unknown): PrintOptions {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const mode = record.mode === "pdf" ? "pdf" : "printer";
    return {
      mode,
      ...(typeof record.defaultFileName === "string"
        ? { defaultFileName: record.defaultFileName }
        : {}),
      ...(typeof record.deviceName === "string"
        ? { deviceName: record.deviceName }
        : {}),
      ...(typeof record.silent === "boolean" ? { silent: record.silent } : {}),
    };
  }
  return { mode: "printer" };
}

export function registerIpc(ctx: IpcContext): void {
  const guard = <T>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
    options?: { allowToolPage?: boolean },
  ) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<T> => {
      const frameUrl = event.senderFrame?.url ?? null;
      const trusted = isTrustedFrameUrl(frameUrl, ctx.getAppUrl());
      const toolPageAllowed =
        options?.allowToolPage === true && isLocalToolPageUrl(frameUrl);
      if (!trusted && !toolPageAllowed) {
        log.warn(
          `[ipc] 拒绝来源不可信的调用 channel=${channel} frame=${frameUrl ?? "null"}`,
        );
        throw new Error("IPC 调用来源不受信任");
      }
      return handler(event, ...args);
    });
  };

  guard<AppInfo>(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    appUrl: ctx.getAppUrl(),
    channel: BUILD_CHANNEL,
    isPackaged: app.isPackaged,
  }));

  guard<UpdateCheckResult>(IPC.updaterCheck, () => checkForUpdates(true));
  guard<UpdateCheckResult>(IPC.updaterDownload, () => downloadUpdate());

  guard<boolean>(IPC.notifyShow, (_event, title, body) => {
    const safeTitle =
      typeof title === "string" && title.trim() !== ""
        ? title.slice(0, 120)
        : "项目管理系统";
    const safeBody = typeof body === "string" ? body.slice(0, 500) : "";
    return notify({
      title: safeTitle,
      body: safeBody,
      onClick: () => ctx.getWindow()?.show(),
    });
  });

  guard<SaveFileResult>(IPC.dialogSave, (_event, defaultName, filters) =>
    showSaveDialog(
      ctx.getWindow(),
      typeof defaultName === "string" && defaultName !== ""
        ? defaultName
        : "未命名",
      asFilters(filters),
    ),
  );

  guard<OpenFileResult>(IPC.dialogOpen, (_event, filters) =>
    showOpenDialog(ctx.getWindow(), asFilters(filters)),
  );

  guard<PrintResult>(IPC.printDo, (_event, options) => {
    const win = ctx.getWindow();
    if (!win) return { ok: false, reason: "窗口不可用" };
    return printCurrentPage(win, asPrintOptions(options));
  });

  guard<string>(IPC.serverUrlGet, () => ctx.getAppUrl());

  guard<{ ok: boolean; url?: string; error?: string }>(
    IPC.serverUrlSet,
    async (_event, rawUrl) => {
      const normalized = normalizeServerUrl(
        typeof rawUrl === "string" ? rawUrl : "",
      );
      if (!normalized.ok || !normalized.url)
        return { ok: false, error: normalized.error ?? "地址非法" };
      const win = ctx.getWindow();
      const options: Electron.MessageBoxOptions = {
        type: "question",
        title: "修改服务器地址",
        message: `将服务器地址修改为：\n${normalized.url}`,
        detail: `配置文件：${configFileLocation()}\n需重启客户端生效。`,
        buttons: ["确认修改", "取消"],
        defaultId: 1,
        cancelId: 1,
      };
      const confirm = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options);
      if (confirm.response !== 0) return { ok: false, error: "用户取消" };
      const current = readLocalConfig();
      const saved = writeLocalConfig({ ...current, appUrl: normalized.url });
      if (!saved) return { ok: false, error: "写入本地配置失败" };
      ctx.onServerUrlChanged(normalized.url);
      return { ok: true, url: normalized.url };
    },
  );

  guard<boolean>(
    IPC.revealLog,
    async () => {
      const result = await shell.openPath(logDirLocation());
      if (result !== "") log.warn(`[ipc] 打开日志目录失败：${result}`);
      return result === "";
    },
    { allowToolPage: true },
  );

  guard<boolean>(IPC.badgeSet, (_event, count) => {
    const numeric = typeof count === "number" ? count : Number(count);
    setTrayUnread(Number.isFinite(numeric) ? numeric : 0, ctx.getWindow());
    return true;
  });

  guard<ClearSessionResult>(IPC.sessionClear, (_event, scope) =>
    clearAppSession(scope === "all" ? "all" : "cache"),
  );

  guard<boolean>(IPC.pageReloadClean, () => {
    const win = ctx.getWindow();
    if (!win) return false;
    log.warn("[ipc] 渲染进程请求 bypassCache 重载");
    win.webContents.reloadIgnoringCache();
    return true;
  });

  // ── 本地运行时（2.0）：云端薄壳模式下 getRuntime() 为 null，通道降级返回 ──

  guard<RuntimeStatusInfo>(IPC.runtimeStatus, () => {
    const runtime = ctx.getRuntime();
    if (!runtime) return { mode: "cloud", phase: "idle" };
    return runtime.status();
  });

  guard<RuntimeActionResult>(
    IPC.runtimeRetry,
    async () => {
      const runtime = ctx.getRuntime();
      if (!runtime) return { ok: false, error: "当前为云端模式，无本地运行时" };
      try {
        await runtime.retry();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { allowToolPage: true },
  ); // 启动页（boot.html）的「重试」按钮

  guard<RuntimeActionResult>(IPC.runtimeRestart, async () => {
    const runtime = ctx.getRuntime();
    if (!runtime) return { ok: false, error: "当前为云端模式，无本地运行时" };
    const ok = await runtime.restartServers();
    return ok
      ? { ok: true }
      : { ok: false, error: "服务重启后仍未就绪，详见日志" };
  });

  guard<BackupResult>(IPC.dataBackup, async (_event, targetDir) => {
    const runtime = ctx.getRuntime();
    if (!runtime) return { ok: false, reason: "当前为云端模式，无本地数据" };
    try {
      const dir =
        typeof targetDir === "string" && targetDir.trim() !== ""
          ? targetDir
          : undefined;
      const file = await runtime.backup(dir);
      shell.showItemInFolder(file);
      return { ok: true, path: file };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });

  guard<RuntimeActionResult>(IPC.dataRestore, async (_event, dumpFile) => {
    const runtime = ctx.getRuntime();
    if (!runtime) return { ok: false, error: "当前为云端模式，无本地数据" };
    const file = typeof dumpFile === "string" ? dumpFile : "";
    if (
      file === "" ||
      !existsSync(file) ||
      !file.toLowerCase().endsWith(".dump")
    ) {
      return { ok: false, error: "备份文件不存在或不是 .dump 格式" };
    }
    const win = ctx.getWindow();
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      title: "恢复数据",
      message: "恢复将覆盖当前全部本地数据，且不可撤销。",
      detail: `备份文件：${file}\n\n恢复期间应用会短暂不可用，完成后自动重启本地服务。`,
      buttons: ["确认恢复", "取消"],
      defaultId: 1,
      cancelId: 1,
    };
    const confirm = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    if (confirm.response !== 0) return { ok: false, error: "用户取消" };
    try {
      await runtime.restore(file);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  guard<boolean>(IPC.dataOpenFolder, async () => {
    const runtime = ctx.getRuntime();
    if (!runtime) return false;
    const dir = runtime.status().dataDir;
    if (!dir) return false;
    const result = await shell.openPath(dir);
    return result === "";
  });

  guard<DataStatsInfo>(IPC.dataStats, () => {
    const runtime = ctx.getRuntime();
    if (!runtime)
      return { pgBytes: 0, uploadsBytes: 0, backupsBytes: 0, human: "0 B" };
    return runtime.stats();
  });

  // 单向通道：渲染异常转发（不返回结果，仅校验来源后记录/上报）
  ipcMain.on("diag:renderer-error", (event, payload: RendererErrorPayload) => {
    const frameUrl = event.senderFrame?.url ?? null;
    if (!isTrustedFrameUrl(frameUrl, ctx.getAppUrl())) {
      log.warn(
        `[ipc] 拒绝来源不可信的渲染异常上报 frame=${frameUrl ?? "null"}`,
      );
      return;
    }
    if (typeof payload !== "object" || payload === null) return;
    const message =
      typeof payload.message === "string"
        ? payload.message.slice(0, 2000)
        : "未知渲染异常";
    const kind =
      payload.kind === "unhandledrejection" ? "unhandledrejection" : "error";
    const source =
      typeof payload.source === "string"
        ? payload.source.slice(0, 500)
        : undefined;
    const stack =
      typeof payload.stack === "string"
        ? payload.stack.slice(0, 4000)
        : undefined;
    ctx.onRendererError(message, kind, source, stack);
  });

  log.info(`[ipc] 已注册白名单通道（sentry=${sentryStatus() ? "on" : "off"}）`);
}
