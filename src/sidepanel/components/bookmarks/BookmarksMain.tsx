// browser-extension/src/sidepanel/components/bookmarks/BookmarksMain.tsx
// 书签页「🌐 公有导航」视图（自原 BookmarksTab 实现体搬迁）：书签树读写、搜索、
// 编辑模式（多选 + 拖拽排序）、新建/导入与站点导航自动同步编排。
// 管理类工具（检测/查重/清理/导入/重置/同步站点导航）在 hooks/use-bookmark-tools.ts，
// 底部工具栏在 BookmarksToolbar.tsx——本文件只保留树操作与视图组装。
import { useEffect, useState } from 'react';
import type { BookmarkNode, BookmarkTree, PluginSettings, SiteNavLinksResult } from '../../../shared/types';
import { listSiteNavLinks } from '../../../shared/api/endpoints';
import { readSettings } from '../../../shared/storage/settings';
import {
  EMPTY_BOOKMARK_TREE,
  readBookmarkStore,
  saveBookmarkStore,
} from '../../../shared/storage/bookmark-store';
import {
  collectAllIds,
  collectFolders,
  collectLinks,
  newFolderNode,
  newLinkNode,
  removeIds,
} from './tools';
import type { ToolNoticeAction } from './hooks/use-bookmark-tools';
import { useBookmarkTools } from './hooks/use-bookmark-tools';
import { AiAddSheet } from './site-nav/AiAddSheet';
import { SyncToSiteSheet } from './site-nav/SyncToSiteSheet';
import { mergeNavIntoTree, NAV_ROOT_TITLE } from './site-nav/nav-import';
import { BookmarkList } from './BookmarkList';
import { ConfirmSheet, MoveToSheet, NewBookmarkSheet, NewFolderSheet } from './BookmarkDialogs';
import type { NewBookmarkPayload } from './BookmarkDialogs';
import { BookmarksToolbar } from './BookmarksToolbar';
import type { CreateAction, ManageAction } from './BookmarksToolbar';
import { EditBar } from './EditBar';

/** 弹层类型 */
type DialogKind = null | 'new-bookmark' | 'new-folder' | 'move' | 'reset-import' | 'clean-dead';

/** 通知条状态：文本 + 可选动作（动作与文本同生命周期，关闭即一并清除） */
interface NoticeState {
  text: string;
  action: ToolNoticeAction;
}

/** AI 添加站点的归档根文件夹（与「站点导航」镜像隔离，同步刷新不覆盖） */
const AI_ROOT_TITLE: string = '✨ AI 收藏';

/** 书签公有导航视图入参 */
interface BookmarksMainProps {
  /** 是否已连接站点（未连接时仅本地能力可用：AI 添加 / 站点同步类动作拦截提示） */
  connected: boolean;
}

