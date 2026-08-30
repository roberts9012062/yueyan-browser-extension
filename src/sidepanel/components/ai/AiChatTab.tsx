// browser-extension/src/sidepanel/components/ai/AiChatTab.tsx
// AI 助手 Tab（对照设计稿重做）：问候区 + 能力卡片宫格 + 消息流 + 上下文条 + 输入区。
//
// 能力实现边界（诚实原则，假功能一律标注「即将上线」）：
//   智能问答 = 站点 AI 对话；文件解析 = 本地读文本文件交给 AI；网页总结 = 抓当前
//   标签页正文交给 AI；联网搜索 / 图片生成 / 截图分析 = 后端暂无对应开放能力。
// 对话记录持久化于 chrome.storage.local（ai_chat_v1），重开面板不丢。
import { useEffect, useRef, useState } from 'react';
import type { AiChatMessage, AiSearchSource, AiSession, ChatMessage, PluginSettings } from '../../../shared/types';
import { STORAGE_KEYS } from '../../../shared/storage/settings';
import {
  clearAiSessions,
  deleteAiSession,
  upsertAiSession,
} from '../../../shared/storage/ai-history';
import { downloadAndCache } from '../../../shared/storage/image-cache';
import { readCurrentMode } from '../../../shared/panel-mode';
import { aiAssist, listAiModels, sendAiChat, sendAiChatStream } from '../../../shared/api/endpoints';
import { ApiError } from '../../../shared/api/client';
import { AiComposer } from './AiComposer';
import type { ComposerContext } from './AiComposer';
import { ArticlePanel } from './ArticlePanel';
import { HistorySheet } from './HistorySheet';
import { ImageCell } from './ImageCell';
import { ImageGenSheet } from './ImageGenSheet';
import { MarkdownMessage } from './MarkdownMessage';
import { PromptMenu } from './PromptMenu';
import type { ActivePrompt, PromptCustom } from './PromptMenu';

/** 能力卡片定义（ready=false 表示后端暂无对应开放能力，点击提示即将上线） */
interface AiCapability {
  key: string;
  icon: string;
  label: string;
  ready: boolean;
}

/**
 * 单条会话消息（系统提示不展示、不持久化）。
 * content = 气泡展示文本（网页/文件场景只显示标题与地址摘要）；
 * payload = 实际发给 AI 的完整文本（含参考资料正文，多轮追问时作为历史携带）。
 */
type UiMessage = AiChatMessage;

/** 能力卡片（对照设计稿六宫格） */
const CAPABILITIES: readonly AiCapability[] = [
  { key: 'chat', icon: '⚡', label: '智能问答', ready: true },
  { key: 'file', icon: '📄', label: '文件解析', ready: true },
  { key: 'web-search', icon: '🌐', label: '联网搜索', ready: true },
  { key: 'image', icon: '🖼️', label: '图片生成', ready: true },
  { key: 'shot', icon: '✂️', label: '截图分析', ready: true },
  { key: 'summary', icon: '🌐', label: '网页总结', ready: true },
];

