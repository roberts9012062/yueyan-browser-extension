// browser-extension/src/sidepanel/components/bookmarks/site-nav/private-nav.ts
// 站点私有导航纯函数：私有条目（navlinks.private.list）→ 内存展示树。
// 安全约束：私有条目属受保护数据，只在本模块产出内存结构供视图渲染，
// 严禁写入书签树 / chrome.storage / IndexedDB（与公开镜像「站点导航」文件夹的本质区别）。

import type { BookmarkNode, SiteNavLink } from '../../../../shared/types';
import { newFolderNode, newLinkNode } from '../tools';

/** 单条私有导航 → 只读链接节点（icon 非空才写入，保持节点轻量；纯函数） */
function toLinkNode(link: SiteNavLink): BookmarkNode {
  const node: BookmarkNode = newLinkNode(link.name !== '' ? link.name : link.url, link.url);
  if (link.icon !== '') {
    node.icon = link.icon;
  }
  return node;
}

/**
 * 私有条目 → 按分类分组的展示树（分类 → 文件夹，组内按 sort 升序；纯函数，不改入参）。
 * 顶层每个分类文件夹一个节点，供 PrivateNavView 直接分组渲染。
 */
export function buildPrivateNavTree(links: readonly SiteNavLink[]): BookmarkNode[] {
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
  const folders: BookmarkNode[] = [];
  for (const [category, items] of byCategory) {
    const folder: BookmarkNode = newFolderNode(category);
    folder.children.push(
      ...[...items].sort((a: SiteNavLink, b: SiteNavLink): number => a.sort - b.sort).map(toLinkNode),
    );
    folders.push(folder);
  }
  return folders;
}
