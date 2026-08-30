// browser-extension/src/sidepanel/components/moment/MomentComposer.tsx
// 写说说发布器（面板首页底部）：文字 + 四类附件（图/视频/音乐/链接）+ 可见性 + 发布。
//
// 行为：
//   - 图片：本地多选 / 剪贴板粘贴 → 本地压缩（>1MB）→ media.upload 上传 → 缩略图附件；
//   - 视频 / 音乐 / 链接：底部弹层贴链接，前端解析（compose.ts）后进附件条；
//   - 发布：组装 HTML（buildMomentHtml）→ posts.create（moment / html / published）；
//   - 校验：正文与附件至少一项、纯文本 ≤2000 字；成功清空并提示，失败显示后端 message。

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';

import { ApiError } from '../../../shared/api/client';
import { createMomentPost, uploadMedia } from '../../../shared/api/endpoints';
import type { InsertKind, MomentAttach, PluginSettings, UploadResult } from '../../../shared/types';
import { AttachBar } from './AttachBar';
import { LinkSheet, MusicSheet, VideoSheet } from './InsertSheets';
import { MomentIcon } from './MomentIcons';
import { VisibilityToggle } from '../VisibilityToggle';
import { MOMENT_MAX_CHARS, buildMomentHtml, compressImageFile, countChars, newAttachId, parseMusicUrl, parseVideoUrl } from './compose';
import type { ParsedVideo } from './compose';

interface MomentComposerProps {
  settings: PluginSettings;
}

/** 顶部提示（ok=成功自散 / err=错误常驻直到下次操作） */
interface ComposerNotice {
  kind: 'ok' | 'err';
  text: string;
}

/** 插入按钮统一样式（图标 14px，跟随文字色） */
const TOOL_CLS: string =
  'flex size-7 items-center justify-center rounded-full text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink disabled:opacity-40';

