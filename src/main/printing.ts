/** 打印与导出 PDF（规格书 §4.6 print:do / §8 P2 2.4） */
import type { BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { redactText } from '../shared/logic/redact';
import type { PrintOptions, PrintResult } from '../shared/types';
import { showSaveDialog } from './dialogs';
import { log } from './diagnostics';

export async function printCurrentPage(win: BrowserWindow, options: PrintOptions): Promise<PrintResult> {
  if (win.isDestroyed()) return { ok: false, reason: '窗口已关闭' };
  if (options.mode === 'pdf') return printToPdf(win, options);
  return printToDevice(win, options);
}

async function printToPdf(win: BrowserWindow, options: PrintOptions): Promise<PrintResult> {
  const target = await showSaveDialog(win, `${options.defaultFileName ?? '导出'}.pdf`, [
    { name: 'PDF 文件', extensions: ['pdf'] },
  ]);
  if (target.canceled || !target.filePath) return { ok: false, reason: '用户取消' };
  try {
    const data = await win.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
    });
    writeFileSync(target.filePath, data);
    log.info(`[print] 已导出 PDF：${target.filePath}`);
    return { ok: true, filePath: target.filePath };
  } catch (error) {
    log.warn(`[print] 导出 PDF 失败：${redactText(String(error))}`);
    return { ok: false, reason: '导出 PDF 失败' };
  }
}

async function printToDevice(win: BrowserWindow, options: PrintOptions): Promise<PrintResult> {
  const result = await new Promise<{ success: boolean; failureReason?: string }>((resolve) => {
    win.webContents.print(
      {
        silent: options.silent ?? false,
        printBackground: true,
        ...(options.deviceName ? { deviceName: options.deviceName } : {}),
      },
      (success, failureReason) => resolve({ success, failureReason }),
    );
  });
  if (result.success) {
    log.info('[print] 打印任务已提交');
    return { ok: true };
  }
  log.warn(`[print] 打印失败：${result.failureReason ?? '未知原因'}`);
  return { ok: false, reason: result.failureReason ?? '打印失败' };
}
