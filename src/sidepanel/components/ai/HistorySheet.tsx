// browser-extension/src/sidepanel/components/ai/HistorySheet.tsx
// AI 历史会话面板：关键词搜索 / 点击翻阅恢复会话 / 单条删除 / 清空全部（二次确认）。
import { useEffect, useState } from 'react';
import type { AiSession } from '../../../shared/types';
import { filterSessions, readAiSessions } from '../../../shared/storage/ai-history';

interface HistorySheetProps {
  /** 当前会话 ID（高亮标记） */
  activeId: string | null;
  /** 恢复某会话为当前会话 */
  onOpen: (session: AiSession) => void;
  /** 删除单条 */
  onDelete: (id: string) => void;
  /** 清空全部历史 */
  onClearAll: () => void;
  onClose: () => void;
}

/** 相对时间（纯函数） */
function timeLabel(ts: number): string {
  const diff: number = Date.now() - ts;
  const minutes: number = Math.floor(diff / 60000);
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
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function HistorySheet(props: HistorySheetProps): React.ReactNode {
  const [sessions, setSessions] = useState<readonly AiSession[]>([]);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [confirming, setConfirming] = useState<boolean>(false);

  useEffect(() => {
    void (async (): Promise<void> => {
      setSessions(await readAiSessions());
      setLoaded(true);
    })();
  }, []);

  const visible: readonly AiSession[] = filterSessions(sessions, query);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col bg-bg"
      onClick={(e: React.MouseEvent): void => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-sm font-medium text-ink">历史对话</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(): void => {
              if (!confirming) {
                setConfirming(true);
                window.setTimeout((): void => setConfirming(false), 2500);
                return;
              }
              props.onClearAll();
              setSessions([]);
              setConfirming(false);
            }}
            className={`rounded-full px-3 py-1 text-[11px] transition-colors duration-200 ${
              confirming ? 'bg-like text-on-accent' : 'text-like hover:bg-like/10'
            }`}
          >
            {confirming ? '确认清空？' : '清空历史'}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="关闭"
            className="rounded-full px-2 text-lg leading-none text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
          >
            ×
          </button>
        </div>
      </header>

      {/* 搜索框 */}
      <div className="px-4 py-2.5">
        <input
          type="text"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setQuery(e.target.value)}
          placeholder="🔍 搜索标题或对话内容"
          className="w-full rounded-full border border-line bg-elevated px-4 py-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </div>

      {/* 会话列表 */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {!loaded ? (
          <p className="animate-pulse py-10 text-center text-xs text-ink-3">加载中…</p>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-xs text-ink-3">
            {query.trim() === '' ? '还没有历史对话' : '没有匹配的历史对话'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((session: AiSession) => (
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={(): void => props.onOpen(session)}
                  className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors duration-200 ${
                    session.id === props.activeId
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-elevated hover:bg-muted'
                  }`}
                >
                  <span className="block truncate text-xs text-ink">{session.title}</span>
                  <span className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
                    <span>{session.messages.length} 条</span>
                    <span>·</span>
                    <span>{timeLabel(session.updatedAt)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  title="删除该会话"
                  onClick={(e: React.MouseEvent): void => {
                    e.stopPropagation();
                    props.onDelete(session.id);
                    setSessions((prev: readonly AiSession[]): readonly AiSession[] =>
                      prev.filter((s: AiSession): boolean => s.id !== session.id),
                    );
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-xs text-ink-3 opacity-0 transition-opacity duration-200 hover:bg-like/10 hover:text-like group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
