// browser-extension/src/sidepanel/components/bookmarks/tools.ts
// 书签功能纯函数与树形操作：URL 归一化、查重、关键词匹配、浏览器书签全深度导入、
// 可达性探测、拖拽排序所需的树结构变换。全部输入输出为不可变拷贝，不改入参。
import type { BookmarkLegacyStore, BookmarkNode, BookmarkTree } from '../../../shared/types';

/** 生成实体 ID（crypto.randomUUID 优先，兜底时间戳+随机） */
export function genId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 新建文件夹节点（children 恒为数组） */
export function newFolderNode(title: string): BookmarkNode {
  return { id: `fld_${genId()}`, kind: 'folder', title, url: '', addedAt: 0, children: [] };
}

/** 新建链接节点 */
export function newLinkNode(title: string, url: string): BookmarkNode {
  return { id: genId(), kind: 'link', title, url, addedAt: Date.now(), children: [] };
}

/**
 * URL 查重归一化：协议无关、忽略尾斜杠与大小写（纯函数）。
 * 例：http://A.com/x/ 与 https://a.com/x 视为同一条目。
 */
export function normalizeUrl(raw: string): string {
  try {
    const u: URL = new URL(raw.trim());
    const path: string = u.pathname.replace(/\/+$/u, '');
    return `${u.host}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** 关键词匹配链接节点（标题或 URL，大小写不敏感；空串恒不匹配） */
export function matchesQuery(node: BookmarkNode, query: string): boolean {
  const q: string = query.trim().toLowerCase();
  if (q === '') {
    return false;
  }
  return node.title.toLowerCase().includes(q) || node.url.toLowerCase().includes(q);
}

/** 先序遍历收集全部链接节点 */
export function collectLinks(nodes: readonly BookmarkNode[]): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'link') {
      out.push(n);
    }
    out.push(...collectLinks(n.children));
  }
  return out;
}

/** 收集全部文件夹节点（含自身） */
export function collectFolders(nodes: readonly BookmarkNode[]): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'folder') {
      out.push(n);
      out.push(...collectFolders(n.children));
    }
  }
  return out;
}

/** 树中全部可多选实体 ID（链接 + 文件夹） */
export function collectAllIds(nodes: readonly BookmarkNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.id);
    out.push(...collectAllIds(n.children));
  }
  return out;
}

/** 收集最近一次有效性检测判定为异常（fail）的链接节点（纯函数；未检测过的节点不算异常） */
export function collectDeadLinks(nodes: readonly BookmarkNode[]): BookmarkNode[] {
  return collectLinks(nodes).filter(
    (n: BookmarkNode): boolean => n.check !== undefined && n.check.status === 'fail',
  );
}

/** 判定 targetId 是否位于 subtreeId 子树内（含自身；用于拖拽防环守卫；纯函数） */
export function isInSubtree(
  nodes: readonly BookmarkNode[],
  subtreeId: string,
  targetId: string,
): boolean {
  let subtreeRoot: BookmarkNode | undefined;
  const find = (layer: readonly BookmarkNode[]): void => {
    if (subtreeRoot !== undefined) {
      return;
    }
    for (const n of layer) {
      if (n.id === subtreeId) {
        subtreeRoot = n;
        return;
      }
      if (n.kind === 'folder') {
        find(n.children);
      }
    }
  };
  find(nodes);
  if (subtreeRoot === undefined) {
    return false;
  }
  return collectAllIds([subtreeRoot]).includes(targetId);
}

/**
 * 从树中批量剪除一组节点 ID（不可变：返回新森林；被剪文件夹整棵带走其子级）。
 * 编辑模式多选删除、查重清理、失效书签清理共用此剪枝路径。
 */
export function removeIds(roots: readonly BookmarkNode[], ids: ReadonlySet<string>): BookmarkNode[] {
  const walk = (layer: readonly BookmarkNode[]): BookmarkNode[] =>
    layer
      .filter((n: BookmarkNode): boolean => !ids.has(n.id))
      .map((n: BookmarkNode): BookmarkNode =>
        n.kind === 'folder' ? { ...n, children: walk(n.children) } : n,
      );
  return walk(roots);
}

/**
 * 从树中移除单个指定节点（不可变：返回新森林）。
 */
export function removeNodeById(roots: readonly BookmarkNode[], id: string): BookmarkNode[] {
  return removeIds(roots, new Set<string>([id]));
}

/** 查重：按归一化 URL 分组且仅保留 ≥2 条的组（组内按加入时间升序；基于先序全量链接） */
export function findDuplicateGroups(tree: BookmarkTree): BookmarkNode[][] {
  const map = new Map<string, BookmarkNode[]>();
  for (const item of collectLinks(tree.roots)) {
    const key: string = normalizeUrl(item.url);
    const bucket: BookmarkNode[] | undefined = map.get(key);
    if (bucket === undefined) {
      map.set(key, [item]);
    } else {
      bucket.push(item);
    }
  }
  const groups: BookmarkNode[][] = [];
  for (const group of map.values()) {
    if (group.length > 1) {
      group.sort((a: BookmarkNode, b: BookmarkNode): number => a.addedAt - b.addedAt);
      groups.push(group);
    }
  }
  return groups;
}

/** 只保留每条同归一化 URL 中最早的一条：返回待删除 ID 集合（纯函数） */
export function duplicateRemoveIds(tree: BookmarkTree): Set<string> {
  const groups: BookmarkNode[][] = findDuplicateGroups(tree);
  const removeIds = new Set<string>();
  for (const group of groups) {
    for (const dup of group.slice(1)) {
      removeIds.add(dup.id);
    }
  }
  return removeIds;
}

// ---------- 浏览器书签导入 ----------

/** 仅导入 http/https 条目（javascript: 书签小工具等排除）；纯函数 */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** 深度优先整树映射（无层数限制）：URL→链接节点，容器→文件夹节点，天然保持嵌套次序 */
export function buildImportForest(treeNodes: chrome.bookmarks.BookmarkTreeNode[], seenUrls: ReadonlySet<string>): { forest: BookmarkNode[]; importedCount: number } {
  const seen = new Set<string>(seenUrls);

  function visit(node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode | null {
    if (node.url !== undefined) {
      if (!isWebUrl(node.url) || seen.has(normalizeUrl(node.url))) {
        return null;
      }
      seen.add(normalizeUrl(node.url));
      return newLinkNode(node.title !== '' ? node.title : node.url, node.url);
    }
    const folder: BookmarkNode = newFolderNode(node.title !== '' ? node.title : '未命名');
    for (const child of node.children ?? []) {
      const mapped: BookmarkNode | null = visit(child);
      if (mapped !== null) {
        folder.children.push(mapped);
      }
    }
    if (folder.children.length === 0) {
      return null;
    }
    return folder;
  }

  // 略过浏览器虚拟根（parentId undefined 的 depth0），直接映射其子树
  const forest: BookmarkNode[] = [];
  for (const root of treeNodes) {
    for (const child of root.children ?? []) {
      const mapped: BookmarkNode | null = visit(child);
      if (mapped !== null) {
        forest.push(mapped);
      }
    }
  }
  return { forest, importedCount: collectLinks(forest).length };
}

/** 可达性探测：no-cors 请求 + 超时（只能判定网络层不可达，HTTP 错误码视为可达） */
export async function probeUrl(url: string): Promise<'ok' | 'fail'> {
  if (!isWebUrl(url)) {
    return 'fail';
  }
  const controller = new AbortController();
  const timer = setTimeout((): void => controller.abort(), 8000);
  try {
    await fetch(url, { mode: 'no-cors', credentials: 'omit', signal: controller.signal });
    clearTimeout(timer);
    return 'ok';
  } catch {
    clearTimeout(timer);
    return 'fail';
  }
}

/**
 * 站点小图标地址：走 Chrome 内置 _favicon 协议，读取浏览器自身的 favicon 缓存
 * （零网络请求、离线可用；需 manifest 声明 "favicon" 权限）。
 * 浏览器没有该站点图标时会返回内置的默认地球图标。
 */
export function getFaviconUrl(pageUrl: string): string {
  return `${chrome.runtime.getURL('_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
}

// ---------- 兼容导出（供旧迁移代码参考类型） ----------
export type { BookmarkLegacyStore };
