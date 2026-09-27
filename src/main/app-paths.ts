/** 运行时路径（依赖 electron app 实例） */
import { app } from "electron";
import { join } from "node:path";
import {
  appDataDir,
  configFilePath,
  logFilePath,
  logsDir,
  windowStateFilePath,
} from "./app-paths-core";

export {
  appDataDir,
  configFilePath,
  logFilePath,
  logsDir,
  windowStateFilePath,
};

export function appDataRoot(): string {
  return app.getPath("appData");
}

/** 打包后：__dirname = <app>/dist/main */
export function distDir(): string {
  return join(__dirname, "..");
}

export function preloadPath(): string {
  return join(distDir(), "preload", "index.cjs");
}

export function fallbackPagePath(): string {
  return join(distDir(), "renderer-fallback", "error.html");
}

/** 本地模式启动进度页（2.0） */
export function bootPagePath(): string {
  return join(distDir(), "renderer-fallback", "boot.html");
}

export function assetPath(name: string): string {
  return join(distDir(), "assets", name);
}

export function resolvedLogFilePath(): string {
  return logFilePath(appDataRoot());
}

export function resolvedLogsDir(): string {
  return logsDir(appDataRoot());
}

export function resolvedConfigFilePath(): string {
  return configFilePath(appDataRoot());
}

export function resolvedWindowStateFilePath(): string {
  return windowStateFilePath(appDataRoot());
}
