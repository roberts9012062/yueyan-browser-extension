// browser-extension/src/sidepanel/components/moment/InsertSheets.tsx
// 写说说「插入内容」底部弹层 ×3：视频（贴链接解析）/ 音乐（网易云歌曲链接）/ 链接（URL+文字）。
// 骨架共用 SheetShell（全视口遮罩 + 底部面板 + 右上角关闭按钮，Esc 同效），
// 解析失败在弹层内联提示，不打断输入。

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { parseMusicUrl, parseVideoUrl } from './compose';

/** 弹层通用骨架：fixed 全视口覆盖（面板任意高度下均正确）、遮罩/关闭按钮/Esc 三种方式关闭 */
function SheetShell(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { onClose } = props;

  useEffect((): (() => void) => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <section className="relative w-full rounded-t-2xl border-t border-line bg-bg px-4 pb-5 pt-3 shadow-[var(--yy-shadow-card-hover)]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">{props.title}</h3>
          <button
            type="button"
            title="关闭"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-full text-ink-3 transition-colors duration-200 hover:bg-muted hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="m2.5 2.5 7 7" />
              <path d="m9.5 2.5-7 7" />
            </svg>
          </button>
        </div>
        {props.children}
      </section>
    </div>
  );
}

/** 弹层内输入行（URL / 文案共用样式） */
const INPUT_CLS: string =
  'w-full rounded-xl border border-line bg-elevated px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';

/** 视频弹层：贴 B站 / YouTube 链接，前端解析失败内联报错 */
export function VideoSheet(props: { onClose: () => void; onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = parseVideoUrl(url);
    if (parsed === null) {
      setError('无法识别该视频链接：支持 B站视频页链接 / BV 号、YouTube 链接（b23.tv 短链请先在浏览器打开后复制完整地址）');
      return;
    }
    props.onSubmit(url.trim());
  };

  return (
    <SheetShell title="插入视频" onClose={props.onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          type="text"
          autoFocus
          value={url}
          onChange={(e): void => {
            setUrl(e.target.value);
            setError('');
          }}
          placeholder="粘贴 B站 / YouTube 视频链接或 BV 号…"
          className={INPUT_CLS}
        />
        {error !== '' && <p className="text-[11px] text-red-500">{error}</p>}
        <button
          type="submit"
          className="self-end rounded-full bg-accent px-4 py-1.5 text-xs text-on-accent transition-opacity hover:opacity-90"
        >
          添加
        </button>
      </form>
    </SheetShell>
  );
}

/** 音乐弹层：贴网易云歌曲链接，解析出歌曲 id */
export function MusicSheet(props: { onClose: () => void; onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (parseMusicUrl(url) === null) {
      setError('无法识别该音乐链接：请粘贴网易云音乐的歌曲页链接（music.163.com/song?id=…）');
      return;
    }
    props.onSubmit(url.trim());
  };

  return (
    <SheetShell title="插入音乐" onClose={props.onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          type="text"
          autoFocus
          value={url}
          onChange={(e): void => {
            setUrl(e.target.value);
            setError('');
          }}
          placeholder="粘贴网易云音乐歌曲链接…"
          className={INPUT_CLS}
        />
        {error !== '' && <p className="text-[11px] text-red-500">{error}</p>}
        <button
          type="submit"
          className="self-end rounded-full bg-accent px-4 py-1.5 text-xs text-on-accent transition-opacity hover:opacity-90"
        >
          添加
        </button>
      </form>
    </SheetShell>
  );
}

/** 链接弹层：URL + 显示文字（留空显示 URL 本身） */
export function LinkSheet(props: { onClose: () => void; onSubmit: (url: string, text: string) => void }) {
  const [url, setUrl] = useState<string>('');
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed: string = url.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      setError('请输入 http(s):// 开头的完整链接');
      return;
    }
    props.onSubmit(trimmed, text.trim());
  };

  return (
    <SheetShell title="插入链接" onClose={props.onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          type="text"
          autoFocus
          value={url}
          onChange={(e): void => {
            setUrl(e.target.value);
            setError('');
          }}
          placeholder="链接地址（http(s)://…）"
          className={INPUT_CLS}
        />
        <input
          type="text"
          value={text}
          onChange={(e): void => setText(e.target.value)}
          placeholder="显示文字（可留空，默认显示链接本身）"
          className={INPUT_CLS}
        />
        {error !== '' && <p className="text-[11px] text-red-500">{error}</p>}
        <button
          type="submit"
          className="self-end rounded-full bg-accent px-4 py-1.5 text-xs text-on-accent transition-opacity hover:opacity-90"
        >
          添加
        </button>
      </form>
    </SheetShell>
  );
}
