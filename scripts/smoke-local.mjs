/**
 * 本地全栈冒烟（2.0）：启动已安装的 PM桌面.exe，等待本地运行时就绪，断言：
 *   1) 主日志出现「本地运行时全部就绪」
 *   2) GET  http://127.0.0.1:<api>/api/health → 200
 *   3) POST http://127.0.0.1:<api>/api/auth/login（基线管理员）→ 200 且返回 token
 *   4) GET  http://127.0.0.1:<ws>/socket.io/?EIO=4&transport=polling → 200（IM 握手）
 *   5) CDP 页面目标已加载到本地应用地址
 * 端口以 %APPDATA%\pm-desktop\runtime.json 实际分配为准（首选 4310/4312/54329）。
 *
 * 用法：
 *   node scripts/smoke-local.mjs                 # 默认 %LOCALAPPDATA%\Programs\PM桌面\PM桌面.exe
 *   node scripts/smoke-local.mjs --exe=<路径>    # 指定可执行文件（如 release-out/win-unpacked）
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const exeArg = process.argv.find((arg) => arg.startsWith("--exe="));
const exePath = exeArg
  ? exeArg.slice("--exe=".length)
  : join(process.env.LOCALAPPDATA ?? "", "Programs", "PM桌面", "PM桌面.exe");
const CDP_PORT = Number(process.env.PM_SMOKE_CDP_PORT ?? 9224);
const BOOT_TIMEOUT_MS = 300_000;
const appDataDir = join(process.env.APPDATA ?? "", "pm-desktop");
const logFile = join(appDataDir, "logs", "main.log");
const runtimeFile = join(appDataDir, "runtime.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const pass = (label) => console.log(`PASS ${label}`);
const fail = (label, detail) => {
  failures += 1;
  console.log(`FAIL ${label}${detail ? `：${detail}` : ""}`);
};

function readRuntimePorts() {
  try {
    const parsed = JSON.parse(readFileSync(runtimeFile, "utf8"));
    return {
      apiPort: parsed?.ports?.apiPort ?? 4310,
      wsPort: parsed?.ports?.wsPort ?? 4312,
      pgPort: parsed?.ports?.pgPort ?? 54329,
    };
  } catch {
    return { apiPort: 4310, wsPort: 4312, pgPort: 54329 };
  }
}

async function waitForReadyMarker(deadline) {
  while (Date.now() < deadline) {
    try {
      if (existsSync(logFile) && readFileSync(logFile, "utf8").includes("本地运行时全部就绪")) {
        return true;
      }
    } catch {
      /* 日志写入中 */
    }
    await sleep(2_000);
  }
  return false;
}

async function fetchJson(url, options, { retries = 5, intervalMs = 1_500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000), ...options });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      // Next standalone 冷启动首个请求含按需编译，可能超时/拒连；重试穿过竞态窗口
      lastError = error;
      if (attempt < retries) await sleep(intervalMs);
    }
  }
  throw lastError;
}

async function findCdpPage(deadline) {
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/list`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(2_000) });
      const targets = await response.json();
      const page = targets.find((item) => item.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(item.url ?? ""));
      if (page) return page;
    } catch {
      /* CDP 未就绪 */
    }
    await sleep(1_000);
  }
  return null;
}

async function main() {
  if (!existsSync(exePath)) {
    console.error(`[smoke-local] 找不到可执行文件：${exePath}`);
    process.exit(1);
  }
  console.log(`[smoke-local] 启动 ${exePath}`);
  const child = spawn(exePath, [`--remote-debugging-port=${CDP_PORT}`], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    const ready = await waitForReadyMarker(deadline);
    if (!ready) {
      fail("本地运行时就绪标记", `${BOOT_TIMEOUT_MS / 1000}s 内日志未出现「本地运行时全部就绪」`);
    } else {
      pass("主日志出现「本地运行时全部就绪」");
    }

    const ports = readRuntimePorts();
    console.log(`[smoke-local] 端口 api=${ports.apiPort} ws=${ports.wsPort} pg=${ports.pgPort}`);

    const health = await fetchJson(`http://127.0.0.1:${ports.apiPort}/api/health`).catch((e) => ({ status: 0, body: String(e) }));
    if (health.status === 200) pass(`GET /api/health → 200`);
    else fail("GET /api/health", `status=${health.status} body=${health.body.slice(0, 200)}`);

    const login = await fetchJson(`http://127.0.0.1:${ports.apiPort}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@pm.local", password: "Admin@123456" }),
    }).catch((e) => ({ status: 0, body: String(e) }));
    if (login.status === 200 && /token|eyJ/.test(login.body)) pass("POST /api/auth/login → 200 且返回令牌");
    else fail("POST /api/auth/login", `status=${login.status} body=${login.body.slice(0, 200)}`);

    const im = await fetchJson(`http://127.0.0.1:${ports.wsPort}/socket.io/?EIO=4&transport=polling`).catch((e) => ({ status: 0, body: String(e) }));
    if (im.status === 200 && im.body.includes("sid")) pass("Socket.IO 握手 → 200");
    else fail("Socket.IO 握手", `status=${im.status} body=${im.body.slice(0, 200)}`);

    const page = await findCdpPage(Date.now() + 60_000);
    if (page) pass(`CDP 页面已加载本地应用：${page.url}`);
    else fail("CDP 页面目标", "未找到 127.0.0.1 页面（窗口可能还在启动页）");
  } finally {
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }

  console.log(failures === 0 ? "[smoke-local] 全部通过" : `[smoke-local] ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[smoke-local] 异常退出：${String(error)}`);
  process.exit(1);
});
