// browser-extension/src/sidepanel/components/bookmarks/BookmarkList.tsx
// 书签树渲染：多级文件夹折叠、站点图标条目、编辑模式多选与拖拽排序。
// 拖拽规则（仅编辑模式）：按住任意书签/文件夹行拖动，松手落在目标行的上/下半区
// 即插入到目标之前/之后（可跨层级）；禁止拖入自身子树（防环）。
import { useEffect, useState } from 'react';
import type { BookmarkNode, BookmarkTree } from '../../../shared/types';
import {
  readCollapsedBookmarkIds,
  saveCollapsedBookmarkIds,
} from '../../../shared/storage/bookmark-store';
import {
  getFaviconUrl,
  isInSubtree,
  matchesQuery,
  removeNodeById,
} from './tools';

interface BookmarkListProps {
  /** 当前树存储 */
  tree: BookmarkTree;
  /** 搜索关键词（非空走平铺匹配） */
  query: string;
  /** 是否编辑模式（启用复选框与拖拽） */
  editing: boolean;
  /** 选中实体 ID 集合 */
  selected: ReadonlySet<string>;
  /** 翻转某个实体的选中态 */
  onToggleSelect: (id: string) => void;
  /** 打开书签 */
  onOpen: (node: BookmarkNode) => void;
  /** 拖拽落位完成 → 返回重排后的新森林 */
  onReorder: (nextRoots: BookmarkNode[]) => void;
}

/** 站点小图标：自定义 icon（站点导航导入的 dataURL）优先，回退 _favicon 缓存，再回退默认图标 */
function Favicon(props: { url: string; icon?: string }) {
  const [failed, setFailed] = useState<boolean>(false);
  if (props.icon !== undefined && props.icon !== '') {
    return <img src={props.icon} alt="" className="size-4 shrink-0 rounded-sm" />;
  }
  if (failed) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px]" aria-hidden>
        🌐
      </span>
    );
  }
  return (
    <img src={getFaviconUrl(props.url)} alt="" onError={(): void => setFailed(true)} className="size-4 shrink-0 rounded-sm" />
  );
}

/** 缩进深度（px/层） */
const INDENT: number = 14;

interface TreeProps extends BookmarkListProps {
  collapsed: ReadonlySet<string>;
  toggleFolder: (id: string) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
}

/** 树节点行（自递归渲染整棵子树） */
function NodeRow(props: TreeProps & { node: BookmarkNode; depth: number }) {
  const { node, depth } = props;
  const isFolder: boolean = node.kind === 'folder';
  const isCollapsed: boolean = props.collapsed.has(node.id);
  const isDragSource: boolean = props.dragId === node.id;

  return (
    <li>
      <div
        draggable={props.editing}
        onDragStart={(ev: React.DragEvent): void => {
          props.setDragId(node.id);
          ev.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={(): void => props.setDragId(null)}
        onDragOver={(ev: React.DragEvent): void => {
          if (!props.editing || props.dragId === null || props.dragId === node.id) {
            return;
          }
          if (isInSubtree(props.tree.roots, node.id, props.dragId)) {
            return; // 不能拖入自身子树
          }
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'move';
        }}
        onDrop={makeRealDropHandler(props, node)}
        style={{ paddingLeft: `${depth * INDENT}px` }}
        className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-200 hover:bg-muted ${
          isDragSource ? 'opacity-40' : ''
        } ${props.editing ? 'cursor-grab' : ''}`}
      >
        {/* 折叠箭头（仅文件夹）/ 占位对齐 */}
        {isFolder ? (
          <button
            type="button"
            onClick={(): void => props.toggleFolder(node.id)}
            title={isCollapsed ? '展开' : '收起'}
            aria-label={isCollapsed ? '展开' : '收起'}
            className="shrink-0 text-[10px] leading-none text-ink-3"
          >
            <span aria-hidden className={`inline-block transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
          </button>
        ) : (
          <span className="w-[10px] shrink-0" aria-hidden />
        )}

        {props.editing && (
          <input
            type="checkbox"
            checked={props.selected.has(node.id)}
            onChange={(): void => props.onToggleSelect(node.id)}
            onClick={(e: React.MouseEvent): void => e.stopPropagation()}
            className="size-3.5 accent-[var(--yy-accent)]"
          />
        )}

        {isFolder ? (
          <button
            type="button"
            onClick={(): void => props.toggleFolder(node.id)}
            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-ink-2"
          >
            📁 {node.title}
          </button>
        ) : (
          <>
            <Favicon url={node.url} icon={node.icon} />
            <button
              type="button"
              onClick={(): void => props.onOpen(node)}
              className="min-w-0 flex-1 truncate text-left text-xs text-ink"
              title={`${node.title} · ${node.url}`}
            >
              {node.title}
            </button>
            {node.check !== undefined && (
              <span
                title={node.check.status === 'ok' ? '检测可达' : '检测异常'}
                className={`size-2 shrink-0 rounded-full ${node.check.status === 'ok' ? 'bg-emerald-500' : 'bg-like'}`}
              />
            )}
          </>
        )}
      </div>

      {!isFolder || !isCollapsed ? (
        isFolder ? (
          <ul className="flex flex-col gap-0.5">
            {node.children.map((child: BookmarkNode) => (
              <NodeRow key={child.id} {...props} node={child} depth={depth + 1} />
            ))}
          </ul>
        ) : null
      ) : null}
    </li>
  );
}

/** 收集树中全部节点 */
function collect(nodes: readonly BookmarkNode[]): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  for (const n of nodes) {
    out.push(n);
    out.push(...collect(n.children));
  }
  return out;
}

