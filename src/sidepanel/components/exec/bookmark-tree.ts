// browser-extension/src/sidepanel/components/exec/bookmark-tree.ts
// 收藏执行器的书签树只读辅助（纯函数，不改入参）：
// 路径清单、按 URL 定位既有书签所在文件夹、按路径不可变插入链接节点。

import type { BookmarkNode } from '../../../shared/types';
import { normalizeUrl } from '../bookmarks/tools';

/** 列出全部文件夹路径（「/」分隔层级，先序；根级链接不在清单内） */
export function listFolderPaths(roots: readonly BookmarkNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly BookmarkNode[], prefix: string): void => {
    for (const n of nodes) {
      if (n.kind !== 'folder') {
        continue;
      }
      const path: string = prefix === '' ? n.title : `${prefix}/${n.title}`;
      out.push(path);
      walk(n.children, path);
    }
  };
  walk(roots, '');
  return out;
}

/** 按归一化 URL 查既有书签所在文件夹路径（根级返回「根级」；未收藏返回 null） */
export function findUrlPath(nodes: readonly BookmarkNode[], pageUrl: string): string | null {
  const target: string = normalizeUrl(pageUrl);
  const walk = (list: readonly BookmarkNode[], prefix: string): string | null => {
    for (const n of list) {
      if (n.kind === 'link' && normalizeUrl(n.url) === target) {
        return prefix === '' ? '根级' : prefix;
      }
      if (n.kind === 'folder') {
        const sub: string | null = walk(n.children, prefix === '' ? n.title : `${prefix}/${n.title}`);
        if (sub !== null) {
          return sub;
        }
      }
    }
    return null;
  };
  return walk(nodes, '');
}

/**
 * 按路径段把链接节点插到目标文件夹头部（不可变；空路径=插根级头部）。
 * 路径不存在时 ok=false 且原样返回（调用方回退根级）。
 */
export function insertByPath(
  nodes: readonly BookmarkNode[],
  segs: readonly string[],
  node: BookmarkNode,
): { ok: boolean; nodes: BookmarkNode[] } {
  if (segs.length === 0) {
    return { ok: true, nodes: [node, ...nodes] };
  }
  const head: string = segs[0];
  const rest: readonly string[] = segs.slice(1);
  let done: boolean = false;
  const out: BookmarkNode[] = [];
  for (const n of nodes) {
    if (!done && n.kind === 'folder' && n.title === head) {
      const inner = insertByPath(n.children, rest, node);
      if (inner.ok) {
        done = true;
        out.push({ ...n, children: inner.nodes });
        continue;
      }
    }
    out.push(n);
  }
  return { ok: done, nodes: done ? out : [...nodes] };
}
