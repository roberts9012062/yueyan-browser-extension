// browser-extension/src/sidepanel/components/bookmarks/AiAddSheet.tsx
// AI 添加站点弹层（对齐 web 端「添加站点」）：填地址 → 自动抓图标（media.transfer 转存
// favicon 落站点媒体库）+ AI 识别名称/分类/标签/简介（ai.models 选模型、ai.chat.stream 聚合，
// 宽松解析回填空字段）→ 保存回调交父级归档到「✨ AI 收藏 / <分类>」。

import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';

import { ApiError } from '../../../../shared/api/client';
import { listAiModels, sendAiChatStream, transferImage } from '../../../../shared/api/endpoints';
import { isConfigured, readSettings } from '../../../../shared/storage/settings';
import { newLinkNode } from '../tools';
import type { BookmarkNode, PluginSettings } from '../../../../shared/types';
import { SheetShell } from '../../moment/InsertSheets';
import { buildRecognizeMessages, parseRecognizeResult } from './ai-recognize';

interface AiAddSheetProps {
  /** 现有分类清单（datalist 提示，引导归档一致） */
  categories: readonly string[];
  onClose: () => void;
  /** 保存回调（node 已带 id/icon；category 为归档分类名） */
  onSaved: (node: BookmarkNode, category: string) => void;
}

/** 表单输入统一样式 */
const INPUT_CLS: string =
  'w-full rounded-xl border border-line bg-elevated px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';

/** 模型选项（供应商·模型 显示，value 为模型名） */
interface ModelOption {
  model: string;
  label: string;
}

