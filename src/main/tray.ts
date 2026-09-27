/** 系统托盘（规格书 §4.5 / §8 P2 2.5 未读角标） */
import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { APP_USER_MODEL_ID } from '../shared/config';
import { formatBadge } from '../shared/logic/format';
import { assetPath } from './app-paths';
import { log } from './diagnostics';

export interface TrayDeps {
  onOpen: () => void;
  onCheckUpdates: () => void;
  onAbout: () => void;
  onSetServer: () => void;
  onClearCache: () => void;
  onQuit: () => void;
  /** 本地模式（2.0）：数据管理菜单组；缺省=云端薄壳，不展示 */
  localMode?: boolean;
  onBackupData?: () => void;
  onRestoreData?: () => void;
  onOpenDataFolder?: () => void;
  onRestartServices?: () => void;
}

let tray: Tray | null = null;
let trayDeps: TrayDeps | null = null;
let unreadCount = 0;
let tooltipSuffix = '';

function baseTrayImage(): Electron.NativeImage {
  const file = assetPath('tray.png');
  if (existsSync(file)) return nativeImage.createFromPath(file);
  return nativeImage.createEmpty();
}

function badgeTrayImage(count: number): Electron.NativeImage {
  const label = formatBadge(count);
  const file = label === '' ? '' : assetPath(label === '99+' ? 'badge-9plus.png' : `badge-${label}.png`);
  if (file !== '' && existsSync(file)) return nativeImage.createFromPath(file);
  return baseTrayImage();
}

function badgeOverlayImage(count: number): Electron.NativeImage | null {
  const label = formatBadge(count);
  if (label === '') return null;
  const file = assetPath(label === '99+' ? 'overlay-9plus.png' : `overlay-${label}.png`);
  return existsSync(file) ? nativeImage.createFromPath(file) : null;
}

function buildMenu(): Electron.Menu {
  const deps = trayDeps;
  if (!deps) return Menu.buildFromTemplate([]);
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: '打开主窗口', click: () => deps.onOpen() },
    { type: 'separator' },
    { label: unreadCount > 0 ? `未读消息：${formatBadge(unreadCount)}` : '未读消息：无', enabled: false },
    { label: '检查更新', click: () => deps.onCheckUpdates() },
  ];
  if (deps.localMode) {
    template.push(
      { type: 'separator' },
      { label: '数据（本机）', enabled: false },
      { label: '备份数据…', click: () => deps.onBackupData?.() },
      { label: '恢复数据…', click: () => deps.onRestoreData?.() },
      { label: '打开数据目录', click: () => deps.onOpenDataFolder?.() },
      { label: '重启本地服务', click: () => deps.onRestartServices?.() },
    );
  }
  template.push(
    { type: 'separator' },
    { label: '设置服务器地址…', click: () => deps.onSetServer() },
    { label: '清理缓存', click: () => deps.onClearCache() },
    { type: 'separator' },
    { label: '关于', click: () => deps.onAbout() },
    { label: '退出', click: () => deps.onQuit() },
  );
  return Menu.buildFromTemplate(template);
}

export function createTray(deps: TrayDeps, win: BrowserWindow | null): Tray {
  trayDeps = deps;
  tray = new Tray(baseTrayImage());
  tray.setToolTip('项目管理系统');
  tray.setContextMenu(buildMenu());
  tray.on('double-click', () => deps.onOpen());
  log.info(`[tray] 托盘已创建（AppUserModelId=${APP_USER_MODEL_ID}）`);
  if (win) win.setOverlayIcon(null, '');
  return tray;
}

export function setTrayUnread(count: number, win: BrowserWindow | null): void {
  unreadCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!tray) return;
  tray.setImage(unreadCount > 0 ? badgeTrayImage(unreadCount) : baseTrayImage());
  const label = formatBadge(unreadCount);
  tray.setToolTip(unreadCount > 0 ? `项目管理系统 — ${label} 条未读${tooltipSuffix}` : `项目管理系统${tooltipSuffix}`);
  tray.setContextMenu(buildMenu());
  if (win && !win.isDestroyed()) {
    const overlay = badgeOverlayImage(unreadCount);
    if (overlay) win.setOverlayIcon(overlay, `${label} 条未读`);
    else win.setOverlayIcon(null, '');
  }
}

export function setTrayStatus(text: string): void {
  tooltipSuffix = text === '' ? '' : ` — ${text}`;
  if (!tray) return;
  const label = formatBadge(unreadCount);
  tray.setToolTip(
    unreadCount > 0 ? `项目管理系统 — ${label} 条未读${tooltipSuffix}` : `项目管理系统${tooltipSuffix}`,
  );
}

/** 首次关闭到托盘时的提示（规格书 §4.1 第 10 步） */
export function showFirstHideBalloon(): void {
  if (!tray) return;
  try {
    tray.displayBalloon({
      title: '仍在后台运行',
      content: '项目管理系统已最小化到托盘，IM 消息提醒保持在线；右键托盘图标可退出。',
      iconType: 'info',
    });
  } catch (error) {
    log.warn(`[tray] 气泡提示失败：${String(error)}`);
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
