/**
 * 本地配置（%APPDATA%/pm-desktop/config.json）读取与服务器地址归一化。
 * 规格书 §4.6：服务器地址仅供本地配置/托盘设置入口使用，运行期不接受页面写入。
 */

export interface LocalConfig {
  appUrl?: string;
  channel?: string;
}

export interface NormalizeResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** 归一化用户输入的服务器地址：仅 http(s)，去掉尾部斜杠，禁止 query/hash */
export function normalizeServerUrl(input: string): NormalizeResult {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') return { ok: false, error: '地址不能为空' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: '地址格式不正确，示例：https://pm.hezongji.cn' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: '仅支持 http/https 地址' };
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return { ok: false, error: '地址不能包含查询参数或锚点' };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.origin}${path}` };
}

/** 容错解析 config.json 内容（文件缺失/损坏都回退空配置） */
export function parseLocalConfig(raw: string | null | undefined): LocalConfig {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null) return {};
  const record = data as Record<string, unknown>;
  const config: LocalConfig = {};
  if (typeof record.appUrl === 'string' && record.appUrl.trim() !== '') {
    const normalized = normalizeServerUrl(record.appUrl);
    if (normalized.ok && normalized.url) config.appUrl = normalized.url;
  }
  if (typeof record.channel === 'string' && record.channel.trim() !== '') config.channel = record.channel.trim();
  return config;
}

/** 解析最终生效的应用地址：本地配置优先，其次构建期默认值 */
export function resolveAppUrl(config: LocalConfig | null | undefined, fallback: string): string {
  if (config && typeof config.appUrl === 'string' && config.appUrl !== '') {
    const normalized = normalizeServerUrl(config.appUrl);
    if (normalized.ok && normalized.url) return normalized.url;
  }
  return fallback;
}

/** 序列化为写盘内容（保持稳定键序，便于人工查看） */
export function serializeLocalConfig(config: LocalConfig): string {
  const ordered: Record<string, string> = {};
  if (config.appUrl) ordered.appUrl = config.appUrl;
  if (config.channel) ordered.channel = config.channel;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
