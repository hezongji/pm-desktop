/**
 * 保存路径安全校验（规格书 §4.6：拒绝写入启动目录等敏感位置）。
 * 纯函数：env 由主进程注入（appData/programData/windowsDir）。
 */

export interface PathEnv {
  appData?: string;
  programData?: string;
  windowsDir?: string;
}

export interface PathCheck {
  ok: boolean;
  reason?: string;
}

function normalize(input: string): string {
  return input.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function isUnder(child: string, parent: string | undefined): boolean {
  if (!parent) return false;
  const p = normalize(parent);
  const c = normalize(child);
  return c === p || c.startsWith(`${p}\\`);
}

/** 敏感路径：启动项、Windows 目录、系统程序目录 */
export function isSensitiveWritePath(filePath: string, env: PathEnv): PathCheck {
  const target = normalize(filePath);
  if (target === '') return { ok: false, reason: '路径为空' };

  const startupDirs = [
    env.appData ? `${env.appData}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup` : undefined,
    env.programData ? `${env.programData}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup` : undefined,
  ].filter((dir): dir is string => typeof dir === 'string');

  for (const dir of startupDirs) {
    if (isUnder(target, dir)) return { ok: false, reason: '禁止写入系统启动目录' };
  }
  if (env.windowsDir && isUnder(target, env.windowsDir)) {
    return { ok: false, reason: '禁止写入 Windows 系统目录' };
  }
  if (target.endsWith('.lnk') && (isUnder(target, env.appData) || isUnder(target, env.programData))) {
    return { ok: false, reason: '禁止在应用数据目录写入快捷方式' };
  }
  return { ok: true };
}

/** 保存对话框返回路径的最终校验（供 IPC handler 使用） */
export function validateSavePath(filePath: string, env: PathEnv): PathCheck {
  if (filePath.trim() === '') return { ok: false, reason: '未选择保存位置' };
  return isSensitiveWritePath(filePath, env);
}
