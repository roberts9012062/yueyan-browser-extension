// browser-extension/src/sidepanel/components/ai/screenshot-tools.ts
// 截图分析公共工具（自 AiChatTab 拆出）：区域取景注入、全屏截图裁剪与本地压缩。
// AI 助手「📸 网页截图」与右键「🔍 截图本页，AI 分析」共用同一套（规则变更两处一起改）。

/** 选区矩形（CSS 像素，相对视口）与页面缩放比 */
export interface PickRect {
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
}

/** 加载 dataUrl 为 Image（纯函数） */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve: (img: HTMLImageElement) => void, reject: () => void): void => {
    const img: HTMLImageElement = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 按选区裁剪截图（CSS 像素 × dpr = 物理像素；纯函数） */
export async function cropScreenshot(rawDataUrl: string, rect: PickRect): Promise<string> {
  const image: HTMLImageElement = await loadImage(rawDataUrl);
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w * rect.dpr));
  canvas.height = Math.max(1, Math.round(rect.h * rect.dpr));
  const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (ctx === null) {
    return rawDataUrl;
  }
  ctx.drawImage(
    image,
    Math.round(rect.x * rect.dpr),
    Math.round(rect.y * rect.dpr),
    Math.round(rect.w * rect.dpr),
    Math.round(rect.h * rect.dpr),
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * 截图本地压缩（纯函数）：canvas 等比缩放 + JPEG 编码，逐档降级直至目标体积。
 * 目标 <800KB（为代理层常见 1MB body 限制留余量）；识图任务对精度不敏感，
 * 长边 1280 足够。全部分档仍超限时返回最后一档（尽力而为）。
 */
export async function compressScreenshot(rawDataUrl: string): Promise<string> {
  const image: HTMLImageElement = await loadImage(rawDataUrl);

  // 压缩分档：[长边上限, 质量]（依次降级）
  const tiers: readonly { maxDim: number; quality: number }[] = [
    { maxDim: 1280, quality: 0.72 },
    { maxDim: 1280, quality: 0.55 },
    { maxDim: 1024, quality: 0.45 },
    { maxDim: 800, quality: 0.4 },
  ];
  const TARGET_BYTES: number = 800 * 1024;

  let last: string = rawDataUrl;
  for (const tier of tiers) {
    const scale: number = Math.min(1, tier.maxDim / Math.max(image.width, image.height));
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (ctx === null) {
      return rawDataUrl;
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    last = canvas.toDataURL('image/jpeg', tier.quality);
    if (last.length * 0.75 < TARGET_BYTES) {
      return last;
    }
  }
  return last;
}

/**
 * 区域选择：向目标标签注入一次性取景器（全屏遮罩 + 拖拽画框，Esc 取消）。
 * executeScript 注入的 func 必须自包含（不得引用外部变量）；
 * 返回选区（CSS 像素）与 devicePixelRatio，用户取消返回 null。
 */
export async function pickRegion(tabId: number): Promise<PickRect | null> {
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
          // 过小的框视为误触取消
          resolve(rect.w < 8 || rect.h < 8 ? null : rect);
        };

        window.addEventListener('keydown', onKeyDown, true);
        overlay.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
      }),
  });
  return (results[0]?.result as PickRect | null) ?? null;
}
