// browser-extension/src/sidepanel/components/bookmarks/BookmarksTab.tsx
// 书签 Tab 容器：「🌐 公有导航 / 🔒 私有导航」双视图切换。
//   公有导航 = 本地书签树 + 站点公开导航镜像（BookmarksMain）；
//   私有导航 = 站点私有导航实时浏览，含访问密码门禁（site-nav/PrivateNavView，
//   私有条目仅在内存渲染，不写入本地存储）。
import { useState } from 'react';

import { BookmarksMain } from './BookmarksMain';
import { PrivateNavView } from './site-nav/PrivateNavView';

/** 书签内视图标识：public=公有导航（默认）/ private=私有导航（密码门禁） */
type BookmarksView = 'public' | 'private';

/** 书签 Tab 入参 */
interface BookmarksTabProps {
  /** 是否已连接站点（未连接时仅本地能力可用：AI 添加 / 站点同步类入口禁用） */
  connected: boolean;
}

export function BookmarksTab(props: BookmarksTabProps) {
  const [view, setView] = useState<BookmarksView>('public');

  return (
    <div className="flex h-full flex-col">
      {/* 公有/私有导航切换条 */}
      <div className="mx-4 mt-3 grid shrink-0 grid-cols-2 gap-1 rounded-full border border-line bg-elevated p-1">
        <ViewTab
          active={view === 'public'}
          label="🌐 公有导航"
          onClick={(): void => setView('public')}
        />
        <ViewTab
          active={view === 'private'}
          label="🔒 私有导航"
          onClick={(): void => setView('private')}
        />
      </div>

      {/* 视图主体（切换即卸载：私有视图退出即不可见，数据不残留本地；
          私有视图自带连接门禁，未连接时展示引导占位） */}
      {view === 'public' ? <BookmarksMain connected={props.connected} /> : <PrivateNavView />}
    </div>
  );
}

/** 切换胶囊按钮 */
function ViewTab(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded-full py-1.5 text-xs font-medium transition-colors duration-200 ${
        props.active ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-muted'
      }`}
    >
      {props.label}
    </button>
  );
}
