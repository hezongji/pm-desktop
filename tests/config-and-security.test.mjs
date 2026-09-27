/** 配置归一化、保存路径安全、脱敏与格式化单测（规格书 §4.6 / §6） */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const logicPath = join(process.cwd(), 'dist', 'logic.cjs');
if (!existsSync(logicPath)) throw new Error('缺少 dist/logic.cjs —— 请先运行 npm run build');
const logic = require(logicPath);

test('服务器地址归一化：仅 http(s)，去尾斜杠，拒 query/hash', () => {
  assert.deepEqual(logic.normalizeServerUrl('https://pm.example.com/'), { ok: true, url: 'https://pm.example.com' });
  assert.deepEqual(logic.normalizeServerUrl('  https://pm.example.com/base/  '), {
    ok: true,
    url: 'https://pm.example.com/base',
  });
  assert.equal(logic.normalizeServerUrl('pm.example.com').ok, false);
  assert.equal(logic.normalizeServerUrl('file:///C:/x').ok, false);
  assert.equal(logic.normalizeServerUrl('https://a.com/?x=1').ok, false);
  assert.equal(logic.normalizeServerUrl('').ok, false);
});

test('config.json 容错解析：损坏内容回退空配置', () => {
  assert.deepEqual(logic.parseLocalConfig(null), {});
  assert.deepEqual(logic.parseLocalConfig('{ 坏 JSON'), {});
  assert.deepEqual(logic.parseLocalConfig('{"appUrl":"javascript:alert(1)"}'), {});
  assert.deepEqual(logic.parseLocalConfig('{"appUrl":"https://ok.example.com/","channel":"beta"}'), {
    appUrl: 'https://ok.example.com',
    channel: 'beta',
  });
});

test('生效地址解析：本地配置优先，非法则回退构建默认值', () => {
  assert.equal(logic.resolveAppUrl({ appUrl: 'https://private.example.com' }, 'https://pm.hezongji.cn'), 'https://private.example.com');
  assert.equal(logic.resolveAppUrl({}, 'https://pm.hezongji.cn'), 'https://pm.hezongji.cn');
  assert.equal(logic.resolveAppUrl(null, 'https://pm.hezongji.cn'), 'https://pm.hezongji.cn');
});

test('序列化保持稳定键序', () => {
  const text = logic.serializeLocalConfig({ appUrl: 'https://a.example.com', channel: 'stable' });
  assert.equal(text, '{\n  "appUrl": "https://a.example.com",\n  "channel": "stable"\n}\n');
});

test('写路径安全：拒绝启动目录、Windows 目录与可疑快捷方式', () => {
  const env = {
    appData: 'C:\\Users\\u\\AppData\\Roaming',
    programData: 'C:\\ProgramData',
    windowsDir: 'C:\\Windows',
  };
  assert.equal(
    logic.isSensitiveWritePath('C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.exe', env).ok,
    false,
  );
  assert.equal(logic.isSensitiveWritePath('C:\\Windows\\System32\\evil.dll', env).ok, false);
  assert.equal(logic.isSensitiveWritePath('D:\\报销\\2026.xlsx', env).ok, true);
  assert.equal(logic.validateSavePath('', env).ok, false);
});

test('脱敏：敏感键替换、JWT 与 Bearer 串清洗（含原地模式）', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop';
  const input = { password: 'p@ss', headers: { Authorization: `Bearer ${jwt}` }, note: `token=${jwt}` };
  const redacted = logic.redactValue(input);
  assert.equal(redacted.password, '[已脱敏]');
  assert.equal(redacted.note.includes(jwt), false);

  const inPlace = { password: 'p@ss', note: `token=${jwt}`, nested: { apiKey: 'sk-123' } };
  logic.redactInPlace(inPlace);
  assert.equal(inPlace.password, '[已脱敏]');
  assert.equal(inPlace.nested.apiKey, '[已脱敏]');
  assert.equal(inPlace.note.includes(jwt), false);
});

test('格式化：字节与未读角标', () => {
  assert.equal(logic.formatBytes(0), '0 B');
  assert.equal(logic.formatBytes(1024), '1 KB');
  assert.equal(logic.formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(logic.formatBadge(0), '');
  assert.equal(logic.formatBadge(7), '7');
  assert.equal(logic.formatBadge(120), '99+');
});
