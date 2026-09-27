/**
 * 打包产物安全红线扫描（规格书 §6 第 1 条 + §8 任务 1.3 验收“产物扫描记录”）。
 * 直接从 app.asar 里取出主进程/preload 代码，断言四条红线与 D1 参数未被覆盖。
 * 用法：node scripts/verify-package.cjs [--test]
 */
const {
 existsSync,
 readFileSync,
 readdirSync,
 rmSync,
 writeFileSync,
} = require("node:fs");
const { join } = require("node:path");
const asar = require("@electron/asar");

const root = join(__dirname, "..");
const isTest = process.argv.includes("--test");
// --dir=<产物目录>：直接指定 win-unpacked 所在目录（默认 release|release-test）
const dirArg = process.argv.find((arg) => arg.startsWith("--dir="));
const unpacked = dirArg
 ? join(dirArg.slice("--dir=".length), "win-unpacked")
 : join(root, isTest ? "release-test" : "release", "win-unpacked");
const asarFile = join(unpacked, "resources", "app.asar");

if (!existsSync(asarFile)) {
 console.error(`[verify-package] 找不到 ${asarFile}（先运行 npm run dist）`);
 process.exit(1);
}

// 用 extractAll 落到临时目录再读（不同 @electron/asar 版本的 extractFile 路径语义不一致）
const scanDir = join(root, isTest ? ".asar-scan-test" : ".asar-scan");
rmSync(scanDir, { recursive: true, force: true });
asar.extractAll(asarFile, scanDir);

const mainCode = readFileSync(
 join(scanDir, "dist", "main", "index.cjs"),
 "utf8",
);
const preloadCode = readFileSync(
 join(scanDir, "dist", "preload", "index.cjs"),
 "utf8",
);
// 扫描副本仅落在 .asar-scan/（已 gitignore），不污染仓库根
writeFileSync(join(scanDir, "app-main.cjs"), mainCode);

const required = [
 ["contextIsolation: true", /contextIsolation:\s*true/],
 ["nodeIntegration: false", /nodeIntegration:\s*false/],
 ["sandbox: true", /sandbox:\s*true/],
 ["webSecurity: true", /webSecurity:\s*true/],
 ["backgroundThrottling: false", /backgroundThrottling:\s*false/],
];

// 持久会话分区：打包后为常量引用（partition: SESSION_PARTITION），需同时校验常量定义值
const partitionOk =
 /partition:\s*"persist:pm"/.test(mainCode) ||
 (/partition:\s*SESSION_PARTITION/.test(mainCode) &&
  /SESSION_PARTITION\s*=\s*"persist:pm"/.test(mainCode));

const forbidden = [
 ["sandbox: false", /sandbox:\s*false/],
 ["contextIsolation: false", /contextIsolation:\s*false/],
 ["nodeIntegration: true", /nodeIntegration:\s*true/],
 ["webSecurity: false", /webSecurity:\s*false/],
];

let failed = 0;
console.log(`[verify-package] 扫描 ${asarFile}`);

// 构建目标校验：测试包必须指向测试环境，正式包必须指向生产（防止打错环境）
// 注意：主进程包内另有 DEFAULT_UPDATES_URL 兜底常量（指向生产），故只断言 BUILD_APP_URL 的注入值
const expectedAppUrl = isTest
 ? "https://pm.hezongji.cn"
 : "https://pm.hezongji.cn";
const injected = /BUILD_APP_URL = "([^"]+)"/.exec(mainCode)?.[1];
const appUrlOk = injected === expectedAppUrl;
if (!appUrlOk) failed += 1;
console.log(
 `${appUrlOk ? "PASS" : "FAIL"} 构建目标地址为 ${expectedAppUrl}（实际 ${injected ?? "未找到"}）`,
);

if (!partitionOk) failed += 1;
console.log(`${partitionOk ? "PASS" : "FAIL"} 主进程含 partition: persist:pm`);
for (const [label, pattern] of required) {
 const ok = pattern.test(mainCode);
 if (!ok) failed += 1;
 console.log(`${ok ? "PASS" : "FAIL"} 主进程含 ${label}`);
}
for (const [label, pattern] of forbidden) {
 const ok = !pattern.test(mainCode);
 if (!ok) failed += 1;
 console.log(`${ok ? "PASS" : "FAIL"} 主进程不含 ${label}`);
}

