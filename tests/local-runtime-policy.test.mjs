/** 本地运行时纯逻辑单测（2.0 全本地模式）：启动阶段/端口候选/健康策略/运行时配置解析 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const logicPath = join(process.cwd(), "dist", "logic.cjs");
if (!existsSync(logicPath))
  throw new Error("缺少 dist/logic.cjs —— 请先运行 npm run build");
const logic = require(logicPath);

test("启动阶段：顺序固定且 ready 收尾", () => {
  assert.deepEqual(
    [...logic.BOOT_STAGES],
    [
      "prepare",
      "initdb",
      "start-pg",
      "migrate",
      "seed",
      "start-server",
      "start-im",
      "ready",
    ],
  );
  assert.equal(logic.isBootStage("migrate"), true);
  assert.equal(logic.isBootStage("nope"), false);
  for (const stage of logic.BOOT_STAGES) {
    assert.equal(typeof logic.bootStageText(stage), "string");
    assert.notEqual(logic.bootStageText(stage), "");
  }
});

test("端口候选：步长 2 递增 8 个", () => {
  assert.deepEqual(
    logic.portCandidates(4310),
    [4310, 4312, 4314, 4316, 4318, 4320, 4322, 4324],
  );
  assert.deepEqual(logic.portCandidates(54329, 3), [54329, 54331, 54333]);
});

test("挑端口：跳过占用，全占用返回 null", () => {
  assert.equal(logic.pickFreePort([4310, 4312, 4314], new Set()), 4310);
  assert.equal(
    logic.pickFreePort([4310, 4312, 4314], new Set([4310, 4312])),
    4314,
  );
  assert.equal(logic.pickFreePort([4310], new Set([4310])), null);
});

test("健康策略：3 次失败重启服务一次，仍失败升级用户", () => {
  assert.equal(logic.evaluateHealth(0, false), "ok");
  assert.equal(logic.evaluateHealth(1, false), "warn");
  assert.equal(logic.evaluateHealth(2, false), "warn");
  assert.equal(logic.evaluateHealth(3, false), "restart-servers");
  assert.equal(logic.evaluateHealth(3, true), "escalate");
  assert.equal(logic.evaluateHealth(9, true), "escalate");
});

test("runtime.json 容错解析：损坏/非法字段被丢弃", () => {
  assert.equal(logic.parseRuntimeState(null), null);
  assert.equal(logic.parseRuntimeState("{ 坏 JSON"), null);
  assert.equal(logic.parseRuntimeState('"str"'), null);
  assert.deepEqual(logic.parseRuntimeState("{}"), {});
  assert.deepEqual(
    logic.parseRuntimeState(
      JSON.stringify({
        ports: { apiPort: 4310, wsPort: -1, pgPort: "x", extra: 1 },
        pgPasswordEnc: "dpapi:abc",
        jwtSecretEnc: 42,
        seededAt: "2026-09-26T00:00:00Z",
      }),
    ),
    {
      ports: { apiPort: 4310 },
      pgPasswordEnc: "dpapi:abc",
      seededAt: "2026-09-26T00:00:00Z",
    },
  );
});

test("数据库连接串：密码 URL 编码、默认库名 pm_local", () => {
  assert.equal(
    logic.buildDatabaseUrl(54329, "p@ss/word"),
    "postgresql://postgres:p%40ss%2Fword@127.0.0.1:54329/pm_local",
  );
  assert.equal(
    logic.buildDatabaseUrl(54999, "plain", "pm_baseline"),
    "postgresql://postgres:plain@127.0.0.1:54999/pm_baseline",
  );
});

test("本地工具页判定：仅放行壳内 boot/error 页", () => {
  assert.equal(
    logic.isLocalToolPageUrl(
      "file:///E:/ai/pm-desktop/dist/renderer-fallback/boot.html",
    ),
    true,
  );
  assert.equal(
    logic.isLocalToolPageUrl(
      "file:///E:/ai/pm-desktop/dist/renderer-fallback/error.html",
    ),
    true,
  );
  assert.equal(
    logic.isLocalToolPageUrl("file:///E:/ai/other/boot.html"),
    false,
  );
  assert.equal(
    logic.isLocalToolPageUrl(
      "https://pm.hezongji.cn/renderer-fallback/boot.html",
    ),
    false,
  );
  assert.equal(logic.isLocalToolPageUrl(null), false);
});
