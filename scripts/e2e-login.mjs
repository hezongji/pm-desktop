// 确定性 CDP 登录 E2E：PM桌面-TEST 壳 → pm.hezongji.cn 测试账号登录 → 桌面桥冒烟 → 会话保持
// 用法: node scripts/e2e-login.mjs  （依赖 release-test/win-unpacked/PM桌面-TEST.exe）
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const EXE =
  "E:/ai/pi/pm_desktop/pm-desktop/release-test/win-unpacked/PM桌面-TEST.exe";
const PORT = 9229;
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
  stdio: "ignore",
});
const log = (...a) => console.log("[login-e2e]", ...a);
const fail = (m) => {
  console.error("[login-e2e] FAIL:", m);
  try {
    child.kill();
  } catch {}
  process.exit(1);
};

let page = null;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = l.find((t) => t.type === "page" && t.url.includes("pm.hezongji.cn"));
    if (page) break;
  } catch {}
}
if (!page) fail("壳页面未就绪");
log("初始页面:", page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let seq = 0;
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    const h = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.id === id) {
        ws.removeEventListener("message", h);
        resolve(m);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expr) => {
  const r = await call("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    return (
      "EXC:" +
      String(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      ).slice(0, 300)
    );
  return r.result?.result?.value;
};

const url = async () => ev("location.href");

// 已登录则跳过登录步骤（partition 持久会话）
if ((await url()).includes("/login")) {
  for (let i = 0; i < 20; i++) {
    const n = await ev("document.querySelectorAll('input').length");
    if (n >= 2) break;
    await sleep(500);
  }
  const filled = await ev(`(() => {
    const ins = [...document.querySelectorAll('input')];
    const user = ins.find(i => /账号|用户名|姓名|拼音|邮箱|user|email/i.test(i.placeholder + i.name + i.id)) || ins[0];
    const pass = ins.find(i => i.type === 'password') || ins[1];
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.__proto__, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
    if (!user || !pass) return 'NO-FIELDS';
    set(user, process.env.PM_E2E_USER ?? 'admin@pm.local'); set(pass, process.env.PM_E2E_PASS ?? 'Admin@123456');
    return 'filled:' + (user.placeholder || user.name) + '/' + pass.type;
  })()`);
  log("表单填充:", filled);
  if (String(filled).startsWith("EXC") || filled === "NO-FIELDS")
    fail(`表单填充失败: ${filled}`);
  const clicked = await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /登\\s*录/.test(b.textContent));
    if (btn) { btn.click(); return 'BTN'; }
    const form = document.querySelector('form');
    if (form) { form.requestSubmit(); return 'FORM'; }
    return 'NONE';
  })()`);
  log("提交:", clicked);
  if (clicked === "NONE") fail("找不到登录按钮");
}

let u = await url();
for (let i = 0; i < 30 && (!u || u.includes("/login")); i++) {
  await sleep(1000);
  u = await url();
}
log("登录后 URL:", u);
if (!u || u.includes("/login")) fail(`登录未跳转（最后 URL=${u}）`);

// 桌面桥冒烟
const info = await ev(
  `window.pmDesktop ? window.pmDesktop.getAppInfo().then(r=>JSON.stringify(r)).catch(e=>'ERR:'+(e&&e.message||String(e))) : 'NO-BRIDGE'`,
);
log("pmDesktop.getAppInfo:", info);
if (
  !info ||
  info === "NO-BRIDGE" ||
  String(info).startsWith("EXC") ||
  String(info).startsWith("ERR")
)
  fail(`桥异常: ${info}`);
const notify = await ev(
  `window.pmDesktop.notify('E2E 冒烟', '桌面通知桥验证').then(r=>JSON.stringify(r)).catch(e=>'ERR:'+(e&&e.message||String(e)))`,
);
log("pmDesktop.notify:", notify);

// 会话保持：硬刷新后仍在系统内
await call("Page.reload", { ignoreCache: true });
await sleep(5000);
const u2 = await url();
log("reload 后 URL:", u2);
const ok = u2 && !u2.includes("/login");
console.log(
  ok
    ? "[login-e2e] PASS：登录 + 桌面桥冒烟 + 会话保持 全通过"
    : "[login-e2e] FAIL：reload 后掉回登录页",
);
try {
  child.kill();
} catch {}
process.exit(ok ? 0 : 1);
