/** IPC 通道名统一定义（规格书 §4.6：preload 只转发，主进程统一校验来源） */
export const IPC = {
  appInfo: "app:info",
  updaterCheck: "updater:check",
  updaterDownload: "updater:download",
  notifyShow: "notify:show",
  dialogSave: "dialog:save",
  dialogOpen: "dialog:open",
  printDo: "print:do",
  serverUrlGet: "config:server-url:get",
  serverUrlSet: "config:server-url:set",
  revealLog: "diag:reveal-log",
  badgeSet: "badge:set",
  sessionClear: "session:clear",
  pageReloadClean: "page:reload-clean",
  // 本地运行时（2.0 全本地模式，DEVIATIONS D3-1）
  runtimeStatus: "runtime:status",
  runtimeRetry: "runtime:retry",
  runtimeRestart: "runtime:restart-services",
  dataBackup: "data:backup",
  dataRestore: "data:restore",
  dataOpenFolder: "data:open-folder",
  dataStats: "data:stats",
} as const;

/** 主进程 → 渲染进程的事件名（preload 以 onXxx 形式暴露） */
export const IPC_EVENTS = {
  updaterProgress: "updater:progress",
  updaterStatus: "updater:status",
  onlineChange: "app:online-change",
  bootProgress: "runtime:boot-progress",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];
