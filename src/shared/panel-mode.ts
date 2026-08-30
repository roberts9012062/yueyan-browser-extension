// browser-extension/src/shared/panel-mode.ts
// 面板形态管理：右侧栏（sidePanel）⇄ 悬浮窗（独立 popup 窗口）⇄ 球形内嵌（embed）。
//
// 形态识别约定：三种宿主共用同一份 src/sidepanel/index.html，以 URL 查询参数区分：
//   悬浮窗固定携带 ?mode=float；网页内球形展开的 iframe 固定携带 ?mode=embed；
//   侧栏 / options 入口不带参数视为 dock。
//
// 注意：PANEL_PATH 必须与 public/manifest.json 的 side_panel.default_path 保持一致。

/** 面板 HTML 相对路径（与 manifest.json 同步维护） */
export const PANEL_PATH: string = 'src/sidepanel/index.html';

/** 页内停靠切换消息类型（手工同步：background/main.ts、src/content/dock.ts） */
const DOCK_TOGGLE_MSG: string = 'yy-dock-toggle';

/** 面板形态（embed=网页内球形悬浮展开的面板 iframe） */
export type PanelMode = 'dock' | 'float' | 'embed';

/** 悬浮窗尺寸（与手册 §11 约定的面板观感一致） */
export const FLOAT_WINDOW_WIDTH: number = 420;
export const FLOAT_WINDOW_HEIGHT: number = 780;

/** 读取当前页面所处形态（纯函数：基于 URL 参数推断） */
export function readCurrentMode(): PanelMode {
  const param: string | null = new URLSearchParams(window.location.search).get('mode');
  if (param === 'float') {
    return 'float';
  }
  if (param === 'embed') {
    return 'embed';
  }
  return 'dock';
}

/** 当前环境是否具备原生右侧栏能力（Chrome ≥114；Edge 无 sidePanel API） */
export function isSidePanelAvailable(): boolean {
  return typeof chrome.sidePanel?.open === 'function';
}

/**
 * 切换为悬浮窗：新开同尺寸 popup 承载同一页面，并尽量收起右侧栏。
 * 收起技巧：Chromium 未提供 sidePanel.close，先用 setOptions(enabled=false) 关闭
 * 已展开面板、随即恢复 enabled=true（仅保留入口，不影响后续点击图标重新打开）；
 * 不支持该 API 的环境静默忽略（面板可能仍开着，属已知边界）。
 */
export async function switchToFloat(): Promise<void> {
  await chrome.windows.create({
    url: `${chrome.runtime.getURL(PANEL_PATH)}?mode=float`,
    type: 'popup',
    width: FLOAT_WINDOW_WIDTH,
    height: FLOAT_WINDOW_HEIGHT,
  });

  // 无侧栏能力（Edge 浮窗）时无需收起动作
  if (typeof chrome.sidePanel?.setOptions !== 'function') {
    return;
  }
  try {
    await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: false });
    await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
  } catch {
    // 收起失败不阻塞流程（用户可自行关闭右侧栏）
  }
}

/**
 * 切换回右侧栏展示：
 *   ① 有原生 sidePanel API → 定位宿主主窗口原生展开侧栏，成功后关闭当前浮窗；
 *   ② 无 API（如 Edge）→ 请求 background 向活动网页转发页内停靠开关指令
 *      （yy-dock-toggle），停靠成功时浮窗保留由用户自行关闭。
 * 返回是否成功切换（失败时调用方保持浮窗不动）。
 */
export async function switchToDock(): Promise<boolean> {
  // ① 原生侧边栏（Chrome）
  if (isSidePanelAvailable()) {
    const hostWindowId: number | null = await (async (): Promise<number | null> => {
      const windows: chrome.windows.Window[] = await chrome.windows.getAll();
      const normalWindows: chrome.windows.Window[] = windows.filter((w: chrome.windows.Window): boolean => w.type === 'normal');
      if (normalWindows.length === 0) {
        return null;
      }
      const focused: chrome.windows.Window | undefined =
        normalWindows.find((w: chrome.windows.Window): boolean => w.focused === true);
      const target: chrome.windows.Window = focused ?? normalWindows[normalWindows.length - 1];
      return target.id ?? null;
    })();

    if (hostWindowId !== null) {
      try {
        await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
        await chrome.sidePanel.open({ windowId: hostWindowId });
      } catch {
        return false;
      }
      window.close();
      return true;
    }
    return false;
  }

  // ② 页内停靠侧栏（Edge 等）
  const reply: unknown = await chrome.runtime.sendMessage({ type: DOCK_TOGGLE_MSG }).catch((): null => null);
  return (
    typeof reply === 'object' && reply !== null && (reply as Record<string, unknown>).ok === true
  );
}
