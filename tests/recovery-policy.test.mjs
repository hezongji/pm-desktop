/** 故障恢复决策表单测（规格书 §4.8） */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const logicPath = join(process.cwd(), 'dist', 'logic.cjs');
if (!existsSync(logicPath)) throw new Error('缺少 dist/logic.cjs —— 请先运行 npm run build');
const logic = require(logicPath);

test('did-fail-load：ERR_ABORTED(-3) 必须忽略（正常导航中断）', () => {
  assert.equal(logic.classifyFailLoad(-3, true, false), 'ignore');
  assert.equal(logic.classifyFailLoad(-3, true, true), 'ignore');
});

test('did-fail-load：非主框架失败忽略（P1 只做导航级）', () => {
  assert.equal(logic.classifyFailLoad(-105, false, false), 'ignore');
});

test('did-fail-load：主框架首次失败重试一次，再失败转兜底页', () => {
  assert.equal(logic.classifyFailLoad(-105, true, false), 'retry');
  assert.equal(logic.classifyFailLoad(-105, true, true), 'fallback');
});

test('崩溃降频：10 分钟内累计 3 次触发保护，窗口外记录被剔除', () => {
  const now = 1_000_000;
  const first = logic.recordCrash([], now);
  assert.equal(first.loop, false);
  const second = logic.recordCrash(first.crashes, now + 1000);
  assert.equal(second.loop, false);
  const third = logic.recordCrash(second.crashes, now + 2000);
  assert.equal(third.loop, true);
  assert.equal(third.crashes.length, 3);

  const stale = logic.recordCrash([now - logic.CRASH_WINDOW_MS - 1], now);
  assert.equal(stale.crashes.length, 1);
  assert.equal(stale.loop, false);
});

test('兜底页文案：证书错误必须提示联系管理员且不自动放行', () => {
  const view = logic.buildFallbackView('certificate', 'x', 'https://pm.hezongji.cn');
  assert.match(view.title, /证书/);
  assert.match(view.detail, /管理员/);
  assert.equal(view.canRetry, true);
});

test('错误码中文映射与离线判定', () => {
  assert.match(logic.describeFailReason(-105, ''), /域名/);
  assert.match(logic.describeFailReason(-118, ''), /超时/);
  assert.match(logic.describeFailReason(-9999, 'unknown'), /unknown/);
  assert.equal(logic.isOfflineLikeError(-106), true);
  assert.equal(logic.isOfflineLikeError(-200), false);
});
