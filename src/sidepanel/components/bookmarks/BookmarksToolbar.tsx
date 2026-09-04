// browser-extension/src/sidepanel/components/bookmarks/BookmarksToolbar.tsx
// 书签视图底部工具栏：搜索框 + 「新建/导入」「管理」弹出菜单 + 编辑入口。
// 菜单开合状态内聚于本组件，动作经判别联合回调交由 BookmarksMain 分发（控制主视图行数）。

import { useState } from 'react';

import { CreateMenu, ManageMenu } from './BookmarkMenus';

/** 「新建/导入」菜单动作 */
export type CreateAction = 'ai-add' | 'sync-to-site' | 'import' | 'import-nav' | 'new-folder' | 'new-bookmark';

/** 「管理」菜单动作 */
export type ManageAction = 'check' | 'dedupe' | 'clean-dead' | 'reset-import';

interface BookmarksToolbarProps {
  /** 搜索关键词（受控） */
  query: string;
  onQueryChange: (q: string) => void;
  /** 检测为失效的书签数（管理菜单徽标） */
  deadCount: number;
  /** 是否已连接站点（未连接时「新建/导入」菜单的联网项置灰） */
  connected: boolean;
  onCreateAction: (action: CreateAction) => void;
  onManageAction: (action: ManageAction) => void;
  /** 进入编辑模式 */
  onEdit: () => void;
  /** 无书签时置灰编辑入口 */
  editDisabled: boolean;
}

export function BookmarksToolbar(props: BookmarksToolbarProps) {
  const [menu, setMenu] = useState<null | 'create' | 'manage'>(null);

  /** 菜单项分发：先收起菜单（原交互语义），再交父级执行动作 */
  function dispatchCreate(action: CreateAction): void {
    setMenu(null);
    props.onCreateAction(action);
  }

  function dispatchManage(action: ManageAction): void {
    setMenu(null);
    props.onManageAction(action);
  }

  return (
    <form
      className="flex items-center gap-1.5 border-t border-line px-3 py-2.5"
      onSubmit={(e: React.FormEvent): void => e.preventDefault()}
    >
      <label className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">🔍</span>
        <input
          type="text"
          value={props.query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => props.onQueryChange(e.target.value)}
          placeholder="搜索书签"
          className="w-full rounded-full border border-line bg-elevated py-2 pl-8 pr-3 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </label>

      {/* 新建/导入 */}
      <div className="relative shrink-0">
        {menu === 'create' && (
          <CreateMenu
            connected={props.connected}
            onAiAdd={(): void => dispatchCreate('ai-add')}
            onSyncToSite={(): void => dispatchCreate('sync-to-site')}
            onImport={(): void => dispatchCreate('import')}
            onImportNav={(): void => dispatchCreate('import-nav')}
            onNewFolder={(): void => dispatchCreate('new-folder')}
            onNewBookmark={(): void => dispatchCreate('new-bookmark')}
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
            onCheck={(): void => dispatchManage('check')}
            onDedupe={(): void => dispatchManage('dedupe')}
            onCleanDead={(): void => dispatchManage('clean-dead')}
            deadCount={props.deadCount}
            onResetImport={(): void => dispatchManage('reset-import')}
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
        onClick={props.onEdit}
        disabled={props.editDisabled}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-ink transition-colors duration-200 hover:bg-accent hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        ✏️
      </button>
    </form>
  );
}
