/**
 * 打包脚本：构建 + electron-builder（NSIS）。
 *   node scripts/dist.mjs           # 正式包 → release/
 *   node scripts/dist.mjs --test    # 测试包（APP_URL=https://pm.hezongji.cn）→ release-test/
 *   node scripts/dist.mjs --beta    # beta 渠道（额外生成 beta.yml）
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const isTest = args.includes("--test");
const isBeta = args.includes("--beta");

const mirrors = {
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR ?? "https://npmmirror.com/mirrors/electron/",
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??
    "https://npmmirror.com/mirrors/electron-builder-binaries/",
};

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...mirrors },
  });
  if (result.status !== 0) {
    console.error(
      `[dist] 命令失败（退出码 ${result.status}）：${command} ${commandArgs.join(" ")}`,
    );
    process.exit(result.status ?? 1);
  }
}

const buildArgs = ["scripts/build.mjs"];
if (isTest) buildArgs.push("--test");
if (isBeta) buildArgs.push("--beta");
run(process.execPath, buildArgs);

// 打包舞台：pm-server / im-server / db / pg16 / seed（stage-server 只清自己的子目录，顺序无关）
const skipServerBuild = args.includes("--skip-server-build");
for (const script of ["scripts/stage-pg.mjs", "scripts/stage-baseline.mjs"]) {
  run(process.execPath, [script]);
}
run(process.execPath, [
  "scripts/stage-server.mjs",
  ...(skipServerBuild ? ["--skip-build"] : []),
]);

const outputDir = isTest ? "release-test" : "release";
// 直接调用 electron-builder 的 CLI 入口，避免经 shell 造成路径空格截断与 ${version} 展开问题
const builderCli = join(root, "node_modules", "electron-builder", "cli.js");
const builderArgs = [
  builderCli,
  "--win",
  "nsis",
  "--publish",
  "never",
  `-c.directories.output=${outputDir}`,
];

if (isTest) {
  builderArgs.push("-c.productName=PM桌面-TEST");
  builderArgs.push("-c.appId=io.github.hezongji.pm-desktop.test"); // 独立 appId：单实例锁/卸载项/更新身份与正式包隔离
  builderArgs.push("-c.win.artifactName=pm-desktop-setup-test-${version}.exe");
  builderArgs.push("-c.win.icon=build/icon-test.ico");
  builderArgs.push("-c.publish.url=https://pm.hezongji.cn/updates/");
}
if (isBeta) {
  builderArgs.push("-c.publish.channel=beta");
  builderArgs.push("-c.generateUpdatesFilesForAllChannels=true");
}

console.log(`[dist] 开始打包（output=${outputDir}）…`);
run(process.execPath, builderArgs);

const outDir = join(root, outputDir);
if (existsSync(outDir)) {
  const artifacts = readdirSync(outDir).filter((name) =>
    /\.(exe|blockmap|yml)$/.test(name),
  );
  console.log(`[dist] 产物目录 ${outDir}:`);
  for (const name of artifacts) console.log(`  - ${name}`);
}
