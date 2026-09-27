/**
 * 故障恢复 + IPC 来源校验的端到端验收（规格书 §4.8 验收断言、§6 第 2 条）。
 * 步骤：
 *   1) 启动已打包客户端并连 CDP
 *   2) 用 CDP 模拟断网（Network.emulateNetworkConditions offline）后触发重载
 *   3) 断言：进入本地兜底页（file://）且标题为「网络不可用」
 *   4) 断言：兜底页（file:// 来源）调用 window.pmDesktop.getAppInfo() 被主进程拒绝
 *   5) 断言：恢复网络后重试可回到线上页面
 * 用法：node scripts/e2e-recovery.mjs [--test]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const isTest = process.argv.includes('--test');
const PORT = Number(process.env.PM_E2E_PORT ?? 9225);
const TIMEOUT_MS = 120_000;

const exe = isTest
  ? join(root, 'release-test', 'win-unpacked', 'PM桌面-TEST.exe')
  : join(root, 'release', 'win-unpacked', 'PM桌面.exe');
if (!existsSync(exe)) {
  console.error(`[e2e] 找不到 ${exe}（先运行 npm run dist 或 dist:test）`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      const resolver = this.pending.get(msg.id);
      if (resolver) {
        this.pending.delete(msg.id);
        resolver(msg);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP 超时: ${method}`)), 20_000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const msg = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (msg.result?.exceptionDetails) return { error: msg.result.exceptionDetails.text };
    return { value: msg.result?.result?.value };
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // 忽略
    }
  }
}

async function waitForPage(deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // 端口未就绪
    }
    await sleep(500);
  }
  throw new Error('CDP 端口未就绪');
}

async function waitForLocation(cdp, predicate, deadline, label) {
  while (Date.now() < deadline) {
    const { value } = await cdp.evaluate('location.href');
    if (typeof value === 'string' && predicate(value)) return value;
    await sleep(700);
  }
  throw new Error(`等待超时：${label}`);
}

async function main() {
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout?.on('data', (d) => logs.push(String(d)));
  child.stderr?.on('data', (d) => logs.push(String(d)));
  const deadline = Date.now() + TIMEOUT_MS;
  let cdp = null;
  let exitCode = 1;
  try {
    const target = await waitForPage(deadline);
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    const liveUrl = await waitForLocation(cdp, (url) => url.startsWith('https://'), deadline, '线上页面加载');
    check('初始加载进入线上系统', liveUrl.startsWith('https://'), liveUrl);

    // 模拟断网并重载：应进入本地兜底页（did-fail-load → 离线类错误 → error.html）
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await cdp.send('Page.reload', { ignoreCache: true });
    const fallbackUrl = await waitForLocation(cdp, (url) => url.startsWith('file://'), deadline, '兜底页');
    check('断网后进入本地兜底页', fallbackUrl.startsWith('file://'), fallbackUrl);

    const title = await cdp.evaluate('document.getElementById("title") ? document.getElementById("title").textContent : document.title');
    check('兜底页展示离线原因', String(title.value ?? '').includes('网络') || String(title.value ?? '').includes('加载'), String(title.value));

    // 兜底页来源为 file://，IPC 必须被拒绝（规格书 §6 第 2 条）
    const rejected = await cdp.evaluate(
      'window.pmDesktop ? window.pmDesktop.getAppInfo().then(function(){return "ALLOWED"}).catch(function(e){return "REJECTED:" + (e && e.message ? e.message : "")}) : "NO_BRIDGE"',
    );
    const rejectedText = String(rejected.value ?? '');
    check('兜底页（file:// 来源）调用 IPC 被拒绝', rejectedText.startsWith('REJECTED'), rejectedText.slice(0, 80));

    // 恢复网络 → 兜底页「重新加载」按钮回到线上
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.evaluate('document.getElementById("retry").click()');
    const backUrl = await waitForLocation(cdp, (url) => url.startsWith('https://'), deadline, '恢复后回到线上');
    check('恢复网络后重试回到线上系统', backUrl.startsWith('https://'), backUrl);

    exitCode = results.every((item) => item.ok) ? 0 : 1;
  } catch (error) {
    console.error(`[e2e] 异常：${error instanceof Error ? error.message : String(error)}`);
    console.error(`[e2e] 应用输出尾部：\n${logs.join('').slice(-1500)}`);
    exitCode = 1;
  } finally {
    cdp?.close();
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // 忽略
    }
  }
  console.log(`[e2e] 汇总：${results.filter((r) => r.ok).length}/${results.length} 通过`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[e2e] 失败：${String(error)}`);
  process.exit(1);
});
