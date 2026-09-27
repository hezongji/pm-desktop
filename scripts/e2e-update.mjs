// 升版本链路 E2E（P1 1.5 验收：检出→下载→静默安装→版本核对）
// 用法: node scripts/e2e-update.mjs <installed-exe-path>
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const exe = process.argv[2];
const wantVersion = process.argv[3] || "1.0.2";
const wantExeLocal =
  process.argv[4] ||
  `E:/ai/pi/pm_desktop/pm-desktop/release/pm-desktop-setup-${wantVersion}.exe`;
const PORT = 9224;
const log = (...a) => console.log("[e2e-update]", ...a);
const fail = (m) => {
  console.error("[e2e-update] FAIL:", m);
  process.exit(1);
};

if (!exe || !existsSync(exe)) fail(`exe 不存在: ${exe}`);

// 1. 启动（带远程调试端口）
const child = spawn(exe, [`--remote-debugging-port=${PORT}`], {
  stdio: "ignore",
  detached: false,
});
log("launched pid", child.pid);

// 2. 等 CDP 就绪
let wsUrl = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await res.json();
    const page = list.find(
      (t) => t.type === "page" && t.url.startsWith("https://pm.hezongji.cn"),
    );
    if (page) {
      wsUrl = page.webSocketDebuggerUrl;
      log("CDP target:", page.url.slice(0, 60));
      break;
    }
  } catch {
    /* retry */
  }
}
if (!wsUrl) fail("CDP 页面目标未就绪");

// 3. WebSocket 求值器
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let seq = 0;
const evalJs = (expr) =>
  new Promise((resolve) => {
    const id = ++seq;
    const onmsg = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id === id) {
        ws.removeEventListener("message", onmsg);
        resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener("message", onmsg);
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: expr, awaitPromise: true, returnByValue: true },
      }),
    );
  });

const isDesktop = await evalJs("typeof window.pmDesktop");
if (isDesktop !== "object") fail(`window.pmDesktop=${isDesktop}，桥未暴露`);
log("window.pmDesktop OK");

// 4. 检查更新（应检出 1.0.1）
const info = await evalJs(
  'window.pmDesktop.checkForUpdates().then(r=>JSON.stringify(r)).catch(e=>"ERR:"+String(e))',
);
log("checkForUpdates →", info);
let parsed = {};
try {
  parsed = JSON.parse(info || "{}");
} catch {
  /* 空返回 */
}
const found = JSON.stringify(parsed).includes(wantVersion);
if (!found) fail(`未检出 ${wantVersion}：${info}`);

// 5. 下载更新
const dl = await evalJs(
  'window.pmDesktop.downloadUpdate().then(r=>JSON.stringify(r)).catch(e=>"ERR:"+String(e))',
);
log("downloadUpdate →", dl);

// 6. 轮询更新缓存目录确认落盘
const cacheDir = join(process.env.LOCALAPPDATA, "pm-desktop-updater");
let downloaded = null;
for (let i = 0; i < 90; i++) {
  await sleep(2000);
  if (existsSync(cacheDir)) {
    const f = readdirSync(join(cacheDir, "pending")).find(
      (f) => f.includes(wantVersion) && f.endsWith(".exe"),
    );
    if (f) {
      downloaded = join(cacheDir, "pending", f);
      const sz = statSync(downloaded).size;
      if (sz > 100_000_000) break;
    }
  }
}
if (!downloaded) fail("更新缓存目录未见 1.0.1 安装包");
const size = statSync(downloaded).size;
log("downloaded:", downloaded, size, "bytes");

// 7. sha256 与本地 release 产物核对
const local = readFileSync(wantExeLocal);
const remote = readFileSync(downloaded);
const h1 = createHash("sha256").update(local).digest("hex");
const h2 = createHash("sha256").update(remote).digest("hex");
log("sha256 local =", h1);
log("sha256 dl    =", h2);
if (h1 !== h2) fail("下载包 sha256 与发布产物不一致");

// 8. 退出应用 → 静默安装下载的包 → 核对版本
child.kill();
await sleep(2000);
const inst = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath '${downloaded}' -ArgumentList '/S' -Wait -PassThru | Select-Object -ExpandProperty ExitCode`,
  ],
  { encoding: "utf8", timeout: 180000 },
);
log("silent install exit:", inst.stdout.trim(), inst.stderr.trim());
const ver = spawnSync(
  "powershell",
  ["-NoProfile", "-Command", `(Get-Item '${exe}').VersionInfo.FileVersion`],
  { encoding: "utf8" },
);
log("installed version now:", ver.stdout.trim());
if (ver.stdout.trim() !== wantVersion) fail(`升级后版本不是 ${wantVersion}`);
log("PASS：升版本链路（检出→下载→sha256 核对→静默安装→版本核对）全通过");
process.exit(0);
