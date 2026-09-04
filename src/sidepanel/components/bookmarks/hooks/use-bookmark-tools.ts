// browser-extension/src/sidepanel/components/bookmarks/hooks/use-bookmark-tools.ts
// 书签管理工具 hook（自 BookmarksMain 拆出，控制主视图文件行数）：
//   有效性检测（逐条探测 + 进度上报）、查重清理、清理失效书签、
//   导入本地浏览器书签、重置为完整层级、同步站点导航（navlinks.list 镜像刷新）。
// 约定：树操作均不可变重建并经 persist 落库；耗时操作开始前不依赖渲染态闭包，
// 落库前重读存储校准（防操作期间列表已被其他入口改动）。

import { useState } from 'react';

import { ApiError } from '../../../../shared/api/client';
import { listSiteNavLinks } from '../../../../shared/api/endpoints';
import type { BookmarkNode, BookmarkTree, PluginSettings, SiteNavLinksResult } from '../../../../shared/types';
import { isConfigured, readSettings } from '../../../../shared/storage/settings';
import { readBookmarkStore } from '../../../../shared/storage/bookmark-store';
import {
  buildImportForest,
  collectDeadLinks,
  collectLinks,
  duplicateRemoveIds,
  normalizeUrl,
  probeUrl,
  removeIds,
} from '../tools';
import { mergeNavIntoTree } from '../site-nav/nav-import';

/** 工具动作产生的通知动作（Main 据此打开对应确认弹层） */
export type ToolNoticeAction = null | 'clean-dead';

/** hook 入参（无默认值，全部显式） */
export interface BookmarkToolsInput {
  /** 当前书签树根级节点（渲染态快照） */
  roots: readonly BookmarkNode[];
  /** 变更落库回调（Main 的 persist） */
  persist: (tree: BookmarkTree) => Promise<void>;
  /** 一次性提示回调（Main 通知条渲染） */
  notify: (text: string, action: ToolNoticeAction) => void;
}

/** hook 返回的工具集 */
export interface BookmarkTools {
  /** 有效性检测进度（null=空闲） */
  checkProgress: { done: number; total: number } | null;
  /** 最近一次检测判定为失效的书签数（管理菜单徽标与确认弹窗文案用） */
  deadCount: number;
  runCheck: () => Promise<void>;
  runDedupe: () => Promise<void>;
  /** 清理失效书签（确认弹层「确认」后调用；无失效时仅提示） */
  confirmCleanDead: () => Promise<void>;
  importLocal: () => Promise<void>;
  /** 重置为浏览器书签完整层级（确认弹层「确认」后调用） */
  confirmResetImport: () => Promise<void>;
  /** 同步站点导航（镜像刷新；未连接站点时提示） */
  syncSiteNav: () => Promise<void>;
}

