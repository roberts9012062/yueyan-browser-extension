// browser-extension/src/shared/storage/bookmark-store.ts
// 书签树持久化（自 settings.ts 拆出，控制其行数）：
//   - 主存 IndexedDB（bookmark-db.ts）+ chrome.storage 兜底双写，savedAt 新者胜调和收敛；
//   - v1 扁平结构一次性迁移；读取时逐节点消毒（非法数据丢弃）。
// 键名常量沿用 settings.ts 的 STORAGE_KEYS 集中登记（本文件不另设魔术字符串）。

import type {
  BookmarkLegacyFolder,
  BookmarkLegacyStore,
  BookmarkNode,
  BookmarkTree,
} from '../types';
import { loadMergedBookmarkTree, persistBookmarkTree } from './bookmark-db';
import { STORAGE_KEYS } from './settings';

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
            // 站点导航导入 / AI 添加站点携带的自定义图标（dataURL 或本站持久地址）
            ...(typeof obj.icon === 'string' && obj.icon !== '' ? { icon: obj.icon } : {}),
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

/** chrome.storage 原始书签记录 → 合法树（roots 逐节点消毒；旧数据无 savedAt 视为 0） */
function sanitizeTreeWithSavedAt(raw: Record<string, unknown>): BookmarkTree {
  return {
    roots: sanitizeChildren(raw.roots),
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  };
}

/**
 * 读取书签树：IndexedDB 主存 ⇄ chrome.storage 兜底 双份调和（savedAt 新者胜，读后收敛一致）；
 * 两份皆无时从 v1 扁平结构一次性迁移（非法数据回退空树）。
 */
export async function readBookmarkStore(): Promise<BookmarkTree> {
  const stored: Record<string, unknown> = await chrome.storage.local.get([
    STORAGE_KEYS.bookmarks,
    STORAGE_KEYS.bookmarksLegacy,
  ]);

  const raw = stored[STORAGE_KEYS.bookmarks];
  const fromStorage: BookmarkTree | null =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).roots)
      ? sanitizeTreeWithSavedAt(raw as Record<string, unknown>)
      : null;
  const merged: BookmarkTree | null = await loadMergedBookmarkTree(fromStorage, STORAGE_KEYS.bookmarks);
  if (merged !== null) {
    return merged;
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

/** 持久化书签树：IndexedDB 主存 + chrome.storage 兜底双写（同一 savedAt；主存失败不阻塞兜底） */
export async function saveBookmarkStore(tree: BookmarkTree): Promise<void> {
  const stamped: BookmarkTree = { ...tree, savedAt: Date.now() };
  await persistBookmarkTree(stamped).catch((): undefined => undefined);
  await chrome.storage.local.set({ [STORAGE_KEYS.bookmarks]: stamped });
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
