/** 更新状态机单测（规格书 §4.4） */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const logicPath = join(process.cwd(), 'dist', 'logic.cjs');
if (!existsSync(logicPath)) throw new Error('缺少 dist/logic.cjs —— 请先运行 npm run build');
const logic = require(logicPath);

test('状态迁移：检查 → 有更新 → 下载 → 完成', () => {
  let phase = 'idle';
  phase = logic.nextPhase(phase, 'check');
  assert.equal(phase, 'checking');
  phase = logic.nextPhase(phase, 'available');
  assert.equal(phase, 'available');
  phase = logic.nextPhase(phase, 'download-start');
  assert.equal(phase, 'downloading');
  phase = logic.nextPhase(phase, 'download-progress');
  assert.equal(phase, 'downloading');
  phase = logic.nextPhase(phase, 'download-done');
  assert.equal(phase, 'downloaded');
});

test('状态迁移：无更新与错误路径', () => {
  assert.equal(logic.nextPhase('checking', 'not-available'), 'not-available');
  assert.equal(logic.nextPhase('checking', 'error'), 'error');
  assert.equal(logic.nextPhase('downloading', 'error'), 'error');
  assert.equal(logic.nextPhase('error', 'check'), 'checking');
});

test('非法迁移保持原状态（不产生未定义状态）', () => {
  assert.equal(logic.nextPhase('idle', 'download-done'), 'idle');
  assert.equal(logic.nextPhase('downloaded', 'check'), 'downloaded');
});

test('进度百分比裁剪', () => {
  assert.equal(logic.clampPercent(0), 0);
  assert.equal(logic.clampPercent(50.4), 50);
  assert.equal(logic.clampPercent(50.6), 51);
  assert.equal(logic.clampPercent(180), 100);
  assert.equal(logic.clampPercent(-5), 0);
  assert.equal(logic.clampPercent(undefined), 0);
  assert.equal(logic.clampPercent(Number.NaN), 0);
});

test('4 小时检查间隔判定', () => {
  const hour = 3600_000;
  assert.equal(logic.shouldCheckNow(null, 1000, 4 * hour), true);
  assert.equal(logic.shouldCheckNow(0, 3 * hour, 4 * hour), false);
  assert.equal(logic.shouldCheckNow(0, 4 * hour, 4 * hour), true);
});

test('更新包命名契约（发布用）', () => {
  const names = logic.updateArtifactNames('1.2.3');
  assert.equal(names.exe, 'pm-desktop-setup-1.2.3.exe');
  assert.equal(names.blockmap, 'pm-desktop-setup-1.2.3.exe.blockmap');
  assert.equal(names.yml, 'latest.yml');
});
