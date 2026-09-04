// browser-extension/src/sidepanel/components/bookmarks/site-nav/SyncToSiteSheet.tsx
// 「同步到站点」弹层：内容多选（文件夹递归树 + 根级散链「未分类」）→ 同步目标
// （🌐 公开导航 / 🔒 私有导航）→ 同步模式（直接 / AI 自动整理 + 进度条，可取消）。
// 分类归属：被勾选文件夹的子树内，每条链接按其**直接父文件夹名**归分类。

import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../../../shared/api/client';
import { isConfigured, readSettings } from '../../../../shared/storage/settings';
import { collectFolders } from '../tools';
import { FolderPicker } from './FolderPicker';
import { collectSyncItems, runSyncToSite } from './sync-to-site';
import type { SyncMode, SyncProgress, SyncOutcome, SyncItem } from './sync-to-site';
import { SheetShell } from '../../moment/InsertSheets';
import type { BookmarkNode, NavVisibility, PluginSettings } from '../../../../shared/types';

interface SyncToSiteSheetProps {
  tree: BookmarkNode[];
  onClose: () => void;
  /** 同步完成后的结果提示（父级 notice 展示） */
  onDone: (message: string) => void;
}

/** 未分类组键（根级散链） */
const UNFILED_KEY: string = 'unfiled';