export function BookmarksMain(props: BookmarksMainProps) {
  const [tree, setTree] = useState<BookmarkTree>(EMPTY_BOOKMARK_TREE);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [editing, setEditing] = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogKind>(null);
  // AI 添加站点弹层
  const [aiAddOpen, setAiAddOpen] = useState<boolean>(false);
  // 同步到站点弹层（本地书签 → 精品导航）
  const [syncOutOpen, setSyncOutOpen] = useState<boolean>(false);
  // 通知条（导入/查重结果等一次性提示，可携带动作按钮）
  const [notice, setNotice] = useState<NoticeState>({ text: '', action: null });

  /** 一次性提示（hook 通知回调与本地提示共用） */
  function notify(text: string, action: ToolNoticeAction): void {
    setNotice({ text, action });
  }

  useEffect(() => {
    void (async (): Promise<void> => {
      setTree(await readBookmarkStore());
      setLoaded(true);
    })();
  }, []);

  // ---------- 站点导航自动同步（打开书签页时静默刷新镜像；仅已导入过、开关开启且已连接时） ----------
  useEffect(() => {
    if (!loaded) {
      return;
    }
    void (async (): Promise<void> => {
      const settings: PluginSettings = await readSettings();
      if (!settings.autoSyncNav || !props.connected) {
        return;
      }
      const hasMirror: boolean = tree.roots.some(
        (n: BookmarkNode): boolean => n.kind === 'folder' && n.title === NAV_ROOT_TITLE,
      );
      if (!hasMirror) {
        return; // 首次仍需手动同步，不无中生有
      }
      try {
        const data: SiteNavLinksResult = await listSiteNavLinks(settings.apiBaseUrl, settings.apiKey);
        if (data.links.length === 0) {
          return;
        }
        const result = mergeNavIntoTree(tree.roots, data.links);
        await persist({ roots: result.roots });
      } catch {
        // 静默失败：不打扰浏览书签
      }
    })();
    // 仅书签树初次加载完成时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /** 变更并落库 */
  async function persist(next: BookmarkTree): Promise<void> {
    setTree(next);
    await saveBookmarkStore(next).catch(() => undefined);
  }

  // ---------- 管理工具（检测/查重/清理/导入/重置/同步站点导航） ----------
  const tools = useBookmarkTools({ roots: tree.roots, persist, notify });

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
      notify('书签已保存到「未分类」', null);
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
    notify('书签已保存', null);
  }

  async function handleNewFolder(name: string): Promise<void> {
    await persist({ roots: [...tree.roots, newFolderNode(name)] });
    setDialog(null);
    notify(`文件夹「${name}」已创建`, null);
  }

  // ---------- AI 添加站点：归档到「✨ AI 收藏 / <分类>」（镜像刷新不覆盖） ----------
  async function handleAiAddSaved(node: BookmarkNode, category: string): Promise<void> {
    const existingRoot: BookmarkNode | undefined = tree.roots.find(
      (n: BookmarkNode): boolean => n.kind === 'folder' && n.title === AI_ROOT_TITLE,
    );
    const aiRoot: BookmarkNode = existingRoot ?? newFolderNode(AI_ROOT_TITLE);
    const existingCat: BookmarkNode | undefined = aiRoot.children.find(
      (n: BookmarkNode): boolean => n.kind === 'folder' && n.title === category,
    );
    const catFolder: BookmarkNode = existingCat ?? newFolderNode(category);
    const nextCat: BookmarkNode = { ...catFolder, children: [...catFolder.children, node] };
    const nextAiRoot: BookmarkNode = {
      ...aiRoot,
      children: existingCat === undefined
        ? [...aiRoot.children, nextCat]
        : aiRoot.children.map((n: BookmarkNode): BookmarkNode => (n.id === nextCat.id ? nextCat : n)),
    };
    const nextRoots: BookmarkNode[] = existingRoot === undefined
      ? [...tree.roots, nextAiRoot]
      : tree.roots.map((n: BookmarkNode): BookmarkNode => (n.id === nextAiRoot.id ? nextAiRoot : n));
    await persist({ roots: nextRoots });
    setAiAddOpen(false);
    notify(`已保存到「${AI_ROOT_TITLE} / ${category}」`, null);
  }

  // ---------- 编辑模式操作 ----------
  async function handleDeleteSelected(): Promise<void> {
    // 剪枝：选中节点整棵删除（文件夹带走其子级）
    await persist({ roots: removeIds(tree.roots, selected) });
    setSelected(new Set());
  }

  async function handleMoveTo(folderId: string | null): Promise<void> {
    const moveSelected: ReadonlySet<string> = selected;
    // 先从原位置整棵摘除（复用批量剪枝，语义与删除一致但节点保留待挂载）
    const prunedRoots: BookmarkNode[] = removeIds(tree.roots, moveSelected);

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

  // ---------- 打开书签 ----------
  function openItem(node: BookmarkNode): void {
    window.open(node.url, '_blank');
  }

  const isTreeEmpty: boolean = tree.roots.length === 0;

  /** 依赖站点连接的「新建/导入」动作（未连接时一律拦截，本地能力不受影响） */
  const ONLINE_ONLY_ACTIONS: ReadonlySet<CreateAction> = new Set(['ai-add', 'sync-to-site', 'import-nav']);

  /** 「新建/导入」菜单动作分发（菜单开合由 Toolbar 内聚） */
  function handleCreateAction(action: CreateAction): void {
    if (!props.connected && ONLINE_ONLY_ACTIONS.has(action)) {
      notify('该功能需要先连接站点：请在「设置」中完成站点连接', null);
      return;
    }
    switch (action) {
      case 'ai-add':
        setAiAddOpen(true);
        break;
      case 'sync-to-site':
        setSyncOutOpen(true);
        break;
      case 'import':
        void tools.importLocal();
        break;
      case 'import-nav':
        void tools.syncSiteNav();
        break;
      case 'new-folder':
        setDialog('new-folder');
        break;
      case 'new-bookmark':
        setDialog('new-bookmark');
        break;
    }
  }

  /** 「管理」菜单动作分发 */
  function handleManageAction(action: ManageAction): void {
    switch (action) {
      case 'check':
        void tools.runCheck();
        break;
      case 'dedupe':
        void tools.runDedupe();
        break;
      case 'clean-dead':
        setDialog('clean-dead');
        break;
      case 'reset-import':
        setDialog('reset-import');
        break;
    }
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* 提示条 */}
      {(notice.text !== '' || tools.checkProgress !== null) && (
        <p className="mx-4 mt-3 rounded-lg border border-line bg-elevated px-3 py-2 text-[11px] text-ink-2">
          {tools.checkProgress !== null
            ? `有效性检测中… ${tools.checkProgress.done}/${tools.checkProgress.total}`
            : notice.text}
          {tools.checkProgress === null && notice.action === 'clean-dead' && (
            <button
              type="button"
              onClick={(): void => setDialog('clean-dead')}
              className="ml-2 text-glow"
            >
              清理失效书签
            </button>
          )}
          {tools.checkProgress === null && (
            <button
              type="button"
              onClick={(): void => setNotice({ text: '', action: null })}
              className="ml-2 text-glow"
            >
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
                onClick={(): void => void tools.importLocal()}
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

      {/* 底部工具栏：搜索 + 新建/管理/编辑（菜单开合内聚） */}
      <BookmarksToolbar
        query={query}
        onQueryChange={setQuery}
        deadCount={tools.deadCount}
        connected={props.connected}
        onCreateAction={handleCreateAction}
        onManageAction={handleManageAction}
        onEdit={(): void => setEditing(true)}
        editDisabled={isTreeEmpty}
      />

      {/* 弹层 */}
      {dialog === 'new-bookmark' && (
        <NewBookmarkSheet
          folders={collectFolders(tree.roots)}
          onClose={(): void => setDialog(null)}
          onSubmit={(payload: NewBookmarkPayload): void => void handleNewBookmark(payload)}
        />
      )}
      {aiAddOpen && (
        <AiAddSheet
          categories={[...new Set(collectFolders(tree.roots).map((n: BookmarkNode): string => n.title))]}
          onClose={(): void => setAiAddOpen(false)}
          onSaved={(node: BookmarkNode, category: string): void => void handleAiAddSaved(node, category)}
        />
      )}
      {syncOutOpen && (
        <SyncToSiteSheet
          tree={tree.roots}
          onClose={(): void => setSyncOutOpen(false)}
          onDone={(message: string): void => notify(message, null)}
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
          onConfirm={(): void => {
            setDialog(null);
            void tools.confirmResetImport();
          }}
        />
      )}
      {dialog === 'clean-dead' && (
        <ConfirmSheet
          title="清理失效书签"
          description={`将删除 ${tools.deadCount} 条检测异常（红点）的书签，删除后无法恢复。判定来自最近一次「书签有效性检测」，结果可能过期（站点或许已恢复），确定继续吗？`}
          confirmLabel={`删除 ${tools.deadCount} 条`}
          onClose={(): void => setDialog(null)}
          onConfirm={(): void => {
            setDialog(null);
            void tools.confirmCleanDead();
          }}
        />
      )}
    </div>
  );
}
