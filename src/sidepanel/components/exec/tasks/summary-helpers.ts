// browser-extension/src/sidepanel/components/exec/tasks/summary-publish.ts
// 右键「总结本页」的纯逻辑辅助（自 SummaryExec 拆出控制行数）：总结提示词、
// 元信息缺省值、标签解析、SEO 组装、图床路由调用与 posts.create 提交——
// 发布装配规则与「生成文章」一致（routeArticleImages 三通道、tags ≤5、seo 二选一才提交）。

import { createPost } from '../../../../shared/api/endpoints';
import type { PluginSettings } from '../../../../shared/types';
import type { ArticleMeta } from '../../ai/ArticlePanel';
import { routeArticleImages } from '../../ai/publish-image-router';

/** 元信息缺省值（标题回退页面标题，AI 成功后覆盖） */
export function defaultArticleMeta(pageTitle: string): ArticleMeta {
  return { title: pageTitle, seoTitle: '', seoDescription: '', tags: [] };
}

/** 总结提示词（输出 markdown，随后渲染为富文本） */
export function buildSummaryPrompt(pageTitle: string, pageUrl: string, pageText: string): string {
  return (
    '你是资深编辑。用简体中文 Markdown 总结下面的网页：'
    + '第一行给一句话核心概括（不要用标题格式），随后用 3-6 个「- 」要点提炼关键信息，'
    + '最后另起一段以「💡 点评：」开头写 30 字内的博主视角点评。不要输出任何与总结无关的内容。\n\n'
    + `网页标题：${pageTitle}\n网址：${pageUrl}\n\n正文：\n${pageText}`
  );
}

/** 发布装配结果 */
export interface SummaryPublishResult {
  id: number;
  /** 图片处理失败张数与首条原因（0=全部成功或无图） */
  failedCount: number;
  failMsg: string;
}

/** 把逗号/空白分隔的标签输入解析为 ≤5 个的标签数组（纯函数） */
export function parseTagInput(raw: string): string[] {
  return raw
    .split(/[,，\s]+/u)
    .map((t: string): string => t.trim())
    .filter((t: string): boolean => t !== '')
    .slice(0, 5);
}

/**
 * 发布 / 存草稿：富文本正文图片按设置图床路由后提交 posts.create（含 seo 与 tags）。
 * onProgress 透传图床逐张处理进度（调用方接执行卡提示区）。
 */
export async function publishSummaryArticle(
  settings: PluginSettings,
  html: string,
  meta: ArticleMeta,
  tags: string,
  visibility: 'public' | 'private',
  status: 'draft' | 'published',
  onProgress: (text: string) => void,
): Promise<SummaryPublishResult> {
  const routed = await routeArticleImages(html, settings, onProgress);
  const seo =
    meta.seoTitle !== '' || meta.seoDescription !== ''
      ? { seo_title: meta.seoTitle, seo_description: meta.seoDescription }
      : undefined;
  const res = await createPost(settings.apiBaseUrl, settings.apiKey, {
    post_kind: 'article',
    title: meta.title.trim(),
    content: routed.html,
    content_format: 'html',
    tags: parseTagInput(tags),
    media_ids: routed.mediaIds,
    visibility,
    status,
    seo,
  });
  return { id: res.id, failedCount: routed.failed, failMsg: routed.failMsg };
}
