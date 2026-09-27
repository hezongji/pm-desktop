/**
 * 会话与缓存治理（规格书 §4.3 / D3）。
 * scope=cache：仅清 HTTP 缓存（登出后防止后退查看敏感页面）
 * scope=all  ：缓存 + Cookie + 本地存储（共享电脑「退出并清除会话」）
 */
import { session } from 'electron';
import { SESSION_PARTITION } from '../shared/config';
import { formatBytes } from '../shared/logic/format';
import type { CacheInfo, ClearSessionResult } from '../shared/types';
import { log } from './diagnostics';

const STORAGES: Electron.ClearStorageDataOptions['storages'] = [
  'cookies',
  'filesystem',
  'indexdb',
  'localstorage',
  'shadercache',
  'serviceworkers',
  'cachestorage',
];

export async function clearAppSession(scope: 'cache' | 'all'): Promise<ClearSessionResult> {
  const target = session.fromPartition(SESSION_PARTITION);
  try {
    await target.clearCache();
    if (scope === 'all') {
      await target.clearStorageData({ storages: STORAGES });
      await target.clearAuthCache();
      await target.clearHostResolverCache();
    }
    log.info(`[session] 已清理会话（scope=${scope}）`);
    return { ok: true, scope };
  } catch (error) {
    log.warn(`[session] 清理失败（scope=${scope}）：${String(error)}`);
    return { ok: false, scope };
  }
}

export async function getCacheInfo(): Promise<CacheInfo> {
  try {
    const bytes = await session.fromPartition(SESSION_PARTITION).getCacheSize();
    return { bytes, human: formatBytes(bytes) };
  } catch {
    return { bytes: 0, human: formatBytes(0) };
  }
}
