/**
 * 故障恢复决策表（规格书 §4.8，纯函数可单测）。
 * 主进程只负责把 Electron 事件翻译成本模块的输入，处置决策集中在这里。
 */

/** 规格书 §4.8：did-fail-load 必须排除 ERR_ABORTED(-3)，那是正常导航中断 */
export const ERR_ABORTED = -3;

/** 崩溃降频窗口与阈值（规格书 §4.8：累计 3 次/10min） */
export const CRASH_WINDOW_MS = 10 * 60 * 1000;
export const CRASH_LIMIT = 3;

/** 一次导航失败后的处置 */
export type FailAction =
  | 'ignore' // 正常中断或非主框架，忽略
  | 'retry' // 自动重试一次
  | 'fallback'; // 转本地兜底页

export function classifyFailLoad(errorCode: number, isMainFrame: boolean, alreadyRetried: boolean): FailAction {
  if (errorCode === ERR_ABORTED) return 'ignore';
  if (!isMainFrame) return 'ignore';
  return alreadyRetried ? 'fallback' : 'retry';
}

export interface CrashDecision {
  /** 更新后的崩溃时间戳列表（已剔除窗口外记录） */
  crashes: number[];
  /** 是否进入降频保护（弹原生对话框） */
  loop: boolean;
}

/** 记录一次渲染进程崩溃，返回是否触发降频保护 */
export function recordCrash(
  crashes: readonly number[],
  now: number,
  windowMs: number = CRASH_WINDOW_MS,
  limit: number = CRASH_LIMIT,
): CrashDecision {
  const kept = crashes.filter((ts) => now - ts <= windowMs);
  kept.push(now);
  return { crashes: kept, loop: kept.length >= limit };
}

/** 崩溃恢复后的计数清零判定：成功加载即可清零 */
export function resetCrashes(): number[] {
  return [];
}

/** Chromium/Electron 网络错误码 → 中文原因（兜底页与日志共用） */
const ERROR_TEXT: Record<number, string> = {
  [-3]: '导航被中断',
  [-1]: '网络连接失败',
  [-2]: '网络请求失败',
  [-6]: '域名解析失败',
  [-7]: '连接超时',
  [-8]: '服务器无响应',
  [-9]: '服务器拒绝连接',
  [-20]: '连接被中断',
  [-21]: '网络连接被重置',
  [-100]: '连接已关闭',
  [-101]: '连接被重置',
  [-102]: '连接被拒绝',
  [-105]: '域名无法解析',
  [-106]: '网络不可达',
  [-109]: '地址不可达',
  [-118]: '连接超时',
  [-130]: '代理连接失败',
  [-137]: '域名解析失败',
  [-200]: '证书校验失败',
  [-201]: '证书已过期',
  [-202]: '证书已被吊销',
  [-501]: '安全策略阻止了该连接',
};

export function describeFailReason(errorCode: number, description?: string): string {
  const mapped = ERROR_TEXT[errorCode];
  if (mapped) return `${mapped}（错误码 ${errorCode}）`;
  if (description && description.trim() !== '') return `${description}（错误码 ${errorCode}）`;
  return `未知网络错误（错误码 ${errorCode}）`;
}

/** 是否属于「疑似离线」类错误（用于兜底页文案） */
export function isOfflineLikeError(errorCode: number): boolean {
  return [-1, -2, -6, -7, -8, -9, -20, -21, -100, -101, -102, -105, -106, -109, -118, -130, -137].includes(errorCode);
}

export type FallbackReason = 'offline' | 'load-failed' | 'certificate' | 'crash-loop' | 'unresponsive' | 'chunk-error';

export interface FallbackView {
  title: string;
  detail: string;
  canRetry: boolean;
}

/** 兜底页展示模型（error.html 只做渲染） */
export function buildFallbackView(reason: FallbackReason, detail: string, appUrl: string): FallbackView {
  const base = `服务器：${appUrl}`;
  switch (reason) {
    case 'offline':
      return { title: '网络不可用', detail: `无法连接到项目管理系统，请检查网络或 VPN。\n${base}`, canRetry: true };
    case 'certificate':
      return {
        title: '服务器证书异常',
        detail: `已拒绝不安全的连接（证书校验未通过），请联系系统管理员确认服务器证书状态。\n${base}`,
        canRetry: true,
      };
    case 'crash-loop':
      return { title: '页面连续崩溃', detail: `页面多次异常退出，已暂停自动重试以避免反复崩溃。\n详情：${detail}\n${base}`, canRetry: true };
    case 'unresponsive':
      return { title: '页面无响应', detail: `页面长时间未响应，可尝试重新加载。\n${base}`, canRetry: true };
    case 'chunk-error':
      return { title: '系统已更新', detail: `检测到服务器版本已更新，正在重新加载最新资源。\n${base}`, canRetry: true };
    case 'load-failed':
    default:
      return { title: '页面加载失败', detail: `${detail}\n${base}`, canRetry: true };
  }
}
