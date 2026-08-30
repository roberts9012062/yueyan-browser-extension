// browser-extension/src/shared/storage/settings.ts
// 设置与缓存的 chrome.storage.local 封装：键名集中登记、读取时结构校验合并缺省值。
// 安全约束（手册 §7）：token/key 只入 chrome.storage，禁止 localStorage/sessionStorage。

import type {
  BookmarkLegacyFolder,
  BookmarkLegacyStore,
  BookmarkNode,
  BookmarkTree,
  PluginSettings,
  SiteMeta,
  UserProfile,
} from '../types';

/** 存储键集中登记（全插件唯一来源，禁止散落魔术字符串） */
export const STORAGE_KEYS = {
  settings: 'plugin_settings_v1',
  profile: 'profile_cache_v1',
  siteMeta: 'site_meta_cache_v1',
  ballPosition: 'ball_position_v1',
  /** v2 树形书签 */
  bookmarks: 'bookmarks_v2',
  /** v1 扁平书签（迁移数据源，读取后保留不删，防回滚丢数据） */
  bookmarksLegacy: 'bookmarks_v1',
  /** 书签树中处于收起状态的文件夹/区块 ID 集合 */
  bookmarksCollapsed: 'bookmarks_collapsed_v1',
  /** AI 对话记录（当前会话消息流） */
  aiChat: 'ai_chat_v1',
  /** 用户自定义提示词列表 */
  aiPrompts: 'ai_prompts_v1',
  /** AI 历史会话列表 */
  aiSessions: 'ai_sessions_v1',
} as const;

/** 空书签树（新装/无数据时的回退值） */
export const EMPTY_BOOKMARK_TREE: BookmarkTree = { roots: [] };

/** 判定对象是否为合法书签节点（递归校验的基元；纯函数） */
function isValidNode(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    (obj.kind === 'folder' || obj.kind === 'link') &&
    typeof obj.title === 'string'
  );
}

/** 校验并规整一棵子节点数组（非法元素丢弃） */
function sanitizeChildren(raw: unknown): BookmarkNode[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: BookmarkNode[] = [];
  for (const item of raw) {
    if (!isValidNode(item)) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const isFolder: boolean = obj.kind === 'folder';
    const checkRaw = obj.check as Record<string, unknown> | undefined;
    out.push({
      id: obj.id as string,
      kind: isFolder ? 'folder' : 'link',
      title: obj.title as string,
      url: typeof obj.url === 'string' ? obj.url : '',
      addedAt: typeof obj.addedAt === 'number' ? obj.addedAt : 0,
      children: isFolder ? sanitizeChildren(obj.children) : [],
      ...(isFolder
        ? {}
        : {
            // 链接节点保留最近一次可达性检测结果
            check:
              typeof checkRaw === 'object' && checkRaw !== null && typeof checkRaw.status === 'string'
                ? { status: checkRaw.status === 'ok' ? ('ok' as const) : ('fail' as const), at: Date.now() }
                : undefined,
          }),
    });
  }
  return out;
}

/** 把 v1 扁平结构转换为 v2 树（一次性迁移；纯函数） */
function migrateLegacy(legacy: BookmarkLegacyStore): BookmarkTree {
  const folderNodes: BookmarkNode[] = legacy.folders.map((f: BookmarkLegacyFolder): BookmarkNode => ({
    id: f.id.startsWith('fld_') ? f.id : `fld_${f.id}`,
    kind: 'folder',
    title: f.name,
    url: '',
    addedAt: 0,
    children: [],
  }));
  // 兼容旧 ID 未带前缀的情况
  const byId = new Map<string, BookmarkNode>(legacy.folders.map((f: BookmarkLegacyFolder): [string, BookmarkNode] => {
    const node = folderNodes[folderNodes.findIndex((n: BookmarkNode): boolean => n.title === f.name)];
    return [f.id, node];
  }));

  const topLinks: BookmarkNode[] = [];
  for (const it of legacy.items) {
    const link: BookmarkNode = {
      id: it.id,
      kind: 'link',
      title: it.title,
      url: it.url,
      addedAt: it.addedAt,
      children: [],
    };
    if (it.folderId !== null && byId.has(it.folderId)) {
      byId.get(it.folderId)?.children.push(link);
    } else {
      topLinks.push(link);
    }
  }
  return { roots: [...topLinks, ...folderNodes] };
}

/** 默认设置（新装/字段缺失时的回退） */
export const DEFAULT_SETTINGS: PluginSettings = {
  apiBaseUrl: '',
  apiKey: '',
  theme: 'cool-moon',
  showBall: true,
};

