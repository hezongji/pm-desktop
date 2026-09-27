/**
 * 主进程入口：启动顺序严格按规格书 §4.1（十步，不得调整）。
 * 1 单实例锁 → 2 setAppUserModelId → 3 日志/Sentry → 4 窗口状态 →
 * 5 创建窗口并加载 APP_URL → 6 挂载 recovery → 7 注册 IPC →
 * 8 更新检查 → 9 托盘 → 10 window-all-closed/isQuitting 行为
 */
import { join } from "node:path";
import { app, dialog, Menu, session, shell } from "electron";
import {
  APP_USER_MODEL_ID,
  APP_DATA_DIR_NAME,
  BUILD_CHANNEL,
  BUILD_APP_URL,
  DEFAULT_UPDATES_URL,
  LOCAL_MODE,
  UPDATE_CHECK_INTERVAL_MS,
} from "../shared/config";
import { resolveAppUrl } from "../shared/logic/app-config";
import {
  configFileLocation,
  readLocalConfig,
  writeLocalConfig,
} from "./app-config-io";
import { getCacheInfo, clearAppSession } from "./session";
import {
  initDiagnostics,
  initSentry,
  log,
  logDirLocation,
} from "./diagnostics";
import { registerIpc } from "./ipc";
import { attachRecovery, type RecoveryController } from "./recovery";
import {
  createMainWindow,
  getMainWindow,
  loadAppIntoMainWindow,
  setQuitting,
  showMainWindow,
} from "./window";
import { applyNativePolish } from "./native-polish";
import {
  createTray,
  destroyTray,
  setTrayUnread,
  showFirstHideBalloon,
} from "./tray";
import {
  checkForUpdates,
  initAutoCheckOnStartup,
  initUpdater,
} from "./updater";
import { LocalRuntime } from "./local-runtime";
import { dataRoot } from "./local-runtime/paths";
import { IPC_EVENTS } from "../shared/ipc-channels";

const isDev = !app.isPackaged;

let recovery: RecoveryController | null = null;
let currentAppUrl = BUILD_APP_URL;
let runtime: LocalRuntime | null = null;
let runtimeStopped = true;
let installingUpdate = false;

function deriveUpdatesUrl(appUrl: string): string {
  try {
    return new URL("/updates/", appUrl).toString();
  } catch {
    return DEFAULT_UPDATES_URL;
  }
}

