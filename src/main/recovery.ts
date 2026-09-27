/**
 * 故障恢复（规格书 §4.8 全表，P1 必修项）。
 * 决策逻辑在 shared/logic/recovery-policy.ts（纯函数，已单测），这里只做 Electron 事件接线。
 */
import { type BrowserWindow, dialog, app } from "electron";
import {
  type FallbackReason,
  buildFallbackView,
  classifyFailLoad,
  describeFailReason,
  isOfflineLikeError,
  recordCrash,
  resetCrashes,
} from "../shared/logic/recovery-policy";
import { fallbackPagePath } from "./app-paths";
import { captureRendererError, log } from "./diagnostics";

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;

export interface RecoveryDeps {
  appUrl: string;
  isDev: boolean;
  /** 兜底页「重试」由页面自身导航，这里只提供重新加载时的清缓存能力 */
  openLogDir?: () => void;
}

export interface RecoveryController {
  showFallback(reason: FallbackReason, detail: string): void;
  handleCertificateError(url: string, error: string): void;
  notifyRendererError(
    message: string,
    kind: "error" | "unhandledrejection",
    source?: string,
    stack?: string,
  ): void;
  reloadIgnoringCacheOnce(): boolean;
  dispose(): void;
}

interface RecoveryState {
  crashes: number[];
  retriedOnce: boolean;
  chunkReloaded: boolean;
  fallbackActive: boolean;
}

export function attachRecovery(
  win: BrowserWindow,
  deps: RecoveryDeps,
): RecoveryController {
  const state: RecoveryState = {
    crashes: [],
    retriedOnce: false,
    chunkReloaded: false,
    fallbackActive: false,
  };
  const contents = win.webContents;

  const showFallback = (reason: FallbackReason, detail: string): void => {
    if (win.isDestroyed()) return;
    state.fallbackActive = true;
    const view = buildFallbackView(reason, detail, deps.appUrl);
    log.warn(`[recovery] 进入兜底页 reason=${reason} detail=${detail}`);
    void win
      .loadFile(fallbackPagePath(), {
        query: {
          reason,
          title: view.title,
          detail: view.detail,
          canRetry: view.canRetry ? "1" : "0",
          app: deps.appUrl,
        },
      })
      .catch((error: unknown) =>
        log.error(`[recovery] 兜底页加载失败：${String(error)}`),
      );
  };

  const reloadIgnoringCacheOnce = (): boolean => {
    if (state.chunkReloaded || win.isDestroyed()) return false;
    state.chunkReloaded = true;
    log.warn(
      "[recovery] 检测到发版后资源失效（ChunkLoadError），执行一次性 bypassCache 重载",
    );
    contents.reloadIgnoringCache();
    return true;
  };

  const onDidFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    const action = classifyFailLoad(errorCode, isMainFrame, state.retriedOnce);
    const reasonText = describeFailReason(errorCode, errorDescription);
    if (action === "ignore") {
      log.debug(
        `[recovery] 忽略加载失败 code=${errorCode} main=${String(isMainFrame)} url=${validatedURL}`,
      );
      return;
    }
    if (action === "retry") {
      state.retriedOnce = true;
      log.warn(
        `[recovery] 加载失败（${reasonText}），自动重试一次：${validatedURL}`,
      );
      if (isOfflineLikeError(errorCode)) {
        showFallback("offline", reasonText);
        return;
      }
      contents.reload();
      return;
    }
    showFallback("load-failed", reasonText);
  };

  const onRenderProcessGone = (
    _event: Electron.Event,
    details: Electron.RenderProcessGoneDetails,
  ): void => {
    if (details.reason === "clean-exit") {
      log.info("[recovery] 渲染进程正常退出，忽略");
      return;
    }
    const decision = recordCrash(state.crashes, Date.now());
    state.crashes = decision.crashes;
    log.warn(
      `[recovery] 渲染进程崩溃 reason=${details.reason} exitCode=${details.exitCode} 近 10 分钟内 ${decision.crashes.length} 次`,
    );
    if (win.isDestroyed()) return;
    if (decision.loop) {
      log.error("[recovery] 触发崩溃降频保护，弹原生对话框");
      const choice = dialog.showMessageBoxSync(win, {
        type: "error",
        title: "页面连续崩溃",
        message: "项目管理系统页面多次异常退出，已暂停自动重试。",
        detail:
          "可先打开日志目录留存现场，再手动重试；若持续崩溃请联系系统管理员。",
        buttons: ["重试", "打开日志目录", "退出"],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice === 0) {
        state.crashes = resetCrashes();
        contents.reload();
      } else if (choice === 1) {
        deps.openLogDir?.();
      } else {
        app.quit();
      }
      return;
    }
    contents.reload();
  };

  const onUnresponsive = (): void => {
    log.warn("[recovery] 页面无响应");
    if (win.isDestroyed()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      title: "页面无响应",
      message: "项目管理系统页面长时间未响应。",
      buttons: ["继续等待", "重新加载"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) contents.reload();
  };

  const onConsoleMessage = (...args: unknown[]): void => {
    const message = extractConsoleMessage(args);
    if (message !== null && CHUNK_ERROR_PATTERN.test(message))
      reloadIgnoringCacheOnce();
  };

  const onDidFinishLoad = (): void => {
    const url = contents.getURL();
    if (url.startsWith("file://")) return; // 兜底页不算恢复成功
    state.crashes = resetCrashes();
    state.retriedOnce = false;
    state.chunkReloaded = false;
    state.fallbackActive = false;
    log.info(`[recovery] 页面加载完成，恢复计数已清零：${url}`);
  };

  // 页面内未捕获异常经 preload 转发（规格书 §8 P3.2：不受页面 CSP 约束）
  const handleRendererError = (
    message: string,
    kind: "error" | "unhandledrejection",
    source?: string,
    stack?: string,
  ): void => {
    captureRendererError({
      message,
      kind,
      ...(source ? { source } : {}),
      ...(stack ? { stack } : {}),
    });
    if (CHUNK_ERROR_PATTERN.test(message)) reloadIgnoringCacheOnce();
  };

  contents.on("did-fail-load", onDidFailLoad);
  contents.on("render-process-gone", onRenderProcessGone);
  contents.on("unresponsive", onUnresponsive);
  contents.on("did-finish-load", onDidFinishLoad);
  contents.on("console-message", onConsoleMessage);

  return {
    showFallback,
    handleCertificateError(url: string, error: string): void {
      log.error(`[recovery] 证书校验失败，已拒绝加载：${url}（${error}）`);
      showFallback("certificate", `目标地址 ${url}\n${error}`);
    },
    notifyRendererError: handleRendererError,
    reloadIgnoringCacheOnce,
    dispose(): void {
      contents.removeListener("did-fail-load", onDidFailLoad);
      contents.removeListener("render-process-gone", onRenderProcessGone);
      contents.removeListener("unresponsive", onUnresponsive);
      contents.removeListener("did-finish-load", onDidFinishLoad);
      contents.removeListener("console-message", onConsoleMessage);
    },
  };
}

/** Electron 35+ 的 console-message 事件改成了对象参数，兼容两种签名 */
function extractConsoleMessage(args: unknown[]): string | null {
  const first = args[0];
  if (typeof first === "object" && first !== null && "message" in first) {
    const message = (first as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  const legacy = args[2];
  return typeof legacy === "string" ? legacy : null;
}
