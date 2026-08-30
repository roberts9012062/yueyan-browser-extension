// browser-extension/src/sidepanel/components/moment/MomentIcons.tsx
// 写说说工具行图标（内联 SVG，stroke 跟随文字色，与插件既有图标风格一致）。

export type MomentIconKind = 'image' | 'video' | 'music' | 'link';

const PATHS: Record<MomentIconKind, React.ReactNode> = {
  // 图片：相框 + 山形 + 太阳
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="m4 10 2.5-3 2 2.5L10.5 7l1.5 2" />
      <circle cx="6" cy="6" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  // 视频：圆角框 + 播放三角
  video: (
    <>
      <rect x="1.5" y="3" width="13" height="10" rx="2" />
      <path d="M7 6.2v3.6L10.2 8 7 6.2Z" fill="currentColor" stroke="none" />
    </>
  ),
  // 音乐：八分音符
  music: (
    <>
      <path d="M6 12.5V3.5l6-1v8" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="10.5" cy="10.5" r="1.6" />
    </>
  ),
  // 链接：两段链环
  link: (
    <>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7.5 4.5 8.8 3.2a2.7 2.7 0 0 1 3.8 3.8L11.3 8.3" />
      <path d="M8.5 11.5 7.2 12.8a2.7 2.7 0 0 1-3.8-3.8L4.7 7.7" />
    </>
  ),
};

interface MomentIconProps {
  kind: MomentIconKind;
  size?: number;
}

export function MomentIcon(props: MomentIconProps) {
  const size: number = props.size ?? 14;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[props.kind]}
    </svg>
  );
}
