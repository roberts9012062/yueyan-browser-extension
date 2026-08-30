// browser-extension/src/sidepanel/components/bookmarks/BookmarksTab.tsx
// 书签 Tab 容器：书签树的读写、搜索、编辑模式（多选 + 拖拽排序）、新建/导入、
// 有效性检测与查重编排。数据模型为多级树（BookmarkTree），存储于 chrome.storage.local。
import { useEffect, useState } from 'react';
import type { BookmarkNode, BookmarkTree } from '../../../shared/types';
import {
  EMPTY_BOOKMARK_TREE,
  readBookmarkStore,
  saveBookmarkStore,
} from '../../../shared/storage/settings';
import {
  buildImportForest,
  collectAllIds,
  collectFolders,
  collectLinks,
  duplicateRemoveIds,
  newFolderNode,
  newLinkNode,
  normalizeUrl,
  probeUrl,
} from './tools';
import { BookmarkList } from './BookmarkList';
import { CreateMenu, ManageMenu } from './BookmarkMenus';
import { ConfirmSheet, MoveToSheet, NewBookmarkSheet, NewFolderSheet } from './BookmarkDialogs';
import type { NewBookmarkPayload } from './BookmarkDialogs';
import { EditBar } from './EditBar';

/** 底部工具栏的菜单类型（互斥展开） */
type OpenMenu = null | 'create' | 'manage';

/** 弹层类型 */
type DialogKind = null | 'new-bookmark' | 'new-folder' | 'move' | 'reset-import';