/** 悬浮球屏幕位置（视口像素坐标） */
export interface BallPosition {
  x: number;
  y: number;
}

/** 归一化站点地址：trim、补协议、去尾斜杠（纯函数） */
export function normalizeBaseUrl(raw: string): string {
  let url: string = raw.trim();
  if (url === '') {
    return '';
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/u, '');
}

/** 判定设置是否已配置完整（纯函数） */
export function isConfigured(settings: PluginSettings): boolean {
  return settings.apiBaseUrl !== '' && settings.apiKey !== '';
}

/** 读取设置（缺失/类型不符的字段用默认值补齐） */
export async function readSettings(): Promise<PluginSettings> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = stored[STORAGE_KEYS.settings];
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const obj = raw as Record<string, unknown>;
  return {
    apiBaseUrl: typeof obj.apiBaseUrl === 'string' ? normalizeBaseUrl(obj.apiBaseUrl) : '',
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : '',
    theme: obj.theme === 'mist' ? 'mist' : 'cool-moon',
    showBall: obj.showBall !== false,
  };
}

/** 持久化设置 */
export async function saveSettings(settings: PluginSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

/** 读取用户资料缓存（无效返回 null） */
export async function readCachedProfile(): Promise<UserProfile | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.profile);
  const raw = stored[STORAGE_KEYS.profile];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'number' || typeof obj.nickname !== 'string') {
    return null;
  }
  return raw as UserProfile;
}

/** 写入用户资料缓存 */
export async function saveCachedProfile(profile: UserProfile): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.profile]: profile });
}

/** 读取站点信息缓存（无效返回 null） */
export async function readCachedSiteMeta(): Promise<SiteMeta | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.siteMeta);
  const raw = stored[STORAGE_KEYS.siteMeta];
  if (typeof raw !== 'object' || raw === null || typeof (raw as Record<string, unknown>).site_name !== 'string') {
    return null;
  }
  return raw as SiteMeta;
}

/** 写入站点信息缓存 */
export async function saveCachedSiteMeta(meta: SiteMeta): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.siteMeta]: meta });
}

/** 断开连接：清除 Key 与身份缓存（保留主题偏好） */
export async function clearConnection(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.profile, STORAGE_KEYS.siteMeta]);
}

/** 读取悬浮球位置（无效返回 null，由调用方回退默认位置） */
export async function readBallPosition(): Promise<BallPosition | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.ballPosition);
  const raw = stored[STORAGE_KEYS.ballPosition];
  if (
    typeof raw !== 'object' || raw === null ||
    typeof (raw as Record<string, unknown>).x !== 'number' ||
    typeof (raw as Record<string, unknown>).y !== 'number'
  ) {
    return null;
  }
  return raw as BallPosition;
}

/** 持久化悬浮球位置 */
export async function saveBallPosition(pos: BallPosition): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.ballPosition]: pos });
}

/** 读取书签树：优先 v2；无 v2 时从 v1 扁平结构一次性迁移（非法数据回退空树） */
export async function readBookmarkStore(): Promise<BookmarkTree> {
  const stored: Record<string, unknown> = await chrome.storage.local.get([
    STORAGE_KEYS.bookmarks,
    STORAGE_KEYS.bookmarksLegacy,
  ]);

  const raw = stored[STORAGE_KEYS.bookmarks];
  if (
    typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).roots)
  ) {
    return { roots: sanitizeChildren((raw as Record<string, unknown>).roots) };
  }

  // 一次性迁移 v1
  const legacyRaw = stored[STORAGE_KEYS.bookmarksLegacy];
  if (
    typeof legacyRaw === 'object' && legacyRaw !== null &&
    Array.isArray((legacyRaw as Record<string, unknown>).items)
  ) {
    const tree: BookmarkTree = migrateLegacy(legacyRaw as BookmarkLegacyStore);
    await saveBookmarkStore(tree).catch(() => undefined);
    return tree;
  }
  return EMPTY_BOOKMARK_TREE;
}

/** 持久化书签树 */
export async function saveBookmarkStore(tree: BookmarkTree): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.bookmarks]: tree });
}

/** 读取收起的文件夹 ID 集合（无记录=全部展开；「未分类」区块使用特殊占位 ID） */
export async function readCollapsedBookmarkIds(): Promise<string[]> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.bookmarksCollapsed);
  const raw = stored[STORAGE_KEYS.bookmarksCollapsed];
  return Array.isArray(raw) ? raw.filter((v: unknown): boolean => typeof v === 'string') : [];
}

/** 持久化收起的文件夹 ID 集合 */
export async function saveCollapsedBookmarkIds(ids: readonly string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.bookmarksCollapsed]: [...ids] });
}
