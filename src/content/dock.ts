// browser-extension/src/content/dock.ts
// 内容脚本：页内停靠侧栏（无 chrome.sidePanel API 浏览器（如 Edge）的等效形态）。
//
// 行为：在宿主页右缘注入全高 iframe 面板（加载插件自身页面 ?mode=embed），
//       由 background / 面板页通过 runtime 消息「yy-dock-toggle」开关；
//       另响应「yy-page-text」——仅在用户点击「网页总结」等明确动作时抓取当前
//       文档可见文本，内容只发往用户自己配置的站点 AI，不做任何其他用途。
//
// 约束：经典脚本自包含，禁止 import/export（键名/路径如引用须本地声明）。

/** 面板 HTML 相对路径（手工同步：public/manifest.json side_panel.default_path） */
const PANEL_PATH: string = 'src/sidepanel/index.html';

/** 停靠侧栏宽度（像素；窄屏自动收敛） */
const DOCK_WIDTH: number = 430;

// ---------- 样式（Shadow DOM 内，宿主页不可见） ----------
const SHADOW_CSS: string = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  .host-root { position: fixed; left: 0; top: 0; z-index: 2147483645; }

  .dock-wrap {
    position: fixed; right: 0; top: 0; height: 100vh;
    width: min(${DOCK_WIDTH}px, 72vw);
    display: none; overflow: hidden;
    background: #121826; border-left: 1px solid rgba(42, 51, 72, 0.9);
    box-shadow: -12px 0 40px rgba(0, 0, 0, 0.35);
  }
  .dock-wrap.open { display: block; animation: slide-in 220ms cubic-bezier(0.22, 1, 0.36, 1); }
  @keyframes slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  .dock-wrap iframe { width: 100%; height: 100%; border: none; display: block; }
`;

function main(): void {
  // 单例防重复注入
  const win: Record<string, unknown> = window as unknown as Record<string, unknown>;
  if (win.__yueyan_dock_mounted__ === true) {
    return;
  }
  win.__yueyan_dock_mounted__ = true;

  // ---------- 宿主节点与 Shadow DOM ----------
  const host: HTMLDivElement = document.createElement('div');
  host.className = 'yueyan-dock-host';
  const shadowRoot: ShadowRoot = host.attachShadow({ mode: 'closed' });

  const styleEl: HTMLStyleElement = document.createElement('style');
  styleEl.textContent = SHADOW_CSS;
  shadowRoot.appendChild(styleEl);

  const rootBox: HTMLDivElement = document.createElement('div');
  rootBox.className = 'host-root';
  shadowRoot.appendChild(rootBox);

  // ---------- 停靠容器（首次展开时惰性创建 iframe） ----------
  let dockOpen: boolean = false;
  let currentWrap: HTMLDivElement | null = null;

  function setDockOpen(open: boolean): void {
    dockOpen = open;
    if (currentWrap !== null) {
      currentWrap.classList.toggle('open', open);
    }
  }

  function toggleDock(): void {
    if (currentWrap === null) {
      const wrap: HTMLDivElement = document.createElement('div');
      wrap.className = 'dock-wrap';
      const frame: HTMLIFrameElement = document.createElement('iframe');
      frame.title = '月言博客助手';
      frame.src = `${chrome.runtime.getURL(PANEL_PATH)}?mode=embed`;
      wrap.appendChild(frame);
      rootBox.appendChild(wrap);
      currentWrap = wrap;
    }
    setDockOpen(!dockOpen);
  }

  // 接收指令（background / 面板页发起；同步应答即可）
  chrome.runtime.onMessage.addListener((msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean => {
    const payload = msg as Record<string, unknown> | null;
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }
    if (payload.type === 'yy-dock-toggle') {
      toggleDock();
      sendResponse({ ok: true });
      return false;
    }
    // 悬浮球点击的二级目标：只开不关（幂等打开）
    if (payload.type === 'yy-dock-open') {
      if (!dockOpen) {
        toggleDock();
      }
      sendResponse({ ok: true });
      return false;
    }
    // 供「网页总结」抓取正文：仅当前文档可见文本，截断至 12K 字符
    if (payload.type === 'yy-page-text') {
      const text: string = (document.body?.innerText ?? '').replace(/\n{3,}/gu, '\n\n').slice(0, 12000);
      sendResponse({ ok: true, title: document.title, url: location.href, text });
      return false;
    }
    return false;
  });

  document.documentElement.appendChild(host);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}

// TypeScript 模块边界标记（经典脚本必须保持零导入/零导出；该空导出仅为
// 让本文件成为模块、避免与其它入口在全作用域下重名，Rollup 构建后会消去）。
export {};
