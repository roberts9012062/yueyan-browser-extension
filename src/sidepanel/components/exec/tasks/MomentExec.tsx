// browser-extension/src/sidepanel/components/exec/tasks/MomentExec.tsx
// 右键任务「发说说」执行器（草稿篮模式）：
//   - 「加入选中文字 / 加入此图片」跨次右键累积到 exec_moment_draft_v1，实现
//     「选一段话 + 图片 → 一条说说」的组合流；发送成功或点「清空」后移除草稿；
//   - 【交互】文字可编辑（≤2000 字）、图片缩略图可删、可选附来源链接、可见性；
//   - 【过程】发布时逐图按设置的发布图床路由（moment-image-router）：配置 TG/CF 图床
//     则原图直传图床（仅正文 <img> 引用）；未配置或图床失败降级站点服务器
//     （media.transfer 转存 / media.upload 直传，关联 media_ids）；全失败按原链接内嵌；
//   - 【完成】posts.create(moment)，附「查看说说」链接。

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../../../../shared/api/client';
import { createMomentPost } from '../../../../shared/api/endpoints';
import type { MomentExecTask } from '../../../../shared/messages/types';
import {
  applyMomentDelta,
  clearMomentDraft,
  readMomentDraft,
  saveMomentDraft,
} from '../../../../shared/storage/exec-task';
import { isConfigured } from '../../../../shared/storage/settings';
import type { MomentAttach, PluginSettings } from '../../../../shared/types';
import { VisibilityToggle } from '../../VisibilityToggle';
import type { Visibility } from '../../VisibilityToggle';
import { buildMomentHtml, countChars, newAttachId } from '../../moment/compose';
import { CompletionBox, ExecutorCard, EXEC_INPUT_CLS, NotConnectedGuide } from '../ExecutorCard';
import type { StepInfo, StepState } from '../ExecutorCard';
import { routeMomentImage } from './moment-image-router';

interface MomentExecProps {
  settings: PluginSettings;
  task: MomentExecTask;
  onDone: () => void;
}

