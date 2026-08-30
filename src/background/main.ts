// browser-extension/src/background/main.ts
// service worker：点击工具栏图标 → 打开插件面板。
//
// 三级降级策略（手册 §2 差异备忘）：
//   ① Chrome ≥114：chrome.sidePanel.open 原生右侧边栏（onClicked 自带用户手势）；
//   ② 无 sidePanel API 的浏览器（如 Edge）：向当前网页的内容脚本发「yy-dock-toggle」，
//      在页面右缘展开页内停靠侧栏；
//   ③ 前两步都失败（特权页面如 chrome:// 、扩展自身页面等不可注入）：降级为同尺寸
//      独立悬浮窗（windows.create popup）。
// 面板页内的「浏览器右侧」按钮通过 runtime 消息 open-dock 复用②的注入逻辑。
//
// 约束：service worker 在 manifest 中以 type:module 运行；本文件仍保持零外部导入，
// 所需常量本地声明并注明与 manifest / shared/panel-mode.ts 的同步关系。

/** 面板 HTML 相对路径（与 public/manifest.json、shared/panel-mode.ts 同步维护） */
const PANEL_PATH: string = 'src/sidepanel/index.html';
/** 页内停靠切换消息类型（与 src/content/dock.ts、shared/panel-mode.ts 同步维护） */
const DOCK_TOGGLE_MSG: string = 'yy-dock-toggle';
/** 悬浮窗尺寸（与 shared/panel-mode.ts 同步维护） */
const FLOAT_WINDOW_WIDTH: number = 420;
const FLOAT_WINDOW_HEIGHT: number = 780;

interface ActionTabLike {
  windowId: number;
}

/** 打开独立悬浮窗 */
async function openFloatWindow(): Promise<void> {
  await chrome.windows.create({
    url: `${chrome.runtime.getURL(PANEL_PATH)}?mode=float`,
    type: 'popup',
    width: FLOAT_WINDOW_WIDTH,
    height: FLOAT_WINDOW_HEIGHT,
  });
}

/**
 * 向可注入的网页标签页发送页内停靠开关指令。
 * 目标优先级：最近聚焦窗口的活动标签 → 其余普通窗口的活动标签；
 * 发送失败（如 chrome:// 特权页无内容脚本）自动跳过下一个候选。
 * 返回是否有任一标签页成功响应。
 */
async function toggleDockInPage(): Promise<boolean> {
  const focusedActives: chrome.tabs.Tab[] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const allActives: chrome.tabs.Tab[] = await chrome.tabs.query({ active: true });

  const seenIds = new Set<number>();
  for (const tab of [...focusedActives, ...allActives]) {
    if (tab.id === undefined || seenIds.has(tab.id)) {
      continue;
    }
    seenIds.add(tab.id);
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: DOCK_TOGGLE_MSG });
      if (typeof reply === 'object' && reply !== null && (reply as Record<string, unknown>).ok === true) {
        return true;
      }
    } catch {
      // 无内容脚本（特权页/商店页）→ 尝试下一个候选标签
    }
  }
  return false;
}

/** 点击工具栏图标：按①→②→③顺序打开面板 */
async function openPanel(tab: ActionTabLike): Promise<void> {
  // ① 原生侧边栏
  if (typeof chrome.sidePanel?.open === 'function') {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    } catch {
      // 失败继续尝试②
    }
  }
  // ② 页内停靠侧栏
  if (await toggleDockInPage()) {
    return;
  }
  // ③ 独立悬浮窗兜底
  await openFloatWindow();
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId === undefined || tab.windowId === null) {
    return;
  }
  void openPanel({ windowId: tab.windowId });
});

// 面板页「浏览器右侧展示面板」按钮 → 复用页内停靠注入（无原生 sidePanel 的环境）
// 悬浮球点击 → 三级打开：原生侧边栏 → 发起页的页内停靠 → 均不可用回 none（球自开面板）
chrome.runtime.onMessage.addListener(
  (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean => {
    const payload = msg as Record<string, unknown> | null;
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    if (payload.type === 'open-dock') {
      void toggleDockInPage().then((ok: boolean): void => sendResponse({ ok }));
      return true; // 保持消息通道开启等待异步应答
    }

    if (payload.type === 'yy-open-sidepanel') {
      void (async (): Promise<void> => {
        // ① 原生侧边栏（Chrome 116+；消息链由用户手势引发，可以调用 open）
        const windowId: number | undefined = sender.tab?.windowId;
        if (typeof chrome.sidePanel?.open === 'function' && windowId !== undefined) {
          try {
            await chrome.sidePanel.open({ windowId });
            sendResponse({ mode: 'sidepanel' });
            return;
          } catch {
            // 失败继续走 ②
          }
        }
        // ② 发起球的所在页的页内停靠侧栏（只开不关）
        const tabId: number | undefined = sender.tab?.id;
        if (tabId !== undefined) {
          try {
            const reply: unknown = await chrome.tabs.sendMessage(tabId, { type: 'yy-dock-open' });
            if (typeof reply === 'object' && reply !== null && (reply as Record<string, unknown>).ok === true) {
              sendResponse({ mode: 'dock' });
              return;
            }
          } catch {
            // 页面无内容脚本（特权页）→ ③
          }
        }
        sendResponse({ mode: 'none' });
      })();
      return true;
    }
    return false;
  },
);

// TypeScript 模块边界标记（经典脚本必须保持零导入/零导出；该空导出仅为
// 让本文件成为模块、避免与其它入口在全作用域下重名，Rollup 构建后会消去）。
export {};
