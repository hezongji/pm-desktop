/**
 * 更新状态机（规格书 §4.4，纯函数可单测）。
 * 主进程把 electron-updater 事件翻译成这里的事件，状态迁移集中在一处。
 */
import type { UpdatePhase } from '../types';

export type UpdateEvent =
  | 'check'
  | 'available'
  | 'not-available'
  | 'download-start'
  | 'download-progress'
  | 'download-done'
  | 'error'
  | 'reset';

const TRANSITIONS: Record<UpdatePhase, Partial<Record<UpdateEvent, UpdatePhase>>> = {
  idle: { check: 'checking', error: 'error' },
  checking: {
    available: 'available',
    'not-available': 'not-available',
    error: 'error',
    reset: 'idle',
  },
  available: { 'download-start': 'downloading', error: 'error', reset: 'idle', check: 'checking' },
  downloading: { 'download-progress': 'downloading', 'download-done': 'downloaded', error: 'error' },
  downloaded: { reset: 'idle', error: 'error' },
  'not-available': { check: 'checking', reset: 'idle' },
  error: { check: 'checking', reset: 'idle' },
};

export function nextPhase(phase: UpdatePhase, event: UpdateEvent): UpdatePhase {
  return TRANSITIONS[phase]?.[event] ?? phase;
}

/** 进度百分比裁剪到 0-100 的整数 */
export function clampPercent(value: number | undefined | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

/** 是否到达检查时机（启动时 + 每 4 小时；lastCheckMs 为 null 表示从未检查） */
export function shouldCheckNow(
  lastCheckMs: number | null,
  now: number,
  intervalMs: number,
): boolean {
  if (lastCheckMs === null) return true;
  if (!Number.isFinite(lastCheckMs)) return true;
  return now - lastCheckMs >= intervalMs;
}

/** 更新包文件名（发布契约 §5.4） */
export function updateArtifactNames(version: string): { exe: string; blockmap: string; yml: string } {
  return {
    exe: `pm-desktop-setup-${version}.exe`,
    blockmap: `pm-desktop-setup-${version}.exe.blockmap`,
    yml: 'latest.yml',
  };
}
