/** 进程间共享类型（preload 暴露面 / 事件载荷 / 返回值） */

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  appUrl: string;
  channel: string;
  isPackaged: boolean;
}

export interface UpdateCheckResult {
  ok: boolean;
  phase: UpdatePhase;
  version?: string;
  reason?: string;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateProgressEvent {
  percent: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

export interface UpdateStatusEvent {
  phase: UpdatePhase;
  version?: string;
  message?: string;
}

export interface OnlineChangeEvent {
  online: boolean;
}

export type FileFilter = { name: string; extensions: string[] };

export interface SaveFileResult {
  canceled: boolean;
  filePath?: string;
}

export interface OpenFileResult {
  canceled: boolean;
  filePaths: string[];
}

export interface PrintOptions {
  mode: "printer" | "pdf";
  /** pdf 模式默认文件名（不含扩展名） */
  defaultFileName?: string;
  deviceName?: string;
  silent?: boolean;
}

export interface PrintResult {
  ok: boolean;
  filePath?: string;
  reason?: string;
}

export interface ClearSessionResult {
  ok: boolean;
  /** 清理范围：cache=仅 HTTP 缓存（登出用）；all=缓存+Cookie+存储（共享电脑退出用） */
  scope: "cache" | "all";
}

export interface CacheInfo {
  bytes: number;
  human: string;
}

export type Unsubscribe = () => void;

/** 本地运行时状态（2.0 全本地模式） */
export interface RuntimeStatusInfo {
  mode: "local" | "cloud";
  phase: "idle" | "booting" | "ready" | "degraded" | "failed" | "stopped";
  apiPort?: number;
  wsPort?: number;
  pgPort?: number;
  dataDir?: string;
  bootStage?: string;
  error?: string;
  startedAt?: string;
}

export interface BootProgressPayload {
  stage: string;
  text: string;
  detail?: string;
}

export interface BackupResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

export interface DataStatsInfo {
  pgBytes: number;
  uploadsBytes: number;
  backupsBytes: number;
  human: string;
}

export interface RuntimeActionResult {
  ok: boolean;
  error?: string;
}

/** window.pmDesktop 契约（规格书 §4.6，名称冻结） */
export interface PmDesktopApi {
  getAppInfo(): Promise<AppInfo>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateCheckResult>;
  notify(title: string, body: string): Promise<boolean>;
  saveFile(
    defaultName: string,
    filters?: FileFilter[],
  ): Promise<SaveFileResult>;
  openFile(filters?: FileFilter[]): Promise<OpenFileResult>;
  print(options: PrintOptions): Promise<PrintResult>;
  getServerUrl(): Promise<string>;
  setServerUrl(
    url: string,
  ): Promise<{ ok: boolean; url?: string; error?: string }>;
  revealLog(): Promise<boolean>;
  setBadge(count: number): Promise<boolean>;
  clearSession(scope?: "cache" | "all"): Promise<ClearSessionResult>;
  reloadClean(): Promise<boolean>;
  onUpdateProgress(
    handler: (payload: UpdateProgressEvent) => void,
  ): Unsubscribe;
  onUpdateStatus(handler: (payload: UpdateStatusEvent) => void): Unsubscribe;
  onOnlineChange(handler: (payload: OnlineChangeEvent) => void): Unsubscribe;
  // ── 本地运行时（2.0 全本地模式；云端薄壳模式下返回 mode:'cloud' 或 ok:false） ──
  getRuntimeStatus(): Promise<RuntimeStatusInfo>;
  retryLocalRuntime(): Promise<RuntimeActionResult>;
  restartLocalServices(): Promise<RuntimeActionResult>;
  backupData(targetDir?: string): Promise<BackupResult>;
  restoreData(dumpFile: string): Promise<RuntimeActionResult>;
  openDataFolder(): Promise<boolean>;
  getDataStats(): Promise<DataStatsInfo>;
  onBootProgress(handler: (payload: BootProgressPayload) => void): Unsubscribe;
}
