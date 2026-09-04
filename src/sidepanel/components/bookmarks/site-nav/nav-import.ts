// browser-extension/src/sidepanel/components/bookmarks/nav-import.ts
// 站点导航导入（navlinks.list → 书签树）：
//   分类 → 子文件夹（组内按 sort 升序），统一收纳在「📚 站点导航」根文件夹；
//   链接携带内嵌图标 dataURL（BookmarkNode.icon，展示优先于浏览器 favicon）。
// 合并语义为「镜像刷新」：根级已有同名文件夹时原位整体替换（站点侧删除/改名随导入同步），
// 重复导入不产生重复条目。全部纯函数，不改入参。

import type { BookmarkNode, SiteNavLink } from '../../../../shared/types';
import { newFolderNode, newLinkNode } from '../tools';

/** 导入根文件夹名（替换判定依据，与 UI 文案一致） */
export const NAV_ROOT_TITLE: string = '📚 站点导航';

/** 导入结果（新根级森林 + 条数统计） */
export interface NavImportResult {
  roots: BookmarkNode[];
  /** 本次镜像的链接条数 */
  imported: number;
  /** 分类数 */
  categories: number;
  /** 是否为原位替换（false=首次导入追加） */
  replaced: boolean;
}

/** 单条导航 → 链接节点（icon 非空才写入，保持节点轻量） */
function toLinkNode(link: SiteNavLink): BookmarkNode {
  const node: BookmarkNode = newLinkNode(link.name !== '' ? link.name : link.url, link.url);
  if (link.icon !== '') {
    node.icon = link.icon;
  }
  return node;
}

/** 导航数据 → 「站点导航」文件夹（按分类分组建子文件夹，组内按 sort 升序） */
export function buildNavFolder(links: readonly SiteNavLink[]): BookmarkNode {
  const byCategory = new Map<string, SiteNavLink[]>();
  for (const link of links) {
    const key: string = link.category !== '' ? link.category : '未分类';
    const bucket: SiteNavLink[] | undefined = byCategory.get(key);
    if (bucket === undefined) {
      byCategory.set(key, [link]);
    } else {
      bucket.push(link);
    }
  }

  const root: BookmarkNode = newFolderNode(NAV_ROOT_TITLE);
  for (const [category, items] of byCategory) {
    const folder: BookmarkNode = newFolderNode(category);
    folder.children.push(...[...items].sort((a: SiteNavLink, b: SiteNavLink): number => a.sort - b.sort).map(toLinkNode));
    root.children.push(folder);
  }
  return root;
}

/** 计数文件夹内分类子目录（导入结果统计用） */
function countCategories(folder: BookmarkNode): number {
  return folder.children.length;
}

/**
 * 合并导航数据到现有根级森林（纯函数）：
 * 根级已有「站点导航」文件夹 → 原位替换为新镜像；否则追加到末尾。
 */
export function mergeNavIntoTree(roots: readonly BookmarkNode[], links: readonly SiteNavLink[]): NavImportResult {
  const folder: BookmarkNode = buildNavFolder(links);
  const index: number = roots.findIndex(
    (n: BookmarkNode): boolean => n.kind === 'folder' && n.title === NAV_ROOT_TITLE,
  );
  if (index >= 0) {
    const next: BookmarkNode[] = [...roots];
    next[index] = folder;
    return { roots: next, imported: links.length, categories: countCategories(folder), replaced: true };
  }
  return { roots: [...roots, folder], imported: links.length, categories: countCategories(folder), replaced: false };
}
