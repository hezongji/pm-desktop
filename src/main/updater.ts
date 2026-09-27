/**
 * 自动更新（规格书 §4.4 v1.1 重写版）。
 * - generic provider，交互全部原生（不依赖远端页面渲染）
 * - 回滚语义：electron-updater allowDowngrade 默认 false 且仅跨通道生效 →
 *   坏版本回滚 = 发更高 semver 的 hotfix，不做自动降级（SOP 见 docs/release-checklist.md）
 */
import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { UPDATE_CHECK_INTERVAL_MS } from "../shared/config";
import {
  clampPercent,
  nextPhase,
  shouldCheckNow,
} from "../shared/logic/updater-state";
import type {
  UpdateCheckResult,
  UpdatePhase,
  UpdateProgressEvent,
  UpdateStatusEvent,
} from "../shared/types";
import { log } from "./diagnostics";
import { notify } from "./notifications";
import { setTrayStatus } from "./tray";

export interface UpdaterDeps {
  updatesUrl: string;
  channel: string;
  isPackaged: boolean;
  getWindow: () => BrowserWindow | null;
  /** 安装前置 isQuitting=true，避免 close 拦截吃掉 quitAndInstall（规格书 §4.1 第 10 步） */
  beginInstall: () => void;
  onProgress?: (payload: UpdateProgressEvent) => void;
  onStatus?: (payload: UpdateStatusEvent) => void;
}

let deps: UpdaterDeps | null = null;
let phase: UpdatePhase = "idle";
let availableVersion: string | undefined;
let lastCheckMs: number | null = null;
let timer: NodeJS.Timeout | null = null;

function setPhase(next: UpdatePhase, message?: string): void {
  phase = next;
  deps?.onStatus?.({
    phase,
    ...(availableVersion ? { version: availableVersion } : {}),
    ...(message ? { message } : {}),
  });
  setTrayStatus(describePhase(next));
}

function describePhase(value: UpdatePhase): string {
  switch (value) {
    case "checking":
      return "正在检查更新";
    case "available":
      return `发现新版本 ${availableVersion ?? ""}`.trim();
    case "downloading":
      return "正在下载更新";
    case "downloaded":
      return "更新已就绪，待重启安装";
    case "error":
      return "更新检查失败";
    default:
      return "";
  }
}

export function initUpdater(updaterDeps: UpdaterDeps): void {
  deps = updaterDeps;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = log;
  autoUpdater.setFeedURL(
    updaterDeps.channel === "beta"
      ? { provider: "generic", url: updaterDeps.updatesUrl, channel: "beta" }
      : { provider: "generic", url: updaterDeps.updatesUrl },
  );
  if (updaterDeps.channel === "beta") {
    autoUpdater.channel = "beta";
    autoUpdater.allowPrerelease = true;
  } else {
    autoUpdater.allowPrerelease = false;
  }

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] 开始检查更新");
    setPhase("checking");
  });

  autoUpdater.on("update-available", (info) => {
    availableVersion = info.version;
    log.info(`[updater] 发现新版本 ${info.version}`);
    setPhase("available");
    notify({
      title: "发现新版本",
      body: `项目管理系统桌面端 v${info.version} 可用，点击后可在托盘中确认下载。`,
      onClick: () => void promptDownload(info.version),
    });
    void promptDownload(info.version);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("[updater] 已是最新版本");
    availableVersion = undefined;
    setPhase("not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    const payload: UpdateProgressEvent = {
      percent: clampPercent(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    };
    setTrayStatus(`正在下载更新 ${payload.percent}%`);
    deps?.onProgress?.(payload);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    availableVersion = info.version;
    log.info(`[updater] 更新已下载完成 v${info.version}`);
    setPhase("downloaded");
    await promptInstall(info.version);
  });

  autoUpdater.on("error", (error) => {
    log.warn(`[updater] 更新流程失败（不阻断使用）：${String(error)}`);
    setPhase("error", String(error));
    notify({ title: "更新失败", body: "已保留当前版本，可稍后在托盘中重试。" });
  });

  scheduleAutoCheck();
}

function scheduleAutoCheck(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(
    () => {
      if (shouldCheckNow(lastCheckMs, Date.now(), UPDATE_CHECK_INTERVAL_MS))
        void checkForUpdates(false);
    },
    30 * 60 * 1000,
  );
}

export function initAutoCheckOnStartup(): void {
  if (!deps) return;
  if (!deps.isPackaged) {
    log.info("[updater] 开发模式跳过启动检查");
    return;
  }
  if (shouldCheckNow(lastCheckMs, Date.now(), UPDATE_CHECK_INTERVAL_MS))
    void checkForUpdates(false);
}

export async function checkForUpdates(
  manual: boolean,
): Promise<UpdateCheckResult> {
  if (!deps) return { ok: false, phase, reason: "更新模块未初始化" };
  if (!deps.isPackaged) {
    return { ok: false, phase, reason: "开发模式不支持更新检查" };
  }
  lastCheckMs = Date.now();
  try {
    setPhase("checking");
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (version && version !== app.getVersion()) {
      availableVersion = version;
      return { ok: true, phase: "available", version };
    }
    return { ok: true, phase: "not-available" };
  } catch (error) {
    const message = String(error);
    log.warn(`[updater] 检查更新失败：${message}`);
    setPhase("error", message);
    if (manual) {
      const win = deps.getWindow();
      const options: Electron.MessageBoxOptions = {
        type: "warning",
        title: "检查更新失败",
        message: "暂时无法连接更新服务器，已保留当前版本。",
        detail: message,
        buttons: ["确定"],
      };
      if (win) await dialog.showMessageBox(win, options);
      else await dialog.showMessageBox(options);
    }
    return { ok: false, phase: "error", reason: message };
  }
}

async function promptDownload(version: string): Promise<void> {
  if (!deps) return;
  const win = deps.getWindow();
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "发现新版本",
    message: `项目管理系统桌面端 v${version} 可用，是否现在下载？`,
    detail: "下载在后台进行，不影响继续使用。",
    buttons: ["立即下载", "稍后"],
    defaultId: 0,
    cancelId: 1,
  };
  const choice = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (choice.response === 0) await downloadUpdate();
}

export async function downloadUpdate(): Promise<UpdateCheckResult> {
  if (!deps) return { ok: false, phase, reason: "更新模块未初始化" };
  if (phase === "downloaded")
    return { ok: true, phase, version: availableVersion };
  try {
    setPhase("downloading");
    await autoUpdater.downloadUpdate();
    return {
      ok: true,
      phase: "downloading",
      ...(availableVersion ? { version: availableVersion } : {}),
    };
  } catch (error) {
    log.warn(`[updater] 下载失败：${String(error)}`);
    setPhase("error", String(error));
    return { ok: false, phase: "error", reason: String(error) };
  }
}

async function promptInstall(version: string): Promise<void> {
  if (!deps) return;
  const win = deps.getWindow();
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "更新已就绪",
    message: `v${version} 已下载完成，重启后自动安装。`,
    buttons: ["立即重启安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
  };
  const choice = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (choice.response === 0) quitAndInstall();
}

export function quitAndInstall(): void {
  deps?.beginInstall();
  log.info("[updater] quitAndInstall（isQuitting 已置位）");
  autoUpdater.quitAndInstall(true, true);
}

export function currentPhase(): UpdatePhase {
  return phase;
}

export function updaterPhaseAfter(
  event: Parameters<typeof nextPhase>[1],
): UpdatePhase {
  const next = nextPhase(phase, event);
  setPhase(next);
  return next;
}
