// browser-extension/src/sidepanel/components/ai/ArticlePanel.tsx
// 「AI 生成文章」面板：把 AI 回答润色为可发布的文章（HTML 富文本编辑），
// AI 配图插入正文（媒体 ID 关联），标题/提示词由 AI 生成可改，SEO 可填，
// 一键发布到 boke（开放网关 posts.create，凭 Key 绑定用户身份）。
import { useEffect, useRef, useState } from 'react';
import type { PluginSettings } from '../../../shared/types';
import {
  aiAssist,
  createPost,
  listAiModels,
  sendAiChatStream,
  transferImage,
} from '../../../shared/api/endpoints';
import { ApiError } from '../../../shared/api/client';
import { downloadAndCache } from '../../../shared/storage/image-cache';
import { VisibilityToggle } from '../VisibilityToggle';
import type { Visibility } from '../VisibilityToggle';
import { renderMarkdown } from './MarkdownMessage';
import { RichEditor } from './RichEditor';
import type { RichEditorHandle } from './RichEditor';

interface ArticlePanelProps {
  /** 连接设置（站点与 Key） */
  settings: PluginSettings;
  /** 来源内容（AI 回答的 Markdown 原文） */
  sourceMarkdown: string;
  /** 原文图片（网页总结携带；润色后均匀插入正文，编辑器中可删可挪） */
  sourceImages: string[];
  /** 来源页 URL（B 站总结时为视频地址，正文尾部附「原视频」链接） */
  sourceUrl: string;
  /** B 站视频块参数（非空时正文顶部嵌入 data-plugin-block 播放器） */
  biliProps: Record<string, unknown> | null;
  /** 对话页当前选中的模型（标题/SEO 生成用） */
  model: string;
  onClose: () => void;
}

/** AI 生成元信息（标题 + SEO；宽松解析容错） */
interface ArticleMeta {
  title: string;
  seoTitle: string;
  seoDescription: string;
  /** AI 生成的标签（≤5 个，每项 ≤20 字符；空数组=未生成） */
  tags: string[];
}

/**
 * 从 AI 输出文本宽松提取 JSON 元信息（纯函数）。
 * 三级容错：剥代码围栏 → 整体 JSON 解析 → 截断时逐字段正则提取；
 * 兜底标题跳过 ```json 等围栏/空行（此前会把围栏标记当标题）。
 */
