// browser-extension/src/content/ball.ts
// 内容脚本：在目标网页注入「球形悬浮」入口。
//
// 行为：
//   - 月亮造型悬浮球（光晕呼吸 + 闪烁星星），支持拖拽移动与位置记忆；
//   - 拖近左右缘自动吸附并半隐藏，鼠标移上去滑出显示全部；
//   - 单击球体展开/收起页面内嵌面板（iframe 加载插件自身页面 ?mode=embed）；
//   - 鼠标悬停球体向下展开快捷菜单：⭐一键收藏（本地书签）/ 📝网页总结 / 📸网页截图，
//     后两者写入 panel_action 并展开面板，由 embed 面板中的 AI 页执行（见 AiChatTab）；
//   - 遵循设置中的 showBall 开关（chrome.storage.onChanged 实时显隐）。
//
// 安全约束（手册 §7）：只渲染悬浮球与面板 iframe，不读取宿主脚本数据；
// 收藏动作仅写入 chrome.storage 的书签树（键名与 shared/storage/settings.ts 手工同步）。
//
// 约束：内容脚本以经典脚本执行，产物必须自包含（禁止 import/export），因此本文件
// 无法按 300 行红线拆分模块（跨文件只能走脆弱的 window 事件桥），此处集中实现并
// 保持结构分区清晰。

/** 设置项存储键（手工同步：shared/storage/settings.ts STORAGE_KEYS.settings） */
const KEY_SETTINGS: string = 'plugin_settings_v1';
/** 悬浮球位置存储键（手工同步：STORAGE_KEYS.ballPosition） */
const KEY_BALL_POSITION: string = 'ball_position_v1';
/** 书签树存储键（手工同步：STORAGE_KEYS.bookmarks；节点结构与 types.BookmarkNode 一致） */
const KEY_BOOKMARKS: string = 'bookmarks_v2';
/** 面板待执行动作（球菜单 → embed 面板；AiChatTab 消费后删除） */
const KEY_PANEL_ACTION: string = 'panel_action';

/** 球体尺寸（像素） */
const BALL_SIZE: number = 44;
/** 视口边缘最小间距（像素） */
const EDGE_GAP: number = 8;
/** 左右缘吸附判定距离（球心距缘小于此值即吸附，像素） */
const SNAP_RANGE: number = 34;
/** 半隐藏位置：球一半在视口外（左缘 x / 右缘 x 由吸附计算得出） */
const HALF_OUT: number = -BALL_SIZE / 2;
/** 区分「拖拽」与「点击」的位移阈值（像素） */
const DRAG_THRESHOLD: number = 5;
/** 菜单按钮尺寸与纵向间距（从球正下方依次排开） */
const FAN_ITEM_SIZE: number = 36;
const MENU_TOP_GAP: number = 10;
const MENU_ITEM_GAP: number = 8;
/** 悬停感应区尺寸（宽度覆盖菜单，高度覆盖三个按钮 + 上下衔接余量） */
const HOVER_AREA_W: number = 150;
const HOVER_AREA_H: number = MENU_TOP_GAP + 3 * (FAN_ITEM_SIZE + MENU_ITEM_GAP) + 16;

/** 悬浮球屏幕位置 */
interface BallPos {
  x: number;
  y: number;
}

/** 扇形菜单动作 */
type FanAction = 'save' | 'summary' | 'shot';

/** 球体默认停靠点：右缘中部 */
function defaultPosition(): BallPos {
  return { x: window.innerWidth - BALL_SIZE - EDGE_GAP - 24, y: Math.round(window.innerHeight * 0.4) };
}

/**
 * 将坐标限制在允许范围内（纯函数）。
 * x 允许半隐藏：吸附态球一半在视口外（[-BALL/2, W-BALL/2]）；
 * y 仍保持完全可见。
 */
function clampToViewport(pos: BallPos): BallPos {
  const minX: number = HALF_OUT;
  const maxX: number = window.innerWidth - BALL_SIZE / 2;
  const maxY: number = window.innerHeight - BALL_SIZE - EDGE_GAP;
  return {
    x: Math.min(Math.max(pos.x, minX), Math.max(maxX, minX)),
    y: Math.min(Math.max(pos.y, EDGE_GAP), Math.max(maxY, EDGE_GAP)),
  };
}

