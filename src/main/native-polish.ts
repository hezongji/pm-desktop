/**
 * 原生感打磨（native polish）：消除浏览器行为残留，让壳不像"套壳网页"。
 * 全部在壳层实现，零 Web 端改动。规格依据：owner 2026-09-25 反馈「web 痕迹太过明显」。
 * - 自定义极简右键菜单（不再出现 Chromium 的 重新加载/后退/另存为/检查）
 * - 光标 CSS 注入：非输入区不再显示 I 形文本光标
 * - 封锁浏览器式缩放（Ctrl+滚轮/Ctrl+=/-/0/触摸捏合）
 * - 封锁浏览器式导航键（F5/Ctrl+R/Ctrl+P/Ctrl+F/Alt+←→）
 * - 固定窗口标题（不再跟随网页 title）
 * - 拦截鼠标侧键的历史前进/后退
 */
import type { BrowserWindow } from "electron";
import { Menu } from "electron";
import { log } from "./diagnostics";

const APP_TITLE = "PM 项目管理系统";

/** 非输入区取消 I 形光标（保留 text 区域正常光标） */
const CURSOR_CSS = `
  body { cursor: default !important; }
  a, button, [role="button"], [onclick], summary, [tabindex]:not([tabindex="-1"]) { cursor: pointer !important; }
  input[type="text"], input[type="password"], input[type="email"], input[type="number"],
  input[type="search"], input[type="tel"], input[type="url"], textarea, select,
  [contenteditable="true"], [contenteditable=""] { cursor: text !important; }
`;

/** 隐藏 Web 端自绘的假窗口按钮组（最小化/最大化/关闭）——壳内已有原生标题栏，双套按钮观感冲突 */
const HIDE_WEB_WINDOW_CONTROLS_CSS = `
  div:has(> button[aria-label="最小化"]) { display: none !important; }
`;

/** 浏览器式按键封锁表 */
function isBrowserStyleKey(input: Electron.Input): boolean {
  const key = (input.key ?? "").toLowerCase();
  const ctrl = input.control;
  const alt = input.alt;
  // 刷新（F5 / Ctrl+R）；打印（Ctrl+P 弹 Chromium 打印框）；查找（Ctrl+F/F3/Ctrl+G）
  if (key === "f5") return true;
  if (ctrl && key === "r") return true;
  if (ctrl && key === "p") return true;
  if (ctrl && key === "f") return true;
  if (key === "f3") return true;
  if (ctrl && key === "g") return true;
  // 历史导航 Alt+←/→
  if (alt && (key === "arrowleft" || key === "arrowright")) return true;
  // 缩放 Ctrl+= / Ctrl+- / Ctrl+0
  if (ctrl && (key === "=" || key === "+" || key === "-" || key === "0"))
    return true;
  return false;
}

/** 极简右键菜单：可编辑区=编辑四件套；有选区=复制；其余=不弹菜单（原生应用常态） */
function buildContextMenu(params: Electron.ContextMenuParams): Menu | null {
  const editable = params.isEditable;
  const hasSelection = params.selectionText?.trim().length ? true : false;
  if (!editable && !hasSelection) return null;
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (editable) {
    if (params.editFlags.canCut)
      template.push({ label: "剪切(X)", role: "cut" });
    if (params.editFlags.canCopy)
      template.push({ label: "复制(C)", role: "copy" });
    if (params.editFlags.canPaste)
      template.push({ label: "粘贴(V)", role: "paste" });
    if (params.editFlags.canSelectAll)
      template.push({ label: "全选(A)", role: "selectAll" });
  } else {
    template.push({ label: "复制(C)", role: "copy" });
  }
  return Menu.buildFromTemplate(template);
}

export function applyNativePolish(win: BrowserWindow): void {
  const wc = win.webContents;

  // 1) 固定窗口标题
  win.setTitle(APP_TITLE);
  win.on("page-title-updated", (event) => event.preventDefault());

  // 2) 极简右键菜单
  wc.on("context-menu", (event, params) => {
    event.preventDefault();
    const menu = buildContextMenu(params);
    if (menu) menu.popup({ window: win });
  });

  // 3) 光标与选择观感（对远端页面注入；不改变可选择本身，便于复制任务编号等）
  wc.once("did-finish-load", () => {
    wc.insertCSS(CURSOR_CSS, { cssOrigin: "author" }).catch(() => {
      /* 兜底页等本地页注入失败可忽略 */
    });
    wc.insertCSS(HIDE_WEB_WINDOW_CONTROLS_CSS, { cssOrigin: "author" }).catch(
      () => undefined,
    );
  });

  // 4) 封锁浏览器式按键（在 devtools 拦截之外追加）
  wc.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && isBrowserStyleKey(input))
      event.preventDefault();
  });

  // 5) 封锁触摸捏合缩放与程序内缩放残留
  wc.setVisualZoomLevelLimits(1, 1).catch(() => undefined);

  // 6) 鼠标侧键（X1/X2）默认触发历史导航 → 拦截（注意：app-command 是 BrowserWindow 事件）
  win.on("app-command", (event, command) => {
    if (command === "browser-backward" || command === "browser-forward")
      event.preventDefault();
  });

  log.info(
    "[native-polish] 原生感打磨已挂载（右键菜单/光标/缩放/导航键/标题/侧键）",
  );
}
