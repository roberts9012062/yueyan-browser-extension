// browser-extension/src/sidepanel/components/VisibilityToggle.tsx
// 可见性切换胶囊（公开 ⇄ 私有）：写说说与「生成文章」发布区共用。
// 点击即互切；图标为内联 SVG（地球=公开 / 挂锁=私有）。

export type Visibility = 'public' | 'private';

interface VisibilityToggleProps {
  value: Visibility;
  onChange: (next: Visibility) => void;
  /** 是否置灰禁用（发布中）；调用方显式传入 */
  disabled: boolean;
}

/** 两种可见性的图标（16 viewBox，stroke 跟随文字色） */
function VisibilityIcon(props: { value: Visibility }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {props.value === 'public' ? (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12" />
          <path d="M8 2c-1.8 1.6-2.7 3.7-2.7 6s.9 4.4 2.7 6c1.8-1.6 2.7-3.7 2.7-6S9.8 3.6 8 2Z" />
        </>
      ) : (
        <>
          <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
          <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
        </>
      )}
    </svg>
  );
}

export function VisibilityToggle(props: VisibilityToggleProps) {
  const { value, onChange, disabled } = props;
  return (
    <button
      type="button"
      title={value === 'public' ? '当前公开，点击切换为私有' : '当前私有，点击切换为公开'}
      disabled={disabled}
      onClick={(): void => onChange(value === 'public' ? 'private' : 'public')}
      className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-2 transition-colors duration-200 hover:border-accent hover:text-ink disabled:opacity-40"
    >
      <VisibilityIcon value={value} />
      {value === 'public' ? '公开' : '私有'}
    </button>
  );
}
