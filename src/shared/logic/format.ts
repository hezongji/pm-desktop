/** 显示格式化（关于面板与托盘共用） */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/** 未读角标文本：1-99 显示数字，超过显示 99+ */
export function formatBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  const normalized = Math.floor(count);
  if (normalized > 99) return '99+';
  return String(normalized);
}
