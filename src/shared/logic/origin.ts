/**
 * 来源与会话域校验（纯函数，可单测）。
 * 规格书 §4.2 / §4.6：外链仅 http(s)、导航不得离开 APP 域、IPC 校验 senderFrame origin。
 */

/** 解析 http/https URL，非法返回 null */
export function parseHttpUrl(value: string | null | undefined): URL | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed;
}

/** 归一化 origin（协议+主机+端口），非法输入返回 null */
export function originOf(value: string | null | undefined): string | null {
  const parsed = parseHttpUrl(value);
  return parsed ? parsed.origin : null;
}

/**
 * IPC 调用是否来自受信帧。
 * 规则：帧 URL 必须与配置的应用地址同源；about:blank、本地文件、其他站点一律拒绝。
 */
export function isTrustedFrameUrl(frameUrl: string | null | undefined, appUrl: string): boolean {
  const frameOrigin = originOf(frameUrl);
  const appOrigin = originOf(appUrl);
  if (!frameOrigin || !appOrigin) return false;
  return frameOrigin === appOrigin;
}

/** 外部链接是否允许交给系统浏览器（规格书 §4.2：仅 http/https） */
export function isExternalLinkAllowed(targetUrl: string | null | undefined): boolean {
  return parseHttpUrl(targetUrl) !== null;
}

/**
 * 站内导航是否允许（will-navigate 拦截）。
 * 允许：同源任意路径；允许从 http 升级到 https 的同一主机；
 * 拒绝：其他域、其他协议。
 */
export function isNavigationAllowed(targetUrl: string | null | undefined, appUrl: string): boolean {
  const target = parseHttpUrl(targetUrl);
  const app = parseHttpUrl(appUrl);
  if (!target || !app) return false;
  if (target.host === app.host) return true;
  return false;
}

/**
 * 是否为壳内本地工具页（启动进度页 boot.html / 兜底页 error.html，file:// 加载）。
 * 用途：这些页面需要少数只读/恢复类 IPC（如 runtime:retry、diag:reveal-log），
 * 但它们不是 appUrl 同源——单独放行，且仅限显式列出的通道（见 ipc.ts）。
 */
export function isLocalToolPageUrl(frameUrl: string | null | undefined): boolean {
  if (typeof frameUrl !== 'string' || frameUrl === '') return false;
  let parsed: URL;
  try {
    parsed = new URL(frameUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'file:') return false;
  const path = parsed.pathname.replace(/\\/g, '/').toLowerCase();
  return path.endsWith('/renderer-fallback/boot.html') || path.endsWith('/renderer-fallback/error.html');
}
