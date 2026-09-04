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

/**
 * 收集页面内容区图片地址（供右键「总结本页」插图；与 AiChatTab 注入抓取函数同规则）：
 * 懒加载属性优先于 src（data-src / data-original / data-actualsrc / data-lazy-src）；
 * 协议相对地址（//cdn...）按页面协议归一；小图（<250px）与广告容器内图过滤；
 * 正文容器优先（article/main 等常见容器），一图未得则全页兜底；上限 9 张防刷屏。
 */
function collectPageImages(): string[] {
  const normalizeSrc = (raw: string | null): string => {
    const v: string = (raw ?? '').trim();
    return v.startsWith('//') ? location.protocol + v : v;
  };
  const resolveImgSrc = (img: HTMLImageElement): string => {
    const lazy: string = normalizeSrc(
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('data-lazy-src'),
    );
    if (/^https?:/i.test(lazy)) {
      return lazy;
    }
    return normalizeSrc(img.currentSrc || img.src || '');
  };
  // 广告容器判定：class/id 精确匹配 ad/banner/promo/sponsor 词根（含 advads-*），
  // 仅查自身与 3 层祖先，避免高层通用容器误伤（与 AiChatTab 注入版一致）
  const AD_TOKEN: RegExp = /^(ads?|advert\w*|advads\w*|banner|promo|sponsor)([-_].*)?$/i;
  const isAdNode = (el: Element): boolean => {
    for (const cls of Array.from(el.classList)) {
      if (AD_TOKEN.test(cls)) {
        return true;
      }
    }
    const id: string = el.id ?? '';
    return id !== '' && AD_TOKEN.test(id);
  };
  const adLike = (img: HTMLImageElement): boolean => {
    let node: HTMLElement | null = img;
    for (let depth: number = 0; depth < 4 && node !== null; depth += 1) {
      if (isAdNode(node)) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  };
  const collectFrom = (scope: ParentNode, picked: string[], seen: Set<string>): void => {
    for (const img of Array.from(scope.querySelectorAll('img'))) {
      const src: string = resolveImgSrc(img);
      if (!/^https?:/i.test(src) || seen.has(src) || picked.length >= 9) {
        continue;
      }
      // 死图过滤：已完成加载尝试但无尺寸（404/防盗链等裂图，页面上显示不出来）——
      // 直接丢弃不抓取（与 AiChatTab 注入版同规则；裂图转存必失败，0.32.1）
      if (img.complete === true && img.naturalWidth === 0) {
        continue;
      }
      const width: number = img.naturalWidth > 0 ? img.naturalWidth : img.width;
      if (width > 0 && width < 250) {
        continue;
      }
      if (adLike(img)) {
        continue;
      }
      seen.add(src);
      picked.push(src);
    }
  };
  // 正文容器优先：常见语义容器命中其一且能取到图，则不扫全页
  const scopes: string[] = ['article', 'main', '[role="main"]', '.content', '#content', '.post-content', '.article-content'];
  const picked: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (const sel of scopes) {
    for (const node of Array.from(document.querySelectorAll(sel))) {
      collectFrom(node, picked, seen);
    }
    if (picked.length > 0) {
      break;
    }
  }
  if (picked.length === 0) {
    collectFrom(document, picked, seen);
  }
  return picked;
}

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
    if (currentWrap === null) {
      return;
    }
    if (open) {
      currentWrap.classList.add('open');
      return;
    }
    // 收起时移除 iframe 而非仅隐藏：释放面板页后台实例（下次展开重新创建）
    currentWrap.remove();
    currentWrap = null;
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
  chrome.runtime.onMessage.addListener((msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean => {    const payload = msg as Record<string, unknown> | null;
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
    // 供「网页总结」抓取正文与内容区图片：可见文本截断至 12K 字符；
    // 图片收集与 AiChatTab 注入函数同规则（懒加载属性优先、协议相对归一、
    // 小图与广告容器过滤、正文容器优先全页兜底），规则变更两处一起改。
    if (payload.type === 'yy-page-text') {
      const text: string = (document.body?.innerText ?? '').replace(/\n{3,}/gu, '\n\n').slice(0, 12000);
      sendResponse({ ok: true, title: document.title, url: location.href, text, images: collectPageImages() });
      return false;
    }
    // 供「右键发说说」取图：页面上下文抓取图片二进制转 dataURL（blob:/受 CSP 保护图
    // 从扩展页跨 origin fetch 不可达，须回到本页上下文取；同步消息通道有超时，异步应答）
    if (payload.type === 'yy-image-data') {
      const src: unknown = payload.src;
      if (typeof src !== 'string' || src === '') {
        sendResponse({ ok: false, reason: 'bad_src' });
        return false;
      }
      (async (): Promise<void> => {
        try {
          const res: Response = await fetch(src, { credentials: 'omit' });
          if (!res.ok) {
            sendResponse({ ok: false, reason: `http_${res.status}` });
            return;
          }
          const blob: Blob = await res.blob();
          if (blob.size > 20 * 1024 * 1024) {
            sendResponse({ ok: false, reason: 'too_large' });
            return;
          }
          const dataUrl: string = await new Promise<string>((resolve: (v: string) => void, reject: () => void): void => {
            const reader: FileReader = new FileReader();
            reader.onload = (): void => resolve(reader.result as string);
            reader.onerror = (): void => reject();
            reader.readAsDataURL(blob);
          });
          sendResponse({ ok: true, dataUrl, mime: blob.type });
        } catch {
          sendResponse({ ok: false, reason: 'fetch_error' });
        }
      })();
      return true; // 异步应答，保持通道开启
    }
    return false;
  });

  // 点击停靠区外收起（与悬浮球面板一致的关闭体验；兜底打开的停靠此前无任何关闭手段）
  document.addEventListener(
    'click',
    (ev: MouseEvent): void => {
      if (!dockOpen) {
        return;
      }
      if (ev.composedPath().includes(host)) {
        return;
      }
      setDockOpen(false);
    },
    true,
  );

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
