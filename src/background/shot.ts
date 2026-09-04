// browser-extension/src/background/shot.ts
// 右键「截图分析」直通流程（自 main.ts 拆出控制行数；Rollup 单入口引用会内联，
// 产物 background.js 仍自包含——SW 已声明 type:module，模块化安全）。

/** 全域主机授权声明（同步自 shared/permissions.ts WIDE_HOSTS） */
const WIDE_HOSTS: chrome.permissions.Permissions = { origins: ['http://*/*', 'https://*/*'] };

/** 任务投递入口签名（main.ts 的 deliverExecTask 注入，避免反向依赖） */
export type DeliverExecTask = (taskBase: Record<string, unknown>, tab: chrome.tabs.Tab) => Promise<void>;

/**
 * 截图分析直通流程（0.34.1：右键即出蒙版，无需先唤面板）：
 *   ① 主机授权（右键手势内 request 合法；已授权静默通过）
 *   ② 注入取景器蒙版等待用户框选（注入函数与 screenshot-tools.pickRegion 同步维护；
 *      用户 Esc/误触取消 → 静默结束不投递）
 *   ③ captureVisibleTab 全屏截图（蒙版已在框选完成时移除）
 *   ④ 携带截图与选区投递 shot 任务（deliver 注入）→ 执行框直接进入裁剪压缩与识图
 * 授权被拒 → 投递空数据任务，执行框内提示并保留手动「开始框选」兜底。
 */
export async function runShotFlow(tab: chrome.tabs.Tab, deliver: DeliverExecTask): Promise<void> {
  const granted: boolean = await chrome.permissions.contains(WIDE_HOSTS).catch((): boolean => false)
    || await chrome.permissions.request(WIDE_HOSTS).catch((): boolean => false);
  if (!granted) {
    void deliver({ kind: 'shot', tabId: tab.id ?? -1, pageUrl: tab.url ?? '', pageTitle: tab.title ?? '', imageDataUrl: '', rect: null }, tab);
    return;
  }
  const rect: { x: number; y: number; w: number; h: number; dpr: number } | null =
    await pickRegionInView(tab.id ?? -1);
  if (rect === null) {
    return; // 用户取消框选：安静结束
  }
  const raw: string = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, {
    format: 'jpeg',
    quality: 90,
  });
  void deliver({
    kind: 'shot',
    tabId: tab.id ?? -1,
    pageUrl: tab.url ?? '',
    pageTitle: tab.title ?? '',
    imageDataUrl: raw,
    rect,
  }, tab);
}

/**
 * 页面取景器注入（executeScript 注入函数须自包含；与
 * sidepanel/components/ai/screenshot-tools.ts 的 pickRegion 注入体同步维护）。
 */
export async function pickRegionInView(tabId: number): Promise<{ x: number; y: number; w: number; h: number; dpr: number } | null> {
  const results: chrome.scripting.InjectionResult<unknown>[] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (): Promise<{ x: number; y: number; w: number; h: number; dpr: number } | null> =>
      new Promise((resolve: (value: { x: number; y: number; w: number; h: number; dpr: number } | null) => void): void => {
        const overlay: HTMLDivElement = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(11,15,26,0.28)';
        const box: HTMLDivElement = document.createElement('div');
        box.style.cssText = 'position:fixed;z-index:2147483647;border:2px dashed #a8b8d8;background:rgba(168,184,216,0.12);display:none;pointer-events:none';
        document.documentElement.appendChild(overlay);
        document.documentElement.appendChild(box);

        let startX = 0;
        let startY = 0;
        let drawing = false;

        const cleanup = (): void => {
          overlay.remove();
          box.remove();
          window.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onUp, true);
        };
        const onKeyDown = (e: KeyboardEvent): void => {
          if (e.key === 'Escape') {
            cleanup();
            resolve(null);
          }
        };
        const onDown = (e: PointerEvent): void => {
          if (e.button !== 0) {
            return;
          }
          drawing = true;
          startX = e.clientX;
          startY = e.clientY;
          box.style.display = 'block';
          box.style.left = `${startX}px`;
          box.style.top = `${startY}px`;
          box.style.width = '0px';
          box.style.height = '0px';
        };
        const onMove = (e: PointerEvent): void => {
          if (!drawing) {
            return;
          }
          const px: number = Math.min(startX, e.clientX);
          const py: number = Math.min(startY, e.clientY);
          box.style.left = `${px}px`;
          box.style.top = `${py}px`;
          box.style.width = `${Math.abs(e.clientX - startX)}px`;
          box.style.height = `${Math.abs(e.clientY - startY)}px`;
        };
        const onUp = (e: PointerEvent): void => {
          if (!drawing) {
            return;
          }
          drawing = false;
          const rect: { x: number; y: number; w: number; h: number; dpr: number } = {
            x: Math.min(startX, e.clientX),
            y: Math.min(startY, e.clientY),
            w: Math.abs(e.clientX - startX),
            h: Math.abs(e.clientY - startY),
            dpr: window.devicePixelRatio,
          };
          cleanup();
          resolve(rect.w < 8 || rect.h < 8 ? null : rect);
        };

        window.addEventListener('keydown', onKeyDown, true);
        overlay.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
      }),
  });
  return (results[0]?.result as { x: number; y: number; w: number; h: number; dpr: number } | null) ?? null;
}

