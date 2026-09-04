// browser-extension/src/sidepanel/components/bookmarks/FolderPicker.tsx
// 书签文件夹递归树形选择器（「同步到站点」步骤一用）：
//   任意层级文件夹可展开/收起（▶/▼）、可勾选——勾选即包含该文件夹整棵子树；
//   子级有勾选而自身未勾时显示半选态（indeterminate）；右侧常显子树内链接总数。

import { useState } from 'react';
import type { BookmarkNode } from '../../../../shared/types';
import { collectLinks } from '../tools';

interface FolderPickerProps {
  /** 顶层文件夹（各自的整棵子树参与渲染） */
  folders: readonly BookmarkNode[];
  /** 已勾选的文件夹 ID 集合 */
  picked: ReadonlySet<string>;
  /** 翻转某文件夹勾选态 */
  onToggle: (id: string) => void;
}

/** 子级（任意深度）是否存在已勾选的文件夹 */
function hasPickedDescendant(nodes: readonly BookmarkNode[], picked: ReadonlySet<string>): boolean {
  return nodes.some(
    (n: BookmarkNode): boolean => n.kind === 'folder' && (picked.has(n.id) || hasPickedDescendant(n.children, picked)),
  );
}

/** 树节点行（自递归渲染子树；depth 控制缩进与默认展开层级） */
function FolderRow(props: { node: BookmarkNode; depth: number; picked: ReadonlySet<string>; onToggle: (id: string) => void }) {
  const { node, depth, picked, onToggle } = props;
  const subFolders: BookmarkNode[] = node.children.filter((c: BookmarkNode): boolean => c.kind === 'folder');
  // 顶层默认展开一级，便于直接看到嵌套结构
  const [expanded, setExpanded] = useState<boolean>(depth === 0);
  const selfPicked: boolean = picked.has(node.id);
  const childPicked: boolean = hasPickedDescendant(node.children, picked);
  const count: number = collectLinks([node]).length;

  return (
    <li>
      <div
        className="flex items-center gap-1.5 rounded-lg py-1.5 pr-2 transition-colors hover:bg-muted"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {subFolders.length > 0 ? (
          <button
            type="button"
            title={expanded ? '收起' : '展开'}
            onClick={(): void => setExpanded(!expanded)}
            className="flex size-4 shrink-0 items-center justify-center text-[9px] text-ink-3 transition-colors hover:text-ink"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <input
          ref={(el: HTMLInputElement | null): void => {
            if (el !== null) {
              el.indeterminate = !selfPicked && childPicked;
            }
          }}
          type="checkbox"
          checked={selfPicked}
          onChange={(): void => onToggle(node.id)}
          className="size-3.5 shrink-0 accent-[var(--yy-accent)]"
        />
        <span className="min-w-0 flex-1 truncate text-xs text-ink">{node.title}</span>
        <span className="shrink-0 text-[10px] text-ink-3">{count} 条</span>
      </div>
      {expanded && subFolders.length > 0 && (
        <ul>
          {subFolders.map((c: BookmarkNode): React.ReactNode => (
            <FolderRow key={c.id} node={c} depth={depth + 1} picked={picked} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderPicker(props: FolderPickerProps) {
  return (
    <ul className="thin-scroll max-h-60 overflow-y-auto rounded-xl border border-line bg-elevated py-1">
      {props.folders.map((f: BookmarkNode): React.ReactNode => (
        <FolderRow key={f.id} node={f} depth={0} picked={props.picked} onToggle={props.onToggle} />
      ))}
    </ul>
  );
}
