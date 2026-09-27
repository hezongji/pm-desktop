/**
 * 冒烟脚本：以 --remote-debugging-port 启动应用，用 CDP 断言页面真的加载完成。
 *   electron 源码模式：node scripts/smoke.mjs
 *   已打包产物：      node scripts/smoke.mjs --test
 * 规格书 §7：E2E/冒烟走 CDP（与 jev 驱动同一通道）。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = Number(process.env.PM_SMOKE_PORT ?? 9223);
const TIMEOUT_MS = 90_000;
const isTest = process.argv.includes('--test');

function launchTarget() {
  if (isTest) {
    return {
      command: join(root, 'release-test', 'win-unpacked', 'PM桌面-TEST.exe'),
      args: [`--remote-debugging-port=${PORT}`],
    };
  }
  const packaged = join(root, 'release', 'win-unpacked', 'PM桌面.exe');
  if (existsSync(packaged)) {
    return { command: packaged, args: [`--remote-debugging-port=${PORT}`] };
  }
  return { command: require('electron'), args: ['.', `--remote-debugging-port=${PORT}`] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function waitForPageTarget(deadline) {
  const endpoint = `http://127.0.0.1:${PORT}/json/list`;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(endpoint);
      const page = targets.find((item) => item.type === 'page' && /^https?:/.test(item.url ?? ''));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // 端口尚未就绪，继续轮询
    }
    await sleep(500);
  }
  throw new Error('CDP 端口在超时前未就绪');
}

function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('CDP 求值超时'));
    }, 15_000);
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const parsed = JSON.parse(String(event.data));
      if (parsed.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(parsed.result?.result?.value ?? null);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP 连接失败'));
    });
  });
}

async function main() {
  const { command, args } = launchTarget();
  if (!existsSync(command)) {
    console.error(`[smoke] FAIL：找不到可执行文件 ${command}（打包产物需先跑 npm run dist）`);
    process.exit(1);
  }
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));

  const deadline = Date.now() + TIMEOUT_MS;
  let exitCode = 1;
  try {
    const target = await waitForPageTarget(deadline);
    console.log(`[smoke] 已连接页面目标：${target.url}`);

    let last = null;
    while (Date.now() < deadline) {
      const raw = await evaluate(
        target.webSocketDebuggerUrl,
        'JSON.stringify({title: document.title, ready: document.readyState, href: location.href, textLen: document.body ? document.body.innerText.length : 0})',
      );
      last = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (last && last.ready === 'complete' && last.textLen > 0) break;
      await sleep(1000);
    }
    console.log(`[smoke] 页面状态：${JSON.stringify(last)}`);

    const ok = Boolean(last) && last.ready === 'complete' && last.textLen > 0 && /^https?:/.test(String(last.href));
    if (!ok) throw new Error('页面未完成加载或内容为空');
    console.log('[smoke] PASS：页面加载完成且渲染出内容');
    exitCode = 0;
  } catch (error) {
    console.error(`[smoke] FAIL：${error instanceof Error ? error.message : String(error)}`);
    console.error(`[smoke] 应用输出（尾部 2000 字）：\n${logs.join('').slice(-2000)}`);
  } finally {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      // 清理失败不影响结论
    }
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[smoke] 异常退出：${String(error)}`);
  process.exit(1);
});