async function bootstrap(): Promise<void> {
  // 步骤 0（单实例锁之前，锁按 userData 路径计算 key）：显式固定 userData。
  // 测试构建（BUILD_IS_TEST）→ %APPDATA%/pm-desktop-test，与正式包的锁/缓存/会话分区彻底隔离，双包可并行
  app.setPath("userData", join(app.getPath("appData"), APP_DATA_DIR_NAME));

  // 步骤 1：单实例锁
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log.info("[boot] 已有实例在运行，本进程退出并聚焦既有窗口");
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    log.info("[boot] 收到二次启动请求，聚焦主窗口");
    showMainWindow();
  });

  // 安全加固（S4 评审 H1/M3）：发布版移除默认应用菜单（其 toggledevtools 加速键会先于
  // before-input-event 消费 Ctrl+Shift+I）；远端页面权限请求一律拒绝（通知走 notify:show IPC）
  if (!isDev) Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );

  // 步骤 2：Windows 通知归属/任务栏分组前提
  app.setAppUserModelId(APP_USER_MODEL_ID);

  // 步骤 3：日志与 Sentry
  const logFile = initDiagnostics(app.getVersion());
  await initSentry(app.getVersion());

  // 步骤 4：窗口状态 + 本地配置（服务器地址覆盖）
  const localConfig = readLocalConfig();
  // 本地模式（2.0，DEVIATIONS D3-1）：LOCAL_MODE 且未在 config.json 显式指定 appUrl。
  // config.json 里写 appUrl = 云端逃生门，回到 1.x 薄壳行为。
  const localMode = LOCAL_MODE && typeof localConfig.appUrl !== "string";
  currentAppUrl = resolveAppUrl(localConfig, BUILD_APP_URL);
  log.info(
    `[boot] 模式=${localMode ? "本地全栈" : "云端薄壳"} 服务器地址=${currentAppUrl} 渠道=${BUILD_CHANNEL} 日志=${logFile} 配置=${configFileLocation()}`,
  );

  // 步骤 4.5（DEVIATIONS D3-3）：本地模式先做快速准备（资源校验/目录/密钥/端口），
  // 拿到实际 API 端口后再建窗口；重活启动链在窗口启动页后异步执行。
  let bootMode = false;
  if (localMode) {
    runtime = new LocalRuntime({
      onProgress: (event) => {
        getMainWindow()?.webContents.send(IPC_EVENTS.bootProgress, event);
      },
      onEscalate: (detail) => void escalateRuntimeFailure(detail),
    });
    try {
      const prepared = await runtime.prepare();
      currentAppUrl = prepared.appUrl;
      bootMode = true;
      runtimeStopped = false;
    } catch (error) {
      // 资源缺失/端口耗尽：无窗口可展示进度页，直接原生报错退出
      const message = error instanceof Error ? error.message : String(error);
      log.error(`[runtime] 准备阶段失败：${message}`);
      dialog.showErrorBox(
        "本地运行环境准备失败",
        `${message}\n\n日志目录：${logDirLocation()}`,
      );
      app.quit();
      return;
    }
  }

  // 步骤 5：创建窗口并加载应用地址（本地模式先加载启动进度页）
  const win = createMainWindow({
    appUrl: currentAppUrl,
    isDev,
    bootMode,
    onFirstHideToTray: () => showFirstHideBalloon(),
  });

  // 本地模式：窗口出来后再跑重活启动链，就绪后切到应用
  if (localMode && runtime) {
    void runtime
      .boot()
      .then(() => loadAppIntoMainWindow(currentAppUrl))
      .catch((error: unknown) => {
        // 启动页经 bootProgress 事件展示失败原因与重试入口
        log.error(`[runtime] 启动链失败：${String(error)}`);
      });
  }

  // 原生感打磨：右键菜单/光标/缩放/导航键/固定标题/侧键（owner 2026-09-25 反馈）
  applyNativePolish(win);

  // 步骤 6：挂载故障恢复（§4.8 全表）
  recovery = attachRecovery(win, {
    appUrl: currentAppUrl,
    isDev,
    openLogDir: () => void shell.openPath(logDirLocation()),
  });

  // 证书错误：一律硬拒（规格书 §4.8 / §6 第 4 条）
  app.on(
    "certificate-error",
    (event, _webContents, url, error, _certificate, callback) => {
      event.preventDefault();
      callback(false);
      recovery?.handleCertificateError(url, error);
    },
  );

  // 步骤 7：注册 IPC 白名单
  registerIpc({
    getAppUrl: () => currentAppUrl,
    getWindow: () => getMainWindow(),
    onRendererError: (message, kind, source, stack) =>
      recovery?.notifyRendererError(message, kind, source, stack),
    onServerUrlChanged: (url) => {
      log.info(`[boot] 服务器地址已改为 ${url}，需重启生效（云端逃生门）`);
    },
    getRuntime: () => runtime,
  });

  // 步骤 8：自动更新（本地模式更新源固定为云端 updates 目录）
  initUpdater({
    updatesUrl: localMode
      ? DEFAULT_UPDATES_URL
      : deriveUpdatesUrl(currentAppUrl),
    channel: BUILD_CHANNEL,
    isPackaged: app.isPackaged,
    getWindow: () => getMainWindow(),
    beginInstall: () => {
      installingUpdate = true;
      setQuitting(true);
    },
    onProgress: (payload) => {
      getMainWindow()?.webContents.send("updater:progress", payload);
      // P3-A 任务栏进度：下载中显示进度条，完成/失败清除（Win 任务栏 overlay）
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.setProgressBar(
          payload.percent >= 100 ? -1 : payload.percent / 100,
          { mode: payload.percent >= 100 ? "none" : "normal" },
        );
      }
    },
    onStatus: (payload) =>
      getMainWindow()?.webContents.send("updater:status", payload),
  });
  initAutoCheckOnStartup();

  // 步骤 9：托盘
  createTray(
    {
      onOpen: () => showMainWindow(),
      onCheckUpdates: () => void checkForUpdates(true),
      onAbout: () => void showAboutDialog(localMode),
      onSetServer: () => void promptServerUrl(),
      onClearCache: () => void promptClearCache(),
      localMode,
      onBackupData: () => void promptBackupData(),
      onRestoreData: () => void promptRestoreData(),
      onOpenDataFolder: () => void shell.openPath(dataRoot()),
      onRestartServices: () => void promptRestartServices(),
      onQuit: () => {
        setQuitting(true);
        app.quit();
      },
    },
    win,
  );

  // 步骤 10：关闭行为
  app.on("window-all-closed", () => {
    log.info("[boot] window-all-closed：Windows 下保持托盘常驻，不退出");
  });

  app.on("before-quit", (event) => {
    setQuitting(true);
    if (!runtime || runtimeStopped) return;
    if (installingUpdate) {
      // 更新安装链路：同步快杀，避免 before-quit 异步拦截打断 quitAndInstall
      runtime.stopFast();
      runtimeStopped = true;
      return;
    }
    // 常规退出：优雅停 PG（fast 模式刷盘），完成后再真正退出
    event.preventDefault();
    void runtime
      .stop()
      .catch((error: unknown) =>
        log.warn(`[runtime] 停止异常：${String(error)}`),
      )
      .finally(() => {
        runtimeStopped = true;
        app.quit();
      });
  });

  app.on("activate", () => showMainWindow());

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
    log.info("[boot] 开发模式：DevTools 已打开");
  }
}

