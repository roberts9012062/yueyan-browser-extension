// browser-extension/src/shared/api/endpoints.ts
// 开放接口调用函数集合（每端点一个薄封装，参数显式、返回强类型）。
// 接口清单见主站 internal/model/openapi.go OpenAPICatalog()。

import { ApiError, buildQuery, openGet, openPost, openUpload, rawPostJson } from './client';
import type {
  AiChatResult,
  AiProvider,
  AiSearchSource,
  ChatMessage,
  SiteMeta,
  SiteNavLink,
  SiteNavLinksResult,
  SiteNavPrivateConfig,
  TimelineResult,
  UploadResult,
  UserProfile,
} from '../types';

/** 后端 API 版本前缀 */
const API_PREFIX = '/api/v1';

/** 密码解锁校验超时（毫秒；与开放接口普通查询一致） */
const UNLOCK_TIMEOUT_MS: number = 15000;

/** 站点信息（site.meta）：连通性校验 + 站名/描述展示 */
export async function getSiteMeta(baseUrl: string, apiKey: string): Promise<SiteMeta> {
  return openGet<SiteMeta>(baseUrl, apiKey, `${API_PREFIX}/open/meta`);
}

/** 我的资料（me.profile）：凭 Key 返回绑定用户公开资料 */
export async function getCurrentUser(baseUrl: string, apiKey: string): Promise<UserProfile> {
  return openGet<UserProfile>(baseUrl, apiKey, `${API_PREFIX}/open/me`);
}

/** 帖子时间线（posts.list） */
export async function listTimelinePosts(
  baseUrl: string,
  apiKey: string,
  page: number,
  pageSize: number,
): Promise<TimelineResult> {
  const query: string = buildQuery({ page, page_size: pageSize });
  return openGet<TimelineResult>(baseUrl, apiKey, `${API_PREFIX}/open/posts${query}`);
}

/** AI 模型清单（ai.models → providers；仅启用的供应商） */
export async function listAiModels(baseUrl: string, apiKey: string): Promise<AiProvider[]> {
  const data: { providers: AiProvider[] } = await openGet<{ providers: AiProvider[] }>(
    baseUrl,
    apiKey,
    `${API_PREFIX}/open/ai/models`,
  );
  return data.providers;
}

/** AI 对话（ai.chat，非流式 JSON） */
export async function sendAiChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<AiChatResult> {
  return openPost<AiChatResult>(baseUrl, apiKey, `${API_PREFIX}/open/ai/chat`, {
    model,
    messages,
    max_tokens: maxTokens,
  }, 120000);
}

/** AI 辅助结果（POST /open/ai/assist 响应 data；文本类填 text，生成类填 media_url） */
export interface AiAssistResult {
  action: string;
  text?: string;
  media_url?: string;
  media_type?: string;
  /** 生成物媒体库 ID（发帖关联 media_ids 用） */
  media_id?: number;
}

/** AI 辅助动作：配图（文生图，返回本站 /media 地址）/ 识图（多模态视觉，image_url 支持公网与 data URL） */
export async function aiAssist(
  baseUrl: string,
  apiKey: string,
  action: 'image' | 'recognize' | 'polish',
  content: string,
  imageUrl: string,
): Promise<AiAssistResult> {
  return openPost<AiAssistResult>(baseUrl, apiKey, `${API_PREFIX}/open/ai/assist`, {
    action,
    content,
    image_url: imageUrl,
  }, 320000);
}

/** 联网搜索条目（宽松解析：字段名兼容 title/name、url/link、snippet/content/desc） */
export interface AiSearchItem {
  title: string;
  url: string;
  snippet: string;
}

/** 从未知结构提取来源数组（纯函数；data 支持裸数组 / {items} / {results} 三种形态） */
function normalizeSearchItems(data: unknown): AiSearchItem[] {
  const container = data as Record<string, unknown> | unknown[] | null;
  const rawList: unknown[] = Array.isArray(container)
    ? container
    : container !== null && Array.isArray((container as Record<string, unknown>).items)
      ? (container as Record<string, unknown>).items as unknown[]
      : container !== null && Array.isArray((container as Record<string, unknown>).results)
        ? (container as Record<string, unknown>).results as unknown[]
        : [];
  const out: AiSearchItem[] = [];
  for (const entry of rawList) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const url: string =
      typeof obj.url === 'string' ? obj.url : (typeof obj.link === 'string' ? obj.link : '');
    if (url === '') {
      continue;
    }
    out.push({
      title: typeof obj.title === 'string' ? obj.title : (typeof obj.name === 'string' ? obj.name : url),
      url,
      snippet:
        typeof obj.snippet === 'string' ? obj.snippet
        : (typeof obj.content === 'string' ? obj.content
        : (typeof obj.desc === 'string' ? obj.desc : '')),
    });
  }
  return out;
}

