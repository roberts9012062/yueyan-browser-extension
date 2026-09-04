// browser-extension/src/sidepanel/components/HeaderBar.tsx
// 顶栏：左上角站点头像（点击打开设置）+ 用户名与在线状态；
// 右侧开关组：网页悬浮球开关 / 悬浮窗形态 / 侧边栏形态 / 刷新 / 主题切换 / 设置（齿轮）。
import { useEffect, useState } from 'react';
import type { PanelMode } from '../../shared/panel-mode';
import type { PluginSettings, SiteMeta, UserProfile } from '../../shared/types';

interface HeaderBarProps {
  /** 当前登录用户（null = 未获取到绑定用户） */
  profile: UserProfile | null;
  /** 站点元信息（副行显示站名） */
  meta: SiteMeta | null;
  /** 当前设置（含主题与悬浮球开关状态） */
  settings: PluginSettings;
  /** 当前面板形态（dock=右侧栏 / float=悬浮窗 / embed=网页内嵌） */
  mode: PanelMode;
  /** 是否展示悬浮窗/侧栏形态按钮（无 sidePanel 能力或 embed 形态时隐藏） */
  showShapeButtons: boolean;
  /** 点击形态按钮（float=悬浮窗 / dock=右侧栏） */
  onSetShape: (shape: 'float' | 'dock') => void;
  /** 翻转网页悬浮球显示 */
  onToggleBall: () => void;
  /** 头像 / 齿轮按钮点击 → 打开设置面板 */
  onOpenSettings: () => void;
  /** 刷新数据 */
  onRefresh: () => void;
  /** 切换深浅主题 */
  onToggleTheme: () => void;
}

/** 常规圆形小按钮样式 */
const ICON_BTN_CLASS: string =
  'flex size-7 items-center justify-center rounded-full text-sm text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink';

/** 激活态开关按钮样式（实底强调色） */
const ACTIVE_BTN_CLASS: string =
  'flex size-7 items-center justify-center rounded-full bg-accent text-on-accent transition-colors duration-200';

/** 「弹出为悬浮窗」图标：方框 + 右上外指箭头 */
function FloatIcon(): React.ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1.5" y="4.5" width="10" height="10" rx="2" />
      <path d="M9.5 6.5 14 2m0 0h-3.4M14 2v3.4" />
    </svg>
  );
}

/** 「停靠为右侧栏」图标：窗口右缘分栏 */
function DockIcon(): React.ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M10.5 2.5v11" />
    </svg>
  );
}

/** 「网页悬浮球」图标：星球圆体 + 卫星点 */
function BallIcon(): React.ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="12.4" cy="4.2" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 「设置」图标：齿轮（外圈齿 + 中轴） */
function GearIcon(): React.ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.5 3.5l1.35 1.35M11.15 11.15l1.35 1.35M12.5 3.5l-1.35 1.35M4.85 11.15 3.5 12.5" />
    </svg>
  );
}

export function HeaderBar(props: HeaderBarProps) {
  // 在线状态：实时跟随浏览器联网情况（用户名旁小圆点）
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return (): void => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const avatarUrl: string = props.profile?.avatar_url ?? '';
  const displayName: string = props.profile?.nickname ?? '未绑定用户';
  const siteName: string = props.meta?.site_name ?? '月言博客';

  return (
    <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
      {/* 左侧：头像 + 身份（点击打开设置） */}
      <button
        type="button"
        onClick={props.onOpenSettings}
        title="打开设置"
        className="group flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-0.5 transition-colors duration-200 hover:bg-muted"
      >
        {avatarUrl !== '' ? (
          <img src={avatarUrl} alt={displayName} className="size-9 rounded-full object-cover" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-lg text-glow">
            🙂
          </span>
        )}
        <span className="min-w-0 text-left">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">{displayName}</span>
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-like'}`}
              title={online ? '在线' : '未联网'}
              aria-hidden
            />
            <span className="shrink-0 text-[10px] text-ink-3">{online ? '在线' : '未联网'}</span>
          </span>
          <span className="block truncate text-[11px] text-ink-3">{siteName}</span>
        </span>
      </button>

      {/* 右侧：开关组（形态 → 悬浮球 → 刷新/主题/设置） */}
      <nav className="flex shrink-0 items-center gap-0.5">
        {props.showShapeButtons && (
          <>
            <button
              type="button"
              onClick={(): void => props.onSetShape('float')}
              title="面板悬浮展示"
              className={props.mode === 'float' ? ACTIVE_BTN_CLASS : ICON_BTN_CLASS}
              aria-pressed={props.mode === 'float'}
            >
              <FloatIcon />
            </button>
            <button
              type="button"
              onClick={(): void => props.onSetShape('dock')}
              title="浏览器右侧展示面板"
              className={props.mode === 'dock' ? ACTIVE_BTN_CLASS : ICON_BTN_CLASS}
              aria-pressed={props.mode === 'dock'}
            >
              <DockIcon />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={props.onToggleBall}
          title={props.settings.showBall ? '关闭网页悬浮球' : '开启网页悬浮球'}
          className={props.settings.showBall ? ACTIVE_BTN_CLASS : ICON_BTN_CLASS}
          aria-pressed={props.settings.showBall}
        >
          <BallIcon />
        </button>

        <button type="button" onClick={props.onRefresh} title="刷新数据" className={ICON_BTN_CLASS}>
          ↻
        </button>
        <button
          type="button"
          onClick={props.onToggleTheme}
          title={props.settings.theme === 'cool-moon' ? '切换到亮色' : '切换到暗色'}
          className={ICON_BTN_CLASS}
        >
          🌓
        </button>
        <button type="button" onClick={props.onOpenSettings} title="设置" className={ICON_BTN_CLASS} aria-label="设置">
          <GearIcon />
        </button>
      </nav>
    </header>
  );
}