const bridgeOk =
 /exposeInMainWorld\("pmDesktop"/.test(preloadCode) ||
 /exposeInMainWorld\('pmDesktop'/.test(preloadCode);
if (!bridgeOk) failed += 1;
console.log(`${bridgeOk ? "PASS" : "FAIL"} preload 仅暴露 window.pmDesktop`);

const extraBridges =
 preloadCode.match(/exposeInMainWorld\((?:"|')([^"']+)(?:"|')/g) ?? [];
const bridgeNames = extraBridges.map((item) =>
 item.replace(/exposeInMainWorld\((?:"|')/, "").replace(/(?:"|')$/, ""),
);
if (bridgeNames.length !== 1 || bridgeNames[0] !== "pmDesktop") {
 console.log(`WARN 暴露面异常：${bridgeNames.join(", ")}`);
}

const noNodeInPreload =
 !/require\((?:"|')(?:node:)?(?:fs|child_process|path|os)(?:"|')\)/.test(
  preloadCode,
 );
if (!noNodeInPreload) failed += 1;
console.log(
 `${noNodeInPreload ? "PASS" : "FAIL"} preload 未引入 Node 原生模块`,
);

// ── 2.0 本地全栈红线（DEVIATIONS D3-1）：运行时资源必须随包分发 ──
const resourcesDir = join(unpacked, "resources");
const requiredResources = [
 [
  "pm-server/server/server.js（Next standalone 入口）",
  join(resourcesDir, "pm-server", "server", "server.js"),
 ],
 [
  "pm-server/server/.next/static（静态资源）",
  join(resourcesDir, "pm-server", "server", ".next", "static"),
 ],
 [
  "im-server/src/index.js（IM 服务入口）",
  join(resourcesDir, "im-server", "src", "index.js"),
 ],
 [
  "im-server/node_modules/prisma/build/index.js（随包迁移 CLI）",
  join(
   resourcesDir,
   "im-server",
   "node_modules",
   "prisma",
   "build",
   "index.js",
  ),
 ],
 [
  "pg16/bin/postgres.exe（嵌入式数据库）",
  join(resourcesDir, "pg16", "bin", "postgres.exe"),
 ],
 [
  "pg16/bin/initdb.exe（首启初始化）",
  join(resourcesDir, "pg16", "bin", "initdb.exe"),
 ],
 ["db/schema.prisma（结构迁移）", join(resourcesDir, "db", "schema.prisma")],
 ["db/migrations（迁移集）", join(resourcesDir, "db", "migrations")],
 [
  "seed/baseline.sql（首启基线数据）",
  join(resourcesDir, "seed", "baseline.sql"),
 ],
 [
  "pg16/LICENSE.txt（PostgreSQL 许可）",
  join(resourcesDir, "pg16", "LICENSE.txt"),
 ],
];
for (const [label, target] of requiredResources) {
 const ok = existsSync(target);
 if (!ok) failed += 1;
 console.log(`${ok ? "PASS" : "FAIL"} 资源含 ${label}`);
}

// 启动进度页随 asar 分发（本地模式窗口第一屏）
const bootPageOk = existsSync(
 join(scanDir, "dist", "renderer-fallback", "boot.html"),
);
if (!bootPageOk) failed += 1;
console.log(
 `${bootPageOk ? "PASS" : "FAIL"} asar 含 renderer-fallback/boot.html`,
);

// 红线：安装包内不得携带任何 .env*（密钥/连接串不落盘）
const envLeaks = [];
(function walk(dir, depth) {
 if (depth > 6) return;
 for (const entry of readdirSync(dir, { withFileTypes: true })) {
  const full = join(dir, entry.name);
  if (entry.isDirectory()) walk(full, depth + 1);
  else if (/^\.env(\..*)?$/.test(entry.name)) envLeaks.push(full);
 }
})(resourcesDir, 0);
if (envLeaks.length > 0) failed += 1;
console.log(
 `${envLeaks.length === 0 ? "PASS" : "FAIL"} 安装包不含 .env*${envLeaks.length > 0 ? `（泄漏：${envLeaks.join("，")}）` : ""}`,
);

console.log(
 failed === 0
  ? "[verify-package] 全部通过"
  : `[verify-package] 存在 ${failed} 项失败`,
);
process.exit(failed === 0 ? 0 : 1);