export function MomentExec(props: MomentExecProps): ReactNode {
  const { settings, task } = props;
  const [text, setText] = useState<string>('');
  const [images, setImages] = useState<string[]>([]);
  const [withSource, setWithSource] = useState<boolean>(false);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [phase, setPhase] = useState<'ready' | 'publishing' | 'done'>('ready');
  const [imgState, setImgState] = useState<StepState>('pending');
  const [failNote, setFailNote] = useState<string>('');
  const [warnNote, setWarnNote] = useState<string>('');
  const [resultId, setResultId] = useState<number>(0);
  const connected: boolean = isConfigured(settings);

  // 挂载：草稿篮合并本次右键增量（文字追加 / 图片去重追加）后回写
  useEffect((): void => {
    void (async (): Promise<void> => {
      const draft = await readMomentDraft();
      const next = applyMomentDelta(draft, task.addText, task.addImage);
      await saveMomentDraft(next);
      setText(next.text);
      setImages(next.images);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chars: number = countChars(text);
  const overLimit: boolean = chars > 2000;

  /** 文字编辑即时回写草稿篮（storage 写入小而廉价；失败静默） */
  function editText(next: string): void {
    setText(next);
    void saveMomentDraft({ text: next, images, updatedAt: Date.now() });
  }

  /** 删除一张草稿图并回写 */
  function removeImage(src: string): void {
    const next: string[] = images.filter((img: string): boolean => img !== src);
    setImages(next);
    void saveMomentDraft({ text, images: next, updatedAt: Date.now() });
  }

  /** 清空草稿篮 */
  async function clearDraft(): Promise<void> {
    await clearMomentDraft();
    setText('');
    setImages([]);
    setWithSource(false);
  }

  /** 发布：逐图转存 → 组装正文 → posts.create(moment) */
  async function publish(): Promise<void> {
    if (text.trim() === '' && images.length === 0 && !withSource) {
      setFailNote('写点内容或加入图片再发布');
      return;
    }
    if (overLimit) {
      setFailNote('正文超过 2000 字上限');
      return;
    }
    setPhase('publishing');
    setFailNote('');
    setWarnNote('');
    setImgState(images.length > 0 ? 'running' : 'done');
    try {
      const attaches: MomentAttach[] = [];
      const mediaIds: number[] = [];
      let failed: number = 0;
      for (const src of images) {
        try {
          // 按设置图床路由：tg/cf 直传图床（mediaId=null）；none 或图床降级走服务器并关联 media_ids
          const resolved = await routeMomentImage(settings, task.tabId, src);
          if (resolved.mediaId !== null) {
            mediaIds.push(resolved.mediaId);
          }
          // source:'tg' 语义=仅正文引用不关联媒体库（TG/CF 图床地址与失败降级原链接）
          attaches.push({ kind: 'image', id: newAttachId(), url: resolved.url, mediaId: resolved.mediaId, source: resolved.mediaId === null ? 'tg' : 'server' });
        } catch {
          failed += 1;
          attaches.push({ kind: 'image', id: newAttachId(), url: src, mediaId: null, source: 'tg' });
        }
      }
      setImgState('done');
      if (withSource) {
        attaches.push({ kind: 'link', id: newAttachId(), url: task.pageUrl, text: task.pageTitle });
      }
      const html: string = buildMomentHtml(text, attaches);
      const res = await createMomentPost(settings.apiBaseUrl, settings.apiKey, html, mediaIds, visibility);
      if (failed > 0) {
        setWarnNote(`${failed} 张图片转存失败，已按原链接内嵌，发布后如裂图可在站点编辑`);
      }
      await clearMomentDraft();
      setResultId(res.id);
      setPhase('done');
    } catch (err: unknown) {
      setFailNote(err instanceof ApiError ? err.message : '发布失败，请稍后重试');
      setPhase('ready');
      setImgState('pending');
    }
  }

  const steps: readonly StepInfo[] = [
    { label: '整理草稿', state: 'done', note: images.length > 0 ? `文字 + ${images.length} 图` : '文字' },
    { label: '处理图片（按图床设置）', state: imgState, note: imgState === 'running' ? '逐张处理…' : '' },
    { label: '发布说说', state: phase === 'done' ? 'done' : phase === 'publishing' ? 'running' : 'pending', note: phase === 'publishing' ? '提交中…' : '' },
  ];

  return (
    <ExecutorCard icon="💬" title="发说说（草稿篮）" steps={steps} onClose={props.onDone}>
      {!connected && <NotConnectedGuide />}

      {(phase === 'ready' || phase === 'publishing') && (
        <div className="space-y-2">
          <textarea
            rows={5}
            value={text}
            onChange={(e): void => editText(e.target.value)}
            placeholder="要发布的文字（右键选中文字 / 图片可持续加入草稿）…"
            disabled={!connected}
            className={`${EXEC_INPUT_CLS} thin-scroll resize-none leading-5 disabled:opacity-60`}
          />
          <p className={`text-right text-[10px] ${overLimit ? 'text-red-500' : 'text-ink-3'}`}>{chars} / 2000</p>

          {/* 图片缩略图（可删） */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {images.map((src: string): ReactNode => (
                <span key={src} className="relative">
                  <img
                    src={src}
                    alt="草稿图片"
                    className="h-14 w-14 rounded-lg border border-line object-cover"
                    loading="lazy"
                  />
                  <button
                    type="button"
                    aria-label="移除图片"
                    onClick={(): void => removeImage(src)}
                    className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-bg text-[10px] text-ink-2 shadow border border-line"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <input type="checkbox" checked={withSource} onChange={(e): void => setWithSource(e.target.checked)} className="accent-[var(--accent)]" />
            附来源链接：{task.pageTitle}
          </label>

          {failNote !== '' && <p className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-500">{failNote}</p>}
          {warnNote !== '' && <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-600 dark:text-amber-400">{warnNote}</p>}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={(): void => void clearDraft()}
              disabled={phase === 'publishing' || (text === '' && images.length === 0)}
              className="rounded-full border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted disabled:opacity-40"
            >
              清空
            </button>
            <VisibilityToggle value={visibility} onChange={setVisibility} disabled={phase === 'publishing'} />
            <span className="flex-1" />
            <button
              type="button"
              disabled={!connected || phase === 'publishing' || overLimit}
              onClick={(): void => void publish()}
              className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-medium text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:opacity-40"
            >
              {phase === 'publishing' ? '发布中…' : '发布'}
            </button>
          </div>
        </div>
      )}

      {/* 完成提示 */}
      {phase === 'done' && (
        <CompletionBox
          text="说说已发布，草稿篮已清空"
          linkHref={`${settings.apiBaseUrl}/posts/${resultId}`}
          linkLabel="查看说说"
          warn={warnNote}
          onDone={props.onDone}
        />
      )}
    </ExecutorCard>
  );
}
