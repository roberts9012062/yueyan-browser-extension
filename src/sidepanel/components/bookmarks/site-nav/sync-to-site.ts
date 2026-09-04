// browser-extension/src/sidepanel/components/bookmarks/site-nav/sync-to-site.ts
// 「同步到站点」执行引擎：选中书签 → 直接 / AI 自动整理（逐条流式识别补全说明/标签/分类）
// → 分批上传（navlinks.save，URL 已存在由后端跳过）。全程经 onProgress 汇报进度，
// cancelled() 轮询取消信号；单条 AI 失败回退本地信息，整批上传失败（403/断网）中止抛错。
// 同步目标可见性（公开/私有）经 visibility 透传站点端 navlinks.save。

import { listAiModels, listSiteNavLinks, saveNavLinks, sendAiChatStream } from '../../../../shared/api/endpoints';
import type { BookmarkNode, NavVisibility, PluginSettings, SiteNavLink } from '../../../../shared/types';
import { buildRecognizeMessages, parseRecognizeResult } from './ai-recognize';

/** 同步模式：direct=保持现有分类原样上传 / ai=按站点内容补全说明/标签/分类 */
export type SyncMode = 'direct' | 'ai';

/** 待同步条目（本地书签 → 站点导航载荷的中间形态） */
export interface SyncItem {
  /** 本地标题（名称回退值） */
  title: string;
  url: string;
  /** 本地所属文件夹名（直接模式的分类 / AI 识别失败时的回退分类） */
  localCategory: string;
  /** 自定义图标（dataURL 或本站地址；可空） */
  icon: string;
}

/** 进度汇报（AI 整理与上传两阶段接力） */
export interface SyncProgress {
  phase: 'ai' | 'upload';
  done: number;
  total: number;
  /** 当前正在处理的站点名 / 批次说明 */
  current: string;
}

/** 同步结果计数 */
export interface SyncOutcome {
  created: number;
  skipped: number;
  failed: number;
  /** AI 成功补全的条数（结果提示用） */
  aiFixed: number;
}

/** 每批上传条数（控制单请求体积：icon dataURL 放大后仍在 Nginx 1m 限制内） */
export const SYNC_BATCH_SIZE: number = 20;

/** 超大图标阈值（字节）：超过则丢弃 icon，防单请求超限 */
const MAX_ICON_CHARS: number = 50_000;

/** 上传单次条数上限（后端硬限制） */
const MAX_LINKS_PER_REQUEST: number = 500;

/** 把某文件夹的直接子链接展开为同步条目（嵌套文件夹由调用方逐层展开；纯函数） */
export function collectSyncItems(directLinks: readonly BookmarkNode[], folderTitle: string): SyncItem[] {
  return directLinks
    .filter((n: BookmarkNode): boolean => n.kind === 'link' && /^https?:\/\//i.test(n.url))
    .map((n: BookmarkNode): SyncItem => ({
      title: n.title,
      url: n.url,
      localCategory: folderTitle,
      icon: n.icon !== undefined && n.icon.length <= MAX_ICON_CHARS ? n.icon : '',
    }));
}

/**
 * 执行同步（编排函数）：AI 整理（可选）→ 分批上传。
 * 整批上传失败（Key 未授权 / 断网）抛 ApiError 中止；取消抛普通 Error('已取消')。
 */
export async function runSyncToSite(options: {
  settings: PluginSettings;
  items: readonly SyncItem[];
  mode: SyncMode;
  /** 同步目标可见性：open=公开导航（默认语义）/ private=私有导航 */
  visibility: NavVisibility;
  onProgress: (p: SyncProgress) => void;
  cancelled: () => boolean;
}): Promise<SyncOutcome> {
  const { settings, items, mode, visibility, onProgress, cancelled } = options;

  // 站点现有分类（AI 归类参考；拉不到不阻塞）
  let siteCategories: string[] = [];
  try {
    const nav: Awaited<ReturnType<typeof listSiteNavLinks>> = await listSiteNavLinks(settings.apiBaseUrl, settings.apiKey);
    siteCategories = nav.categories;
  } catch {
    // 忽略
  }
  // AI 模型（默认第一个可用；拉不到时 AI 条目回退本地信息）
  let model: string = '';
  if (mode === 'ai') {
    try {
      const providers: Awaited<ReturnType<typeof listAiModels>> = await listAiModels(settings.apiBaseUrl, settings.apiKey);
      const first = providers.find((p): boolean => p.enabled && p.models.length > 0);
      if (first !== undefined) {
        model = first.models[0];
      }
    } catch {
      // 忽略：model 保持空
    }
  }

  // ---------- 阶段一：组装载荷（AI 模式逐条识别） ----------
  const payload: SiteNavLink[] = [];
  let aiFixed: number = 0;
  for (let i: number = 0; i < items.length; i++) {
    if (cancelled()) {
      throw new Error('已取消');
    }
    const item: SyncItem = items[i];
    onProgress({ phase: 'ai', done: i, total: items.length, current: item.title });
    const entry: SiteNavLink = {
      id: 0,
      name: item.title,
      url: item.url,
      category: item.localCategory,
      tags: [],
      description: '',
      icon: item.icon,
      sort: i + 1,
      created_at: '',
      // 私有目标透传 visibility（站点端空值默认开放，公开目标省略字段）
      ...(visibility === 'private' ? { visibility: 'private' as const } : {}),
    };
    if (mode === 'ai' && model !== '') {
      try {
        let aggregated: string = '';
        await sendAiChatStream(
          settings.apiBaseUrl,
          settings.apiKey,
          model,
          buildRecognizeMessages(item.url, '', [item.localCategory, ...siteCategories]),
          1000,
          false,
          { onText: (delta: string): void => { aggregated += delta; } },
        );
        const draft = parseRecognizeResult(aggregated);
        if (draft !== null) {
          entry.name = draft.name !== '' ? draft.name : item.title;
          entry.category = draft.category !== '' ? draft.category : item.localCategory;
          entry.tags = draft.tags;
          entry.description = draft.description;
          aiFixed++;
        }
      } catch {
        // 单条识别失败 → 本地信息兜底，继续
      }
    }
    payload.push(entry);
  }

  // ---------- 阶段二：分批上传 ----------
  let created: number = 0;
  let skipped: number = 0;
  let failed: number = 0;
  for (let start: number = 0; start < payload.length; start += SYNC_BATCH_SIZE) {
    if (cancelled()) {
      throw new Error('已取消');
    }
    const end: number = Math.min(start + SYNC_BATCH_SIZE, payload.length);
    onProgress({ phase: 'upload', done: start, total: payload.length, current: `上传第 ${start + 1}-${end} 条` });
    const result: Awaited<ReturnType<typeof saveNavLinks>> = await saveNavLinks(
      settings.apiBaseUrl,
      settings.apiKey,
      payload.slice(start, end),
    );
    created += result.created;
    skipped += result.skipped;
    failed += result.failed;
  }
  onProgress({ phase: 'upload', done: payload.length, total: payload.length, current: '完成' });
  return { created, skipped, failed, aiFixed };
}

/** 同步载荷条数上限（与后端限制一致的前置校验值） */
export const SYNC_MAX_ITEMS: number = MAX_LINKS_PER_REQUEST;