/** 选区矩形（CSS 像素，相对视口）与页面缩放比 */
interface PickRect {
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
async function cropScreenshot(rawDataUrl: string, rect: PickRect): Promise<string> {
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

/** 系统提示 */
const SYSTEM_PROMPT: string = '你是月言博客站点的 AI 助手，回答保持简洁、友好，使用简体中文。';
/** 对话输出 token 上限：直接取后端硬顶 16000（clampMaxTokens 会把超值收敛到 16000，
 *  传更大无意义）；彻底杜绝长总结/长文输出截断 */
const DEFAULT_MAX_TOKENS: number = 16000;
/** 随请求携带的历史轮数上限 */
const HISTORY_LIMIT: number = 20;
/** 页面/文件上下文注入正文上限（字符） */
const CONTEXT_TEXT_LIMIT: number = 12000;

interface PageContext {
  label: string;
  title: string;
  url: string;
  text: string;
  /** 原文内容区图片（教程步骤图等；随消息携带并可带入生成文章） */
  images: string[];
}

interface FileContext {
  name: string;
  text: string;
}

interface AiChatTabProps {
  settings: PluginSettings;
  seedText: string;
  onConsumeSeed: () => void;
  /** 请求切换到 AI Tab（球菜单动作触发时由 App 执行 setTab('ai')） */
  onRequestGoAi: () => void;
}

export function AiChatTab(props: AiChatTabProps) {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState<string>('');

  const [pageCtx, setPageCtx] = useState<PageContext | null>(null);
  const [fileCtx, setFileCtx] = useState<FileContext | null>(null);
  const [imageGenOpen, setImageGenOpen] = useState<boolean>(false);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  /** 联网搜索模式（输入框旁开关）：开启后普通发送先经 ai.search 检索再作答 */
  const [webSearchOn, setWebSearchOn] = useState<boolean>(false);
  /** 「生成文章」面板：待润色发布的 AI 回答内容（null=关闭） */
  const [articleFrom, setArticleFrom] = useState<string | null>(null);
  /** 生成文章的原文图片（来自网页总结消息；空数组=无） */
  const [articleImages, setArticleImages] = useState<string[]>([]);
  /** 生成文章的来源 URL（B 站总结时为视频页地址，用于正文附播放器链接） */
  const [articleSourceUrl, setArticleSourceUrl] = useState<string>('');
  /** 最近一次 B 站总结的视频块参数（生成文章时嵌入 data-plugin-block 播放器） */
  const [articleBiliProps, setArticleBiliProps] = useState<Record<string, unknown> | null>(null);
  /** 当前会话 ID（首条消息发送时创建；清空后为 null） */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [promptMenuOpen, setPromptMenuOpen] = useState<boolean>(false);
  const [activePrompt, setActivePrompt] = useState<ActivePrompt | null>(null);
  const [customPrompts, setCustomPrompts] = useState<readonly PromptCustom[]>([]);

  useEffect(() => {
    void (async (): Promise<void> => {
      const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.aiPrompts);
      const raw = stored[STORAGE_KEYS.aiPrompts] as { customs?: PromptCustom[] } | undefined;
      setCustomPrompts(Array.isArray(raw?.customs) ? (raw.customs as PromptCustom[]) : []);
    })();
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ---------- 球菜单动作消费（仅 embed 面板执行，防多实例重复） ----------
  /** 当前面板形态（页面生命周期内不变；embed=悬浮球展开的面板） */
  const PANEL_MODE: 'dock' | 'float' | 'embed' = readCurrentMode();
  /** 已执行过的动作 nonce（单实例内去重；跨实例由 embed 限定 + storage 删除收敛） */
  const executedNonces = new Set<string>();

  async function consumePanelAction(): Promise<void> {
    if (PANEL_MODE !== 'embed') {
      return;
    }
    const stored: Record<string, unknown> = await chrome.storage.local.get('panel_action');
    const pending = stored['panel_action'] as { action?: string; nonce?: string } | undefined;
    if (pending?.action === undefined || pending.nonce === undefined) {
      return;
    }
    await chrome.storage.local.remove('panel_action').catch(() => undefined);
    if (executedNonces.has(pending.nonce)) {
      return;
    }
    executedNonces.add(pending.nonce);
    props.onRequestGoAi();
    if (pending.action === 'summary') {
      void grabPageAndSummarize();
      return;
    }
    if (pending.action === 'shot') {
      void analyzeScreenshot();
    }
  }

  // 双通道：球触发展开本面板时可能尚未完成挂载（靠 storage 暂存），
  // 也可能早已打开（靠 runtime 广播立即响应）
  useEffect(() => {
    void consumePanelAction();
    const listener = (msg: unknown): void => {
      const payload = msg as Record<string, unknown> | null;
      if (typeof payload === 'object' && payload !== null && payload.type === 'yy-run-action') {
        void consumePanelAction();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return (): void => {
      chrome.runtime.onMessage.removeListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 模型清单 ----------
  useEffect(() => {
    let cancelled = false;
    listAiModels(props.settings.apiBaseUrl, props.settings.apiKey)
      .then((providers) => {
        if (cancelled) {
          return;
        }
        const flat: string[] = providers.flatMap((p) => p.models);
        setModels(flat);
        setModel((cur: string): string => (cur !== '' ? cur : (flat[0] ?? '')));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : '模型列表加载失败');
        }
      });
    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 对话持久化 ----------
  useEffect(() => {
    void (async (): Promise<void> => {
      const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.settings);
      const saved = (stored[STORAGE_KEYS.aiChat] as UiMessage[] | undefined) ?? [];
      setMessages(saved);
    })();
  }, []);

  useEffect(() => {
    // 截图 dataUrl 体积大，持久化时剥离（重开后缩略图消失，对话文本保留）
    const slim: UiMessage[] = messages.map((m: UiMessage): UiMessage => {
      if (m.images === undefined) {
        return m;
      }
      const urls: string[] = m.images.filter((src: string): boolean => !src.startsWith('data:'));
      return urls.length === m.images.length ? m : { ...m, images: urls.length > 0 ? urls : undefined };
    });
    void chrome.storage.local.set({ [STORAGE_KEYS.aiChat]: slim }).catch(() => undefined);

    // 多会话历史：有消息 → 归档到活动会话（首条时创建）；清空 → 移除该会话
    if (slim.length === 0) {
      if (activeSessionId !== null) {
        void deleteAiSession(activeSessionId);
      }
      return;
    }
    const firstUser: UiMessage | undefined = slim.find((m: UiMessage): boolean => m.role === 'user');
    const sessionId: string = activeSessionId ?? crypto.randomUUID();
    if (activeSessionId === null) {
      setActiveSessionId(sessionId);
    }
    const title: string = (firstUser?.content ?? '新对话').slice(0, 24);
    void upsertAiSession({ id: sessionId, title, updatedAt: Date.now(), messages: slim });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  /**
   * 发送一轮对话（默认流式：SSE 逐块增量渲染，联网检索由后端 web_search 统一处理）。
   * 参数：userText 发给 AI 的完整文本（上下文场景含正文）；displayText 气泡展示文本；
   *      sources 前端已知的来源（网页总结场景无；联网来源由流式事件下发）。
   * 流式失败（旧后端无该端点等）自动回退非流式一次。
   */
  async function send(userText: string, displayText: string, sources: readonly AiSearchSource[]): Promise<void> {
    const trimmed: string = userText.trim();
    if (trimmed === '' || sending || model === '') {
      return;
    }
    const history: ChatMessage[] = messages.slice(-HISTORY_LIMIT).map((m: UiMessage) => {
      const item: ChatMessage = { role: m.role, content: m.payload ?? m.content };
      return item;
    });
    const system: string =
      activePrompt !== null
        ? SYSTEM_PROMPT + '\n\n【当前角色设定，请严格遵守】\n' + activePrompt.content
        : SYSTEM_PROMPT;
    const userMessage: UiMessage = {
      role: 'user',
      content: displayText,
      payload: displayText === trimmed ? undefined : trimmed,
    };
    setMessages((prev: UiMessage[]): UiMessage[] => [...prev, userMessage, { role: 'assistant', content: '' }]);
    setInput('');
    setSending(true);
    setError('');

    /** 追加正文增量到最后一条 assistant 消息 */
    const appendDelta = (delta: string): void => {
      setMessages((prev: UiMessage[]): UiMessage[] => {
        if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') {
          return prev;
        }
        const last: UiMessage = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
      });
    };
    /** 设置联网来源到最后一条 assistant 消息 */
    const applySources = (list: readonly AiSearchSource[]): void => {
      setMessages((prev: UiMessage[]): UiMessage[] => {
        if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') {
          return prev;
        }
        const last: UiMessage = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, sources: [...list] }];
      });
    };

    const finalSources: AiSearchSource[] = [...sources];
    try {
      await sendAiChatStream(
        props.settings.apiBaseUrl,
        props.settings.apiKey,
        model,
        [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: trimmed },
        ],
        DEFAULT_MAX_TOKENS,
        webSearchOn,
        {
          onText: appendDelta,
          onSources: (list: AiSearchSource[]): void => {
            finalSources.push(...list);
            applySources(list);
          },
        },
      );
    } catch (streamErr: unknown) {
      // 流式失败：回退非流式一次（旧后端无 stream 端点 / 流中断）
      try {
        const result = await sendAiChat(props.settings.apiBaseUrl, props.settings.apiKey, model, [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: trimmed },
        ], DEFAULT_MAX_TOKENS);
        setMessages((prev: UiMessage[]): UiMessage[] => {
          const cleared: UiMessage[] = prev.map((item: UiMessage, i: number): UiMessage =>
            i === prev.length - 1 && item.role === 'assistant' ? { role: 'assistant', content: result.reply } : item,
          );
          return cleared;
        });
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : '发送失败，请稍后重试');
        // 流式中途失败但已有部分内容时保留已渲染部分
        if (!(streamErr instanceof ApiError) || streamErr.status !== 404) {
          void streamErr;
        }
      }
    } finally {
      setSending(false);
      // 前端已知来源（非流式路径兜底）合并到末条消息
      if (finalSources.length > 0) {
        applySources(finalSources);
      }
    }
  }

  /** 上下文注入前缀（纯函数）：来源说明 + 截断正文 */
  function withContext(question: string, ctxLabel: string, text: string): string {
    const body: string = text.slice(0, CONTEXT_TEXT_LIMIT);
    return `【参考资料 · ${ctxLabel}】\n${body}\n\n【问题】${question}`;
  }

  // ---------- 能力卡片点击 ----------
  function tapCapability(cap: AiCapability): void {
    if (!cap.ready) {
      setToast(`「${cap.label}」即将上线，敬请期待`);
      window.setTimeout((): void => setToast(''), 2000);
      return;
    }
    if (cap.key === 'file') {
      fileRef.current?.click();
      return;
    }
    if (cap.key === 'summary') {
      void grabPageAndSummarize();
      return;
    }
    if (cap.key === 'web-search') {
      // 联网统一走后端 web_search：等价于打开输入框旁的联网开关后发送
      if (input.trim() === '') {
        setWebSearchOn(true);
        setToast('联网已开启：输入问题后发送');
        window.setTimeout((): void => setToast(''), 2200);
        return;
      }
      setWebSearchOn(true);
      void send(input, input, []);
      return;
    }
    if (cap.key === 'image') {
      setImageGenOpen(true);
      return;
    }
    if (cap.key === 'shot') {
      void analyzeScreenshot();
      return;
    }
    setInput('');
    setError('');
  }

  /** 按需主机授权（用户手势内申请，仅首次弹框；网页总结与截图共用） */
  async function ensureHostPermission(): Promise<boolean> {
    const HOSTS: chrome.permissions.Permissions = { origins: ['http://*/*', 'https://*/*'] };
    const alreadyGranted: boolean = await chrome.permissions.contains(HOSTS).catch((): boolean => false);
    const granted: boolean = alreadyGranted
      ? true
      : await chrome.permissions.request(HOSTS).catch((): boolean => false);
    if (!granted) {
      setToast('需要「读取网站信息」授权：请在扩展详情中开启网站访问权限');
      window.setTimeout((): void => setToast(''), 3200);
      return false;
    }
    return true;
  }

  /**
   * 截图本地压缩（纯函数）：canvas 等比缩放 + JPEG 编码，逐档降级直至目标体积。
   * 目标 <800KB（为代理层常见 1MB body 限制留余量）；识图任务对精度不敏感，
   * 长边 1280 足够。全部分档仍超限时返回最后一档（尽力而为）。
   */
  async function compressScreenshot(rawDataUrl: string): Promise<string> {
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
  async function pickRegion(tabId: number): Promise<PickRect | null> {
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

  /**
   * 截图分析：截取当前可见页面 → 本地压缩（防代理层体积拒绝）→ ai.assist(recognize)。
   * 背景：全屏截图 base64 常超 1MB，Nginx 默认 client_max_body_size=1m 会直接 413，
   * 且代理错误响应无 CORS 头 → 浏览器表现为 fetch 抛错（"无法连接站点"假象）。
   * 后端 image_url 支持 data URL 原样透传（resolveImageInput），无需公网地址。
   */
  async function analyzeScreenshot(): Promise<void> {
    if (!(await ensureHostPermission())) {
      return;
    }
    setError('');
    try {
      // 定位用户正在看的网页标签（聚焦窗口活动标签优先）
      const focused: chrome.tabs.Tab[] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab: chrome.tabs.Tab | undefined = focused.find(
        (tItem: chrome.tabs.Tab): boolean => tItem.id !== undefined && tItem.url !== undefined && /^https?:/i.test(tItem.url),
      );
      if (tab?.id === undefined) {
        setToast('未找到可截图的网页：请切到一个普通网页后重试');
        window.setTimeout((): void => setToast(''), 2600);
        return;
      }

      // ① 网页上拖拽选区（Esc / 过小框取消）
      const rect: PickRect | null = await pickRegion(tab.id);
      if (rect === null) {
        return;
      }

      setSending(true);
      // ② 全屏截图 → 按选区裁剪（×dpr 物理像素）→ 压缩
      const raw: string = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, {
        format: 'jpeg',
        quality: 90,
      });
      const dataUrl: string = await compressScreenshot(await cropScreenshot(raw, rect));
      setMessages((prev: UiMessage[]): UiMessage[] => [
        ...prev,
        { role: 'user', content: '✂️ 区域截图分析', images: [dataUrl] },
      ]);
      // ③ 多模态识图
      const result = await aiAssist(props.settings.apiBaseUrl, props.settings.apiKey, 'recognize', '', dataUrl);
      const text: string = result.text ?? '（未返回识别结果）';
      setMessages((prev: UiMessage[]): UiMessage[] => [...prev, { role: 'assistant', content: text }]);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '截图分析失败，请稍后重试');
    } finally {
      setSending(false);
    }
  }

  /**
   * 图片生成：描述 → ai.assist(image) 文生图（生成物已转存站点媒体库，
   * media_url 为本站 /media 路径，展示时拼接站点 origin 绝对化）。
   */
  async function generateImage(prompt: string): Promise<void> {
    setImageGenOpen(false);
    setSending(true);
    setError('');
    setMessages((prev: UiMessage[]): UiMessage[] => [
      ...prev,
      { role: 'user', content: `🎨 画一张：${prompt}` },
    ]);
    try {
      const result = await aiAssist(props.settings.apiBaseUrl, props.settings.apiKey, 'image', prompt, '');
      const relative: string = result.media_url ?? '';
      if (relative === '') {
        throw new ApiError('未返回图片地址', 0);
      }
      const absolute: string = /^https?:/i.test(relative) ? relative : `${props.settings.apiBaseUrl}${relative}`;
      setMessages((prev: UiMessage[]): UiMessage[] => [
        ...prev,
        { role: 'assistant', content: '图片已生成（已转存站点媒体库，并缓存到本机）：', images: [absolute] },
      ]);
      // 本地缓存（IndexedDB）：发帖走站点媒体库，翻阅查看不依赖站点
      void downloadAndCache(absolute);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '图片生成失败，请稍后重试');
    } finally {
      setSending(false);
    }
  }

  /**
   * B 站视频总结：页面上下文（同源请求自动携带用户登录态）取 cid 与字幕列表
   * （优先 ai-zh AI 中文字幕，回退 CC 中文字幕），字幕文件在扩展页拉取
   * （主机权限免跨域），全文交给 AI 总结。
   */
  async function summarizeBiliVideo(tab: chrome.tabs.Tab): Promise<void> {
    interface BiliMeta {
      ok: boolean;
      reason?: string;
      title?: string;
      desc?: string;
      bvid?: string;
      subtitleUrl?: string;
      lan?: string;
      cid?: number;
      cover?: string;
      author?: string;
      duration?: number;
    }
    const results: chrome.scripting.InjectionResult<unknown>[] = await chrome.scripting.executeScript({
      target: { tabId: tab.id as number },
      func: async (): Promise<BiliMeta> => {
        // ---- 自包含 md5（Paul Johnston 经典实现，Node 环境已验证与标准值一致）----
        const md5 = (input: string): string => {
          const safeAdd: (x: number, y: number) => number = (x: number, y: number): number => {
            const lsw: number = (x & 0xffff) + (y & 0xffff);
            const msw: number = (x >> 16) + (y >> 16) + (lsw >> 16);
            return (msw << 16) | (lsw & 0xffff);
          };
          const bitRol: (n: number, c: number) => number = (n: number, c: number): number =>
            (n << c) | (n >>> (32 - c));
          const cmn: (q: number, a: number, b: number, x: number, s: number, t: number) => number = (
            q: number, a: number, b: number, x: number, s: number, t: number,
          ): number => safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
          const ff: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
            a: number, b: number, c: number, d: number, x: number, s: number, t: number,
          ): number => cmn((b & c) | (~b & d), a, b, x, s, t);
          const gg: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
            a: number, b: number, c: number, d: number, x: number, s: number, t: number,
          ): number => cmn((b & d) | (c & ~d), a, b, x, s, t);
          const hh: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
            a: number, b: number, c: number, d: number, x: number, s: number, t: number,
          ): number => cmn(b ^ c ^ d, a, b, x, s, t);
          const ii: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
            a: number, b: number, c: number, d: number, x: number, s: number, t: number,
          ): number => cmn(c ^ (b | ~d), a, b, x, s, t);

          /** 字节序列 → 32 位字数组并跑主循环 */
          const binl: (words: number[], byteLen: number) => number[] = (words: number[], byteLen: number): number[] => {
            words[byteLen >> 5] |= 0x80 << (byteLen % 32);
            words[(((byteLen + 64) >>> 9) << 4) + 14] = byteLen;
            let a: number = 1732584193;
            let b: number = -271733879;
            let c: number = -1732584194;
            let d: number = 271733878;
            for (let i: number = 0; i < words.length; i += 16) {
              const oa: number = a;
              const ob: number = b;
              const oc: number = c;
              const od: number = d;
              a=ff(a,b,c,d,words[i],7,-680876936);d=ff(d,a,b,c,words[i+1],12,-389564586);c=ff(c,d,a,b,words[i+2],17,606105819);b=ff(b,c,d,a,words[i+3],22,-1044525330);
              a=ff(a,b,c,d,words[i+4],7,-176418897);d=ff(d,a,b,c,words[i+5],12,1200080426);c=ff(c,d,a,b,words[i+6],17,-1473231341);b=ff(b,c,d,a,words[i+7],22,-45705983);
              a=ff(a,b,c,d,words[i+8],7,1770035416);d=ff(d,a,b,c,words[i+9],12,-1958414417);c=ff(c,d,a,b,words[i+10],17,-42063);b=ff(b,c,d,a,words[i+11],22,-1990404162);
              a=ff(a,b,c,d,words[i+12],7,1804603682);d=ff(d,a,b,c,words[i+13],12,-40341101);c=ff(c,d,a,b,words[i+14],17,-1502002290);b=ff(b,c,d,a,words[i+15],22,1236535329);
              a=gg(a,b,c,d,words[i+1],5,-165796510);d=gg(d,a,b,c,words[i+6],9,-1069501632);c=gg(c,d,a,b,words[i+11],14,643717713);b=gg(b,c,d,a,words[i],20,-373897302);
              a=gg(a,b,c,d,words[i+5],5,-701558691);d=gg(d,a,b,c,words[i+10],9,38016083);c=gg(c,d,a,b,words[i+15],14,-660478335);b=gg(b,c,d,a,words[i+4],20,-405537848);
              a=gg(a,b,c,d,words[i+9],5,568446438);d=gg(d,a,b,c,words[i+14],9,-1019803690);c=gg(c,d,a,b,words[i+3],14,-187363961);b=gg(b,c,d,a,words[i+8],20,1163531501);
              a=gg(a,b,c,d,words[i+13],5,-1444681467);d=gg(d,a,b,c,words[i+2],9,-51403784);c=gg(c,d,a,b,words[i+7],14,1735328473);b=gg(b,c,d,a,words[i+12],20,-1926607734);
              a=hh(a,b,c,d,words[i+5],4,-378558);d=hh(d,a,b,c,words[i+8],11,-2022574463);c=hh(c,d,a,b,words[i+11],16,1839030562);b=hh(b,c,d,a,words[i+14],23,-35309556);
              a=hh(a,b,c,d,words[i+1],4,-1530992060);d=hh(d,a,b,c,words[i+4],11,1272893353);c=hh(c,d,a,b,words[i+7],16,-155497632);b=hh(b,c,d,a,words[i+10],23,-1094730640);
              a=hh(a,b,c,d,words[i+13],4,681279174);d=hh(d,a,b,c,words[i],11,-358537222);c=hh(c,d,a,b,words[i+3],16,-722521979);b=hh(b,c,d,a,words[i+6],23,76029189);
              a=hh(a,b,c,d,words[i+9],4,-640364487);d=hh(d,a,b,c,words[i+12],11,-421815835);c=hh(c,d,a,b,words[i+15],16,530742520);b=hh(b,c,d,a,words[i+2],23,-995338651);
              a=ii(a,b,c,d,words[i],6,-198630844);d=ii(d,a,b,c,words[i+7],10,1126891415);c=ii(c,d,a,b,words[i+14],15,-1416354905);b=ii(b,c,d,a,words[i+5],21,-57434055);
              a=ii(a,b,c,d,words[i+12],6,1700485571);d=ii(d,a,b,c,words[i+3],10,-1894986606);c=ii(c,d,a,b,words[i+10],15,-1051523);b=ii(b,c,d,a,words[i+1],21,-2054922799);
              a=ii(a,b,c,d,words[i+8],6,1873313359);d=ii(d,a,b,c,words[i+15],10,-30611744);c=ii(c,d,a,b,words[i+6],15,-1560198380);b=ii(b,c,d,a,words[i+13],21,1309151649);
              a=ii(a,b,c,d,words[i+4],6,-145523070);d=ii(d,a,b,c,words[i+11],10,-1120210379);c=ii(c,d,a,b,words[i+2],15,718787259);b=ii(b,c,d,a,words[i+9],21,-343485551);
              a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
            }
            return [a, b, c, d];
          };

          // 字符串 → UTF-8 字节 → 32 位字数组 → 摘要 → 十六进制
          const bytes: number[] = [];
          for (let i: number = 0; i < input.length; i += 1) {
            const code: number = input.charCodeAt(i);
            if (code < 0x80) {
              bytes.push(code);
            } else if (code < 0x800) {
              bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            } else {
              bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
          }
          const words: number[] = [];
          for (let i: number = 0; i < bytes.length * 8; i += 8) {
            words[i >> 5] = (words[i >> 5] || 0) | (bytes[i / 8] << (i % 32));
          }
          const digest: number[] = binl(words, bytes.length * 8);
          const toHex: (l: number) => string = (l: number): string => {
            let s: string = '';
            for (let i: number = 0; i < 4; i += 1) {
              const val: number = (l >> (i * 8)) & 0xff;
              s += '0123456789abcdef'.charAt((val >>> 4) & 0x0f) + '0123456789abcdef'.charAt(val & 0x0f);
            }
            return s;
          };
          return toHex(digest[0]) + toHex(digest[1]) + toHex(digest[2]) + toHex(digest[3]);
        };

        // ---- wbi 签名（B 站 2023+ 风控：字幕接口须带 w_rid）----
        const MIXIN: number[] = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
        const signWbi = (params: Record<string, string>, imgKey: string, subKey: string): string => {
          const raw: string = imgKey + subKey;
          let mixinKey: string = '';
          for (let i: number = 0; i < 32; i += 1) {
            mixinKey += raw[MIXIN[i]];
          }
          const query: string[][] = Object.entries({ ...params, wts: String(Math.floor(Date.now() / 1000)) })
            .filter((pair: [string, string]): boolean => !/[!'()*]/.test(pair[1]))
            .sort((x: [string, string], y: [string, string]): number => (x[0] < y[0] ? -1 : 1));
          const qs: string = new URLSearchParams(query).toString();
          return `${qs}&w_rid=${md5(qs + mixinKey)}`;
        };

        const match: RegExpMatchArray | null = location.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/);
        if (match === null) {
          return { ok: false, reason: 'not-video' };
        }
        const bvid: string = match[1];
        try {
          const viewResp: Response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { credentials: 'include' });
          const view = (await viewResp.json()) as {
            code: number;
            message?: string;
            data?: { cid: number; title: string; desc: string; pic: string; owner?: { name: string }; duration: number };
          };
          if (view.code !== 0 || view.data === undefined) {
            return { ok: false, reason: `view-${view.code}`, bvid };
          }
          const cid: number = view.data.cid;
          const title: string = view.data.title;
          const desc: string = (view.data.desc ?? '').slice(0, 500);

          // nav 拿 wbi keys（未登录也返回）→ wbi 签名调 player 接口；失败回退旧 v2
          const navResp: Response = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
          const nav = (await navResp.json()) as { data?: { wbi_img?: { img_url: string; sub_url: string } } };
          const imgUrl: string = nav.data?.wbi_img?.img_url ?? '';
          const subUrl: string = nav.data?.wbi_img?.sub_url ?? '';
          const pickKeys = (u: string): string => u.slice(u.lastIndexOf('/') + 1).split('.')[0];
          let subs: { lan: string; subtitle_url: string }[] = [];
          let lastErr: string = 'no-subtitle';
          if (imgUrl !== '' && subUrl !== '') {
            const signed: string = signWbi(
              { bvid, cid: String(cid), fnval: '4048', fno: '0', qn: '80' },
              pickKeys(imgUrl),
              pickKeys(subUrl),
            );
            const wbiResp: Response = await fetch(`https://api.bilibili.com/x/player/wbi/v2?${signed}`, { credentials: 'include' });
            const wbi = (await wbiResp.json()) as { code: number; message?: string; data?: { subtitle?: { subtitles?: { lan: string; subtitle_url: string }[] } } };
            if (wbi.code === 0) {
              subs = wbi.data?.subtitle?.subtitles ?? [];
            } else {
              lastErr = `wbi-${wbi.code}`;
            }
          }
          if (subs.length === 0 && lastErr !== 'no-subtitle') {
            // wbi 失败时回退旧接口再试一次
            const pResp: Response = await fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, { credentials: 'include' });
            const player = (await pResp.json()) as { code: number; data?: { subtitle?: { subtitles?: { lan: string; subtitle_url: string }[] } } };
            if (player.code === 0) {
              subs = player.data?.subtitle?.subtitles ?? [];
            }
          }
          if (subs.length === 0) {
            return { ok: false, reason: lastErr, title, desc, bvid };
          }
          const pick = subs.find((s) => s.lan === 'ai-zh') ?? subs.find((s) => /zh/i.test(s.lan)) ?? subs[0];
          let subtitleUrl: string = pick.subtitle_url ?? '';
          if (subtitleUrl.startsWith('//')) {
            subtitleUrl = `https:${subtitleUrl}`;
          }
          return {
            ok: subtitleUrl !== '',
            title,
            desc,
            bvid,
            subtitleUrl,
            lan: pick.lan,
            cid: view.data.cid,
            cover: view.data.pic ?? '',
            author: view.data.owner?.name ?? '',
            duration: view.data.duration ?? 0,
          };
        } catch (err: unknown) {
          const detail: string = err instanceof Error ? err.message : String(err);
          return { ok: false, reason: `fetch-error(${detail.slice(0, 60)})`, bvid };
        }
      },
    });
    const meta = results[0]?.result as BiliMeta | undefined;

    if (meta === undefined || !meta.ok || (meta.subtitleUrl ?? '') === '') {
      const reason: string = meta?.reason ?? 'inject-failed';
      const tip: string =
        reason === 'no-subtitle'
          ? '该视频没有可用字幕（AI 字幕需在浏览器登录 B 站后生成）'
          : `未能获取视频字幕（${reason}）：请确认已登录 B 站后重试`;
      setToast(tip);
      window.setTimeout((): void => setToast(''), 3000);
      return;
    }

    // 扩展页拉取字幕文件（主机权限免跨域）→ 逐条拼全文交给总结
    setSending(true);
    try {
      const subResp: Response = await fetch(meta.subtitleUrl as string, { credentials: 'omit' });
      const subJson = (await subResp.json()) as { body?: { content: string }[] };
      const transcript: string = (subJson.body ?? [])
        .map((line: { content: string }): string => line.content)
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 12000);
      if (transcript.trim() === '') {
        setToast('字幕内容为空，无法总结');
        window.setTimeout((): void => setToast(''), 2600);
        return;
      }
      const videoUrl: string = `https://www.bilibili.com/video/${meta.bvid ?? ''}/`;
      const question: string =
        `【B 站视频《${meta.title ?? ''}》的字幕全文（${meta.lan === 'ai-zh' ? 'AI 字幕' : '字幕'}）】\n` +
        `简介：${meta.desc ?? '（无）'}\n\n${transcript}\n\n` +
        '【请总结这个视频的核心内容，按要点列出；开头用一句话说明视频主题】';
      setPageCtx({
        label: meta.title ?? 'B 站视频',
        title: meta.title ?? '',
        url: videoUrl,
        text: transcript,
        images: [],
      });
      // 视频块参数（boke bilibili-video 插件的 data-props 协议）
      setArticleBiliProps({
        bvid: meta.bvid ?? '',
        cid: meta.cid ?? 0,
        title: meta.title ?? '',
        cover: meta.cover ?? '',
        author: meta.author ?? '',
        duration: meta.duration ?? 0,
      });
      await send(question, `📺 ${meta.title ?? 'B 站视频'} — ${videoUrl}`, []);
    } catch {
      setError('字幕拉取失败，请稍后重试');
    } finally {
      setSending(false);
    }
  }

  /**
   * 网页总结：定位「用户正在看的网页」标签并抓取正文。
   *
   * 实现方式：chrome.scripting.executeScript 向目标标签动态注入一次性抓取函数——
   * 不依赖页面是否注入过内容脚本（扩展更新后旧脚本失效也能用，无需刷新页面），
   * 竞品同类插件的通行做法。前置条件：
   *   - "tabs" 权限：定位活动标签并读取 url（无该权限时 tab.url 恒为 undefined）；
   *   - "scripting" + optional_host_permissions（http/https）：首次点击时向用户申请，
   *     同意一次后长期可用；拒绝则无法读取任何网页。
   */
  async function grabPageAndSummarize(): Promise<void> {
    if (!(await ensureHostPermission())) {
      return;
    }

    // ---------- 候选标签收集：聚焦窗口活动标签 → 各窗口活动标签（去重） ----------
    const candidates: chrome.tabs.Tab[] = [];
    const pushTab = (t: chrome.tabs.Tab): void => {
      if (t.id !== undefined && !candidates.some((c: chrome.tabs.Tab): boolean => c.id === t.id)) {
        candidates.push(t);
      }
    };
    const focused: chrome.tabs.Tab[] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    focused.forEach(pushTab);
    const windows: chrome.windows.Window[] = await chrome.windows.getAll({ populate: true });
    windows
      .flatMap((w: chrome.windows.Window): chrome.tabs.Tab[] => w.tabs ?? [])
      .filter((t: chrome.tabs.Tab): boolean => t.active === true)
      .forEach(pushTab);

    // ---------- B 站视频分支：取 AI/CC 字幕总结（优先于普通正文抓取） ----------
    const biliTab: chrome.tabs.Tab | undefined = candidates.find(
      (tItem: chrome.tabs.Tab): boolean =>
        tItem.id !== undefined && tItem.url !== undefined && /^https?:\/\/(www\.)?bilibili\.com\/video\//i.test(tItem.url),
    );
    if (biliTab !== undefined) {
      await summarizeBiliVideo(biliTab);
      return;
    }

    // ---------- 逐个候选动态注入抓取（失败继续下一个） ----------
    let sawInternalPage: boolean = false;
    for (const tab of candidates) {
      if (tab.url !== undefined && !/^https?:/i.test(tab.url)) {
        // 浏览器内部页（chrome:// 等）：平台禁止注入
        sawInternalPage = true;
        continue;
      }
      if (tab.id === undefined) {
        continue;
      }
      try {
        const results: chrome.scripting.InjectionResult<unknown>[] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (): { ok: boolean; title: string; url: string; text: string; images: string[] } => {
            // 注入函数在页面隔离环境执行，须自包含（不得引用外部变量）
            const text: string = (document.body?.innerText ?? '')
              .replace(/[ \t]+/g, ' ')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
              .slice(0, 12000);
            // 内容区图片：优先正文容器（容器一图未得则全页兜底再扫）。
            // 懒加载属性优先于 src——教程站 src 常是占位图，真实地址在
            // data-src / data-original / data-actualsrc / data-lazy-src；
            // 协议相对地址（//cdn...）按页面协议归一后再校验
            const normalizeSrc = (raw: string | null): string => {
                const v: string = (raw ?? '').trim();
                if (v.startsWith('//')) {
                    return location.protocol + v;
                }
                return v;
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
            // 广告容器判定：token 精确匹配（ad/ad-right/banner/advads-* 等命中；
            // site-header/download-btn 这类仅含 "ad" 子串的普通类不命中——子串匹配曾
            // 因广告插件在 body 上留 advads 标记导致全站图片误杀）。
            // 仅查 img 自身与 3 层祖先，避免页面高层的通用容器误伤
            const AD_TOKEN: RegExp = /^(ads?|advert\w*|advads\w*|banner|promo|sponsor)([-_].*)?$/i;
            const isAdNode: (el: Element) => boolean = (el: Element): boolean => {
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
            const collectFrom = (scope: ParentNode, picked: string[], seenUrls: Set<string>): void => {
                for (const img of Array.from(scope.querySelectorAll('img'))) {
                    const src: string = resolveImgSrc(img);
                    if (!/^https?:/i.test(src) || seenUrls.has(src)) {
                        continue;
                    }
                    const width: number = img.naturalWidth > 0 ? img.naturalWidth : img.width;
                    if (width > 0 && width < 250) {
                        continue;
                    }
                    const anchorWrap: HTMLAnchorElement | null = img.closest('a');
                    const isImageHref: boolean = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i.test(anchorWrap?.getAttribute('href') ?? '');
                    if (anchorWrap !== null && !isImageHref) {
                        try {
                            const hrefUrl: URL = new URL(anchorWrap.getAttribute('href') ?? '', location.href);
                            if (hrefUrl.hostname !== location.hostname) {
                                continue;
                            }
                        } catch {
                            continue;
                        }
                    }
                    if (img.closest('button') !== null || img.closest('aside, footer, nav') !== null || adLike(img)) {
                        continue;
                    }
                    seenUrls.add(src);
                    picked.push(src);
                    if (picked.length >= 6) {
                        return;
                    }
                }
            };
            const picked: string[] = [];
            const seenUrls: Set<string> = new Set();
            const containers: ParentNode = document.querySelector('article, main, [role="main"], .content, .post-content, .markdown-body') ?? document;
            collectFrom(containers, picked, seenUrls);
            if (picked.length === 0) {
                collectFrom(document, picked, seenUrls);
            }
            return { ok: text !== '', title: document.title, url: location.href, text, images: picked };
          },
        });
        const data = results[0]?.result as { ok?: boolean; title?: string; url?: string; text?: string; images?: string[] } | undefined;
        if (data?.ok === true && typeof data.text === 'string' && data.text.trim() !== '') {
          setPageCtx({
            label: data.title ?? '当前页面',
            title: data.title ?? '',
            url: data.url ?? tab.url ?? '',
            text: data.text,
            images: Array.isArray(data.images) ? data.images : [],
          });
          {
            const pageImages: string[] = Array.isArray(data.images) ? data.images : [];
            if (pageImages.length === 0) {
              setToast('已总结，但未在该页检测到可携带的正文图片');
              window.setTimeout((): void => setToast(''), 2600);
            }
            const imageNote: string =
              pageImages.length > 0
                ? '\n\n【原文图片（按出现顺序；总结时在对应步骤/段落处标注"（图N）"）】\n' +
                  pageImages.map((u: string, i: number): string => `图${i + 1}: ${u}`).join('\n')
                : '';
            const pageQuestion: string =
              withContext('请总结这篇网页的核心内容，用要点列出', data.title ?? '当前页面', data.text) + imageNote;
            const before: number = messages.length;
            await send(pageQuestion, `🌐 ${data.title ?? '当前页面'} — ${data.url ?? tab.url ?? ''}`, []);
            if (pageImages.length > 0) {
              // 把原文图片挂到本次总结的 user 消息上（缩略展示 + 供生成文章取用）
              setMessages((prev: UiMessage[]): UiMessage[] => {
                if (before >= prev.length) {
                  return prev;
                }
                const updated: UiMessage = { ...prev[before], images: pageImages };
                return [...prev.slice(0, before), updated, ...prev.slice(before + 1)];
              });
            }
          }
          return;
        }
      } catch {
        // 该候选注入失败（受站点限制等），尝试下一个
      }
    }

    const message: string = sawInternalPage
      ? '当前是浏览器内部页面（如设置页），无法读取——请切到一个普通网页'
      : '未能读取页面内容，请确认已打开普通网页后重试';
    setToast(message);
    window.setTimeout((): void => setToast(''), 2600);
  }

  // ---------- 提示词：新增 / 删除自定义 ----------
  async function addCustomPrompt(name: string, content: string): Promise<void> {
    const item: PromptCustom = { id: crypto.randomUUID(), name, content };
    const next: readonly PromptCustom[] = [...customPrompts, item];
    setCustomPrompts(next);
    await chrome.storage.local.set({ [STORAGE_KEYS.aiPrompts]: { customs: next } }).catch(() => undefined);
    setToast(`提示词「${name}」已保存`);
    window.setTimeout((): void => setToast(''), 2000);
  }

  async function deleteCustomPrompt(id: string): Promise<void> {
    const next: readonly PromptCustom[] = customPrompts.filter((c: PromptCustom): boolean => c.id !== id);
    setCustomPrompts(next);
    await chrome.storage.local.set({ [STORAGE_KEYS.aiPrompts]: { customs: next } }).catch(() => undefined);
    // 若删除的是激活中的提示词，一并停用
    setActivePrompt((prev: ActivePrompt | null): ActivePrompt | null =>
      prev !== null && customPrompts.some((c: PromptCustom): boolean => c.id === id && c.name === prev.name) ? null : prev,
    );
  }

  // ---------- 文件解析：读本地文本文件 ----------
  function handleFileSelected(file: File): void {
    if (file.size > 1 << 20) {
      setToast('文件过大（上限 1MB 文本）');
      window.setTimeout((): void => setToast(''), 2000);
      return;
    }
    const reader = new FileReader();
    reader.onload = (): void => {
      const text: string = typeof reader.result === 'string' ? reader.result : '';
      if (text.trim() === '') {
        setToast('文件为空或不是文本格式');
        window.setTimeout((): void => setToast(''), 2000);
        return;
      }
      setFileCtx({ name: file.name, text });
      {
        const fileQuestion: string = withContext(`请解析这份文件（${file.name}），概述要点`, file.name, text);
        void send(fileQuestion, `📄 ${file.name}`, []);
      }
    };
    reader.readAsText(file);
  }

  // ---------- 来源条动作 ----------
  const context: ComposerContext | null =
    fileCtx !== null
      ? { label: fileCtx.name, kind: 'file' }
      : pageCtx !== null
        ? { label: pageCtx.label, kind: 'page' }
        : null;

  function askWithContext(): void {
    const text: string = fileCtx !== null ? fileCtx.text : (pageCtx?.text ?? '');
    const label: string = fileCtx !== null ? fileCtx.name : (pageCtx?.label ?? '');
    if (input.trim() === '') {
      setToast('先输入你想问的问题');
      window.setTimeout((): void => setToast(''), 2000);
      return;
    }
    void send(withContext(input.trim(), label, text), input.trim(), []);
  }

  function summarizeContext(): void {
    const text: string = fileCtx !== null ? fileCtx.text : (pageCtx?.text ?? '');
    const label: string = fileCtx !== null ? fileCtx.name : (pageCtx?.label ?? '内容');
    void send(withContext('请总结以上内容的核心要点', label, text), `🧾 总结：${label}`, []);
  }

  // ---------- 外部转发 seed ----------
  useEffect(() => {
    if (props.seedText.trim() === '') {
      return;
    }
    props.onConsumeSeed();
    void send(props.seedText, props.seedText, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seedText]);

  // ---------- 自动滚底 ----------
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  const showHero: boolean = messages.length === 0 && !sending;

  return (
    <div className="relative flex h-full flex-col">
      {/* 轻提示 */}
      {toast !== '' && (
        <p className="absolute left-1/2 top-2 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-[11px] text-bg shadow-[var(--yy-shadow-card)]">
          {toast}
        </p>
      )}

      {/* 消息流 */}
      <div ref={listRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {showHero && (
          <div className="pt-2">
            <p className="text-sm text-ink-2">👋 你好，</p>
            <h2 className="font-display mt-1 text-lg font-semibold leading-snug text-ink">我是月言 AI 小助手</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-2">作为你的智能伙伴，你可以通过我:</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {CAPABILITIES.map((cap: AiCapability) => (
                <button
                  key={cap.key}
                  type="button"
                  onClick={(): void => tapCapability(cap)}
                  title={cap.ready ? cap.label : `${cap.label}（即将上线）`}
                  className="flex flex-col items-start gap-1 rounded-xl border border-line bg-elevated px-3 py-2.5 transition-shadow duration-200 hover:shadow-[var(--yy-shadow-card)]"
                >
                  <span aria-hidden className="text-sm">{cap.icon}</span>
                  <span className="truncate text-[11px] text-ink">{cap.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <ul className="flex flex-col gap-2 pt-2">
          {messages.map((msg: UiMessage, index: number) => (
            <li key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'break-all bg-accent text-on-accent'
                    : 'border border-line bg-elevated text-ink'
                }`}
              >
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <MarkdownMessage content={msg.content} />
                )}
                {msg.role === 'assistant' && msg.content.trim() !== '' && (
                  <button
                    type="button"
                    onClick={(): void => {
                      // 原文图片：本条回答之前的最近一条 user 消息携带的原图（网页总结场景）
                      const idx: number = messages.indexOf(msg);
                      const sourceImages: string[] = [];
                      let sourceUrl = '';
                      for (let i: number = idx - 1; i >= 0; i -= 1) {
                        if (messages[i].role === 'user') {
                          for (const img of messages[i].images ?? []) {
                            if (!img.startsWith('data:') && !sourceImages.includes(img)) {
                              sourceImages.push(img);
                            }
                          }
                          // 提取来源 URL（网页总结的 user 消息显示「标题 — url」）
                          const urlMatch: RegExpMatchArray | null = messages[i].content.match(/https?:\/\/\S+/);
                          if (urlMatch !== null) {
                            sourceUrl = urlMatch[0];
                          }
                          break;
                        }
                      }
                      setArticleImages(sourceImages);
                      setArticleSourceUrl(sourceUrl);
                      // B 站来源：仅当提取到的 URL 是视频地址时携带块参数（避免普通网页误嵌）
                      if (/bilibili\.com\/video\//i.test(sourceUrl)) {
                        setArticleBiliProps((prev) => prev);
                      } else {
                        setArticleBiliProps(null);
                      }
                      setArticleFrom(msg.payload ?? msg.content);
                    }}
                    title="把这篇回答润色成文章，可编辑后发布到博客"
                    className="mt-1.5 rounded-full border border-line px-2.5 py-0.5 text-[10px] text-ink-3 transition-colors duration-200 hover:border-accent hover:text-glow"
                  >
                    📝 生成文章
                  </button>
                )}
                {msg.sources !== undefined && msg.sources.length > 0 && (
                  <span className="mt-2 flex flex-col gap-1 border-t border-line/60 pt-1.5">
                    <span className="text-[10px] text-ink-3">来源：</span>
                    {msg.sources.map((source: AiSearchSource, i: number): React.ReactNode => (
                      <a
                        key={i}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={source.url}
                        className="truncate text-[11px] text-glow underline underline-offset-2"
                      >
                        ［{i + 1}］{source.title}
                      </a>
                    ))}
                  </span>
                )}
                {msg.images !== undefined && msg.images.length > 0 && (
                  <span className="mt-1.5 flex flex-col gap-1.5">
                    {msg.images.map((src: string, i: number) => (
                      <ImageCell key={i} src={src} />
                    ))}
                  </span>
                )}
              </div>
            </li>
          ))}
          {sending && (
            <li className="flex justify-start">
              <p className="rounded-2xl border border-line bg-elevated px-3 py-2 text-xs text-ink-3">思考中…</p>
            </li>
          )}
        </ul>
      </div>

      {/* 错误提示 */}
      {error !== '' && (
        <p className="mx-4 mb-1 rounded-lg border border-like/40 bg-like/10 px-3 py-1.5 text-xs text-like">{error}</p>
      )}

      {/* 底部输入区 */}
      <AiComposer
        context={context}
        onAskContext={askWithContext}
        onSummarizeContext={summarizeContext}
        models={models}
        model={model}
        onModelChange={(m: string): void => setModel(m)}
        onAttachFile={(): void => fileRef.current?.click()}
        onSummarizePage={(): void => void grabPageAndSummarize()}
        activePrompt={activePrompt}
        webSearchOn={webSearchOn}
        onToggleWebSearch={(): void => setWebSearchOn(!webSearchOn)}
        onClearPrompt={(): void => setActivePrompt(null)}
        promptSlot={
          promptMenuOpen ? (
            <PromptMenu
              activeName={activePrompt?.name ?? null}
              customs={customPrompts}
              onPick={(p: ActivePrompt): void => setActivePrompt(p)}
              onAddCustom={(n: string, c: string): void => void addCustomPrompt(n, c)}
              onDeleteCustom={(id: string): void => void deleteCustomPrompt(id)}
              onClose={(): void => setPromptMenuOpen(false)}
            />
          ) : null
        }
        onOpenHistory={(): void => setHistoryOpen(true)}
        onClearChat={(): void => {
          setMessages([]);
          setPageCtx(null);
          setFileCtx(null);
          void chrome.storage.local.remove(STORAGE_KEYS.aiChat).catch(() => undefined);
          // 开启新会话（旧会话随消息清空在持久化 effect 中移除）
          setActiveSessionId(null);
        }}
        input={input}
        onInputChange={setInput}
        onSend={(): void => {
          if (input.trim() === '') {
            return;
          }
          void send(input, input, []);
        }}
        sending={sending}
      />

      {/* AI 生成文章面板 */}
      {articleFrom !== null && (
        <ArticlePanel
          settings={props.settings}
          sourceMarkdown={articleFrom}
          sourceImages={articleImages}
          sourceUrl={articleSourceUrl}
          biliProps={articleBiliProps}
          model={model}
          onClose={(): void => setArticleFrom(null)}
        />
      )}

      {/* 历史对话面板 */}
      {historyOpen && (
        <HistorySheet
          activeId={activeSessionId}
          onOpen={(session: AiSession): void => {
            setMessages(session.messages);
            setActiveSessionId(session.id);
            setHistoryOpen(false);
            setPageCtx(null);
            setFileCtx(null);
          }}
          onDelete={(id: string): void => {
            void deleteAiSession(id);
            if (id === activeSessionId) {
              setActiveSessionId(null);
              void chrome.storage.local.remove(STORAGE_KEYS.aiChat).catch(() => undefined);
            }
          }}
          onClearAll={(): void => {
            void clearAiSessions();
            setActiveSessionId(null);
          }}
          onClose={(): void => setHistoryOpen(false)}
        />
      )}

      {/* 图片生成弹层 */}
      {imageGenOpen && (
        <ImageGenSheet onClose={(): void => setImageGenOpen(false)} onSubmit={(p: string): void => void generateImage(p)} />
      )}

      {/* 隐藏文件选择器（文本类文件） */}
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yml,.yaml,.html,.css,.js,.ts,.tsx,.jsx,.py,.go,.java,.sql,text/*"
        className="hidden"
        onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
          const file: File | null = e.target.files?.[0] ?? null;
          if (file !== null) {
            handleFileSelected(file);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}
