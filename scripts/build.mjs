/**
 * 构建脚本：esbuild 打包主进程 / preload（CJS 双产物）+ 复制本地资产。
 * 用法：
 *   node scripts/build.mjs              # 生产构建（本地全栈模式，APP_URL 为云端逃生门默认）
 *   node scripts/build.mjs --test       # 测试构建（产品名加 TEST，独立数据目录）
 *   node scripts/build.mjs --beta       # beta 渠道
 *   node scripts/build.mjs --cloud      # 云端薄壳模式（1.x 行为，调试用）
 */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const isTest = args.includes("--test");
const isBeta = args.includes("--beta");
const isCloud = args.includes("--cloud");

const APP_URL = isTest ? "https://pm.hezongji.cn" : "https://pm.hezongji.cn";
const CHANNEL = isBeta ? "beta" : "stable";
const PRODUCT_NAME = isTest ? "PM桌面-TEST" : "PM桌面";
// 2.0 默认本地全栈（DEVIATIONS D3-1）；--cloud 退回 1.x 云端薄壳
const LOCAL_MODE = !isCloud;

// 注意：中间产物统一写 dist/（electron-builder 的 files 只收 dist/**）；
// 安装包产物通过 release/ 与 release-test/ 区分（见 scripts/dist.mjs）
const distDir = join(root, "dist");

const define = {
  __APP_URL__: JSON.stringify(APP_URL),
  __CHANNEL__: JSON.stringify(CHANNEL),
  __PRODUCT_NAME__: JSON.stringify(PRODUCT_NAME),
  __IS_TEST__: JSON.stringify(isTest),
  __LOCAL_MODE__: JSON.stringify(LOCAL_MODE),
};

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  minify: false,
  logLevel: "info",
  external: [
    "electron",
    "electron-updater",
    "electron-log",
    "@sentry/electron",
  ],
};

async function run() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(join(distDir, "main"), { recursive: true });
  mkdirSync(join(distDir, "preload"), { recursive: true });
  mkdirSync(join(distDir, "assets"), { recursive: true });
  mkdirSync(join(distDir, "renderer-fallback"), { recursive: true });

  await build({
    ...shared,
    entryPoints: [join(root, "src/main/index.ts")],
    outfile: join(distDir, "main/index.cjs"),
    define,
  });

  await build({
    ...shared,
    entryPoints: [join(root, "src/preload/index.ts")],
    outfile: join(distDir, "preload/index.cjs"),
    define,
  });

  // 纯逻辑聚合产物：供 node --test 直接加载（测试跑的是实际发布代码路径）
  await build({
    ...shared,
    entryPoints: [join(root, "src/shared/logic/index.ts")],
    outfile: join(distDir, "logic.cjs"),
    define,
  });

  cpSync(
    join(root, "src/renderer-fallback/error.html"),
    join(distDir, "renderer-fallback/error.html"),
  );
  cpSync(
    join(root, "src/renderer-fallback/boot.html"),
    join(distDir, "renderer-fallback/boot.html"),
  );

  const assetNames = [
    "icon.ico",
    "tray.png",
    "tray-test.png",
    ...Array.from({ length: 9 }, (_, index) => `badge-${index + 1}.png`),
    "badge-9plus.png",
    ...Array.from({ length: 9 }, (_, index) => `overlay-${index + 1}.png`),
    "overlay-9plus.png",
  ];
  let copied = 0;
  for (const name of assetNames) {
    const from = join(root, "build", name);
    if (existsSync(from)) {
      cpSync(from, join(distDir, "assets", name));
      copied += 1;
    }
  }

  console.log(
    `[build] 完成 → ${distDir}\n  产物: main/index.cjs preload/index.cjs logic.cjs renderer-fallback/{error,boot}.html assets(${copied} 个)\n  APP_URL=${APP_URL} CHANNEL=${CHANNEL} PRODUCT=${PRODUCT_NAME} LOCAL_MODE=${LOCAL_MODE}`,
  );
}

run().catch((error) => {
  console.error("[build] 失败:", error);
  process.exit(1);
});