/** 推断坐标所处的吸附缘（半隐藏位置 → 'left' | 'right' | null；纯函数） */
function edgeOf(pos: BallPos): 'left' | 'right' | null {
  if (pos.x <= HALF_OUT + 1) {
    return 'left';
  }
  if (pos.x >= window.innerWidth - BALL_SIZE / 2 - 1) {
    return 'right';
  }
  return null;
}

/** 读取悬浮球位置（无效返回 null） */
async function readBallPos(): Promise<BallPos | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(KEY_BALL_POSITION);
  const raw = stored[KEY_BALL_POSITION];
  if (
    typeof raw !== 'object' || raw === null ||
    typeof (raw as Record<string, unknown>).x !== 'number' ||
    typeof (raw as Record<string, unknown>).y !== 'number'
  ) {
    return null;
  }
  return { x: (raw as BallPos).x, y: (raw as BallPos).y };
}

/** 读取 showBall 开关（缺省视为开启） */
async function readShowBall(): Promise<boolean> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(KEY_SETTINGS);
  const raw = stored[KEY_SETTINGS] as Record<string, unknown> | undefined;
  return raw === undefined ? true : raw.showBall !== false;
}

/** 书签树节点（结构与 types.BookmarkNode 一致；本地最小子集） */
interface FanNode {
  id: string;
  kind: 'folder' | 'link';
  title: string;
  url: string;
  addedAt: number;
  children: FanNode[];
}

