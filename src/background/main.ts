// browser-extension/src/background/main.ts
// service worker：
//   ① 点击工具栏图标 → 打开插件面板（三级降级，见 openPanel）；
//   ② 右键菜单（月言助手）→ 构建执行任务 → 悬浮球优先 / 面板兜底投递（§14 执行框方案）。
//
// 三级降级策略（手册 §2 差异备忘）：
//   ① Chrome ≥114：chrome.sidePanel.open 原生右侧边栏（onClicked 自带用户手势）；
//   ② 无 sidePanel API 的浏览器（如 Edge）：向当前网页的内容脚本发「yy-dock-*」，
//      在页面右缘展开页内停靠侧栏；
//   ③ 前两步都失败（特权页面如 chrome:// 、扩展自身页面等不可注入）：降级为同尺寸
//      独立悬浮窗（windows.create popup）。
//
// 约束：service worker 在 manifest 中以 type:module 运行；本文件仍保持零外部导入，
// 所需常量/结构本地声明并注明同步来源（shared/messages/types.ts、storage/exec-task.ts）。

/** 面板 HTML 相对路径（与 public/manifest.json、shared/panel-mode.ts 同步维护） */
import { runShotFlow } from './shot';

const PANEL_PATH: string = 'src/sidepanel/index.html';
/** 页内停靠切换/只开消息类型（与 src/content/dock.ts、shared/panel-mode.ts 同步维护） */
const DOCK_TOGGLE_MSG: string = 'yy-dock-toggle';
const DOCK_OPEN_MSG: string = 'yy-dock-open';
/** 悬浮窗尺寸（与 shared/panel-mode.ts 同步维护） */
const FLOAT_WINDOW_WIDTH: number = 420;
const FLOAT_WINDOW_HEIGHT: number = 780;

/** 执行任务探测/领取/收起/取图消息（同步自 shared/messages/types.ts MSG） */
const EXEC_OFFER_MSG: string = 'yy-exec-offer';
const EXEC_RUN_MSG: string = 'yy-exec-run';
const EXEC_CLOSE_MSG: string = 'yy-exec-close';
/** 任务暂存键与消费者标记（同步自 storage/settings.ts STORAGE_KEYS.execTask 与 messages/types.ts） */
const KEY_EXEC_TASK: string = 'exec_task_v1';
/** 右键菜单项 id（本文件唯一来源；注册与 onClicked 分发共用） */
type MenuId = 'yy-root' | 'yy-summary' | 'yy-fav-ai' | 'yy-fav-pick' | 'yy-moment-text' | 'yy-moment-image' | 'yy-shot';

/** 右键可用的页面范围（与 content_scripts.matches 一致；file 需用户在浏览器开启文件访问） */
const MENU_DOC_PATTERNS: readonly string[] = ['http://*/*', 'https://*/*', 'file://*/*'];

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

/**
 * 面板兜底打开（右键任务转面板时用）：① 原生侧栏 → ② 指定标签页内停靠（只开不关）
 * → ③ 独立悬浮窗。与 action 点击的 openPanel 区别：停靠走幂等打开，避免已开侧栏被误关。
 */
