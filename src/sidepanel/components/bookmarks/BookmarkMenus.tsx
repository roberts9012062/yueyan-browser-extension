// browser-extension/src/sidepanel/components/bookmarks/BookmarkMenus.tsx
// 底部工具栏的上弹菜单：新建/导入菜单与工具（检测/查重）菜单。
import type { ReactNode } from 'react';

/** 弹出菜单容器（向上弹出、点击遮罩关闭由父级处理） */
function Popover({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-full right-0 z-40 mb-2 w-44 rounded-xl border border-line bg-elevated p-1.5 shadow-[var(--yy-shadow-card-hover)]">
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

/** 菜单项 */
function MenuItem(props: { icon: string; label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-ink transition-colors duration-200 hover:bg-muted"
      >
        <span aria-hidden>{props.icon}</span>
        {props.label}
      </button>
    </li>
  );
}

interface CreateMenuProps {
  onImport: () => void;
  onNewFolder: () => void;
  onNewBookmark: () => void;
}

export function CreateMenu(props: CreateMenuProps) {
  return (
    <Popover>
      <MenuItem icon="⬇️" label="导入书签" onClick={props.onImport} />
      <MenuItem icon="📁" label="新建文件夹" onClick={props.onNewFolder} />
      <MenuItem icon="🔖" label="新建书签" onClick={props.onNewBookmark} />
    </Popover>
  );
}

interface ManageMenuProps {
  onCheck: () => void;
  onDedupe: () => void;
  /** 清空后按浏览器书签完整层级重建 */
  onResetImport: () => void;
}

export function ManageMenu(props: ManageMenuProps) {
  return (
    <Popover>
      <MenuItem icon="🩺" label="书签有效性检测" onClick={props.onCheck} />
      <MenuItem icon="👥" label="书签查重" onClick={props.onDedupe} />
      <li className="my-1 border-t border-line" />
      <MenuItem icon="♻️" label="重置为完整层级" onClick={props.onResetImport} />
    </Popover>
  );
}