/** 联网搜索（ai.search：SearXNG 聚合检索，返回标题/摘要/地址；生成回答由调用方拼接走 ai.chat） */
export async function aiSearch(
  baseUrl: string,
  apiKey: string,
  query: string,
  limit: number,
): Promise<AiSearchItem[]> {
  const data: unknown = await openPost<unknown>(
    baseUrl,
    apiKey,
    `${API_PREFIX}/open/ai/search`,
    { query, limit },
    90000,
  );
  return normalizeSearchItems(data);
}

/** 发布文章请求（开放网关 posts.create；与主站 CreatePostReq 对齐的插件侧子集） */
export interface CreatePostInput {
  post_kind: 'article' | 'moment';
  /** 媒体形态：text / image / audio / video（空=后端归一 text） */
  content_type?: string;
  title: string;
  content: string;
  content_format: 'html' | 'markdown';
  tags: string[];
  media_ids: number[];
  visibility: 'public' | 'private';
  status: 'draft' | 'published';
  seo?: { seo_title: string; seo_description: string };
}

/** 发布文章（凭 Key 以绑定用户身份；返回新文章 ID） */
export async function createPost(
  baseUrl: string,
  apiKey: string,
  input: CreatePostInput,
): Promise<{ id: number }> {
  return openPost<{ id: number }>(baseUrl, apiKey, `${API_PREFIX}/open/posts`, input, 60000);
}

/**
 * 发布说说（moment 形态：短内容 ≤2000 字、无标题，html 富文本混排正文）。
 * 参数：content 正文 HTML；mediaIds 上传图片的媒体 ID 集合；visibility 可见性；恒直接发布。
 */
export async function createMomentPost(
  baseUrl: string,
  apiKey: string,
  content: string,
  mediaIds: number[],
  visibility: 'public' | 'private',
): Promise<{ id: number }> {
  return createPost(baseUrl, apiKey, {
    post_kind: 'moment',
    content_type: 'text',
    title: '',
    content,
    content_format: 'html',
    tags: [],
    media_ids: mediaIds,
    visibility,
    status: 'published',
  });
}

/** 媒体上传（media.upload：multipart 文件落站点媒体库，写说说的本地图/粘贴图通道） */
export async function uploadMedia(baseUrl: string, apiKey: string, file: File): Promise<UploadResult> {
  return openUpload<UploadResult>(baseUrl, apiKey, `${API_PREFIX}/open/media`, file, 60000);
}

/** 站点导航列表（navlinks.list：精品导航插件数据，书签「导入站点导航」数据源） */
export async function listSiteNavLinks(baseUrl: string, apiKey: string): Promise<SiteNavLinksResult> {
  return openGet<SiteNavLinksResult>(baseUrl, apiKey, `${API_PREFIX}/open/nav/links`);
}

/** 导航同步写入结果（navlinks.save 响应 data） */
export interface NavSaveResult {
  created: number;
  skipped: number;
  failed: number;
}

/** 导航同步写入（navlinks.save：批量写入精品导航；URL 已存在自动跳过，单次 ≤500 条） */
export async function saveNavLinks(baseUrl: string, apiKey: string, links: SiteNavLink[]): Promise<NavSaveResult> {
  return openPost<NavSaveResult>(baseUrl, apiKey, `${API_PREFIX}/open/nav/links`, { links }, 120000);
}

/** 私有导航条目数据（navlinks.private.list：响应与 navlinks.list 同构，仅含私有条目） */
export async function listPrivateNavLinks(baseUrl: string, apiKey: string): Promise<SiteNavLinksResult> {
  return openGet<SiteNavLinksResult>(baseUrl, apiKey, `${API_PREFIX}/open/nav/private/links`);
}