async function openPanelForTask(windowId: number, tabId: number): Promise<void> {
  if (typeof chrome.sidePanel?.open === 'function') {
    try {
      await chrome.sidePanel.open({ windowId });
      return;
    } catch {
      // 失败继续尝试②
    }
  }
  try {
    const reply: unknown = await chrome.tabs.sendMessage(tabId, { type: DOCK_OPEN_MSG });
    if (typeof reply === 'object' && reply !== null && (reply as Record<string, unknown>).ok === true) {
      return;
    }
  } catch {
    // 无内容脚本 → ③
  }
  await openFloatWindow();
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

// ---------- 右键菜单（月言助手）：注册与任务投递 ----------

/** 全量重建右键菜单（onInstalled 触发；removeAll 保证 id 幂等不重复） */
function registerMenus(): void {
  chrome.contextMenus.removeAll((): void => {
    const common: { documentUrlPatterns: string[] } = { documentUrlPatterns: [...MENU_DOC_PATTERNS] };
    chrome.contextMenus.create({ ...common, id: 'yy-root', title: '月言助手', contexts: ['page', 'selection', 'image'] });
    chrome.contextMenus.create({ ...common, id: 'yy-summary', parentId: 'yy-root', title: '📝 总结本页，发布到博客', contexts: ['page'] });
    chrome.contextMenus.create({ ...common, id: 'yy-fav-ai', parentId: 'yy-root', title: '⭐ 收藏本页（AI 自动分类）', contexts: ['page'] });
    chrome.contextMenus.create({ ...common, id: 'yy-fav-pick', parentId: 'yy-root', title: '📁 收藏本页到指定文件夹…', contexts: ['page'] });
    chrome.contextMenus.create({ ...common, id: 'yy-shot', parentId: 'yy-root', title: '🔍 截图本页，AI 分析', contexts: ['page'] });
    chrome.contextMenus.create({ ...common, id: 'yy-moment-text', parentId: 'yy-root', title: '💬 发说说：加入选中文字', contexts: ['selection'] });
    chrome.contextMenus.create({ ...common, id: 'yy-moment-image', parentId: 'yy-root', title: '💬 发说说：加入此图片', contexts: ['image'] });
  });
}

chrome.runtime.onInstalled.addListener(registerMenus);
// 浏览器启动时 SW 冷启动不触发 onInstalled：菜单注册补挂一次（重复 create 同 id 会报错，仍走 removeAll 幂等）
chrome.runtime.onStartup.addListener(registerMenus);

/**
 * 右键任务投递：暂存（target=ball）→ 探测悬浮球 → 球不可用改写 panel 并打开面板。
 * 球应答 {ok:true} 表示已展开执行框；隐藏/失联走面板兜底（ ExecutorHost 领取执行）。
 */
async function deliverExecTask(taskBase: Record<string, unknown>, tab: chrome.tabs.Tab): Promise<void> {
  const nonce: string = crypto.randomUUID();
  const task: Record<string, unknown> = { ...taskBase, nonce, target: 'ball', createdAt: Date.now() };
  await chrome.storage.local.set({ [KEY_EXEC_TASK]: task });

  if (tab.id !== undefined) {
    try {
      const reply: unknown = await chrome.tabs.sendMessage(tab.id, { type: EXEC_OFFER_MSG, nonce });
      if (typeof reply === 'object' && reply !== null && (reply as Record<string, unknown>).ok === true) {
        return; // 悬浮球已展开执行框
      }
    } catch {
      // 无内容脚本（特权页）→ 面板兜底
    }
  }

  // 面板兜底：改写 target → 三级降级打开面板 → 广播领取
  await chrome.storage.local.set({ [KEY_EXEC_TASK]: { ...task, target: 'panel' } });
  const windowId: number = tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  await openPanelForTask(windowId, tab.id ?? -1);
  void chrome.runtime.sendMessage({ type: EXEC_RUN_MSG, nonce }).catch((): void => undefined);
}

chrome.contextMenus.onClicked.addListener((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (tab === undefined || tab.id === undefined || tab.url === undefined) {
    return;
  }
  const pageUrl: string = tab.url;
  const pageTitle: string = tab.title ?? pageUrl;
  const tabId: number = tab.id;
  const base: Record<string, unknown> = { tabId, pageUrl, pageTitle };

  switch (info.menuItemId as MenuId) {
    case 'yy-summary':
      void deliverExecTask({ ...base, kind: 'summary' }, tab);
      break;
    case 'yy-fav-ai':
      void deliverExecTask({ ...base, kind: 'bookmark', mode: 'ai' }, tab);
      break;
    case 'yy-fav-pick':
      void deliverExecTask({ ...base, kind: 'bookmark', mode: 'pick' }, tab);
      break;
    case 'yy-moment-text':
      void deliverExecTask({ ...base, kind: 'moment', addText: info.selectionText ?? '', addImage: '' }, tab);
      break;
    case 'yy-moment-image':
      void deliverExecTask({ ...base, kind: 'moment', addText: '', addImage: info.srcUrl ?? '' }, tab);
      break;
    case 'yy-shot':
      // 直通流程（shot.ts）：右键即出蒙版框选，完成后携截图投递（授权拒绝时投空数据走面板兜底）
      if (tab !== undefined) {
        void runShotFlow(tab, deliverExecTask);
      }
      break;
    default:
      break;
  }
});

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

    // 执行框关闭转发：扩展页的 runtime.sendMessage 广播按官方语义不投递 content script，
    // 须经此处转 tabs.sendMessage 到执行框所在的宿主页标签（sender.tab 即宿主页）。
    if (payload.type === EXEC_CLOSE_MSG) {
      const relayTabId: number | undefined = sender.tab?.id;
      if (relayTabId !== undefined) {
        void chrome.tabs.sendMessage(relayTabId, { type: EXEC_CLOSE_MSG }).catch((): void => undefined);
      }
      sendResponse({ ok: true });
      return false;
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