async function showAboutDialog(localMode: boolean): Promise<void> {
  const win = getMainWindow();
  const cache = await getCacheInfo();
  const status = runtime?.status();
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "关于 项目管理系统 桌面端",
    message: `项目管理系统 桌面端 v${app.getVersion()}`,
    detail: [
      `运行模式：${localMode ? "本地全栈（数据保存在本机）" : "云端薄壳"}`,
      ...(localMode
        ? [
            `数据目录：${dataRoot()}`,
            `本地服务：API ${status?.apiPort ?? "-"} / 实时 ${status?.wsPort ?? "-"} / 数据库 ${status?.pgPort ?? "-"}`,
            `数据用量：${runtime?.stats().human ?? "-"}`,
          ]
        : [`服务器地址：${currentAppUrl}`]),
      `更新通道：${BUILD_CHANNEL}`,
      `Electron：${process.versions.electron}`,
      `Chromium：${process.versions.chrome}`,
      `日志目录：${logDirLocation()}`,
      `缓存占用：${cache.human}`,
      `自动检查更新：每 ${Math.round(UPDATE_CHECK_INTERVAL_MS / 3600000)} 小时`,
    ].join("\n"),
    buttons: ["打开日志目录", "清理缓存", "关闭"],
    defaultId: 2,
    cancelId: 2,
  };
  const result = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) await shell.openPath(logDirLocation());
  if (result.response === 1) {
    const cleared = await clearAppSession("cache");
    log.info(`[about] 清理缓存结果：${JSON.stringify(cleared)}`);
    void dialog.showMessageBox({
      type: "info",
      title: "清理缓存",
      message: "缓存已清理完成。",
      buttons: ["确定"],
    });
  }
}

async function promptServerUrl(): Promise<void> {
  const win = getMainWindow();
  const options: Electron.MessageBoxOptions = {
    type: "question",
    title: "设置服务器地址",
    message: `当前服务器地址：\n${currentAppUrl}`,
    detail: "修改后需重启客户端生效（用于测试环境或私有化部署）。",
    buttons: ["修改", "取消"],
    defaultId: 1,
    cancelId: 1,
  };
  const answer = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (answer.response !== 0) return;
  const input = win
    ? await dialog.showMessageBox(win, {
        type: "warning",
        title: "确认修改地址",
        message: "请编辑配置文件中的 appUrl 字段后重启客户端。",
        detail: `配置文件：${configFileLocation()}\n当前值：${currentAppUrl}`,
        buttons: ["打开配置目录", "取消"],
        defaultId: 1,
        cancelId: 1,
      })
    : await dialog.showMessageBox({
        type: "warning",
        title: "确认修改地址",
        message: "请编辑配置文件中的 appUrl 字段后重启客户端。",
        detail: configFileLocation(),
        buttons: ["打开配置目录", "取消"],
        defaultId: 1,
        cancelId: 1,
      });
  if (input.response === 0) await shell.openPath(configFileLocation());
}

async function promptClearCache(): Promise<void> {
  const win = getMainWindow();
  const options: Electron.MessageBoxOptions = {
    type: "question",
    title: "清理缓存",
    message: "将清理 HTTP 缓存（不退出登录）。",
    buttons: ["清理", "取消"],
    defaultId: 1,
    cancelId: 1,
  };
  const answer = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (answer.response !== 0) return;
  await clearAppSession("cache");
  setTrayUnread(0, getMainWindow());
}