export function AiAddSheet(props: AiAddSheetProps) {
  const { categories } = props;
  const [settings, setSettings] = useState<PluginSettings | null>(null);
  const [url, setUrl] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [tagsText, setTagsText] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [icon, setIcon] = useState<string>('');

  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string>('');
  const [recognizing, setRecognizing] = useState<boolean>(false);
  const [iconBusy, setIconBusy] = useState<boolean>(false);
  const [hint, setHint] = useState<string>('');
  const [error, setError] = useState<string>('');

  // 挂载即读连接设置；未连接时展示引导（不阻塞手填）
  useEffect((): void => {
    void readSettings().then((s: PluginSettings): void => setSettings(s));
  }, []);

  // 打开时拉模型清单（失败不阻塞手填，仅隐藏 AI 识别）
  useEffect((): void => {
    if (settings === null || !isConfigured(settings)) {
      return;
    }
    void (async (): Promise<void> => {
      try {
        const providers = await listAiModels(settings.apiBaseUrl, settings.apiKey);
        const options: ModelOption[] = providers
          .filter((p): boolean => p.enabled && p.models.length > 0)
          .flatMap((p): ModelOption[] => p.models.map((m: string): ModelOption => ({ model: m, label: `${p.name} · ${m}` })));
        setModels(options);
        if (options.length > 0) {
          setModel(options[0].model);
        }
      } catch {
        setModels([]);
      }
    })();
    // 仅连接设置就绪后拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings !== null && isConfigured(settings)]);

  /** 站点 favicon 候选地址（origin + /favicon.ico） */
  function faviconUrl(siteUrl: string): string | null {
    try {
      return `${new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`).origin}/favicon.ico`;
    } catch {
      return null;
    }
  }

  /** 抓取图标：转存 favicon 到站点媒体库（持久地址，无防盗链） */
  async function fetchIcon(): Promise<void> {
    if (settings === null || !isConfigured(settings)) {
      setHint('请先在「设置」中完成站点连接，再抓取图标');
      return;
    }
    const target: string | null = faviconUrl(url.trim());
    if (target === null) {
      setHint('先填写有效的站点地址，再抓取图标');
      return;
    }
    setIconBusy(true);
    setError('');
    try {
      const result = await transferImage(settings.apiBaseUrl, settings.apiKey, target);
      setIcon(result.url);
    } catch (err: unknown) {
      setHint(err instanceof ApiError ? `图标抓取失败：${err.message}` : '图标抓取失败（站点 favicon 可能不存在）');
    } finally {
      setIconBusy(false);
    }
  }

  /** AI 识别：流式聚合 → 宽松解析 → 仅回填空字段（用户已填内容不覆盖） */
  async function recognize(): Promise<void> {
    if (settings === null || !isConfigured(settings)) {
      setError('请先在「设置」中完成站点连接，再使用 AI 识别');
      return;
    }
    const siteUrl: string = url.trim();
    if (siteUrl === '') {
      setError('先填写站点地址，AI 才能识别');
      return;
    }
    if (model === '') {
      setError('站点未返回可用模型，无法 AI 识别（可手填后直接保存）');
      return;
    }
    setRecognizing(true);
    setError('');
    let aggregated: string = '';
    try {
      await sendAiChatStream(
        settings.apiBaseUrl,
        settings.apiKey,
        model,
        buildRecognizeMessages(siteUrl, name.trim(), categories),
        1000,
        false,
        { onText: (delta: string): void => { aggregated += delta; } },
      );
      const draft = parseRecognizeResult(aggregated);
      if (draft === null) {
        setError('AI 未返回有效识别结果，请重试或手填');
        return;
      }
      if (name.trim() === '') {
        setName(draft.name);
      }
      if (category.trim() === '') {
        setCategory(draft.category);
      }
      if (tagsText.trim() === '' && draft.tags.length > 0) {
        setTagsText(draft.tags.join(', '));
      }
      if (description.trim() === '') {
        setDescription(draft.description);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'AI 识别失败，请稍后重试');
    } finally {
      setRecognizing(false);
    }
  }

  /** 地址失焦：自动触发一次识别 + 图标抓取（web 端同款行为；已识别过则不重复） */
  function onUrlBlur(): void {
    const siteUrl: string = url.trim();
    if (siteUrl === '') {
      return;
    }
    if (icon === '') {
      void fetchIcon();
    }
    if ((name.trim() === '' || category.trim() === '') && !recognizing) {
      void recognize();
    }
  }

  /** 保存：校验必填 → 构造链接节点交父级归档 */
  function handleSave(): void {
    const siteUrl: string = url.trim();
    const siteName: string = name.trim();
    const siteCategory: string = category.trim();
    if (siteUrl === '' || siteName === '' || siteCategory === '') {
      setError('站点地址、网站名字、分类为必填项');
      return;
    }
    const node: BookmarkNode = newLinkNode(siteName, siteUrl);
    if (icon !== '') {
      node.icon = icon;
    }
    props.onSaved(node, siteCategory);
  }

  function onTagsInput(e: ChangeEvent<HTMLInputElement>): void {
    setTagsText(e.target.value);
  }

  const busy: boolean = recognizing || iconBusy;

  return (
    <SheetShell title="AI 添加站点" onClose={props.onClose}>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          {icon !== '' ? (
            <img src={icon} alt="站点图标" className="size-10 rounded-lg border border-line object-contain p-0.5" />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-elevated text-base" aria-hidden>
              ❓
            </span>
          )}
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={(): void => void fetchIcon()}
              disabled={iconBusy || url.trim() === ''}
              className="rounded-full border border-line px-3 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
            >
              {iconBusy ? '抓取中…' : icon === '' ? '抓取图标' : '重新抓取图标'}
            </button>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">站点地址 *</span>
          <input
            type="text"
            autoFocus
            value={url}
            onChange={(e): void => setUrl(e.target.value)}
            onBlur={onUrlBlur}
            placeholder="example.com 或 https://example.com"
            className={INPUT_CLS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">网站名字 *</span>
          <input
            type="text"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder="如：月言博客"
            className={INPUT_CLS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">分类 *（可输入新分类，或点下方 AI 识别自动分类）</span>
          <input
            type="text"
            value={category}
            onChange={(e): void => setCategory(e.target.value)}
            list="ai-add-category-options"
            placeholder="如：开发工具"
            className={INPUT_CLS}
          />
          <datalist id="ai-add-category-options">
            {categories.map((c: string): React.ReactNode => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">标签（可选，逗号分隔，最多 10 个）</span>
          <input type="text" value={tagsText} onChange={onTagsInput} placeholder="如：3D设计, AI生成" className={INPUT_CLS} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">站点简介（可选，≤200 字）</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e): void => setDescription(e.target.value)}
            placeholder="一句话介绍这个站点…"
            className={`${INPUT_CLS} resize-none`}
          />
        </label>

        {models.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
            <span className="shrink-0 text-[11px] text-ink-2">AI 模型</span>
            <select
              value={model}
              onChange={(e): void => setModel(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2 py-1 text-[11px] text-ink focus:border-accent focus:outline-none"
            >
              {models.map((m: ModelOption): React.ReactNode => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={(): void => void recognize()}
              disabled={busy}
              className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[11px] text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {recognizing ? '识别中…' : '✨ AI 识别'}
            </button>
          </div>
        )}

        {hint !== '' && <p className="text-[11px] text-ink-3">{hint}</p>}
        {error !== '' && <p className="text-[11px] text-red-500">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full border border-line px-4 py-1.5 text-xs text-ink-2 transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="rounded-full bg-accent px-5 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </SheetShell>
  );
}