export function useBookmarkTools(input: BookmarkToolsInput): BookmarkTools {
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);

  // ---------- 有效性检测：逐条探测，完成后标记并汇报（存在异常时通知条带一键清理入口） ----------
  async function runCheck(): Promise<void> {
    const links: BookmarkNode[] = collectLinks(input.roots);
    if (links.length === 0 || checkProgress !== null) {
      return;
    }
    let done: number = 0;
    setCheckProgress({ done: 0, total: links.length });

    const statusById = new Map<string, 'ok' | 'fail'>();
    for (const link of links) {
      const status: 'ok' | 'fail' = await probeUrl(link.url);
      statusById.set(link.id, status);
      done += 1;
      setCheckProgress({ done, total: links.length });
    }
    let bad: number = 0;
    const mark = (nodes: readonly BookmarkNode[]): BookmarkNode[] =>
      nodes.map((n: BookmarkNode): BookmarkNode => {
        if (n.kind === 'link') {
          const st = statusById.get(n.id);
          if (st !== undefined) {
            if (st === 'fail') {
              bad += 1;
            }
            return { ...n, check: { status: st, at: Date.now() } };
          }
          return n;
        }
        return { ...n, children: mark(n.children) };
      });

    // 防并发期间列表已变：以存储当前值重算后落库
    const current: BookmarkTree = await readBookmarkStore();
    await input.persist({ roots: mark(current.roots) });
    setCheckProgress(null);
    input.notify(
      `检测完成：${statusById.size - bad} 可达 / ${bad} 异常`,
      bad > 0 ? 'clean-dead' : null,
    );
  }

  // ---------- 查重清理（每组保留最早一条） ----------
  async function runDedupe(): Promise<void> {
    const current: BookmarkTree = await readBookmarkStore();
    const dupIds: ReadonlySet<string> = duplicateRemoveIds(current);
    if (dupIds.size === 0) {
      input.notify('没有发现重复书签', null);
      return;
    }
    await input.persist({ roots: removeIds(current.roots, dupIds) });
    input.notify(`已清理 ${dupIds.size} 条重复书签（每组保留最早一条）`, null);
  }

  // ---------- 清理失效书签（最近一次检测判定为异常的链接，一次性剪枝） ----------
  async function confirmCleanDead(): Promise<void> {
    const current: BookmarkTree = await readBookmarkStore();
    const deadIds: ReadonlySet<string> = new Set(
      collectDeadLinks(current.roots).map((n: BookmarkNode): string => n.id),
    );
    if (deadIds.size === 0) {
      input.notify('没有检测为失效的书签，请先执行「书签有效性检测」', null);
      return;
    }
    await input.persist({ roots: removeIds(current.roots, deadIds) });
    input.notify(`已清理 ${deadIds.size} 条失效书签`, null);
  }

  // ---------- 导入本地浏览器书签（全深度嵌套映射；已有同 URL 跳过） ----------
  async function importLocal(): Promise<void> {
    try {
      const chromeTree: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.getTree();
      const existingUrls: ReadonlySet<string> = new Set(
        collectLinks(input.roots).map((n: BookmarkNode): string => normalizeUrl(n.url)),
      );
      const { forest, importedCount } = buildImportForest(chromeTree, existingUrls);
      if (importedCount === 0) {
        input.notify('未从浏览器中找到可导入的新书签', null);
        return;
      }
      await input.persist({ roots: [...forest, ...input.roots] });
      input.notify(`已导入 ${importedCount} 条书签（含嵌套文件夹）`, null);
    } catch {
      input.notify('导入失败：无法读取浏览器书签，请检查扩展权限', null);
    }
  }

  // ---------- 重置：清空后按浏览器书签完整层级重建（修复旧版浅层导入） ----------
  async function confirmResetImport(): Promise<void> {
    try {
      const chromeTree: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.getTree();
      const { forest, importedCount } = buildImportForest(chromeTree, new Set<string>());
      await input.persist({ roots: forest });
      setCheckProgress(null);
      input.notify(`已按浏览器书签完整层级重建，共 ${importedCount} 条书签`, null);
    } catch {
      input.notify('重置失败：无法读取浏览器书签，请检查扩展权限', null);
    }
  }

  // ---------- 同步站点导航（navlinks.list → 「站点导航」文件夹镜像刷新） ----------
  async function syncSiteNav(): Promise<void> {
    const settings: PluginSettings = await readSettings();
    if (!isConfigured(settings)) {
      input.notify('尚未连接站点：请先在「设置」中完成站点连接', null);
      return;
    }
    try {
      const data: SiteNavLinksResult = await listSiteNavLinks(settings.apiBaseUrl, settings.apiKey);
      if (data.links.length === 0) {
        input.notify('站点暂无导航数据（需站点安装并启用「精品导航」插件）', null);
        return;
      }
      const result = mergeNavIntoTree(input.roots, data.links);
      await input.persist({ roots: result.roots });
      input.notify(
        result.replaced
          ? `站点导航已刷新：${result.categories} 个分类 / ${result.imported} 条`
          : `已导入站点导航：${result.categories} 个分类 / ${result.imported} 条`,
        null,
      );
    } catch (err: unknown) {
      input.notify(
        err instanceof ApiError
          ? (err.status === 403
            ? '站点未授权「导航列表」接口：请在后台重新生成 Key 并勾选'
            : err.message)
          : '导入失败：无法连接站点',
        null,
      );
    }
  }

  return {
    checkProgress,
    deadCount: collectDeadLinks(input.roots).length,
    runCheck,
    runDedupe,
    confirmCleanDead,
    importLocal,
    confirmResetImport,
    syncSiteNav,
  };
}