/** 本地运行时看门狗最终升级：自动重启仍不健康 → 原生三选（重试/日志/退出） */
async function escalateRuntimeFailure(detail: string): Promise<void> {
  log.error(`[runtime] 运行时不健康且自动恢复失败：${detail}`);
  const win = getMainWindow();
  const options: Electron.MessageBoxOptions = {
    type: "error",
    title: "本地服务异常",
    message: "本地服务连续异常，自动重启未能恢复。",
    detail: `${detail}\n\n可先打开日志目录留存现场，再重试启动；若反复出现请联系系统管理员。`,
    buttons: ["重试启动", "打开日志目录", "退出"],
    defaultId: 0,
    cancelId: 2,
  };
  const choice = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (choice.response === 0 && runtime) {
    try {
      await runtime.retry();
      loadAppIntoMainWindow(currentAppUrl);
    } catch (error) {
      log.error(`[runtime] 手动重试失败：${String(error)}`);
    }
  } else if (choice.response === 1) {
    await shell.openPath(logDirLocation());
  } else if (choice.response === 2) {
    setQuitting(true);
    app.quit();
  }
}

async function promptBackupData(): Promise<void> {
  if (!runtime) return;
  const win = getMainWindow();
  try {
    const file = await runtime.backup();
    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: "备份完成",
      message: "数据备份已完成。",
      detail: `备份文件：${file}`,
      buttons: ["打开所在目录", "关闭"],
      defaultId: 1,
      cancelId: 1,
    };
    const choice = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    if (choice.response === 0) shell.showItemInFolder(file);
  } catch (error) {
    const options: Electron.MessageBoxOptions = {
      type: "error",
      title: "备份失败",
      message: "数据备份失败。",
      detail: String(error),
      buttons: ["确定"],
    };
    if (win) await dialog.showMessageBox(win, options);
    else await dialog.showMessageBox(options);
  }
}

async function promptRestoreData(): Promise<void> {
  if (!runtime) return;
  const win = getMainWindow();
  const pickOptions: Electron.OpenDialogOptions = {
    title: "选择备份文件",
    filters: [{ name: "数据备份", extensions: ["dump"] }],
    properties: ["openFile"],
  };
  const picked = win
    ? await dialog.showOpenDialog(win, pickOptions)
    : await dialog.showOpenDialog(pickOptions);
  if (picked.canceled || picked.filePaths.length === 0) return;
  const file = picked.filePaths[0];
  const confirmOptions: Electron.MessageBoxOptions = {
    type: "warning",
    title: "恢复数据",
    message: "恢复将覆盖当前全部本地数据，且不可撤销。",
    detail: `备份文件：${file}\n\n恢复期间应用会短暂不可用，完成后本地服务自动重启。`,
    buttons: ["确认恢复", "取消"],
    defaultId: 1,
    cancelId: 1,
  };
  const confirm = win
    ? await dialog.showMessageBox(win, confirmOptions)
    : await dialog.showMessageBox(confirmOptions);
  if (confirm.response !== 0) return;
  try {
    await runtime.restore(file);
    const doneOptions: Electron.MessageBoxOptions = {
      type: "info",
      title: "恢复完成",
      message: "数据已恢复，页面将重新加载。",
      buttons: ["确定"],
    };
    if (win) await dialog.showMessageBox(win, doneOptions);
    else await dialog.showMessageBox(doneOptions);
    win?.webContents.reloadIgnoringCache();
  } catch (error) {
    const failOptions: Electron.MessageBoxOptions = {
      type: "error",
      title: "恢复失败",
      message: "数据恢复失败，本地数据未被改动或已自动回滚到可启动状态。",
      detail: String(error),
      buttons: ["确定"],
    };
    if (win) await dialog.showMessageBox(win, failOptions);
    else await dialog.showMessageBox(failOptions);
  }
}

async function promptRestartServices(): Promise<void> {
  if (!runtime) return;
  const win = getMainWindow();
  const ok = await runtime.restartServers();
  const options: Electron.MessageBoxOptions = {
    type: ok ? "info" : "error",
    title: ok ? "重启完成" : "重启失败",
    message: ok ? "本地服务已重启完成。" : "本地服务重启后仍未就绪，详见日志。",
    buttons: ["确定"],
  };
  if (win) await dialog.showMessageBox(win, options);
  else await dialog.showMessageBox(options);
}

void app
  .whenReady()
  .then(bootstrap)
  .catch((error: unknown) => {
    log.error(`[boot] 启动失败：${String(error)}`);
    dialog.showErrorBox(
      "启动失败",
      `项目管理系统桌面端启动失败：\n${String(error)}`,
    );
    app.quit();
  });

app.on("will-quit", () => {
  recovery?.dispose();
  destroyTray();
});

export { writeLocalConfig };
