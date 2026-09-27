/**
 * preload：仅做白名单转发，无业务逻辑（规格书 §4.6 / §6 第 2 条）。
 * sandbox:true 下经 polyfilled require 使用 electron 的 contextBridge / ipcRenderer。
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC, IPC_EVENTS } from "../shared/ipc-channels";
import type {
  AppInfo,
  BackupResult,
  ClearSessionResult,
  DataStatsInfo,
  FileFilter,
  OpenFileResult,
  PmDesktopApi,
  PrintOptions,
  PrintResult,
  RuntimeActionResult,
  RuntimeStatusInfo,
  SaveFileResult,
  Unsubscribe,
  UpdateCheckResult,
} from "../shared/types";

function subscribe<T>(
  channel: string,
  handler: (payload: T) => void,
): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: PmDesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>,
  checkForUpdates: () =>
    ipcRenderer.invoke(IPC.updaterCheck) as Promise<UpdateCheckResult>,
  downloadUpdate: () =>
    ipcRenderer.invoke(IPC.updaterDownload) as Promise<UpdateCheckResult>,
  notify: (title: string, body: string) =>
    ipcRenderer.invoke(IPC.notifyShow, title, body) as Promise<boolean>,
  saveFile: (defaultName: string, filters?: FileFilter[]) =>
    ipcRenderer.invoke(
      IPC.dialogSave,
      defaultName,
      filters,
    ) as Promise<SaveFileResult>,
  openFile: (filters?: FileFilter[]) =>
    ipcRenderer.invoke(IPC.dialogOpen, filters) as Promise<OpenFileResult>,
  print: (options: PrintOptions) =>
    ipcRenderer.invoke(IPC.printDo, options) as Promise<PrintResult>,
  getServerUrl: () => ipcRenderer.invoke(IPC.serverUrlGet) as Promise<string>,
  setServerUrl: (url: string) =>
    ipcRenderer.invoke(IPC.serverUrlSet, url) as Promise<{
      ok: boolean;
      url?: string;
      error?: string;
    }>,
  revealLog: () => ipcRenderer.invoke(IPC.revealLog) as Promise<boolean>,
  setBadge: (count: number) =>
    ipcRenderer.invoke(IPC.badgeSet, count) as Promise<boolean>,
  clearSession: (scope?: "cache" | "all") =>
    ipcRenderer.invoke(
      IPC.sessionClear,
      scope ?? "cache",
    ) as Promise<ClearSessionResult>,
  reloadClean: () =>
    ipcRenderer.invoke(IPC.pageReloadClean) as Promise<boolean>,
  onUpdateProgress: (handler) => subscribe(IPC_EVENTS.updaterProgress, handler),
  onUpdateStatus: (handler) => subscribe(IPC_EVENTS.updaterStatus, handler),
  // 本地运行时（2.0）
  getRuntimeStatus: () =>
    ipcRenderer.invoke(IPC.runtimeStatus) as Promise<RuntimeStatusInfo>,
  retryLocalRuntime: () =>
    ipcRenderer.invoke(IPC.runtimeRetry) as Promise<RuntimeActionResult>,
  restartLocalServices: () =>
    ipcRenderer.invoke(IPC.runtimeRestart) as Promise<RuntimeActionResult>,
  backupData: (targetDir?: string) =>
    ipcRenderer.invoke(IPC.dataBackup, targetDir) as Promise<BackupResult>,
  restoreData: (dumpFile: string) =>
    ipcRenderer.invoke(
      IPC.dataRestore,
      dumpFile,
    ) as Promise<RuntimeActionResult>,
  openDataFolder: () =>
    ipcRenderer.invoke(IPC.dataOpenFolder) as Promise<boolean>,
  getDataStats: () =>
    ipcRenderer.invoke(IPC.dataStats) as Promise<DataStatsInfo>,
  onBootProgress: (handler) => subscribe(IPC_EVENTS.bootProgress, handler),
  // 断网/恢复：渲染进程自身的 online/offline 即权威来源，无需绕主进程（对外契约不变）
  onOnlineChange: (handler) => {
    const onOnline = (): void => handler({ online: true });
    const onOffline = (): void => handler({ online: false });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  },
};

/** 渲染异常转发到主进程（规格书 §8 P3.2：走 IPC，不受页面 CSP 的 connect-src 限制） */
function forwardRendererErrors(): void {
  window.addEventListener("error", (event) => {
    const message = event.message || "未知脚本错误";
    ipcRenderer.send("diag:renderer-error", {
      kind: "error",
      message,
      source: `${event.filename ?? ""}:${event.lineno ?? 0}:${event.colno ?? 0}`,
      stack: event.error instanceof Error ? (event.error.stack ?? "") : "",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "未处理的 Promise 拒绝";
    ipcRenderer.send("diag:renderer-error", {
      kind: "unhandledrejection",
      message,
      stack: reason instanceof Error ? (reason.stack ?? "") : "",
    });
  });
}

try {
  contextBridge.exposeInMainWorld("pmDesktop", api);
  forwardRendererErrors();
} catch (error) {
  // preload 失败必须留痕，但不能阻断页面加载
  console.error("[pmDesktop] preload 初始化失败", error);
}
