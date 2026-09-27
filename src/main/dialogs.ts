/** 文件对话框（规格书 §4.6 dialog:save / dialog:open） */
import { type BrowserWindow, dialog } from 'electron';
import type { FileFilter, OpenFileResult, SaveFileResult } from '../shared/types';
import { validateSavePath } from '../shared/logic/safe-path';
import { log } from './diagnostics';

function toElectronFilters(filters?: FileFilter[]): Electron.FileFilter[] | undefined {
  if (!filters || filters.length === 0) return undefined;
  return filters.map((filter) => ({ name: filter.name, extensions: filter.extensions }));
}

export async function showSaveDialog(
  win: BrowserWindow | null,
  defaultName: string,
  filters?: FileFilter[],
): Promise<SaveFileResult> {
  const options: Electron.SaveDialogOptions = {
    defaultPath: defaultName,
    filters: toElectronFilters(filters),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { canceled: true };
  const check = validateSavePath(result.filePath, {
    appData: process.env.APPDATA,
    programData: process.env.ProgramData,
    windowsDir: process.env.SystemRoot,
  });
  if (!check.ok) {
    log.warn(`[dialog:save] 拒绝保存到敏感路径：${check.reason ?? '未知原因'}`);
    return { canceled: true };
  }
  return { canceled: false, filePath: result.filePath };
}

export async function showOpenDialog(
  win: BrowserWindow | null,
  filters?: FileFilter[],
): Promise<OpenFileResult> {
  const options: Electron.OpenDialogOptions = {
    filters: toElectronFilters(filters),
    properties: ['openFile', 'multiSelections'],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return { canceled: true, filePaths: [] };
  return { canceled: false, filePaths: result.filePaths };
}
