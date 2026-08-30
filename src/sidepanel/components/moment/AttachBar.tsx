// browser-extension/src/sidepanel/components/moment/AttachBar.tsx
// 写说说附件条：图片缩略图网格 + 视频/音乐/链接条目行，每项右上角可删除。

import type { MomentAttach } from '../../../shared/types';

interface AttachBarProps {
  attaches: readonly MomentAttach[];
  onRemove: (id: string) => void;
}

/** 附件条目摘要文案（视频/音乐/链接三类；图片走缩略图不走此函数） */
function attachLabel(attach: MomentAttach): string {
  if (attach.kind === 'image') {
    return attach.url; // 理论不达（图片渲染缩略图，不出文案）
  }
  if (attach.kind === 'video') {
    return attach.platform === 'bilibili' ? `B站视频 · ${attach.url}` : `YouTube 视频 · ${attach.url}`;
  }
  if (attach.kind === 'music') {
    return `网易云歌曲 #${attach.songId}`;
  }
  return attach.text === '' ? attach.url : attach.text;
}

export function AttachBar(props: AttachBarProps) {
  const { attaches, onRemove } = props;
  if (attaches.length === 0) {
    return null;
  }
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attaches.map((attach: MomentAttach) => (
        <div
          key={attach.id}
          className="group relative overflow-hidden rounded-xl border border-line bg-elevated"
        >
          {attach.kind === 'image' ? (
            <img
              src={attach.url}
              alt="待发布配图"
              className="size-16 object-cover"
            />
          ) : (
            <div className="flex max-w-44 items-center gap-1.5 px-2.5 py-2">
              <span aria-hidden className="shrink-0 text-xs">
                {attach.kind === 'video' ? '▶' : attach.kind === 'music' ? '♪' : '🔗'}
              </span>
              <span className="truncate text-[11px] text-ink-2">{attachLabel(attach)}</span>
            </div>
          )}
          <button
            type="button"
            title="移除"
            onClick={(): void => onRemove(attach.id)}
            className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none text-white transition-colors hover:bg-black/80"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
