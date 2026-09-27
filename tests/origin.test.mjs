/** 来源与会话域校验单测（规格书 §4.2 / §4.6 安全红线） */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const logicPath = join(process.cwd(), 'dist', 'logic.cjs');
if (!existsSync(logicPath)) {
  throw new Error('缺少 dist/logic.cjs —— 请先运行 npm run build（或 npm run verify）');
}
const logic = require(logicPath);

test('IPC 来源校验：同源放行，异源/本地文件/about:blank 一律拒绝', () => {
  const appUrl = 'https://pm.hezongji.cn';
  assert.equal(logic.isTrustedFrameUrl('https://pm.hezongji.cn/login', appUrl), true);
  assert.equal(logic.isTrustedFrameUrl('https://pm.hezongji.cn/', appUrl), true);
  assert.equal(logic.isTrustedFrameUrl('https://evil.example.com/', appUrl), false);
  assert.equal(logic.isTrustedFrameUrl('http://pm.hezongji.cn/', appUrl), false);
  assert.equal(logic.isTrustedFrameUrl('file:///C:/tmp/error.html', appUrl), false);
  assert.equal(logic.isTrustedFrameUrl('about:blank', appUrl), false);
  assert.equal(logic.isTrustedFrameUrl(undefined, appUrl), false);
  assert.equal(logic.isTrustedFrameUrl(null, appUrl), false);
});

test('端口差异视为不同来源', () => {
  assert.equal(logic.isTrustedFrameUrl('https://example.com:8443/', 'https://example.com/'), false);
});

test('外链仅允许 http/https（拦 file://、shell:、javascript:）', () => {
  assert.equal(logic.isExternalLinkAllowed('https://example.com/a'), true);
  assert.equal(logic.isExternalLinkAllowed('http://example.com/a'), true);
  assert.equal(logic.isExternalLinkAllowed('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(logic.isExternalLinkAllowed('shell:startup'), false);
  assert.equal(logic.isExternalLinkAllowed('javascript:alert(1)'), false);
  assert.equal(logic.isExternalLinkAllowed(''), false);
});

test('导航拦截：仅同主机放行', () => {
  const appUrl = 'https://pm.hezongji.cn';
  assert.equal(logic.isNavigationAllowed('https://pm.hezongji.cn/projects/1', appUrl), true);
  assert.equal(logic.isNavigationAllowed('https://other.example.com/', appUrl), false);
  assert.equal(logic.isNavigationAllowed('file:///C:/tmp/x.html', appUrl), false);
});

test('originOf / parseHttpUrl 边界', () => {
  assert.equal(logic.originOf('https://a.b.c:8443/path'), 'https://a.b.c:8443');
  assert.equal(logic.originOf('不是URL'), null);
  assert.equal(logic.originOf('ftp://example.com/'), null);
});
