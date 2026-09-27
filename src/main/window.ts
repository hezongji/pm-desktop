/**
 * 主窗口：创建、窗口状态记忆、单实例聚焦、关闭到托盘（规格书 §4.1 / §4.2）。
 * 安全红线四参数（contextIsolation/nodeIntegration/sandbox/webSecurity）在此设置，禁止覆盖。
 */
import { BrowserWindow, screen, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SESSION_PARTITION } from "../shared/config";
import {
  isExternalLinkAllowed,
  isLocalToolPageUrl,
  isNavigationAllowed,
} from "../shared/logic/origin";
import {
  assetPath,
  bootPagePath,
  preloadPath,
  resolvedWindowStateFilePath,
} from "./app-paths";
import { log } from "./diagnostics";

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 1280;
const MIN_HEIGHT = 800;
const SAVE_DEBOUNCE_MS = 400;
const MIN_VISIBLE_WIDTH = 200;
const MIN_VISIBLE_HEIGHT = 100;

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

let mainWindow: BrowserWindow | null = null;
let quitting = false;

/** 规格书 §4.1 第 10 步：isQuitting 标志决定 close 是否真的退出（否则会吃掉 quitAndInstall） */
export function setQuitting(value: boolean): void {
  quitting = value;
}

export function isQuitting(): boolean {
  return quitting;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null;
}

function readWindowState(): WindowState {
  const file = resolvedWindowStateFilePath();
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null)
      throw new Error("状态文件格式非法");
    const record = parsed as Record<string, unknown>;
    const width =
      typeof record.width === "number" ? record.width : DEFAULT_WIDTH;
    const height =
      typeof record.height === "number" ? record.height : DEFAULT_HEIGHT;
    const state: WindowState = {
      width: Math.max(MIN_WIDTH, Math.round(width)),
      height: Math.max(MIN_HEIGHT, Math.round(height)),
      isMaximized: record.isMaximized === true,
    };
    if (typeof record.x === "number") state.x = Math.round(record.x);
    if (typeof record.y === "number") state.y = Math.round(record.y);
    return state;
  } catch {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, isMaximized: false };
  }
}

/** 窗口位置越界（拔掉外接屏）时丢弃坐标，避免窗口出现在不可见区域 */
function clampStateToDisplays(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state;
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX =
      Math.min(state.x! + state.width, area.x + area.width) -
      Math.max(state.x!, area.x);
    const overlapY =
      Math.min(state.y! + state.height, area.y + area.height) -
      Math.max(state.y!, area.y);
    return overlapX >= MIN_VISIBLE_WIDTH && overlapY >= MIN_VISIBLE_HEIGHT;
  });
  if (visible) return state;
  const { x: _x, y: _y, ...rest } = state;
  return rest;
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const file = resolvedWindowStateFilePath();
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  const state: WindowState = {
    width: Math.max(MIN_WIDTH, bounds.width),
    height: Math.max(MIN_HEIGHT, bounds.height),
    x: bounds.x,
    y: bounds.y,
    isMaximized: win.isMaximized(),
  };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    log.warn(`[window] 保存窗口状态失败：${String(error)}`);
  }
}

export interface CreateWindowOptions {
  appUrl: string;
  isDev: boolean;
  /** 首次关闭到托盘时的提示回调（规格书 §4.1 第 10 步） */
  onFirstHideToTray?: () => void;
  /** 本地模式（2.0）：先加载启动进度页 boot.html，运行时就绪后由 loadAppIntoMainWindow 切到应用 */
  bootMode?: boolean;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const state = clampStateToDisplays(readWindowState());
  const iconFile = assetPath("icon.ico");

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined
      ? { x: state.x, y: state.y }
      : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    title: "项目管理系统",
    // P3-A Fluent 材质：Win11 Mica 云母（22H2+ 生效，旧系统静默降级纯色；Web 侧画布透出配合见 docs/p3-ui-plan.md）
    ...(process.platform === "win32" ? { backgroundMaterial: "mica" as const } : {}),
    ...(existsSync(iconFile) ? { icon: iconFile } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true, // 红线
      nodeIntegration: false, // 红线
      sandbox: true, // 红线（规格书 §4.2 v1.1 修正）
      webSecurity: true, // 红线
      partition: SESSION_PARTITION,
      zoomFactor: 1.0,
      // 规格书 §4.2 / D1：Chromium 隐藏页强节流会掐断 socket.io 心跳 → 必须关闭节流
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow = win;

  // 外链：一律系统浏览器，且仅 http(s)（规格书 §4.2 / §6 第 3 条）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLinkAllowed(url)) {
      void shell.openExternal(url);
    } else {
      log.warn(`[window] 已拦截非 http(s) 外链：${url}`);
    }
    return { action: "deny" };
  });

  // 站内导航限制：离开 APP 域一律阻止（规格书 §4.2）
  win.webContents.on("will-navigate", (event, url) => {
    if (isNavigationAllowed(url, options.appUrl)) return;
    event.preventDefault();
    log.warn(`[window] 已拦截越域导航：${url}`);
    if (isExternalLinkAllowed(url)) void shell.openExternal(url);
  });

  // 发布版禁用开发工具（规格书 §7）
  if (!options.isDev) {
    win.webContents.on("before-input-event", (event, input) => {
      const key = (input.key ?? "").toLowerCase();
      const isDevToolsKey =
        key === "f12" ||
        (input.control && input.shift && key === "i") ||
        (input.control && input.shift && key === "c");
      if (isDevToolsKey) event.preventDefault();
    });
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), SAVE_DEBOUNCE_MS);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("maximize", scheduleSave);
  win.on("unmaximize", scheduleSave);

  let firstHideNotified = false;
  win.on("close", (event) => {
    saveWindowState(win);
    if (quitting) {
      log.info("[window] isQuitting=true，允许关闭");
      return;
    }
    event.preventDefault();
    win.hide();
    if (!firstHideNotified) {
      firstHideNotified = true;
      options.onFirstHideToTray?.();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.once("ready-to-show", () => {
    if (state.isMaximized) win.maximize();
    win.show();
    log.info(
      `[window] ready-to-show，加载 ${options.bootMode ? "启动进度页" : options.appUrl}`,
    );
  });

  if (options.bootMode) {
    void win.loadFile(bootPagePath()).catch((error: unknown) => {
      log.error(`[window] 启动进度页加载失败：${String(error)}`);
    });
  } else {
    void win.loadURL(options.appUrl).catch((error: unknown) => {
      log.warn(`[window] 首次加载失败（交由 recovery 处理）：${String(error)}`);
    });
  }

  return win;
}

/** 本地模式：运行时就绪后把窗口从启动进度页切到应用地址 */
export function loadAppIntoMainWindow(appUrl: string): void {
  const win = getMainWindow();
  if (!win) return;
  if (isLocalToolPageUrl(win.webContents.getURL()) === false) return; // 已切走/兜底页，勿覆盖
  log.info(`[window] 本地运行时就绪，切换到应用 ${appUrl}`);
  void win.loadURL(appUrl).catch((error: unknown) => {
    log.warn(`[window] 应用加载失败（交由 recovery 处理）：${String(error)}`);
  });
}

export function showMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}