/** 私有导航访问配置（navlinks.private.config：mode/是否已设密码/标题/条数，无密钥材料） */
export async function getPrivateNavConfig(baseUrl: string, apiKey: string): Promise<SiteNavPrivateConfig> {
  return openGet<SiteNavPrivateConfig>(baseUrl, apiKey, `${API_PREFIX}/open/nav/private/config`);
}

/**
 * 校验私有导航访问密码（公开桥接 POST /nav/private/unlock，无需 Key；响应为直通 JSON 非信封）。
 * 返回归一判定：'ok'=密码正确 / 'bad_password'=密码不对 / 'self_only'=站点未开启密码访问 / 'unavailable'=站点不可达。
 */
export async function unlockPrivateNav(
  baseUrl: string,
  password: string,
): Promise<'ok' | 'bad_password' | 'self_only' | 'unavailable'> {
  const { status, data } = await rawPostJson(
    baseUrl,
    `${API_PREFIX}/nav/private/unlock`,
    { password },
    UNLOCK_TIMEOUT_MS,
  );
  if (status === 200) {
    return 'ok';
  }
  const code: string = typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).code === 'string'
    ? (data as Record<string, unknown>).code as string
    : '';
  if (status === 401) {
    return 'bad_password';
  }
  if (status === 403 && code === 'self_only') {
    return 'self_only';
  }
  return 'unavailable';
}

/** 图片转存结果（POST /open/media/transfer 响应 data） */
export interface MediaTransferResult {
  /** 本站持久地址（/media/...） */
  url: string;
  media_id: number;
  mime_type: string;
  size_bytes: number;
}

/** 图片转存（外链图落站点媒体库；仅放行公网 http/https 图片地址） */
export async function transferImage(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
): Promise<MediaTransferResult> {
  return openPost<MediaTransferResult>(
    baseUrl,
    apiKey,
    `${API_PREFIX}/open/media/transfer`,
    { url: imageUrl },
    60000,
  );
}

/** 流式对话事件回调（SSE 增量渲染用） */
export interface StreamHandlers {
  /** 正文增量（逐块） */
  onText: (delta: string) => void;
  /** 联网检索来源（web_search=true 时首个事件；可选） */
  onSources?: (sources: AiSearchSource[]) => void;
}

/**
 * AI 流式对话（ai.chat.stream：POST /api/v1/open/ai/chat/stream，SSE）。
 * 事件协议：data:{"text":"增量"} / data:{"search_results":[...]} / data:{"error"} / data:[DONE]。
 * webSearch=true 时后端先检索（来源经 onSources 下发）并把检索上下文注入回答。
 */
export async function sendAiChatStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  webSearch: boolean,
  handlers: StreamHandlers,
): Promise<void> {
  const res: Response = await fetch(`${baseUrl}/api/v1/open/ai/chat/stream`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, web_search: webSearch }),
    credentials: 'omit',
  });
  if (!res.ok || res.body === null) {
    throw new ApiError(`流式请求失败（HTTP ${res.status}）`, res.status);
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader();
  const decoder: TextDecoder = new TextDecoder();
  let buffer: string = '';

  /** 处理单个 SSE 事件行（返回是否应中止） */
  const handleEvent = (raw: string): boolean => {
    const line: string | undefined = raw.split('\n').find((l: string): boolean => l.startsWith('data: '));
    if (line === undefined) {
      return true;
    }
    const payload: string = line.slice(6);
    if (payload === '[DONE]') {
      return false;
    }
    try {
      const obj = JSON.parse(payload) as { text?: string; search_results?: { title?: string; url?: string }[]; error?: string };
      if (obj.error !== undefined && obj.error !== '') {
        throw new ApiError(obj.error, 0);
      }
      if (obj.search_results !== undefined && handlers.onSources !== undefined) {
        handlers.onSources(
          obj.search_results
            .filter((item) => typeof item.url === 'string' && item.url !== '')
            .map((item) => ({
              title: typeof item.title === 'string' ? item.title : (item.url as string),
              url: item.url as string,
            })),
        );
      }
      if (typeof obj.text === 'string' && obj.text !== '') {
        handlers.onText(obj.text);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }
      // 非 JSON 片段（心跳/注释）忽略
    }
    return true;
  };

  for (;;) {
    const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let sep: number = buffer.indexOf('\n\n');
    while (sep >= 0) {
      const raw: string = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!handleEvent(raw)) {
        return;
      }
      sep = buffer.indexOf('\n\n');
    }
  }
}
