// browser-extension/src/sidepanel/components/PostList.tsx
// 帖子时间线列表：自持请求状态（加载 / 空 / 错误 / 刷新），供首页嵌入。
import { useEffect, useState } from 'react';
import { listTimelinePosts } from '../../shared/api/endpoints';
import { ApiError } from '../../shared/api/client';
import type { PostSummaryItem } from '../../shared/types';

interface PostListProps {
  /** 站点根地址 */
  apiBaseUrl: string;
  /** 开放 Key */
  apiKey: string;
  /** 拉取条数 */
  count: number;
  /** 外部刷新令牌（数值变化即重新拉取） */
  refreshTick: number;
}

/** 相对时间文案（纯函数）：分钟 / 小时 / 天前，超出回退到日期 */
function formatRelativeTime(iso: string): string {
  const published: number = new Date(iso).getTime();
  if (Number.isNaN(published)) {
    return '';
  }
  const diffMs: number = Date.now() - published;
  const minutes: number = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours: number = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days: number = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天前`;
  }
  return new Date(iso).toLocaleDateString('zh-CN');
}

/** 帖子形态徽标文案（纯函数） */
function kindLabel(postKind: string): string {
  return postKind === 'article' ? '文章' : '说说';
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; items: PostSummaryItem[] };

export function PostList(props: PostListProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;

    setState({ phase: 'loading' });
    listTimelinePosts(props.apiBaseUrl, props.apiKey, 1, props.count)
      .then((result) => {
        if (!cancelled) {
          setState({ phase: 'done', items: result.items });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message: string = err instanceof ApiError ? err.message : '加载失败，请稍后重试';
          setState({ phase: 'error', message });
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [props.apiBaseUrl, props.apiKey, props.count, props.refreshTick]);

  if (state.phase === 'loading') {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((n: number) => (
          <div key={n} className="h-16 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (state.phase === 'error') {
    return <p className="rounded-xl border border-line px-4 py-3 text-xs text-ink-2">{state.message}</p>;
  }

  if (state.items.length === 0) {
    return <p className="rounded-xl border border-line px-4 py-3 text-xs text-ink-2">站点还没有公开帖子。</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {state.items.map((item: PostSummaryItem) => (
        <li
          key={item.id}
          className="rounded-xl border border-line bg-elevated px-3.5 py-3 transition-shadow duration-200 hover:shadow-[var(--yy-shadow-card)]"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] text-glow">{kindLabel(item.post_kind)}</span>
            <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.title !== '' ? item.title : item.summary}</h4>
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-2">{item.summary}</p>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-3">
            <span className="truncate">{item.author.nickname}</span>
            <span>👍 {item.like_count}</span>
            <span>💬 {item.comment_count}</span>
            <span>👁 {item.view_count}</span>
            <span className="ml-auto shrink-0">{formatRelativeTime(item.published_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