export function MomentComposer(props: MomentComposerProps) {
  const { settings } = props;
  const [content, setContent] = useState<string>('');
  const [attaches, setAttaches] = useState<MomentAttach[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [sheet, setSheet] = useState<InsertKind | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 成功提示 3 秒自散（错误提示常驻，下次操作时清除）
  useEffect((): (() => void) => {
    if (notice === null || notice.kind !== 'ok') {
      return (): undefined => undefined;
    }
    const timer = setTimeout((): void => setNotice(null), 3000);
    return (): void => clearTimeout(timer);
  }, [notice]);

  /** textarea 自增高（上限 160px 后内部滚动） */
  const autoResize = (): void => {
    const el: HTMLTextAreaElement | null = textareaRef.current;
    if (el !== null) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  };

  /** 批量上传图片：逐张压缩 → media.upload → 附件；失败聚合计数 */
  const handleFiles = async (files: FileList): Promise<void> => {
    const images: File[] = Array.from(files).filter((f: File): boolean => f.type.startsWith('image/'));
    if (images.length === 0) {
      return;
    }
    setUploading(true);
    let failed: number = 0;
    let failMsg: string = '';
    for (const raw of images) {
      try {
        const file: File = await compressImageFile(raw);
        const result: UploadResult = await uploadMedia(settings.apiBaseUrl, settings.apiKey, file);
        setAttaches((prev: MomentAttach[]): MomentAttach[] => [
          ...prev,
          { kind: 'image', id: newAttachId(), url: result.url, mediaId: result.media_id },
        ]);
      } catch (err: unknown) {
        failed += 1;
        failMsg = err instanceof ApiError ? err.message : '上传失败';
      }
    }
    setUploading(false);
    if (failed > 0) {
      const summary: string = failed === images.length
        ? failMsg
        : `${images.length - failed}/${images.length} 张上传成功，${failed} 张失败：${failMsg}`;
      setNotice({ kind: 'err', text: summary });
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      void handleFiles(e.clipboardData.files);
    }
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files !== null) {
      void handleFiles(e.target.files);
    }
    e.target.value = ''; // 允许重复选择同一文件
  };

  /** 发布：校验 → 组装 HTML → posts.create(moment) */
  const handlePublish = async (): Promise<void> => {
    if (submitting || uploading) {
      return;
    }
    const trimmed: string = content.trim();
    if (trimmed === '' && attaches.length === 0) {
      setNotice({ kind: 'err', text: '写点内容或添加附件再发布' });
      return;
    }
    if (countChars(trimmed) > MOMENT_MAX_CHARS) {
      setNotice({ kind: 'err', text: `正文超过 ${MOMENT_MAX_CHARS} 字上限，请精简后再发布` });
      return;
    }
    setNotice(null);
    setSubmitting(true);
    try {
      await createMomentPost(
        settings.apiBaseUrl,
        settings.apiKey,
        buildMomentHtml(trimmed, attaches),
        attaches
          .filter((a: MomentAttach): boolean => a.kind === 'image')
          .map((a: MomentAttach): number => (a.kind === 'image' ? a.mediaId : 0)),
        visibility,
      );
      setContent('');
      setAttaches([]);
      setNotice({ kind: 'ok', text: '已发布 ✓' });
      requestAnimationFrame(autoResize);
    } catch (err: unknown) {
      const message: string = err instanceof ApiError
        ? (err.status === 403 ? `${err.message}（请检查 Key 是否勾选「发布文章」接口）` : err.message)
        : '发布失败，请稍后再试';
      setNotice({ kind: 'err', text: message });
    } finally {
      setSubmitting(false);
    }
  };

  const chars: number = countChars(content.trim());
  const overLimit: boolean = chars > MOMENT_MAX_CHARS;
  const canSubmit: boolean = (chars > 0 || attaches.length > 0) && !overLimit && !submitting && !uploading;

  return (
    <div className="relative border-t border-line px-4 py-3">
      {notice !== null && (
        <p className={`mb-2 rounded-xl px-3 py-1.5 text-[11px] ${
          notice.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-500'
        }`}>
          {notice.text}
        </p>
      )}
      <AttachBar attaches={attaches} onRemove={(id: string): void => {
        setAttaches((prev: MomentAttach[]): MomentAttach[] => prev.filter((a: MomentAttach): boolean => a.id !== id));
      }} />
      <div className="rounded-2xl border border-line bg-elevated transition-colors focus-within:border-accent">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e): void => {
            setContent(e.target.value);
            autoResize();
          }}
          onPaste={onPaste}
          rows={1}
          placeholder="记一点…（可粘贴图片）"
          className="block w-full resize-none bg-transparent px-3 pt-2.5 text-xs leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <p className={`px-3 pb-1.5 text-right text-[10px] ${overLimit ? 'text-red-500' : 'text-ink-3'}`}>
          {chars} / {MOMENT_MAX_CHARS}
        </p>
      </div>
      <div className="mt-2 flex items-center gap-0.5">
        <button type="button" title="插入图片（本地/粘贴）" disabled={uploading} className={TOOL_CLS}
          onClick={(): void => fileInputRef.current?.click()}>
          <MomentIcon kind="image" />
        </button>
        <button type="button" title="插入视频（B站/YouTube 链接）" className={TOOL_CLS}
          onClick={(): void => setSheet('video')}>
          <MomentIcon kind="video" />
        </button>
        <button type="button" title="插入音乐（网易云链接）" className={TOOL_CLS}
          onClick={(): void => setSheet('music')}>
          <MomentIcon kind="music" />
        </button>
        <button type="button" title="插入链接" className={TOOL_CLS}
          onClick={(): void => setSheet('link')}>
          <MomentIcon kind="link" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onFileChange}
        />
        <span className="flex-1" />
        <VisibilityToggle value={visibility} onChange={setVisibility} disabled={uploading || submitting} />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={(): void => void handlePublish()}
          className="ml-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {uploading ? '上传中…' : submitting ? '发布中…' : '发布'}
        </button>
      </div>
      {sheet === 'video' && (
        <VideoSheet onClose={(): void => setSheet(null)} onSubmit={(url: string): void => {
          const parsed: ParsedVideo | null = parseVideoUrl(url);
          if (parsed === null) {
            return; // 弹层内已校验拦截，理论不达
          }
          setAttaches((prev: MomentAttach[]): MomentAttach[] => [
            ...prev,
            { kind: 'video', id: newAttachId(), url, embedUrl: parsed.embedUrl, platform: parsed.platform },
          ]);
          setSheet(null);
        }} />
      )}
      {sheet === 'music' && (
        <MusicSheet onClose={(): void => setSheet(null)} onSubmit={(url: string): void => {
          const songId: string | null = parseMusicUrl(url);
          if (songId === null) {
            return; // 弹层内已校验拦截，理论不达
          }
          setAttaches((prev: MomentAttach[]): MomentAttach[] => [
            ...prev,
            { kind: 'music', id: newAttachId(), url, songId },
          ]);
          setSheet(null);
        }} />
      )}
      {sheet === 'link' && (
        <LinkSheet onClose={(): void => setSheet(null)} onSubmit={(url: string, text: string): void => {
          setAttaches((prev: MomentAttach[]): MomentAttach[] => [
            ...prev,
            { kind: 'link', id: newAttachId(), url, text },
          ]);
          setSheet(null);
        }} />
      )}
    </div>
  );
}