function parseMeta(raw: string): ArticleMeta {
  const fenced: RegExpMatchArray | null = raw.match(/\{[\s\S]*\}/);
  if (fenced !== null) {
    try {
      const obj = JSON.parse(fenced[0]) as Record<string, unknown>;
      const rawTags: unknown = obj.tags;
      const tags: string[] = Array.isArray(rawTags)
        ? rawTags
            .filter((tag: unknown): boolean => typeof tag === 'string' && (tag as string).trim() !== '')
            .map((tag: unknown): string => (tag as string).trim().slice(0, 20))
            .slice(0, 5)
        : [];
      return {
        title: typeof obj.title === 'string' ? obj.title : '',
        seoTitle: typeof obj.seo_title === 'string' ? obj.seo_title : '',
        seoDescription: typeof obj.seo_description === 'string' ? obj.seo_description : '',
        tags,
      };
    } catch {
      // 落入兜底
    }
  }
  // 截断抗性兜底：逐字段正则提取（JSON 不完整时仍能救回已生成字段）
  const fieldRe = (key: string): string => {
    const m: RegExpMatchArray | null = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\n]{1,120})"`));
    return m !== null ? m[1] : '';
  };
  const titleRescued: string = fieldRe('title');
  const seoTitleRescued: string = fieldRe('seo_title');
  const seoDescRescued: string = fieldRe('seo_description');
  const tagsRescued: string[] = [];
  const tagsMatch: RegExpMatchArray | null = raw.match(/"tags"\s*:\s*\[([^\]]*)\]/);
  if (tagsMatch !== null) {
    for (const item of tagsMatch[1].split(',')) {
      const cleaned: string = item.replace(/["\s]/g, '');
      if (cleaned !== '') {
        tagsRescued.push(cleaned.slice(0, 20));
      }
    }
  }
  if (titleRescued !== '' || tagsRescued.length > 0) {
    return {
      title: titleRescued,
      seoTitle: seoTitleRescued,
      seoDescription: seoDescRescued,
      tags: tagsRescued.slice(0, 5),
    };
  }
  // 最终兜底：首个非围栏/非空行作标题（跳过 ```json 等标记行）
  const fallbackLine: string =
    raw
      .split('\n')
      .map((line: string): string => line.trim())
      .find((line: string): boolean => line !== '' && !line.startsWith('```') && !line.startsWith('<think')) ?? '';
  return { title: fallbackLine.slice(0, 40), seoTitle: '', seoDescription: '', tags: [] };
}

/** 原文图片均匀插入 markdown：按段落间隔分布（图多时每 N 段一张；无段则附文末；纯函数） */
function distributeImages(markdown: string, images: readonly string[]): string {
  if (images.length === 0) {
    return markdown;
  }
  const blocks: string[] = markdown.split(/\n\n+/);
  const step: number = Math.max(1, Math.floor(blocks.length / images.length));
  const outBlocks: string[] = [];
  let imgIdx: number = 0;
  blocks.forEach((block: string, i: number): void => {
    outBlocks.push(block);
    if (imgIdx < images.length && (i + 1) % step === 0) {
      outBlocks.push(`![原文配图](${images[imgIdx]})`);
      imgIdx += 1;
    }
  });
  for (; imgIdx < images.length; imgIdx += 1) {
    outBlocks.push(`![原文配图](${images[imgIdx]})`);
  }
  return outBlocks.join('\n\n');
}

const INPUT_CLASS: string =
  'w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';

export function ArticlePanel(props: ArticlePanelProps): React.ReactNode {
  const editorRef = useRef<RichEditorHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [html, setHtml] = useState<string>('');
  const [meta, setMeta] = useState<ArticleMeta>({ title: '', seoTitle: '', seoDescription: '', tags: [] });
  const [tags, setTags] = useState<string>('');
  const [mediaIds, setMediaIds] = useState<number[]>([]);
  const [phase, setPhase] = useState<'polishing' | 'editing' | 'publishing'>('polishing');
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [model, setModel] = useState<string>(props.model);
  /** 发布可见性（公开/私有一键互切；随发布提交） */
  const [visibility, setVisibility] = useState<Visibility>('public');

  // ---------- 挂载初始化：润色 / 元信息 / 插图三段独立容错 ----------
  // 任何一段失败都不拖累其余：润色失败用原文、元信息失败留空可手填、
  // 原文图片无论如何插入正文（此前单一 try 导致润色超时时标题标签图片全丢）。
  useEffect(() => {
    void (async (): Promise<void> => {
      const errors: string[] = [];

      // ① 元信息（标题/标签/SEO）先行——生成快，先就位便于用户查看；
      //    失败自动重试一次（长字幕输入偶发超时），仍失败则留空提示手填
      const genMeta = async (): Promise<boolean> => {
        let usableModel: string = props.model;
        if (usableModel === '') {
          const providers = await listAiModels(props.settings.apiBaseUrl, props.settings.apiKey);
          usableModel = providers[0]?.models[0] ?? '';
          setModel(usableModel);
        }
        if (usableModel === '') {
          return false;
        }
        // 走流式端点聚合（后端 ThinkFilter 剥离推理模型的思考段，
        // 非流式会把 <think> 计入输出导致 800 token 内 JSON 被截断）
        let aggregated: string = '';
        await sendAiChatStream(
          props.settings.apiBaseUrl,
          props.settings.apiKey,
          usableModel,
          [
            { role: 'system', content: '你是博客编辑。只输出 JSON，不要任何其他文字。' },
            {
              role: 'user',
              content:
                '为下面的内容生成文章标题、SEO 信息与标签，输出严格 JSON：' +
                '{"title":"12-24字中文标题","seo_title":"SEO标题","seo_description":"80-120字摘要","tags":["标签1","标签2"]}' +
                '（tags 为 3-5 个核心关键词，不带 # 号）\n\n内容：' +
                props.sourceMarkdown.slice(0, 2000),
            },
          ],
          2000,
          false,
          {
            onText: (delta: string): void => {
              aggregated += delta;
            },
          },
        );
        const parsed: ArticleMeta = parseMeta(aggregated);
        if (parsed.title.trim() === '') {
          return false;
        }
        setMeta(parsed);
        if (parsed.tags.length > 0) {
          setTags(parsed.tags.join(', '));
        }
        return true;
      };
      try {
        const ok: boolean = await genMeta().catch((): boolean => false);
        if (!ok) {
          await genMeta().catch((): boolean => false);
        }
      } catch {
        errors.push('标题/标签/SEO 生成失败，请手动填写');
      }

      // ② 正文润色（输入 3000 字内：后端上游超时上限约束）；失败用原文继续
      const POLISH_LIMIT: number = 3000;
      const head: string = props.sourceMarkdown.slice(0, POLISH_LIMIT);
      const tail: string = props.sourceMarkdown.length > POLISH_LIMIT ? props.sourceMarkdown.slice(POLISH_LIMIT) : '';
      let baseText: string = props.sourceMarkdown;
      try {
        const polished = await aiAssist(props.settings.apiBaseUrl, props.settings.apiKey, 'polish', head, '');
        baseText = (polished.text ?? head) + tail;
        if (tail !== '') {
          errors.push('内容较长：前 3000 字已润色，其余保留原文');
        }
      } catch (err: unknown) {
        errors.push(`AI 润色失败（已填入原文）：${err instanceof ApiError ? err.message : '请稍后重试'}`);
      }

      // ③ 正文落位：均匀插入原文图片（无论润色是否成功）；
      //    来源为 B 站视频时尾部附「原视频」链接（优先取传递的 sourceUrl，
      //    回退从正文提取 BV 号；boke 的 B 站插件可渲染播放器）
      const biliFromUrl: RegExpMatchArray | null = props.sourceUrl.match(/bilibili\.com\/video\/(BV[A-Za-z0-9]+)/);
      const biliFromText: RegExpMatchArray | null = baseText.match(/bilibili\.com\/video\/(BV[A-Za-z0-9]+)/);
      const bili: string | null = biliFromUrl?.[1] ?? biliFromText?.[1] ?? null;
      if (bili !== null) {
        baseText += `\n\n📺 原视频：https://www.bilibili.com/video/${bili}/`;
      }
      // B 站播放器块：boke bilibili-video 插件协议
      // <div data-plugin-block="bilibili" data-props="{&quot;…}"></div>（props 值内引号须 &quot; 转义）
      let playerBlock: string = '';
      const bvidInProps: unknown = props.biliProps?.bvid;
      if (props.biliProps !== null && typeof bvidInProps === 'string' && bvidInProps !== '') {
        const propsJson: string = JSON.stringify(props.biliProps).replace(/"/g, '&quot;');
        playerBlock = `<div data-plugin-block="bilibili" data-props="${propsJson}"></div>`;
      }
      setHtml(playerBlock + renderMarkdown(distributeImages(baseText, props.sourceImages)));
      setPhase('editing');
      if (errors.length > 0) {
        setError(errors.join('；'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 润色完成进入编辑态：内容区滚回顶部（标题与提示可见）
  useEffect(() => {
    if (phase === 'editing') {
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [phase]);

  // ---------- AI 插图：按当前文章内容配图并插入光标处 ----------
  async function insertAiImage(): Promise<void> {
    setNotice('正在根据文章内容配图…');
    setError('');
    try {
      const content: string = editorRef.current?.getPlainText() ?? html;
      const result = await aiAssist(props.settings.apiBaseUrl, props.settings.apiKey, 'image', content, '');
      const relative: string = result.media_url ?? '';
      if (relative === '') {
        throw new ApiError('未返回图片地址', 0);
      }
      const absolute: string = /^https?:/i.test(relative) ? relative : `${props.settings.apiBaseUrl}${relative}`;
      void downloadAndCache(absolute);
      editorRef.current?.insertHtml(
        `<figure><img src="${absolute}" alt="AI 配图" style="width:100%;border-radius:8px;margin:8px 0" /></figure>`,
      );
      if (typeof result.media_id === 'number') {
        const mediaId: number = result.media_id;
        setMediaIds((prev: number[]): number[] => [...prev, mediaId]);
      }
      setNotice('配图已插入光标处');
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '配图失败，请稍后重试');
    }
  }

  /**
   * 发布前转存外链图片：编辑器中指向其它站点的 <img> 逐张调 media.transfer，
   * src 替换为本站持久地址、media_id 并入关联列表；单张失败（防盗链/非图片）
   * 保留原址继续，仅计数提示——不阻断发布。
   * 返回：{html 转存后的正文, mediaIds 含新转存的 ID, failed 失败张数}
   */
  async function transferExternalImages(
    sourceHtml: string,
  ): Promise<{ html: string; mediaIds: number[]; failed: number }> {
    const doc: Document = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const imgs: HTMLImageElement[] = Array.from(doc.querySelectorAll('img'));
    const siteHost: string = (() => {
      try {
        return new URL(props.settings.apiBaseUrl).host;
      } catch {
        return '';
      }
    })();

    const collected: number[] = [];
    let failed: number = 0;
    let index: number = 0;
    for (const img of imgs) {
      const src: string = img.getAttribute('src') ?? '';
      index += 1;
      if (!/^https?:\/\//i.test(src)) {
        continue;
      }
      // 本站地址（AI 配图已转存过）跳过
      let host: string = '';
      try {
        host = new URL(src).host;
      } catch {
        continue;
      }
      if (host === siteHost) {
        continue;
      }
      setNotice(`正在转存外链图片 ${index}/${imgs.length}…`);
      try {
        const result = await transferImage(props.settings.apiBaseUrl, props.settings.apiKey, src);
        if (result.url !== '') {
          img.setAttribute('src', result.url);
        }
        if (typeof result.media_id === 'number') {
          collected.push(result.media_id);
        }
      } catch {
        failed += 1;
      }
    }
    return { html: doc.body.innerHTML, mediaIds: collected, failed };
  }

  // ---------- 发布 ----------
  async function publish(status: 'draft' | 'published'): Promise<void> {
    const title: string = meta.title.trim();
    if (title === '') {
      setError('请填写标题');
      return;
    }
    if (html.trim() === '') {
      setError('正文为空');
      return;
    }
    setPhase('publishing');
    setError('');
    setNotice('正在处理正文图片…');

    // 外链图转存（防盗链根治）：失败张数仅提示
    const transferred = await transferExternalImages(html);
    if (transferred.failed > 0) {
      setError(`${transferred.failed} 张外链图片转存失败（源站拒绝），已保留原地址，发布后如裂图可编辑替换`);
    }
    try {
      const tagList: string[] = tags
        .split(/[,，\s]+/u)
        .map((tag: string): string => tag.trim())
        .filter((tag: string): boolean => tag !== '')
        .slice(0, 5);
      const seo =
        meta.seoTitle !== '' || meta.seoDescription !== ''
          ? { seo_title: meta.seoTitle, seo_description: meta.seoDescription }
          : undefined;
      const allMediaIds: number[] = [...mediaIds, ...transferred.mediaIds];
      setNotice(transferred.failed > 0 ? '部分图片转存失败，继续发布…' : '正在发布…');
      await createPost(props.settings.apiBaseUrl, props.settings.apiKey, {
        post_kind: 'article',
        title,
        content: transferred.html,
        content_format: 'html',
        tags: tagList,
        media_ids: allMediaIds,
        visibility,
        status,
        seo,
      });
      setNotice(status === 'published' ? '已发布到博客 🎉' : '草稿已保存');
      window.setTimeout((): void => props.onClose(), 1200);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : '发布失败，请稍后重试');
      setPhase('editing');
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-sm font-medium text-ink">
          生成文章
          <span className="ml-2 text-[11px] text-ink-3">
            {phase === 'polishing' ? 'AI 润色中…' : '润色完成，可自由编辑后发布'}
          </span>
        </h3>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="关闭"
          className="rounded-full px-2 text-lg leading-none text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
        >
          ×
        </button>
      </header>

      {/* 生成提示常驻顶栏下方（任何滚动位置可见） */}
      {(phase === 'polishing' || notice !== '' || error !== '') && (
        <p
          className={`mx-4 mt-2.5 rounded-lg px-3 py-2 text-[11px] ${
            error !== '' ? 'border border-like/40 bg-like/10 text-like' : 'border border-line bg-elevated text-ink-2'
          }`}
        >
          {phase === 'polishing'
            ? 'AI 正在润色并生成标题 / 标签 / SEO…'
            : error !== ''
              ? error
              : notice}
        </p>
      )}

      <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {phase === 'polishing' ? (
          <p className="animate-pulse py-12 text-center text-xs text-ink-3">
            AI 正在润色内容并生成标题与 SEO…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* 标题 */}
            <input
              type="text"
              value={meta.title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                setMeta({ ...meta, title: e.target.value });
              }}
              placeholder="文章标题"
              className={`${INPUT_CLASS} font-display text-base`}
            />

            {/* 富文本编辑器 */}
            <RichEditor
              editorRef={editorRef}
              initialHtml={html}
              placeholder="正文…"
              onHtmlChange={(next: string): void => setHtml(next)}
            />

            {/* 标签 + 插图 */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tags}
                onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setTags(e.target.value)}
                placeholder="标签（AI 已生成，可修改，逗号分隔 ≤5 个）"
                className={`${INPUT_CLASS} flex-1 text-xs`}
              />
              <button
                type="button"
                onClick={(): void => void insertAiImage()}
                title="AI 根据文章内容配图并插入光标处"
                className="shrink-0 rounded-full bg-accent-soft px-4 py-2 text-xs text-glow transition-opacity duration-200 hover:opacity-80"
              >
                🖼 插入配图{mediaIds.length > 0 ? `（${mediaIds.length}）` : ''}
              </button>
            </div>

            {/* SEO 折叠区 */}
            <details className="rounded-xl border border-line bg-elevated px-3 py-2.5">
              <summary className="cursor-pointer text-xs text-ink-2">SEO 设置（AI 已生成，可修改）</summary>
              <div className="mt-2.5 flex flex-col gap-2">
                <input
                  type="text"
                  value={meta.seoTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                    setMeta({ ...meta, seoTitle: e.target.value });
                  }}
                  placeholder="SEO 标题"
                  className={`${INPUT_CLASS} text-xs`}
                />
                <textarea
                  rows={3}
                  value={meta.seoDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void => {
                    setMeta({ ...meta, seoDescription: e.target.value });
                  }}
                  placeholder="SEO 描述（80-120 字）"
                  className={`${INPUT_CLASS} resize-none text-xs`}
                />
                <p className="text-[10px] text-ink-3">
                  模型：{model !== '' ? model : '（站点未配置）'}；发布身份：Key 绑定用户
                </p>
              </div>
            </details>

          </div>
        )}
      </div>

      {/* 底部操作 */}
      {phase !== 'polishing' && (
        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <VisibilityToggle value={visibility} onChange={setVisibility} disabled={phase === 'publishing'} />
          <button
            type="button"
            onClick={(): void => void publish('draft')}
            disabled={phase === 'publishing'}
            className="flex-1 rounded-full border border-line py-2.5 text-sm text-ink-2 transition-colors duration-200 hover:bg-muted disabled:opacity-40"
          >
            存草稿
          </button>
          <button
            type="button"
            onClick={(): void => void publish('published')}
            disabled={phase === 'publishing'}
            className="flex-[2] rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:opacity-40"
          >
            {phase === 'publishing' ? '发布中…' : '发布到博客'}
          </button>
        </footer>
      )}
    </div>
  );
}
