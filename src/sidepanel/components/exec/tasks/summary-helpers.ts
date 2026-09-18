// browser-extension/src/sidepanel/components/exec/tasks/summary-helpers.ts
// 右键「总结本页」的纯逻辑辅助（自 SummaryExec 拆出控制行数）：总结提示词、
// 元信息缺省值、标签解析、SEO 组装、图床路由调用与 posts.create 提交——
// 发布装配规则与「生成文章」一致（routeArticleImages 三通道、tags ≤5、seo 二选一才提交）。
// 另含「总结素材装配」（SummarySource）：普通网页与 B 站视频两条来源链路的
// 抓取与提示词/正文装配差异集中于此，执行器只消费装配结果（B 站字幕抓取
// 复用 shared/bili-video，与 AI 助手网页总结同一套实现）。

import { ApiError } from '../../../../shared/api/client';
import { createPost } from '../../../../shared/api/endpoints';
import {
  buildBiliPlayerBlock,
  buildBiliPlayerProps,
  collectBiliSubtitleMeta,
  fetchBiliTranscript,
  isBiliVideoUrl,
} from '../../../../shared/bili-video';
import type { BiliSubtitleMeta } from '../../../../shared/bili-video';
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

/** B 站视频总结提示词（素材为字幕全文 + 简介，输出结构与网页版一致） */
export function buildBiliSummaryPrompt(videoTitle: string, videoUrl: string, desc: string, transcript: string): string {
  return (
    '你是资深编辑。用简体中文 Markdown 总结下面这个 B 站视频：'
    + '第一行给一句话核心概括（不要用标题格式），随后用 3-6 个「- 」要点提炼关键信息，'
    + '最后另起一段以「💡 点评：」开头写 30 字内的博主视角点评。不要输出任何与总结无关的内容。\n\n'
    + `视频标题：${videoTitle}\n视频地址：${videoUrl}\n简介：${desc !== '' ? desc : '（无）'}\n\n字幕全文：\n${transcript}`
  );
}

/**
 * 总结素材装配计划：抓取产物 → AI 提示词与正文装配的差异段。
 * kind 决定步骤条文案；decorate 为纯函数（捕获常量），把 AI 输出的 markdown
 * 加工为待渲染正文（尾附出处/原视频链接）；headHtml 拼在渲染结果前（B 站播放器块）。
 */
export interface SummarySource {
  kind: 'web' | 'bili';
  /** 发给 AI 的完整提示词 */
  prompt: string;
  /** 抓取到的正文/字幕（步骤条字数统计用） */
  text: string;
  /** 原文内容区图片（B 站分支恒为空） */
  images: string[];
  /** 正文 HTML 头部（B 站播放器块；普通网页为空串） */
  headHtml: string;
  /** AI 输出 markdown → 加工后的 markdown（纯函数） */
  decorate: (markdown: string) => string;
}

/** 普通网页来源装配（正文经 yy-page-text 抓取，尾附原文出处引用块） */
function buildWebSummarySource(pageTitle: string, pageUrl: string, text: string, images: readonly string[]): SummarySource {
  return {
    kind: 'web',
    prompt: buildSummaryPrompt(pageTitle, pageUrl, text),
    text,
    images: [...images],
    headHtml: '',
    decorate: (markdown: string): string => `${markdown}\n\n> 原文：[${pageTitle}](${pageUrl})`,
  };
}

/** B 站视频来源装配（头部嵌播放器块、尾附原视频链接，不插图） */
function buildBiliSummarySource(meta: BiliSubtitleMeta, transcript: string): SummarySource {
  const videoTitle: string = meta.title ?? 'B 站视频';
  const videoUrl: string = `https://www.bilibili.com/video/${meta.bvid ?? ''}/`;
  return {
    kind: 'bili',
    prompt: buildBiliSummaryPrompt(videoTitle, videoUrl, meta.desc ?? '', transcript),
    text: transcript,
    images: [],
    headHtml: buildBiliPlayerBlock(buildBiliPlayerProps(meta)),
    decorate: (markdown: string): string => `${markdown}\n\n> 原视频：[${videoTitle}](${videoUrl})`,
  };
}

/** 普通网页抓取（dock 通道 yy-page-text 应答 {ok,title,url,text,images}） */
async function grabWebSource(tabId: number, pageTitle: string, pageUrl: string): Promise<SummarySource> {
  const reply: unknown = await chrome.tabs.sendMessage(tabId, { type: 'yy-page-text' });
  const obj = reply as { ok?: boolean; text?: string; images?: unknown } | null;
  if (typeof obj !== 'object' || obj === null || obj.ok !== true || typeof obj.text !== 'string' || obj.text === '') {
    throw new ApiError('页面无可读正文', 0);
  }
  const images: string[] = Array.isArray(obj.images)
    ? obj.images.filter((v: unknown): boolean => typeof v === 'string')
    : [];
  return buildWebSummarySource(pageTitle, pageUrl, obj.text, images);
}

/** 抓取结果：装配计划 + 可选降级提示（B 站字幕不可得时回退普通网页总结） */
export interface GrabSummaryResult {
  source: SummarySource;
  warn: string;
}

/**
 * 右键「总结本页」统一抓取入口：
 * B 站视频页优先取字幕总结（与 AI 助手网页总结同一实现），字幕不可得
 * （未登录 B 站无 AI 字幕 / 主机权限未授予 / 注入失败 / 字幕为空）时
 * 自动回退普通网页抓取，并在 warn 给出可读原因——回退链路依赖 manifest
 * 静态注入的 dock 内容脚本，无主机权限也始终可用。
 */
export async function grabSummarySource(tabId: number, pageTitle: string, pageUrl: string): Promise<GrabSummaryResult> {
  if (isBiliVideoUrl(pageUrl)) {
    let meta: BiliSubtitleMeta | undefined;
    try {
      meta = await collectBiliSubtitleMeta(tabId);
    } catch {
      // 主机权限未授予等注入失败：回退普通网页总结
      meta = undefined;
    }
    const subtitleUrl: string = meta !== undefined && meta.ok ? meta.subtitleUrl ?? '' : '';
    if (meta !== undefined && meta.ok && subtitleUrl !== '') {
      const transcript: string = await fetchBiliTranscript(subtitleUrl);
      if (transcript.trim() !== '') {
        return { source: buildBiliSummarySource(meta, transcript), warn: '' };
      }
      return {
        source: await grabWebSource(tabId, pageTitle, pageUrl),
        warn: '视频字幕内容为空，已回退按普通网页总结',
      };
    }
    const reason: string = meta?.reason ?? '注入失败';
    return {
      source: await grabWebSource(tabId, pageTitle, pageUrl),
      warn: `未能获取视频字幕（${reason}），已回退按普通网页总结；AI 字幕需在浏览器登录 B 站后生成`,
    };
  }
  return { source: await grabWebSource(tabId, pageTitle, pageUrl), warn: '' };
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