/** 生成实体 ID */
function genId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** URL 查重归一化（与书签页 tools.normalizeUrl 保持一致） */
function normalizeUrl(raw: string): string {
  try {
    const u: URL = new URL(raw.trim());
    return `${u.host}${u.pathname.replace(/\/+$/u, '')}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** 递归判断树中是否已收藏该 URL（纯函数） */
function hasUrl(nodes: readonly FanNode[], target: string): boolean {
  for (const n of nodes) {
    if (n.kind === 'link' && normalizeUrl(n.url) === target) {
      return true;
    }
    if (hasUrl(n.children, target)) {
      return true;
    }
  }
  return false;
}

// ---------- 样式（写入 Shadow DOM，宿主页不可见） ----------
const SHADOW_CSS: string = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  .host-root { position: fixed; left: 0; top: 0; z-index: 2147483646; }

  /* 月亮本体：月白渐变 + 左上光斑 + 银蓝光晕（呼吸） */
  .ball {
    position: fixed; width: ${BALL_SIZE}px; height: ${BALL_SIZE}px;
    border-radius: 50%; border: none; cursor: pointer;
    background:
      radial-gradient(circle at 34% 28%, rgba(255, 253, 244, 0.95) 0%, rgba(253, 246, 227, 0.55) 26%, rgba(253, 246, 227, 0) 46%),
      radial-gradient(circle at 50% 50%, #f6efd9 0%, #ece4cc 52%, #c9d2e0 100%);
    box-shadow:
      0 0 10px 1px rgba(214, 226, 246, 0.55),
      0 0 26px 5px rgba(168, 184, 216, 0.38),
      0 4px 14px rgba(31, 42, 64, 0.3);
    display: flex; align-items: center; justify-content: center;
    transition: left 220ms cubic-bezier(0.22, 1, 0.36, 1), top 220ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 150ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 150ms ease;
    touch-action: none; user-select: none; -webkit-user-drag: none;
    pointer-events: auto;
  }
  /* 拖动跟手：关闭位移过渡（仅保留悬停缩放） */
  .ball.dragging { transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1); }
  .ball:hover { transform: scale(1.08); }
  .ball:active { transform: scale(0.96); }
  /* 月亮图案：mask 挖出月牙，drop-shadow 沿月牙形状发光 */
  .moon-mark {
    position: absolute; left: 50%; top: 50%;
    width: 21px; height: 21px; border-radius: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(160deg, #fffdf2 15%, #efe6c8 60%, #ded7bd 100%);
    -webkit-mask: radial-gradient(circle at 66% 30%, transparent 0 8.5px, #000 9px);
    mask: radial-gradient(circle at 66% 30%, transparent 0 8.5px, #000 9px);
    filter: drop-shadow(0 0 4px rgba(255, 249, 220, 0.95)) drop-shadow(0 0 10px rgba(247, 201, 72, 0.35));
    pointer-events: none;
  }

  /* 月晕呼吸层：包裹球体的柔光，微微地亮暗循环 */
  .ball::before {
    content: ''; position: absolute; inset: -7px; border-radius: 50%;
    background: radial-gradient(circle, rgba(197, 208, 232, 0.5) 0%, rgba(197, 208, 232, 0.16) 46%, rgba(197, 208, 232, 0) 70%);
    pointer-events: none;
    animation: moon-breathe 3.4s ease-in-out infinite;
  }
  @keyframes moon-breathe {
    0%, 100% { opacity: 0.45; transform: scale(0.94); }
    50% { opacity: 0.95; transform: scale(1.06); }
  }

  /* 黄色小星星：球面上若隐若现地闪烁（各颗相位/节奏不同） */
  .star {
    position: absolute; pointer-events: none; color: #f7c948;
    text-shadow: 0 0 5px rgba(247, 201, 72, 0.95), 0 0 12px rgba(247, 201, 72, 0.5);
    animation: star-twinkle 2.6s ease-in-out infinite;
  }
  .star.s1 { left: 9px; top: 8px; font-size: 9px; animation-delay: 0s; animation-duration: 2.4s; }
  .star.s2 { right: 7px; top: 15px; font-size: 7px; animation-delay: 0.9s; animation-duration: 3.1s; }
  .star.s3 { left: 13px; bottom: 7px; font-size: 8px; animation-delay: 1.6s; animation-duration: 2.8s; }
  .star.s4 { right: 11px; bottom: 12px; font-size: 6px; animation-delay: 0.4s; animation-duration: 3.5s; }
  @keyframes star-twinkle {
    0%, 100% { opacity: 0.08; transform: scale(0.5) rotate(0deg); }
    50% { opacity: 1; transform: scale(1.05) rotate(18deg); }
  }

  /* 感应区：位于球体下方（与球底微重叠衔接），仅在菜单展开时拦截命中——
     常态穿透不挡球（保拖拽），展开时实体化保「球→菜单」悬停链路不断 */
  .hover-area {
    position: fixed; width: ${HOVER_AREA_W}px; height: ${HOVER_AREA_H}px;
    border-radius: 14px; pointer-events: none;
  }
  .hover-area.active { pointer-events: auto; }

  .fan-item {
    position: fixed; width: ${FAN_ITEM_SIZE}px; height: ${FAN_ITEM_SIZE}px;
    border-radius: 50%; border: 1px solid rgba(42, 51, 72, 0.9); cursor: pointer;
    background: #121826; color: #e8ecf4; font-size: 15px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    opacity: 0; pointer-events: none;
    transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease;
  }

  .fan-item:hover { background: #1a2233; }
  .fan-wrap.open .fan-item { opacity: 1; pointer-events: auto; }

  .panel-wrap {
    position: fixed; width: 392px; height: 600px; max-height: calc(100vh - 24px);
    display: none; flex-direction: column; overflow: hidden;
    border-radius: 14px; background: #121826;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); border: 1px solid rgba(42, 51, 72, 0.9);
  }
  .panel-wrap.open { display: flex; animation: pop-in 200ms cubic-bezier(0.34, 1.56, 0.64, 1); }
  @keyframes pop-in { from { opacity: 0; transform: scale(0.96) translateY(6px); } to { opacity: 1; transform: none; } }
  .panel-wrap iframe { width: 100%; height: 100%; border: none; }

  .toast {
    position: fixed; z-index: 2147483646; padding: 6px 14px; border-radius: 999px;
    background: rgba(18, 24, 38, 0.92); color: #e8ecf4; font-size: 12px;
    border: 1px solid rgba(42, 51, 72, 0.9); pointer-events: none;
  }
`;

function main(): void {
  // 单例防重复注入
  const win: Record<string, unknown> = window as unknown as Record<string, unknown>;
  if (win.__yueyan_ball_mounted__ === true) {
    return;
  }
  win.__yueyan_ball_mounted__ = true;

  // ---------- 宿主节点与 Shadow DOM ----------
  const host: HTMLDivElement = document.createElement('div');
  host.className = 'yueyan-ball-host';
  const shadowRoot: ShadowRoot = host.attachShadow({ mode: 'closed' });

  const styleEl: HTMLStyleElement = document.createElement('style');
  styleEl.textContent = SHADOW_CSS;
  shadowRoot.appendChild(styleEl);

  const rootBox: HTMLDivElement = document.createElement('div');
  rootBox.className = 'host-root';
  shadowRoot.appendChild(rootBox);

  // ---------- 轻提示（收藏结果等一次性反馈） ----------
  let toastEl: HTMLDivElement | null = null;
  function showToast(text: string): void {
    if (toastEl !== null) {
      toastEl.remove();
    }
    const el: HTMLDivElement = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toastEl = el;
    rootBox.appendChild(el);
    el.style.left = `${Math.max(currentPos.x - 30, EDGE_GAP)}px`;
    el.style.top = `${Math.max(currentPos.y - BALL_SIZE - 34, EDGE_GAP)}px`;
    window.setTimeout((): void => {
      el.remove();
      if (toastEl === el) {
        toastEl = null;
      }
    }, 1800);
  }

  // ---------- 展开面板（iframe 内嵌完整面板页） ----------
  const panelWrap: HTMLDivElement = document.createElement('div');
  panelWrap.className = 'panel-wrap';
  let panelFrame: HTMLIFrameElement | null = null;

  let panelOpen: boolean = false;

  function setPanelOpen(open: boolean): void {
    if (open && panelFrame === null) {
      panelFrame = document.createElement('iframe');
      panelFrame.title = '月言博客助手';
      panelFrame.src = `${chrome.runtime.getURL('src/sidepanel/index.html')}?mode=embed`;
      panelWrap.appendChild(panelFrame);
    }
    panelOpen = open;
    panelWrap.classList.toggle('open', open);
  }

  // 点击面板外关闭（closed Shadow Root 的 composedPath 会被剪枝，须以 host 判定来源）
  document.addEventListener(
    'click',
    (ev: MouseEvent): void => {
      if (!panelOpen) {
        return;
      }
      if (ev.composedPath().includes(host)) {
        return;
      }
      setPanelOpen(false);
    },
    true,
  );

  // ---------- 悬停感应区（球与菜单的统一父级） ----------
  // 结构：球体与菜单按钮都挂在感应区子树内——指针停留在任一后代上都不算离开
  // （悬停语义统一，菜单不闪没）；感应区自身永久穿透（pointer-events:none），
  // 只有球与按钮接收指针——避免感应区盖住球导致拖拽失灵（0.16.2 的回归）。
  const hoverArea: HTMLDivElement = document.createElement('div');
  hoverArea.className = 'hover-area';
  rootBox.appendChild(hoverArea);

  // ---------- 球体 ----------
  const ball: HTMLButtonElement = document.createElement('button');
  ball.type = 'button';
  ball.className = 'ball';
  ball.title = '月言博客助手（悬停出菜单，可拖动）';

  const moonMark: HTMLSpanElement = document.createElement('span');
  moonMark.className = 'moon-mark';
  moonMark.setAttribute('aria-hidden', 'true');
  ball.appendChild(moonMark);

  // 月面上的小星星（✦ 字符 + 闪烁动画，各颗相位不同）
  const STAR_CHARS: readonly string[] = ['✦', '✧', '✦', '✧'];
  STAR_CHARS.forEach((ch: string, i: number): void => {
    const star: HTMLSpanElement = document.createElement('span');
    star.className = `star s${i + 1}`;
    star.textContent = ch;
    star.setAttribute('aria-hidden', 'true');
    ball.appendChild(star);
  });
  hoverArea.appendChild(ball);

  // ---------- 快捷菜单（悬停向下展开，位于感应区子树） ----------
  const fanWrap: HTMLDivElement = document.createElement('div');
  fanWrap.className = 'fan-wrap';
  hoverArea.appendChild(fanWrap);

  const FAN_DEFS: readonly { icon: string; label: string; action: FanAction }[] = [
    { icon: '⭐', label: '一键收藏', action: 'save' },
    { icon: '📝', label: '网页总结', action: 'summary' },
    { icon: '📸', label: '网页截图', action: 'shot' },
  ];

  const fanItems: HTMLButtonElement[] = FAN_DEFS.map((def): HTMLButtonElement => {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fan-item';
    btn.title = def.label;
    btn.setAttribute('aria-label', def.label);
    btn.textContent = def.icon;
    btn.addEventListener('pointerup', (ev: PointerEvent): void => {
      ev.stopPropagation();
      closeFan();
      void runFanAction(def.action);
    });
    fanWrap.appendChild(btn);
    return btn;
  });

  let fanOpen: boolean = false;

  function openFan(): void {
    fanOpen = true;
    fanWrap.classList.add('open');
    hoverArea.classList.add('active');
    applyFanTransforms();
  }

  function closeFan(): void {
    fanOpen = false;
    fanWrap.classList.remove('open');
    hoverArea.classList.remove('active');
    applyFanTransforms();
    peekIn();
  }

  /** 展开态位移：球正下方纵向排开（收起态归位球心并缩小） */
  function applyFanTransforms(): void {
    const centerOffset: number = BALL_SIZE / 2 - FAN_ITEM_SIZE / 2;
    fanItems.forEach((btn: HTMLButtonElement, i: number): void => {
      if (!fanOpen) {
        btn.style.transform = `translate(${centerOffset}px, ${centerOffset}px) scale(0.4)`;
        return;
      }
      const dx: number = centerOffset;
      const dy: number = BALL_SIZE + MENU_TOP_GAP + i * (FAN_ITEM_SIZE + MENU_ITEM_GAP);
      btn.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
    });
  }

  /**
   * 扩展上下文存活检测：扩展刷新/更新后，旧页面的 content script 上下文失效
   * （storage 监听已死、菜单点击无效），此时应移除自身避免僵尸球。
   */
  function ensureAlive(): boolean {
    let alive: boolean;
    try {
      alive = chrome.runtime !== undefined && chrome.runtime.id !== undefined;
    } catch {
      alive = false;
    }
    if (!alive) {
      host.remove();
      return false;
    }
    return true;
  }
  document.addEventListener('visibilitychange', (): void => {
    if (document.visibilityState === 'visible') {
      if (ensureAlive()) {
        void applyVisibility();
      }
    }
  });

  // 悬停收起模型（关键事件语义）：
  //   pointerleave 不冒泡，且球/菜单按钮都是感应区的 DOM 后代——指针从后代
  //   移到祖先不会触发祖先的 pointerenter（0.17.1 抽风根因：取消信号收不到，
  //   定时收起到期 → 菜单关 → 鼠标落回球上又打开 → 闪烁循环）。
  //   因此取消信号改用 pointerover（冒泡）：子树内任何命中目标变化都会冒泡
  //   经过感应区；离开整个子树时由感应区的 pointerleave 延时收起。
  let closeTimer: number = 0;
  function scheduleClose(): void {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout((): void => closeFan(), 160);
  }
  function cancelClose(): void {
    window.clearTimeout(closeTimer);
  }

  ball.addEventListener('pointerenter', (): void => {
    if (!ensureAlive()) {
      return;
    }
    void applyVisibility();
    peekOut();
    openFan();
  });
  // 子树内任何移动（球↔按钮↔感应区空白）都取消待收起
  hoverArea.addEventListener('pointerover', (): void => {
    cancelClose();
  });
  // 离开整个感应区子树（含球）→ 延时收起
  hoverArea.addEventListener('pointerleave', (): void => {
    scheduleClose();
  });

  // ---------- 扇形菜单动作 ----------
  async function runFanAction(action: FanAction): Promise<void> {
    if (action === 'save') {
      await saveBookmarkLocal();
      return;
    }
    // 网页总结 / 网页截图：写动作暂存 → 展开球面板 → 广播通知（面板加载后消费）
    const nonce: string = genId();
    await chrome.storage.local.set({
      [KEY_PANEL_ACTION]: { action, nonce },
    });
    setPanelOpen(true);
    void chrome.runtime.sendMessage({ type: 'yy-run-action', nonce }).catch((): void => undefined);
  }

  /** 一键收藏当前页（写入书签树根级；已收藏则提示） */
  async function saveBookmarkLocal(): Promise<void> {
    try {
      const stored: Record<string, unknown> = await chrome.storage.local.get(KEY_BOOKMARKS);
      const raw = stored[KEY_BOOKMARKS] as { roots?: FanNode[] } | undefined;
      const roots: FanNode[] = Array.isArray(raw?.roots) ? (raw.roots as FanNode[]) : [];
      const target: string = normalizeUrl(location.href);
      if (hasUrl(roots, target)) {
        showToast('已在书签中');
        return;
      }
      const node: FanNode = {
        id: genId(),
        kind: 'link',
        title: document.title !== '' ? document.title : location.href,
        url: location.href,
        addedAt: Date.now(),
        children: [],
      };
      await chrome.storage.local.set({ [KEY_BOOKMARKS]: { roots: [node, ...roots] } });
      showToast('已收藏');
    } catch {
      showToast('收藏失败');
    }
  }

  // ---------- 定位与边缘吸附 ----------
  let currentPos: BallPos = defaultPosition();
  /** 当前吸附缘（null=未吸附半隐藏）与吸附时的半隐藏坐标 */
  let dockedEdge: 'left' | 'right' | null = null;
  let hiddenPos: BallPos = defaultPosition();

  /** 拖动结束时的吸附判定：距左右缘足够近 → 半隐藏并返回吸附缘 */
  function snapToEdge(pos: BallPos): { pos: BallPos; edge: 'left' | 'right' | null } {
    if (pos.x < SNAP_RANGE) {
      return { pos: { ...pos, x: HALF_OUT }, edge: 'left' };
    }
    if (pos.x > window.innerWidth - BALL_SIZE - SNAP_RANGE) {
      return { pos: { ...pos, x: window.innerWidth - BALL_SIZE / 2 }, edge: 'right' };
    }
    return { pos, edge: null };
  }

  /** 吸附态滑出显示全部（hover 时调用；不落库，离开后缩回） */
  function peekOut(): void {
    if (dockedEdge === 'left') {
      applyPos({ ...currentPos, x: EDGE_GAP });
      return;
    }
    if (dockedEdge === 'right') {
      applyPos({ ...currentPos, x: window.innerWidth - BALL_SIZE - EDGE_GAP });
    }
  }

  /** 吸附态缩回半隐藏（离开感应区时调用） */
  function peekIn(): void {
    if (dockedEdge !== null) {
      applyPos(hiddenPos);
    }
  }

  function applyPos(pos: BallPos): void {
    currentPos = clampToViewport(pos);
    // 吸附态由 snapToEdge / 初始恢复显式维护——此处不自动推断：
    // peekOut 的滑出坐标是临时的，若在此推断会把 dockedEdge 冲掉（吸附紊乱）
    ball.style.left = `${currentPos.x}px`;
    ball.style.top = `${currentPos.y}px`;

    // 感应区：水平居中于球心，从球底上方 4px 处开始（微重叠衔接悬停链路，不遮球主体）
    hoverArea.style.left = `${currentPos.x + BALL_SIZE / 2 - HOVER_AREA_W / 2}px`;
    hoverArea.style.top = `${currentPos.y + BALL_SIZE - 4}px`;

    // 扇形按钮基点对齐球心（位移由 transform 控制）
    for (const btn of fanItems) {
      btn.style.left = `${currentPos.x}px`;
      btn.style.top = `${currentPos.y}px`;
    }
    applyFanTransforms();

    // 面板贴近球体一侧打开（左侧空间不足时贴左边）
    const panelWidth: number = 392;
    const openOnLeft: boolean = currentPos.x + BALL_SIZE + panelWidth + EDGE_GAP > window.innerWidth;
    panelWrap.style.left =
      openOnLeft ? `${Math.max(currentPos.x - panelWidth - 10, EDGE_GAP)}px` : `${Math.min(currentPos.x + BALL_SIZE + 10, window.innerWidth - panelWidth - EDGE_GAP)}px`;
    panelWrap.style.top = `${clampToViewport({ x: 0, y: currentPos.y }).y}px`;
  }

  void (async (): Promise<void> => {
    const saved: BallPos | null = await readBallPos();
    const start: BallPos = saved ?? defaultPosition();
    applyPos(start);
    // 记忆位置处于半隐藏 → 恢复吸附态
    dockedEdge = edgeOf(currentPos);
    if (dockedEdge !== null) {
      hiddenPos = currentPos;
    }
    applyVisibility();
  })();

  // ---------- showBall 开关实时生效 ----------
  async function applyVisibility(): Promise<void> {
    const visible: boolean = await readShowBall();
    host.style.display = visible ? '' : 'none';
    if (!visible) {
      closeFan();
      if (panelOpen) {
        setPanelOpen(false);
      }
    }
  }
  chrome.storage.onChanged.addListener((changes, areaName): void => {
    if (areaName === 'local' && changes[KEY_SETTINGS] !== undefined) {
      void applyVisibility();
    }
  });

  // ---------- 拖拽与点击 ----------
  // 点击 = 打开侧边栏（三级：原生侧边栏 → 页内停靠 → 球面板兜底）。
  // 双通道保证点击必达：pointerup 与 click 谁先到谁生效，另一条被 suppress 抑制；
  // 拖动结束同样置 suppress 防误触。
  let suppressClick = false;
  let dragging = false;
  let moved = false;
  let grabOffset: BallPos = { x: 0, y: 0 };

  /** 点击球：优先召唤侧边栏，全不可用才展开球面板 */
  async function openPanelByClick(): Promise<void> {
    try {
      const reply: unknown = await chrome.runtime.sendMessage({ type: 'yy-open-sidepanel' });
      const mode = (reply as { mode?: string } | undefined)?.mode;
      if (mode === 'sidepanel' || mode === 'dock') {
        closeFan();
        return;
      }
    } catch {
      // 消息链失败（如 SW 未唤醒）→ 走兜底
    }
    setPanelOpen(true);
  }

  ball.addEventListener('pointerup', (): void => {
    if (!dragging) {
      return;
    }
    if (!moved) {
      // 单击：pointerup 先响应并抑制后续 click（若 click 仍到，双保险去重）
      suppressClick = true;
      void openPanelByClick();
    }
  });

  ball.addEventListener('click', (): void => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    void openPanelByClick();
  });

  ball.addEventListener('pointerdown', (ev: PointerEvent): void => {
    dragging = true;
    moved = false;
    dockedEdge = null; // 按下即脱离吸附，跟随指针移动
    ball.classList.add('dragging');
    grabOffset = { x: ev.clientX - currentPos.x, y: ev.clientY - currentPos.y };
    ball.setPointerCapture(ev.pointerId);
  });
  ball.addEventListener('pointermove', (ev: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    const next: BallPos = { x: ev.clientX - grabOffset.x, y: ev.clientY - grabOffset.y };
    const dx: number = Math.abs(next.x - currentPos.x);
    const dy: number = Math.abs(next.y - currentPos.y);
    if (!moved && dx + dy > DRAG_THRESHOLD) {
      moved = true;
      closeFan();
    }
    if (moved) {
      ev.preventDefault();
      applyPos(next);
    }
  });
  ball.addEventListener('pointerup', (): void => {
    const wasDragging: boolean = dragging;
    dragging = false;
    ball.classList.remove('dragging');
    if (wasDragging && moved) {
      // 贴近左右缘 → 吸附半隐藏；否则停在原地
      const snapped = snapToEdge(currentPos);
      dockedEdge = snapped.edge;
      if (snapped.edge !== null) {
        hiddenPos = snapped.pos;
      }
      applyPos(snapped.pos);
      void chrome.storage.local.set({ [KEY_BALL_POSITION]: currentPos }).catch(() => undefined);
      suppressClick = true; // 拖动后抑制补发的 click
    }
  });
  ball.addEventListener('pointercancel', (): void => {
    dragging = false;
    ball.classList.remove('dragging');
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