/** 在 target 前后插入被拖节点（基于摘除后的森林；不可变重建路径） */
export function placeBeside(
  forest: readonly BookmarkNode[],
  targetId: string,
  dragged: BookmarkNode,
  before: boolean,
): BookmarkNode[] {
  // 逐层扫描：找到包含 target 的层，在其副本上 splice；命中后沿路径浅拷贝回溯
  const walk = (layer: readonly BookmarkNode[]): BookmarkNode[] | null => {
    for (let i: number = 0; i < layer.length; i += 1) {
      if (layer[i].id === targetId) {
        const arr: BookmarkNode[] = [...layer];
        arr.splice(before ? i : i + 1, 0, dragged);
        return arr;
      }
    }
    let changed: boolean = false;
    const mapped: BookmarkNode[] = layer.map((n: BookmarkNode): BookmarkNode => {
      if (n.kind !== 'folder') {
        return n;
      }
      const deeper: BookmarkNode[] | null = walk(n.children);
      if (deeper !== null) {
        changed = true;
        return { ...n, children: deeper };
      }
      return n;
    });
    return changed ? mapped : null;
  };
  const result: BookmarkNode[] | null = walk(forest);
  return result ?? [...forest];
}

/**
 * 真实的 drop 处理器（工厂函数，弥补 NodeRow 内草稿代码的复杂度）。
 * 上半行=插到目标前；下半行=插到目标后；跨层级天然支持。
 */
function makeRealDropHandler(props: TreeProps, node: BookmarkNode) {
  return (ev: React.DragEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
    const sourceId: string | null = props.dragId;
    props.setDragId(null);
    if (
      !props.editing || sourceId === null || sourceId === node.id ||
      isInSubtree(props.tree.roots, node.id, sourceId) ||
      isInSubtree(props.tree.roots, sourceId, node.id)
    ) {
      return;
    }
    const rect: DOMRect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const before: boolean = ev.clientY < rect.top + rect.height / 2;

    const draggedNode: BookmarkNode | undefined =
      collect(props.tree.roots).find((n: BookmarkNode): boolean => n.id === sourceId);
    if (draggedNode === undefined) {
      return;
    }
    const pruned: BookmarkNode[] = removeNodeById(props.tree.roots, sourceId);
    const next: BookmarkNode[] = placeBeside(pruned, node.id, draggedNode, before);
    props.onReorder(next);
  };
}

export function BookmarkList(props: BookmarkListProps) {
  // 折叠的文件夹 ID 集合：首次挂载从存储恢复，之后每次切换即写回（跨会话记忆）
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const ids: string[] = await readCollapsedBookmarkIds();
      setCollapsed(new Set(ids));
    })();
  }, []);

  function toggleFolder(id: string): void {
    setCollapsed((prev: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      void saveCollapsedBookmarkIds([...next]).catch(() => undefined);
      return next;
    });
  }

  const ctx: TreeProps = { ...props, collapsed, toggleFolder, dragId, setDragId };

  // ---------- 空状态 ----------
  if (props.tree.roots.length === 0 && props.query.trim() === '') {
    return null; // 空态由容器统一呈现（引导按钮）
  }

  // ---------- 搜索平铺 ----------
  if (props.query.trim() !== '') {
    const hits: BookmarkNode[] = collect(props.tree.roots).filter(
      (n: BookmarkNode): boolean => n.kind === 'link' && matchesQuery(n, props.query),
    );
    return (
      <div>
        <p className="px-2 pb-2 text-[11px] text-ink-3">
          匹配到 {hits.length} 条{hits.length === 0 ? '，换个关键词试试' : ''}
        </p>
        <ul className="flex flex-col gap-0.5">
          {hits.map((node: BookmarkNode) => (
            <NodeRow key={node.id} {...ctx} node={{ ...node, children: [] }} depth={0} />
          ))}
        </ul>
      </div>
    );
  }

  // ---------- 树视图：「未分类」（根级链接）+ 各顶级文件夹 ----------
  const rootLinks: BookmarkNode[] = props.tree.roots.filter(
    (n: BookmarkNode): boolean => n.kind === 'link',
  );
  const folders: BookmarkNode[] = props.tree.roots.filter(
    (n: BookmarkNode): boolean => n.kind === 'folder',
  );

  return (
    <div className="flex flex-col">
      {rootLinks.length > 0 && (
        <section className="mb-2">
          <SectionHeader
            id="__root__"
            label="未分类"
            count={rootLinks.length}
            ctx={ctx}
          />
          {!ctx.collapsed.has('__root__') && (
            <ul className="flex flex-col gap-0.5">
              {rootLinks.map((node: BookmarkNode) => (
                <NodeRow key={node.id} {...ctx} node={node} depth={0} />
              ))}
            </ul>
          )}
        </section>
      )}
      <ul className="flex flex-col gap-0.5">
        {folders.map((node: BookmarkNode) => (
          <NodeRow key={node.id} {...ctx} node={node} depth={0} />
        ))}
      </ul>
    </div>
  );
}

/** 未分类区块头（可折叠，与文件夹行为一致；根级链接不支持拖入排序头部语义简单化） */
function SectionHeader(props: { id: string; label: string; count: number; ctx: TreeProps }) {
  const isCollapsed: boolean = props.ctx.collapsed.has(props.id);
  return (
    <header
      onClick={(): void => props.ctx.toggleFolder(props.id)}
      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-muted"
    >
      <span aria-hidden className={`text-[10px] leading-none text-ink-3 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
        ▶
      </span>
      <span className="text-xs font-medium text-ink-2">📥 {props.label}</span>
      <span className="text-[10px] text-ink-3">{props.count}</span>
    </header>
  );
}
