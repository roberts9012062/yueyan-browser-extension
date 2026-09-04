// browser-extension/src/sidepanel/components/exec/tasks/SummaryExec.tsx
// 右键任务「总结本页，发布到博客」执行器（发表前体验与 AI 助手「生成文章」一致）：
//   【过程】dock 抓取正文与内容区图片（yy-page-text 既有通道，图片收集与 AI 页同规则）
//           → AI 流式总结（执行框内实时滚动）→ markdown 渲染为富文本 HTML
//           （原文图片均匀插入、尾附原文出处）；并行 AI 生成标题/标签/SEO
//           （generateArticleMeta，与「生成文章」同一套逻辑，失败留空可手填）；
//   【交互】RichEditor 富文本正文（图片可视化可删改）+ 标题/标签/SEO 编辑 + 可见性；
//   【完成】正文图片按设置 publishImageBed 路由（routeArticleImages：站点服务器转存 /
//           TG图床 / CF图床）→ createPost(article)（含 seo 与 tags），附「查看文章」链接。

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../../../../shared/api/client';
import { listAiModels, sendAiChatStream } from '../../../../shared/api/endpoints';
import type { SummaryExecTask } from '../../../../shared/messages/types';
import { isConfigured } from '../../../../shared/storage/settings';
import type { PluginSettings } from '../../../../shared/types';
import { distributeImages, generateArticleMeta } from '../../ai/ArticlePanel';
import type { ArticleMeta } from '../../ai/ArticlePanel';
import { renderMarkdown } from '../../ai/MarkdownMessage';
import type { RichEditorHandle } from '../../ai/RichEditor';
import { buildSummaryPrompt, defaultArticleMeta, publishSummaryArticle } from './summary-helpers';
import { CompletionBox, ExecutorCard, NotConnectedGuide } from '../ExecutorCard';
import type { StepInfo, StepState } from '../ExecutorCard';
import { SummaryEditor } from './SummaryEditor';

interface SummaryExecProps {
  settings: PluginSettings;
  task: SummaryExecTask;
  onDone: () => void;
}

/** 任务执行阶段（noconn=未连接 / grab=抓正文 / ai=总结 / edit=编辑 / publishing=发布 / done=完成） */
type Phase = 'noconn' | 'grab' | 'ai' | 'edit' | 'publishing' | 'done';

/** 失败发生的位置（决定步骤条哪一格标红、重试按钮回到哪一步） */
type FailStep = '' | 'grab' | 'ai' | 'publish';