export function BookmarksTab() {
  const [tree, setTree] = useState<BookmarkTree>(EMPTY_BOOKMARK_TREE);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [editing, setEditing] = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  // 检测进度：null=空闲
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);
  // 通知条文案（导入/查重结果等一次性提示）
  const [notice, setNotice] = useState<string>('');

  useEffect(() => {
    void (async (): Promise<void> => {
      setTree(await readBookmarkStore());
      setLoaded(true);
    })();
  }, []);

  /** 变更并落库 */
  async function persist(next: BookmarkTree): Promise<void> {
    setTree(next);
    await saveBookmarkStore(next).catch(() => undefined);
  }

  /** 翻转选中态 */
  function toggleSelect(id: string): void {
    setSelected((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const selectableCount: number =
    collectLinks(tree.roots).length + collectFolders(tree.roots).length;

  // ---------- 新建 ----------
  async function handleNewBookmark(payload: NewBookmarkPayload): Promise<void> {
    const link: BookmarkNode = newLinkNode(
      payload.title !== '' ? payload.title : payload.url,
      payload.url,
    );
    if (payload.folderId === null) {
      await persist({ roots: [link, ...tree.roots] });
      setDialog(null);
      setNotice('书签已保存到「未分类」');
      return;
    }
    // 挂到指定文件夹末尾（不可变重建路径）
    const attach = (nodes: readonly BookmarkNode[]): BookmarkNode[] =>
      nodes.map((n: BookmarkNode): BookmarkNode => {
        if (n.id !== payload.folderId) {
          return n.kind === 'folder' ? { ...n, children: attach(n.children) } : n;
        }
        return { ...n, children: [...n.children, link] };
      });
    await persist({ roots: attach(tree.roots) });
    setDialog(null);
    setNotice('书签已保存');
  }

  async function handleNewFolder(name: string): Promise<void> {
    await persist({ roots: [...tree.roots, newFolderNode(name)] });
    setDialog(null);
    setNotice(`文件夹「${name}」已创建`);
  }

  // ---------- 导入本地浏览器书签（全深度嵌套映射） ----------
  async function handleImport(): Promise<void> {
    setMenu(null);
    try {
      const chromeTree: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.getTree();
      const existingUrls: ReadonlySet<string> = new Set(
        collectLinks(tree.roots).map((n: BookmarkNode): string => normalizeUrl(n.url)),
      );
      const { forest, importedCount } = buildImportForest(chromeTree, existingUrls);
      if (importedCount === 0) {
        setNotice('未从浏览器中找到可导入的新书签');
        return;
      }
      await persist({ roots: [...forest, ...tree.roots] });
      setNotice(`已导入 ${importedCount} 条书签（含嵌套文件夹）`);
    } catch {
      setNotice('导入失败：无法读取浏览器书签，请检查扩展权限');
    }
  }

  // ---------- 重置：清空后按浏览器书签完整层级重建（修复旧版浅层导入） ----------
  async function handleResetImport(): Promise<void> {
    setDialog(null);
    try {
      const chromeTree: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.getTree();
      const { forest, importedCount } = buildImportForest(chromeTree, new Set<string>());
      await persist({ roots: forest });
      setCheckProgress(null);
      setNotice(`已按浏览器书签完整层级重建，共 ${importedCount} 条书签`);
    } catch {
      setNotice('重置失败：无法读取浏览器书签，请检查扩展权限');
    }
  }

  // ---------- 编辑模式操作 ----------
  async function handleDeleteSelected(): Promise<void> {
    // 剪枝：选中节点整棵删除（文件夹带走其子级）
    const prune = (nodes: readonly BookmarkNode[]): BookmarkNode[] =>
      nodes.filter((n: BookmarkNode): boolean => !selected.has(n.id))
        .map((n: BookmarkNode): BookmarkNode =>
          n.kind === 'folder' ? { ...n, children: prune(n.children) } : n,
        );
    await persist({ roots: prune(tree.roots) });
    setSelected(new Set());
  }

  async function handleMoveTo(folderId: string | null): Promise<void> {
    const moveSelected: ReadonlySet<string> = selected;
    const prunedRoots: BookmarkNode[] = (() => {
      const walk = (nodes: readonly BookmarkNode[]): BookmarkNode[] =>
        nodes.filter((n: BookmarkNode): boolean => !moveSelected.has(n.id))
          .map((n: BookmarkNode): BookmarkNode =>
            n.kind === 'folder' ? { ...n, children: walk(n.children) } : n,
          );
      return walk(tree.roots);
    })();

    // 被移动节点按原相对顺序排列
    const movedNodes: BookmarkNode[] = collectLinks(tree.roots)
      .concat(collectFolders(tree.roots))
      .filter((n: BookmarkNode): boolean => moveSelected.has(n.id));

    if (folderId === null) {
      await persist({ roots: [...movedNodes, ...prunedRoots] });
    } else {
      let attached: boolean = false;
      const attach = (nodes: readonly BookmarkNode[]): BookmarkNode[] =>
        nodes.map((n: BookmarkNode): BookmarkNode => {
          if (attached || n.kind !== 'folder' || n.id !== folderId) {
            return n.kind === 'folder' && !attached ? { ...n, children: attach(n.children) } : n;
          }
          attached = true;
          return { ...n, children: [...n.children, ...movedNodes] };
        });
      const nextRoots: BookmarkNode[] = attach(prunedRoots);
      await persist({ roots: attached ? nextRoots : { roots: nextRoots }.roots });
    }
    setDialog(null);
    setSelected(new Set());
  }

  // ---------- 工具：有效性检测 ----------
  async function runCheck(): Promise<void> {
    setMenu(null);
    const links: BookmarkNode[] = collectLinks(tree.roots);
    if (links.length === 0 || checkProgress !== null) {
      return;
    }
    let done = 0;
    setCheckProgress({ done: 0, total: links.length });

    const statusById = new Map<string, 'ok' | 'fail'>();
    for (const link of links) {
      const status: 'ok' | 'fail' = await probeUrl(link.url);
      statusById.set(link.id, status);
      done += 1;
      setCheckProgress({ done, total: links.length });
    }
    let bad = 0;
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

    // 防并发期间列表已变：以当前 state 重算
    const current = await readBookmarkStore();
    const marked: BookmarkTree = { roots: mark(current.roots) };
    await persist(marked);
    setCheckProgress(null);
    setNotice(`检测完成：${statusById.size - bad} 可达 / ${bad} 异常`);
  }

  // ---------- 工具：查重清理 ----------
  async function runDedupe(): Promise<void> {
    setMenu(null);
    const removeIds: ReadonlySet<string> = duplicateRemoveIds(tree);
    if (removeIds.size === 0) {
      setNotice('没有发现重复书签');
      return;
    }
    const walk = (nodes: readonly BookmarkNode[]): BookmarkNode[] =>
      nodes.filter((n: BookmarkNode): boolean => !removeIds.has(n.id))
        .map((n: BookmarkNode): BookmarkNode =>
          n.kind === 'folder' ? { ...n, children: walk(n.children) } : n,
        );
    await persist({ roots: walk(tree.roots) });
    setNotice(`已清理 ${removeIds.size} 条重复书签（每组保留最早一条）`);
  }

  // ---------- 打开书签 ----------
  function openItem(node: BookmarkNode): void {
    window.open(node.url, '_blank');
  }

  const isTreeEmpty: boolean = tree.roots.length === 0;

  return (
    <div className="relative flex h-full flex-col">
      {/* 提示条 */}
      {(notice !== '' || checkProgress !== null) && (
        <p className="mx-4 mt-3 rounded-lg border border-line bg-elevated px-3 py-2 text-[11px] text-ink-2">
          {checkProgress !== null
            ? `有效性检测中… ${checkProgress.done}/${checkProgress.total}`
            : notice}
          {checkProgress === null && (
            <button type="button" onClick={(): void => setNotice('')} className="ml-2 text-glow">
              关闭
            </button>
          )}
        </p>
      )}

      {/* 内容区 */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!loaded ? (
          <p className="animate-pulse py-10 text-center text-xs text-ink-3">加载中…</p>
        ) : isTreeEmpty && query.trim() === '' ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 pb-16">
            <span className="text-5xl" aria-hidden>🗂</span>
            <p className="text-sm text-ink-2">书签夹暂无内容</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(): void => void handleImport()}
                className="rounded-full border border-line px-4 py-2 text-xs text-ink transition-colors duration-200 hover:bg-muted"
              >
                ⬇️ 导入本地书签
              </button>
              <button
                type="button"
                onClick={(): void => setDialog('new-bookmark')}
                className="rounded-full bg-accent px-4 py-2 text-xs font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
              >
                ＋ 新建书签
              </button>
            </div>
          </div>
        ) : (
          <>
            {editing && (
              <p className="mb-2 rounded-lg border border-dashed border-line px-3 py-1.5 text-[11px] text-ink-3">
                编辑模式：按住任意书签或文件夹拖动到目标位置松手即可排序（可跨层级）
              </p>
            )}
            <BookmarkList
              tree={tree}
              query={query}
              editing={editing}
              selected={selected}
              onToggleSelect={toggleSelect}
              onOpen={openItem}
              onReorder={(nextRoots: BookmarkNode[]): void => void persist({ roots: nextRoots })}
            />
          </>
        )}
      </div>

      {/* 编辑模式操作条 */}
      {editing && (
        <div className="border-t border-line px-3 py-2">
          <EditBar
            selectableCount={selectableCount}
            selectedCount={selected.size}
            onToggleSelectAll={(): void => {
              const allIds: string[] = collectAllIds(tree.roots);
              setSelected(selected.size === allIds.length ? new Set() : new Set(allIds));
            }}
            onDelete={(): void => void handleDeleteSelected()}
            onMoveClick={(): void => setDialog('move')}
            onFinish={(): void => {
              setEditing(false);
              setSelected(new Set());
            }}
          />
        </div>
      )}

      {/* 底部工具栏：搜索 + 新建/管理/编辑 */}
      <form
        className="flex items-center gap-1.5 border-t border-line px-3 py-2.5"
        onSubmit={(e: React.FormEvent): void => e.preventDefault()}
      >
        <label className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setQuery(e.target.value)}
            placeholder="搜索书签"
            className="w-full rounded-full border border-line bg-elevated py-2 pl-8 pr-3 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </label>

        {/* 新建/导入 */}
        <div className="relative shrink-0">
          {menu === 'create' && (
            <CreateMenu
              onImport={(): void => void handleImport()}
              onNewFolder={(): void => {
                setMenu(null);
                setDialog('new-folder');
              }}
              onNewBookmark={(): void => {
                setMenu(null);
                setDialog('new-bookmark');
              }}
            />
          )}
          <button
            type="button"
            title="新建 / 导入"
            onClick={(): void => setMenu(menu === 'create' ? null : 'create')}
            className={`flex size-9 items-center justify-center rounded-full text-base transition-colors duration-200 ${
              menu === 'create' ? 'bg-accent text-on-accent' : 'bg-muted text-ink hover:bg-accent hover:text-on-accent'
            }`}
          >
            ＋
          </button>
        </div>

        {/* 管理 */}
        <div className="relative shrink-0">
          {menu === 'manage' && (
            <ManageMenu
              onCheck={(): void => void runCheck()}
              onDedupe={(): void => void runDedupe()}
              onResetImport={(): void => {
                setMenu(null);
                setDialog('reset-import');
              }}
            />
          )}
          <button
            type="button"
            title="管理（有效性检测 / 查重）"
            onClick={(): void => setMenu(menu === 'manage' ? null : 'manage')}
            className={`flex size-9 items-center justify-center rounded-full text-sm transition-colors duration-200 ${
              menu === 'manage' ? 'bg-accent text-on-accent' : 'bg-muted text-ink hover:bg-accent hover:text-on-accent'
            }`}
          >
            🛠
          </button>
        </div>

        {/* 编辑 */}
        <button
          type="button"
          title="编辑书签（含拖拽排序）"
          onClick={(): void => setEditing(true)}
          disabled={isTreeEmpty}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-ink transition-colors duration-200 hover:bg-accent hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✏️
        </button>
      </form>

      {/* 弹层 */}
      {dialog === 'new-bookmark' && (
        <NewBookmarkSheet
          folders={collectFolders(tree.roots)}
          onClose={(): void => setDialog(null)}
          onSubmit={(payload: NewBookmarkPayload): void => void handleNewBookmark(payload)}
        />
      )}
      {dialog === 'new-folder' && (
        <NewFolderSheet onClose={(): void => setDialog(null)} onSubmit={(name: string): void => void handleNewFolder(name)} />
      )}
      {dialog === 'move' && (
        <MoveToSheet
          folders={collectFolders(tree.roots)}
          count={selected.size}
          excludeIds={selected}
          onClose={(): void => setDialog(null)}
          onSubmit={(folderId: string | null): void => void handleMoveTo(folderId)}
        />
      )}
      {dialog === 'reset-import' && (
        <ConfirmSheet
          title="重置为完整层级"
          description="将清空当前书签夹的全部内容，并以浏览器书签的真实嵌套层级（含所有子文件夹）重新导入。此前手动添加的书签也会被清除，确定继续吗？"
          confirmLabel="清空并重建"
          onClose={(): void => setDialog(null)}
          onConfirm={(): void => void handleResetImport()}
        />
      )}
    </div>
  );
}