export function SyncToSiteSheet(props: SyncToSiteSheetProps) {
  const [settings, setSettings] = useState<PluginSettings | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<NavVisibility>('open');
  const [mode, setMode] = useState<SyncMode>('direct');
  const [running, setRunning] = useState<boolean>(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [error, setError] = useState<string>('');
  const cancelledRef = useRef<boolean>(false);

  const topFolders: BookmarkNode[] = props.tree.filter((n: BookmarkNode): boolean => n.kind === 'folder');
  const unfiledLinks: BookmarkNode[] = props.tree.filter((n: BookmarkNode): boolean => n.kind === 'link');
  const hasUnfiled: boolean = unfiledLinks.length > 0;
  const allKeys: string[] = [...topFolders.map((f: BookmarkNode): string => f.id), ...(hasUnfiled ? [UNFILED_KEY] : [])];

  useEffect((): void => {
    void readSettings().then((s: PluginSettings): void => setSettings(s));
  }, []);

  function toggleGroup(key: string): void {
    setPicked((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const allPicked: boolean = allKeys.length > 0 && allKeys.every((k: string): boolean => picked.has(k));

  /**
   * 展开选中集合为同步条目：勾选的文件夹整棵子树收录（内部按直接父文件夹名归分类）；
   * 未勾选的文件夹继续下探（其子级可能被单独勾选）。
   */
  function buildItems(): SyncItem[] {
    const items: SyncItem[] = [];
    const walk = (nodes: readonly BookmarkNode[]): void => {
      for (const node of nodes) {
        if (node.kind !== 'folder') {
          continue;
        }
        if (picked.has(node.id)) {
          for (const f of collectFolders([node])) {
            items.push(...collectSyncItems(f.children, f.title));
          }
        } else {
          walk(node.children);
        }
      }
    };
    walk(topFolders);
    if (picked.has(UNFILED_KEY)) {
      items.push(...collectSyncItems(unfiledLinks, '未分类'));
    }
    return items;
  }

  /** 执行同步（步骤二按钮） */
  async function handleStart(): Promise<void> {
    if (settings === null || !isConfigured(settings)) {
      setError('请先在「设置」中完成站点连接');
      return;
    }
    const items: SyncItem[] = buildItems();
    if (items.length === 0) {
      setError('所选分类中没有可同步的 http(s) 书签');
      return;
    }
    setRunning(true);
    setError('');
    setOutcome(null);
    cancelledRef.current = false;
    try {
      const result: SyncOutcome = await runSyncToSite({
        settings,
        items,
        mode,
        visibility: target,
        onProgress: (p: SyncProgress): void => setProgress(p),
        cancelled: (): boolean => cancelledRef.current,
      });
      setOutcome(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === '已取消') {
        setOutcome({ created: 0, skipped: 0, failed: 0, aiFixed: 0 });
        setError('已取消：本次同步未完成（已上传批次保留在站点）');
      } else if (err instanceof ApiError) {
        setError(err.status === 403
          ? '站点未授权「导航同步写入」接口：请在后台重新生成 Key 并勾选（若插件较旧需升级精品导航插件）'
          : err.message);
      } else {
        setError('同步失败，请稍后重试');
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  /** 完成结果文案 */
  function outcomeText(): string {
    if (outcome === null) {
      return '';
    }
    if (outcome.created === 0 && outcome.failed === 0 && outcome.skipped === 0) {
      return '没有新条目需要同步（所选书签可能都已存在于站点）';
    }
    const dest: string = target === 'private' ? '站点私有导航' : '站点';
    const parts: string[] = [`已同步 ${outcome.created} 条到${dest}`];
    if (outcome.skipped > 0) {
      parts.push(`跳过已存在 ${outcome.skipped} 条`);
    }
    if (outcome.failed > 0) {
      parts.push(`失败 ${outcome.failed} 条`);
    }
    if (outcome.aiFixed > 0) {
      parts.push(`AI 整理 ${outcome.aiFixed} 条`);
    }
    return parts.join('，');
  }

  const percent: number = progress !== null && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <SheetShell title="同步到站点" onClose={props.onClose}>
      {/* 步骤一：递归树多选要同步的文件夹 */}
      {!running && outcome === null && (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-ink-3">勾选要同步到站点「精品导航」的分类（可展开子文件夹，勾选含整棵子树）：</p>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={(): void => setPicked(allPicked ? new Set<string>() : new Set<string>(allKeys))}
              className="size-3.5 accent-[var(--yy-accent)]"
            />
            全选（{allKeys.length} 个分组）
          </label>
          <FolderPicker folders={topFolders} picked={picked} onToggle={toggleGroup} />
          {hasUnfiled && (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink transition-colors hover:bg-muted">
              <input
                type="checkbox"
                checked={picked.has(UNFILED_KEY)}
                onChange={(): void => toggleGroup(UNFILED_KEY)}
                className="size-3.5 accent-[var(--yy-accent)]"
              />
              <span className="min-w-0 flex-1 truncate">未分类（根级散链）</span>
              <span className="shrink-0 text-[10px] text-ink-3">{unfiledLinks.length} 条</span>
            </label>
          )}
          <OptionCards<NavVisibility> label="同步目标" value={target} options={TARGET_OPTIONS}
            onPick={setTarget} disabled={running} />
          <OptionCards<SyncMode> label="" value={mode} options={MODE_OPTIONS}
            onPick={setMode} disabled={running} />
          {error !== '' && <p className="text-[11px] text-red-500">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={picked.size === 0 || (settings !== null && !isConfigured(settings))}
              onClick={(): void => void handleStart()}
              className="rounded-full bg-accent px-5 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              开始同步
            </button>
          </div>
        </div>
      )}

      {/* 步骤二执行中：进度条 */}
      {running && progress !== null && (
        <div className="flex flex-col gap-3 py-2">
          <p className="text-xs text-ink">
            {progress.phase === 'ai' ? 'AI 正在整理站点信息…' : '正在上传到站点…'}
            <span className="ml-1 text-ink-3">{progress.done}/{progress.total}（{percent}%）</span>
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${percent}%` }} />
          </div>
          <p className="truncate text-[11px] text-ink-3">{progress.current}</p>
          <button
            type="button"
            onClick={(): void => { cancelledRef.current = true; }}
            className="self-end rounded-full border border-line px-4 py-1.5 text-xs text-ink-2 transition-colors hover:border-like hover:text-like"
          >
            取消同步
          </button>
        </div>
      )}

      {/* 完成 / 失败结果 */}
      {!running && (outcome !== null || error !== '') && (
        <div className="flex flex-col gap-3 py-1">
          {error !== '' && <p className="text-[11px] text-red-500">{error}</p>}
          {outcome !== null && error === '' && (
            <p className="text-xs text-ink">{outcomeText()}</p>
          )}
          <div className="flex justify-end gap-2">
            {outcome !== null && error === '' && (
              <button
                type="button"
                onClick={(): void => {
                  props.onDone(outcomeText());
                  props.onClose();
                }}
                className="rounded-full bg-accent px-5 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90"
              >
                完成
              </button>
            )}
            {error !== '' && (
              <button
                type="button"
                onClick={(): void => { setOutcome(null); setError(''); }}
                className="rounded-full border border-line px-4 py-1.5 text-xs text-ink-2 transition-colors hover:bg-muted"
              >
                返回重试
              </button>
            )}
          </div>
        </div>
      )}
    </SheetShell>
  );
}

/** 单选卡片组（同步目标 / 同步模式共用渲染） */
function OptionCards<T extends string>(props: {
  /** 可选标题（空串则不渲染标签行） */
  label: string;
  value: T;
  options: { value: T; title: string; desc: string }[];
  onPick: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {props.label !== '' && <p className="text-[11px] text-ink-3">{props.label}</p>}
      <div className="flex gap-2">
        {props.options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={props.disabled}
            onClick={(): void => props.onPick(opt.value)}
            className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
              props.value === opt.value ? 'border-accent bg-accent-soft' : 'border-line hover:border-ink-3'
            }`}
          >
            <p className="text-xs font-medium text-ink">{props.value === opt.value ? '◉' : '○'} {opt.title}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 同步目标 / 同步模式选项（单选卡片数据） */
const TARGET_OPTIONS: { value: NavVisibility; title: string; desc: string }[] = [
  { value: 'open', title: '🌐 公开导航', desc: '同步到站点公开导航，访客可见' },
  { value: 'private', title: '🔒 私有导航', desc: '仅站点私有导航页展示（访问密码在站点设置）' },
];

const MODE_OPTIONS: { value: SyncMode; title: string; desc: string }[] = [
  { value: 'direct', title: '直接同步', desc: '保持现有分类，按本地文件夹结构原样上传（快）' },
  { value: 'ai', title: 'AI 自动整理', desc: '按每个站点内容补全说明、标签与分类（逐条识别，较慢）' },
];