export function SummaryExec(props: SummaryExecProps): ReactNode {
  const { settings, task } = props;
  const [phase, setPhase] = useState<Phase>(isConfigured(settings) ? 'grab' : 'noconn');
  const [failStep, setFailStep] = useState<FailStep>('');
  const [pageText, setPageText] = useState<string>('');
  /** 抓取到的内容区图片（AI 失败重试时仍可插图） */
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [failNote, setFailNote] = useState<string>('');
  const [warnNote, setWarnNote] = useState<string>('');
  /** 流式总结实时预览（markdown 纯文本） */
  const [preview, setPreview] = useState<string>('');
  /** 渲染后的正文 HTML（RichEditor 初值与发布内容；编辑器变更经 onHtmlChange 回写） */
  const [html, setHtml] = useState<string>('');
  const [meta, setMeta] = useState<ArticleMeta>(() => defaultArticleMeta(task.pageTitle));
  const [metaPending, setMetaPending] = useState<boolean>(false);
  const [tags, setTags] = useState<string>('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [saving, setSaving] = useState<boolean>(false);
  const [result, setResult] = useState<{ id: number; draft: boolean } | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<RichEditorHandle | null>(null);

  /** 抓正文与图片（dock 应答 {ok,title,url,text,images}；失败给出可读原因与重试） */
  async function runGrab(): Promise<void> {
    setPhase('grab');
    setFailStep('');
    setFailNote('');
    try {
      const reply: unknown = await chrome.tabs.sendMessage(task.tabId, { type: 'yy-page-text' });
      const obj = reply as { ok?: boolean; text?: string; images?: unknown } | null;
      if (typeof obj !== 'object' || obj === null || obj.ok !== true || typeof obj.text !== 'string' || obj.text === '') {
        throw new ApiError('页面无可读正文', 0);
      }
      setPageText(obj.text);
      const images: string[] = Array.isArray(obj.images)
        ? obj.images.filter((v: unknown): boolean => typeof v === 'string')
        : [];
      setPageImages(images);
      void runAi(obj.text, images);
    } catch (err: unknown) {
      setFailStep('grab');
      setFailNote(err instanceof ApiError ? err.message : '正文抓取失败（页面可能未注入内容脚本）');
    }
  }

  /**
   * AI 流式总结 → 渲染为富文本进入编辑；并行生成元信息（互不拖累，与「生成文章」一致）。
   */
  async function runAi(text: string, images: readonly string[]): Promise<void> {
    setPhase('ai');
    setFailStep('');
    setFailNote('');
    setPreview('');
    try {
      const providers = await listAiModels(settings.apiBaseUrl, settings.apiKey);
      const model: string = providers.flatMap((p) => p.models)[0] ?? '';
      if (model === '') {
        throw new ApiError('站点未配置可用 AI 模型', 0);
      }
      let aggregated: string = '';
      await sendAiChatStream(
        settings.apiBaseUrl,
        settings.apiKey,
        model,
        [{ role: 'user', content: buildSummaryPrompt(task.pageTitle, task.pageUrl, text) }],
        4000,
        false,
        {
          onText: (delta: string): void => {
            aggregated += delta;
            setPreview(aggregated);
          },
        },
      );
      if (aggregated.trim() === '') {
        throw new ApiError('AI 未返回内容', 0);
      }
      // 渲染为富文本：尾附原文出处 + 原文图片均匀插入（与「生成文章」同款规则）
      const withSource: string = aggregated.trim() + `\n\n> 原文：[${task.pageTitle}](${task.pageUrl})`;
      setHtml(renderMarkdown(distributeImages(withSource, images)));
      setPhase('edit');
      // 元信息并行生成（不阻塞编辑；失败留空可手填并提示）
      void (async (): Promise<void> => {
        setMetaPending(true);
        try {
          const gen = await generateArticleMeta(settings.apiBaseUrl, settings.apiKey, model, aggregated);
          if (gen !== null) {
            setMeta(gen.meta);
            if (gen.meta.tags.length > 0) {
              setTags(gen.meta.tags.join(', '));
            }
          } else {
            setWarnNote('标签 / SEO 自动生成失败，可手动填写');
          }
        } catch {
          setWarnNote('标签 / SEO 自动生成失败，可手动填写');
        } finally {
          setMetaPending(false);
        }
      })();
    } catch (err: unknown) {
      setFailStep('ai');
      setFailNote(err instanceof ApiError ? err.message : 'AI 总结失败，请稍后重试');
    }
  }

  // 挂载即启动（未连接时停在引导态）
  useEffect((): void => {
    if (phase === 'grab') {
      void runGrab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 流式预览随内容滚动到底
  useEffect((): void => {
    const el: HTMLDivElement | null = previewRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [preview]);

  /** 发布 / 存草稿：装配逻辑在 summary-publish（图床路由 + seo/tags 随 createPost 提交） */
  async function publish(status: 'draft' | 'published'): Promise<void> {
    const finalTitle: string = meta.title.trim();
    if (finalTitle === '') {
      setFailStep('publish');
      setFailNote('请填写标题');
      return;
    }
    if (html.trim() === '') {
      setFailStep('publish');
      setFailNote('正文为空');
      return;
    }
    setSaving(true);
    setFailStep('');
    setFailNote('');
    setWarnNote('');
    setPhase('publishing');
    try {
      const res = await publishSummaryArticle(settings, html, meta, tags, visibility, status, (text: string): void => {
        setWarnNote(text);
      });
      if (res.failedCount > 0) {
        setWarnNote(`${res.failedCount} 张图片处理失败（${res.failMsg}），已保留原地址，发布后如裂图可编辑替换`);
      } else {
        setWarnNote('');
      }
      setResult({ id: res.id, draft: status === 'draft' });
      setPhase('done');
    } catch (err: unknown) {
      setFailStep('publish');
      setFailNote(err instanceof ApiError ? err.message : '发布失败，请稍后重试');
      setPhase('edit');
    } finally {
      setSaving(false);
    }
  }

  // 步骤条状态纯推导（三步：抓正文与图片 / AI 总结与元信息 / 发布）
  const s1: StepState = failStep === 'grab' ? 'error' : phase === 'noconn' ? 'pending' : phase === 'grab' ? 'running' : 'done';
  const s2: StepState =
    failStep === 'ai' ? 'error'
    : phase === 'ai' ? 'running'
    : phase === 'grab' || phase === 'noconn' ? 'pending'
    : 'done';
  const s3: StepState =
    failStep === 'publish' ? 'error'
    : phase === 'publishing' ? 'running'
    : phase === 'done' ? 'done'
    : 'pending';
  const steps: readonly StepInfo[] = [
    { label: '抓取网页正文与图片', state: s1, note: pageText !== '' ? `${pageText.length} 字${pageImages.length > 0 ? ` + ${pageImages.length} 图` : ''}` : '' },
    { label: 'AI 总结与元信息', state: s2, note: phase === 'ai' ? '生成中…' : '' },
    { label: '发布到博客', state: s3, note: phase === 'publishing' ? '处理图片并提交…' : '' },
  ];

  return (
    <ExecutorCard icon="📝" title="总结本页，发布到博客" steps={steps} onClose={props.onDone}>
      {phase === 'noconn' && <NotConnectedGuide />}

      {/* AI 生成实时预览 */}
      {phase === 'ai' && (
        <div
          ref={previewRef}
          className="thin-scroll max-h-40 overflow-y-auto rounded-lg border border-line bg-elevated px-2.5 py-2 text-[11px] leading-5 text-ink-2"
        >
          {preview !== '' ? preview : '正在思考…'}
        </div>
      )}

      {/* 失败提示与重试 */}
      {failNote !== '' && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-500">
          <span className="flex-1">{failNote}</span>
          {failStep === 'grab' && (
            <button
              type="button"
              onClick={(): void => void runGrab()}
              className="shrink-0 rounded-full border border-red-400/50 px-2.5 py-0.5 transition-colors duration-200 hover:bg-red-500/10"
            >
              重试
            </button>
          )}
          {failStep === 'ai' && (
            <button
              type="button"
              onClick={(): void => void runAi(pageText, pageImages)}
              className="shrink-0 rounded-full border border-red-400/50 px-2.5 py-0.5 transition-colors duration-200 hover:bg-red-500/10"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* 过程提示（元信息降级 / 图片转存进度 / 部分失败） */}
      {warnNote !== '' && phase !== 'done' && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-600 dark:text-amber-400">{warnNote}</p>
      )}

      {/* 编辑确认（交互）：富文本 + 元信息，与「生成文章」发表前一致 */}
      {(phase === 'edit' || phase === 'publishing') && (
        <SummaryEditor
          editorRef={editorRef}
          initialHtml={html}
          onHtmlChange={setHtml}
          meta={meta}
          onMetaChange={setMeta}
          tags={tags}
          onTagsChange={setTags}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          saving={saving}
          metaPending={metaPending}
          onDraft={(): void => void publish('draft')}
          onPublish={(): void => void publish('published')}
        />
      )}

      {/* 完成提示 */}
      {phase === 'done' && result !== null && (
        <CompletionBox
          text={`${result.draft ? '草稿已保存' : '已发布到博客'}《${meta.title.trim()}》`}
          linkHref={`${settings.apiBaseUrl}/posts/${result.id}`}
          linkLabel="查看文章"
          warn={warnNote}
          onDone={props.onDone}
        />
      )}
    </ExecutorCard>
  );
}
