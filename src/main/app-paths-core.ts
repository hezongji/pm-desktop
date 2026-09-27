/** 应用数据路径集中定义（规格书 §4.1：%APPDATA%/pm-desktop/logs 等） */
import { join } from "node:path";
import { APP_DATA_DIR_NAME } from "../shared/config";

export function appDataDir(appDataRoot: string): string {
  return join(appDataRoot, APP_DATA_DIR_NAME);
}

export function logsDir(appDataRoot: string): string {
  return join(appDataDir(appDataRoot), "logs");
}

export function logFilePath(appDataRoot: string): string {
  return join(logsDir(appDataRoot), "main.log");
}

export function configFilePath(appDataRoot: string): string {
  return join(appDataDir(appDataRoot), "config.json");
}

export function windowStateFilePath(appDataRoot: string): string {
  return join(appDataDir(appDataRoot), "window-state.json");
}
