/**
 * P3-F 三主题截图走查：启动本地全栈（win-unpacked），CDP 接管页面，
 * 登录后遍历代表页 × 代表主题，截图到 docs/p3-shots/。
 *   node scripts/shots.mjs [--exe=<路径>]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const outDir = join(root, "docs", "p3-shots");
const exeArg = process.argv.find((a) => a.startsWith("--exe="));
const exePath =
  exeArg?.slice("--exe=".length) ??
  join(root, "release", "win-unpacked", "PM桌面.exe");
const CDP_PORT = process.env.PM_SHOTS_CDP ?? 9224;
const appDataDir = join(process.env.APPDATA ?? "", "pm-desktop");
const logFile = join(appDataDir, "logs", "main.log");

const THEMES = ["light", "dark", "warm", "dusk"];
const PAGES = [
  ["dashboard", "/dashboard"],
  ["tasks", "/tasks"],
  ["projects", "/projects"],
  ["files", "/files"],
  ["messages", "/messages"],
  ["purchase", "/purchase"],
  ["todos", "/todos"],
  ["settings", "/settings"],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      const log = await import("node:fs").then((f) =>
        f.readFileSync(logFile, "utf8"),
      );
      if (log.includes("本地运行时全部就绪")) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error("运行时就绪超时");
}

async function login(page) {
  await page.goto("http://127.0.0.1:4310/login", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("input", { timeout: 60_000 });
  await sleep(1500);
  // 登录表单：按 type/占位符回退匹配
  const emailInput =
    (await page.$('input[type="email"]')) ??
    (await page.$('input[name="email"]')) ??
    (await page.$('input[placeholder*="邮"]')) ??
    (await page.$("input"));
  const pwdInput = (await page.$('input[type="password"]')) ??
    (await page.$('input[name="password"]'));
  if (!emailInput || !pwdInput) throw new Error("找不到登录输入框");
  await emailInput.fill("admin@pm.local");
  await pwdInput.fill("Admin@123456");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]);
  await sleep(3000);
}

async function main() {
  if (!existsSync(exePath)) throw new Error(`找不到可执行：${exePath}`);
  mkdirSync(outDir, { recursive: true });
  const { chromium } = require(
    "C:/Users/pc/project-management-system/node_modules/playwright-core",
  );

  const child = spawn(exePath, [`--remote-debugging-port=${CDP_PORT}`], {
    stdio: "ignore",
  });
  let failures = 0;
  try {
    await waitReady();
    // main.log 为追加式，waitReady 可能命中旧日志；CDP 连接必须轮询到真实监听
    const browser = await (async () => {
      const deadline = Date.now() + 90_000;
      let lastErr;
      while (Date.now() < deadline) {
        try {
          return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        } catch (e) {
          lastErr = e;
          await sleep(1500);
        }
      }
      throw lastErr;
    })();
    const context = browser.contexts()[0];
    // Electron 禁止 CDP newPage；轮询等主窗从 boot 页切到 4310（就绪后窗口才导航）
    let page;
    {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        page = context.pages().find((p) => p.url().includes("127.0.0.1:4310"));
        if (page) break;
        await sleep(1000);
      }
      if (!page) {
        page = context.pages()[0];
        if (!page) throw new Error("CDP 无可用页面目标");
        await page
          .goto("http://127.0.0.1:4310/login", { waitUntil: "domcontentloaded" })
          .catch(() => {});
      }
    }
    await page.bringToFront();

    await login(page);

    for (const theme of THEMES) {
      for (const [name, path] of PAGES) {
        try {
          await page.evaluate((t) => {
            localStorage.setItem("theme", t);
          }, theme);
          await page.goto(`http://127.0.0.1:4310${path}`, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await sleep(2500); // 骨架屏→数据上屏
          await page.screenshot({
            path: join(outDir, `${theme}-${name}.png`),
            fullPage: false,
          });
          console.log(`SHOT ${theme}-${name}`);
        } catch (e) {
          failures += 1;
          console.log(`FAIL ${theme}-${name}：${String(e).slice(0, 120)}`);
        }
      }
    }
    await browser.close();
  } finally {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  }
  console.log(
    failures === 0
      ? `[shots] 全部完成 → ${outDir}`
      : `[shots] ${failures} 项失败`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`[shots] 异常：${String(e).slice(0, 300)}`);
  process.exit(1);
});
