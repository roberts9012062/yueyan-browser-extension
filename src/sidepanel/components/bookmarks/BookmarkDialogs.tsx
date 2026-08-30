// browser-extension/src/sidepanel/components/bookmarks/BookmarkDialogs.tsx
// 书签相关弹层：通用底部滑出卡片 + 新建书签 / 新建文件夹 / 移动到文件夹。
import type { ReactNode } from 'react';
import type { BookmarkNode } from '../../../shared/types';

/** 遮罩 + 底部卡片通用弹层 */
function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-end bg-black/30"
      onClick={(e: React.MouseEvent): void => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <section className="w-full rounded-t-2xl border-t border-line bg-bg px-4 pb-5 pt-3 shadow-[var(--yy-shadow-card-hover)]">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">{props.title}</h3>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="关闭"
            className="rounded-full px-2 text-lg leading-none text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
          >
            ×
          </button>
        </header>
        {props.children}
      </section>
    </div>
  );
}

/** 二次确认卡片（危险操作用） */
export function ConfirmSheet(props: {
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <p className="mb-4 text-xs leading-relaxed text-ink-2">{props.description}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={props.onClose}
          className="flex-1 rounded-full border border-line py-2.5 text-sm text-ink-2 transition-colors duration-200 hover:bg-muted"
        >
          取消
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          className="flex-1 rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
        >
          {props.confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

const INPUT_CLASS: string =
  'w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';

export interface NewBookmarkPayload {
  title: string;
  url: string;
  folderId: string | null;
}

export function NewBookmarkSheet(props: {
  /** 全部文件夹节点（树形先序收集） */
  folders: BookmarkNode[];
  onClose: () => void;
  onSubmit: (payload: NewBookmarkPayload) => void;
}) {
  let title = '';
  let url = '';
  let folderId: string = '';

  return (
    <Sheet title="新建书签" onClose={props.onClose}>
      <form
        id="yy-new-bookmark-form"
        className="flex flex-col gap-3"
        onSubmit={(e: React.FormEvent): void => {
          e.preventDefault();
          if (url.trim() === '') {
            return;
          }
          props.onSubmit({ title: title.trim(), url: url.trim(), folderId: folderId === '' ? null : folderId });
        }}
      >
        <input
          type="text"
          placeholder="标题（可留空自动用地址）"
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
            title = e.target.value;
          }}
          className={INPUT_CLASS}
        />
        <input
          type="url"
          required
          placeholder="https://example.com"
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
            url = e.target.value;
          }}
          className={INPUT_CLASS}
        />
        <select
          defaultValue=""
          onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
            folderId = e.target.value;
          }}
          className={`${INPUT_CLASS} appearance-none`}
        >
          <option value="">未分类</option>
          {props.folders.map((f: BookmarkNode) => (
            <option key={f.id} value={f.id}>{f.title}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
        >
          保存书签
        </button>
      </form>
    </Sheet>
  );
}

export function NewFolderSheet(props: {
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  let name = '';
  return (
    <Sheet title="新建文件夹" onClose={props.onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: React.FormEvent): void => {
          e.preventDefault();
          const trimmed: string = name.trim();
          if (trimmed !== '') {
            props.onSubmit(trimmed);
          }
        }}
      >
        <input
          type="text"
          autoFocus
          required
          placeholder="文件夹名称"
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
            name = e.target.value;
          }}
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          className="rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
        >
          创建
        </button>
      </form>
    </Sheet>
  );
}

export function MoveToSheet(props: {
  /** 全部文件夹节点 */
  folders: BookmarkNode[];
  /** 已选实体数（标题展示） */
  count: number;
  /** 移动目标里需排除的 ID 集（选中的文件夹自身及其子级，防移入自身） */
  excludeIds: ReadonlySet<string>;
  onClose: () => void;
  onSubmit: (folderId: string | null) => void;
}) {
  return (
    <Sheet title={`移动 ${props.count} 个选中项到…`} onClose={props.onClose}>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto thin-scroll">
        <li>
          <button
            type="button"
            onClick={(): void => props.onSubmit(null)}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-ink transition-colors duration-200 hover:bg-muted"
          >
            📥 未分类
          </button>
        </li>
        {props.folders
          .filter((f: BookmarkNode): boolean => !props.excludeIds.has(f.id))
          .map((f: BookmarkNode) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={(): void => props.onSubmit(f.id)}
                className="w-full truncate rounded-lg px-3 py-2.5 text-left text-sm text-ink transition-colors duration-200 hover:bg-muted"
              >
                📁 {f.title}
              </button>
            </li>
          ))}
        {props.folders.filter((f: BookmarkNode): boolean => !props.excludeIds.has(f.id)).length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-ink-3">还没有可用文件夹，可先「新建文件夹」</li>
        )}
      </ul>
    </Sheet>
  );
}
