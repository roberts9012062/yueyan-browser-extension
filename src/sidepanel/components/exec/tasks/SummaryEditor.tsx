// browser-extension/src/sidepanel/components/exec/tasks/SummaryEditor.tsx
// 右键「总结本页」的编辑确认表单（与 AI 助手「生成文章」发表前体验一致）：
// 标题（AI 生成可改）+ RichEditor 富文本正文（图片可视化可删改）+ 标签（AI 生成可改）
// + SEO 折叠区（AI 生成可改）+ 可见性与存草稿/发布。编辑状态由父组件持有。

import type { MutableRefObject } from 'react';
import type { ReactNode } from 'react';

import type { ArticleMeta } from '../../ai/ArticlePanel';
import { RichEditor } from '../../ai/RichEditor';
import type { RichEditorHandle } from '../../ai/RichEditor';
import { VisibilityToggle } from '../../VisibilityToggle';
import type { Visibility } from '../../VisibilityToggle';
import { EXEC_INPUT_CLS } from '../ExecutorCard';

interface SummaryEditorProps {
  /** 富文本编辑器命令式句柄（父组件持有，发布读取内容用） */
  editorRef: MutableRefObject<RichEditorHandle | null>;
  /** 正文初值 HTML（渲染后的富文本：段落 + 原文配图 + 原文出处） */
  initialHtml: string;
  onHtmlChange: (html: string) => void;
  meta: ArticleMeta;
  onMetaChange: (meta: ArticleMeta) => void;
  tags: string;
  onTagsChange: (tags: string) => void;
  visibility: Visibility;
  onVisibilityChange: (visibility: Visibility) => void;
  saving: boolean;
  /** 元信息（标题/标签/SEO）AI 生成中提示 */
  metaPending: boolean;
  onDraft: () => void;
  onPublish: () => void;
}

export function SummaryEditor(props: SummaryEditorProps): ReactNode {
  const { meta, onMetaChange } = props;
  return (
    <div className="space-y-2">
      {/* 元信息生成中提示 */}
      {props.metaPending && (
        <p className="animate-pulse text-[10px] text-ink-3">AI 正在生成标题 / 标签 / SEO…</p>
      )}

      {/* 标题 */}
      <input
        type="text"
        value={meta.title}
        onChange={(e): void => onMetaChange({ ...meta, title: e.target.value })}
        placeholder="文章标题"
        className={`${EXEC_INPUT_CLS} font-display text-sm`}
      />

      {/* 富文本正文（渲染后的内容：图片以真实 <img> 展示，可删可挪） */}
      <RichEditor
        editorRef={props.editorRef}
        initialHtml={props.initialHtml}
        onHtmlChange={props.onHtmlChange}
        placeholder="正文…"
      />

      {/* 标签 */}
      <input
        type="text"
        value={props.tags}
        onChange={(e): void => props.onTagsChange(e.target.value)}
        placeholder="标签（AI 已生成，可修改，逗号分隔 ≤5 个）"
        className={EXEC_INPUT_CLS}
      />

      {/* SEO 折叠区 */}
      <details className="rounded-xl border border-line bg-elevated px-2.5 py-2">
        <summary className="cursor-pointer text-[11px] text-ink-2">SEO 设置（AI 已生成，可修改）</summary>
        <div className="mt-2 flex flex-col gap-2">
          <input
            type="text"
            value={meta.seoTitle}
            onChange={(e): void => onMetaChange({ ...meta, seoTitle: e.target.value })}
            placeholder="SEO 标题"
            className={EXEC_INPUT_CLS}
          />
          <textarea
            rows={3}
            value={meta.seoDescription}
            onChange={(e): void => onMetaChange({ ...meta, seoDescription: e.target.value })}
            placeholder="SEO 描述（80-120 字）"
            className={`${EXEC_INPUT_CLS} resize-none`}
          />
        </div>
      </details>

      {/* 底部操作 */}
      <div className="flex items-center gap-2 pt-0.5">
        <VisibilityToggle value={props.visibility} onChange={props.onVisibilityChange} disabled={props.saving} />
        <span className="flex-1" />
        <button
          type="button"
          disabled={props.saving}
          onClick={props.onDraft}
          className="rounded-full border border-line px-3 py-1.5 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted disabled:opacity-40"
        >
          存草稿
        </button>
        <button
          type="button"
          disabled={props.saving}
          onClick={props.onPublish}
          className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-medium text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:opacity-40"
        >
          {props.saving ? '提交中…' : '发布到博客'}
        </button>
      </div>
    </div>
  );
}
