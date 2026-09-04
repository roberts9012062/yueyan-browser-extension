// browser-extension/src/sidepanel/components/exec/BookmarkExec.tsx
// 右键任务「收藏本页」执行器（AI 自动分类 / 手动指定文件夹两种模式）：
//   【过程】读取书签树（IndexedDB 主存 ⇄ storage 兜底）抽取文件夹路径；
//           AI 模式另经 ai.chat 流式聚合推荐目标文件夹与标题（JSON 宽松解析）；
//   【交互】文件夹下拉（根级 / 既有路径 / 新建顶层文件夹）+ 标题编辑 + 已收藏提示；
//   【完成】写回书签树（saveBookmarkStore 双写，与球收藏共用 savedAt 调和机制）。
// 树操作纯函数在 exec/bookmark-tree.ts（保持本文件行数受控）。

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../../../../shared/api/client';
import { listAiModels, sendAiChatStream } from '../../../../shared/api/endpoints';
import type { BookmarkExecTask } from '../../../../shared/messages/types';
import { readBookmarkStore, saveBookmarkStore } from '../../../../shared/storage/bookmark-store';
import { isConfigured } from '../../../../shared/storage/settings';
import type { BookmarkNode, PluginSettings } from '../../../../shared/types';
import { newFolderNode, newLinkNode } from '../../bookmarks/tools';
import { CompletionBox, ExecutorCard, EXEC_INPUT_CLS } from '../ExecutorCard';
import type { StepInfo, StepState } from '../ExecutorCard';
import { findUrlPath, insertByPath, listFolderPaths } from '../bookmark-tree';

interface BookmarkExecProps {
  settings: PluginSettings;
  task: BookmarkExecTask;
  onDone: () => void;
}

/** 执行阶段（load=读树 / ai=AI 推荐 / confirm=确认 / saving=保存 / done=完成） */
type Phase = 'load' | 'ai' | 'confirm' | 'saving' | 'done';

/** AI 推荐结果（JSON 宽松解析所得） */
interface AiSuggest {
  folder: string;
  newFolder: string;
  title: string;
}

/** 「新建顶层文件夹」在下拉中的哨兵值 */
const OPT_NEW: string = '__new__';

/** 从 AI 输出宽松提取 JSON（剥围栏 → 整体解析 → 逐字段正则兜底） */
function parseSuggest(raw: string): AiSuggest | null {
  const fenced: RegExpMatchArray | null = raw.match(/\{[\s\S]*\}/);
  if (fenced !== null) {
    try {
      const obj = JSON.parse(fenced[0]) as Record<string, unknown>;
      return {
        folder: typeof obj.folder === 'string' ? obj.folder : '',
        newFolder: typeof obj.new_folder === 'string' ? obj.new_folder : '',
        title: typeof obj.title === 'string' ? obj.title.slice(0, 30) : '',
      };
    } catch {
      // 落入兜底
    }
  }
  const pick = (key: string): string => raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\n]{1,40})"`))?.[1] ?? '';
  const folder: string = pick('folder');
  const newFolder: string = pick('new_folder');
  const title: string = pick('title');
  if (folder === '' && newFolder === '' && title === '') {
    return null;
  }
  return { folder, newFolder, title: title.slice(0, 30) };
}

export function BookmarkExec(props: BookmarkExecProps): ReactNode {
  const { settings, task } = props;
  const [phase, setPhase] = useState<Phase>('load');
  const [folders, setFolders] = useState<string[]>([]);
  const [suggest, setSuggest] = useState<AiSuggest | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [title, setTitle] = useState<string>(task.pageTitle);
  const [existedPath, setExistedPath] = useState<string | null>(null);
  const [failNote, setFailNote] = useState<string>('');
  const [savedPath, setSavedPath] = useState<string>('');

  /** 读树 → 路径清单 + 已收藏检测；AI 模式且已连接时接着跑推荐 */
  async function loadAndSuggest(): Promise<void> {
    setPhase('load');
    setFailNote('');
    try {
      const tree = await readBookmarkStore();
      const paths: string[] = listFolderPaths(tree.roots);
      setFolders(paths);
      setExistedPath(findUrlPath(tree.roots, task.pageUrl));
      if (task.mode === 'ai' && isConfigured(settings)) {
        await runSuggest(paths);
        return;
      }
      if (task.mode === 'ai') {
        setFailNote('未连接站点：AI 分类不可用，请手动选择文件夹');
      }
      setPhase('confirm');
    } catch {
      setFailNote('书签树读取失败，请重试');
      setPhase('confirm');
    }
  }

  /** AI 推荐（流式聚合防 think 截断；失败不阻塞手动选择） */
  async function runSuggest(paths: readonly string[]): Promise<void> {
    setPhase('ai');
    try {
      const providers = await listAiModels(settings.apiBaseUrl, settings.apiKey);
      const model: string = providers.flatMap((p) => p.models)[0] ?? '';
      if (model === '') {
        throw new ApiError('站点未配置可用 AI 模型', 0);
      }
      const listing: string = paths.length > 0 ? paths.join('\n') : '（还没有任何文件夹）';
      let aggregated: string = '';
      await sendAiChatStream(
        settings.apiBaseUrl,
        settings.apiKey,
        model,
        [
          { role: 'system', content: '你是书签管理助手。只输出 JSON，不要任何其他文字。' },
          {
            role: 'user',
            content:
              '从书签夹路径列表中为网页选出最合适的收藏位置；都不合适时可建议新建顶层文件夹。\n'
              + `书签夹路径（「/」分隔层级）：\n${listing}\n\n`
              + `网页标题：${task.pageTitle}\n网址：${task.pageUrl}\n\n`
              + '输出严格 JSON：{"folder":"列表中的某个路径，都不合适给空串","new_folder":"建议新建的顶层文件夹名（仅 folder 为空时可非空）","title":"15字内书签标题"}',
          },
        ],
        1200,
        false,
        { onText: (delta: string): void => { aggregated += delta; } },
      );
      const parsed: AiSuggest | null = parseSuggest(aggregated);
      if (parsed !== null) {
        setSuggest(parsed);
        if (parsed.title !== '') {
          setTitle(parsed.title);
        }
        if (parsed.newFolder !== '') {
          setSelected(OPT_NEW);
          setNewName(parsed.newFolder);
        } else if (parsed.folder !== '' && paths.indexOf(parsed.folder) >= 0) {
          setSelected(parsed.folder);
        }
      } else {
        setFailNote('AI 推荐解析失败，已回退手动选择');
      }
    } catch (err: unknown) {
      setFailNote(`${err instanceof ApiError ? err.message : 'AI 推荐失败'}，已回退手动选择`);
    }
    setPhase('confirm');
  }

  useEffect((): void => {
    void loadAndSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 确认收藏：按选择定位目标文件夹（不可变插入），新建文件夹为顶层节点 */
  async function save(): Promise<void> {
    setPhase('saving');
    setFailNote('');
    try {
      const tree = await readBookmarkStore();
      const node: BookmarkNode = newLinkNode(title.trim() !== '' ? title.trim() : task.pageUrl, task.pageUrl);
      let finalPath: string = '根级';
      let roots: BookmarkNode[] = tree.roots;
      if (selected === OPT_NEW) {
        const name: string = newName.trim();
        if (name === '') {
          setFailNote('请填写新文件夹名称');
          setPhase('confirm');
          return;
        }
        const folderNode: BookmarkNode = { ...newFolderNode(name), children: [node] };
        roots = [...roots, folderNode];
        finalPath = name;
      } else {
        const res = insertByPath(tree.roots, selected === '' ? [] : selected.split('/'), node);
        roots = res.nodes;
        finalPath = res.ok ? (selected === '' ? '根级' : selected) : '根级';
      }
      await saveBookmarkStore({ roots });
      setSavedPath(finalPath);
      setPhase('done');
    } catch {
      setFailNote('收藏写入失败，请重试');
      setPhase('confirm');
    }
  }

  // 步骤条（AI 模式三步 / 手动模式两步）
  const aiStepState: StepState = phase === 'ai' ? 'running' : suggest !== null ? 'done' : phase === 'load' ? 'pending' : 'done';
  const steps: readonly StepInfo[] =
    task.mode === 'ai'
      ? [
        { label: '读取书签夹', state: phase === 'load' ? 'running' : 'done', note: folders.length > 0 ? `${folders.length} 个文件夹` : '' },
        { label: 'AI 分类推荐', state: aiStepState, note: phase === 'ai' ? '分析中…' : '' },
        { label: '确认收藏', state: phase === 'done' ? 'done' : phase === 'saving' ? 'running' : 'pending', note: '' },
      ]
      : [
        { label: '读取书签夹', state: phase === 'load' ? 'running' : 'done', note: folders.length > 0 ? `${folders.length} 个文件夹` : '' },
        { label: '确认收藏', state: phase === 'done' ? 'done' : phase === 'saving' ? 'running' : 'pending', note: '' },
      ];

  return (
    <ExecutorCard
      icon={task.mode === 'ai' ? '⭐' : '📁'}
      title={task.mode === 'ai' ? '收藏本页（AI 自动分类）' : '收藏本页到指定文件夹'}
      steps={steps}
      onClose={props.onDone}
    >
      {/* 过程/回退提示 */}
      {phase === 'ai' && (
        <p className="animate-pulse rounded-lg border border-line bg-elevated px-2.5 py-2 text-[11px] text-ink-2">
          AI 正在为「{task.pageTitle}」挑书签夹…
        </p>
      )}
      {failNote !== '' && (
        <div className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-500">{failNote}</div>
      )}
      {existedPath !== null && phase !== 'done' && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          该页已在书签中（位于「{existedPath}」），再次收藏会新增一条。
        </p>
      )}

      {/* 确认（交互） */}
      {(phase === 'confirm' || phase === 'saving') && (
        <div className="space-y-2">
          <select
            value={selected}
            onChange={(e): void => setSelected(e.target.value)}
            className={EXEC_INPUT_CLS}
            aria-label="目标文件夹"
          >
            <option value="">根级（未分类）</option>
            {folders.map((path: string): ReactNode => (
              <option key={path} value={path}>{path}</option>
            ))}
            <option value={OPT_NEW}>✨ 新建顶层文件夹…</option>
          </select>
          {selected === OPT_NEW && (
            <input type="text" value={newName} onChange={(e): void => setNewName(e.target.value)} placeholder="新文件夹名称" className={EXEC_INPUT_CLS} />
          )}
          <input type="text" value={title} onChange={(e): void => setTitle(e.target.value)} placeholder="书签标题" className={EXEC_INPUT_CLS} />
          <div className="flex justify-end gap-2 pt-0.5">
            <button type="button" onClick={props.onDone} className="rounded-full border border-line px-3 py-1.5 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted">
              取消
            </button>
            <button
              type="button"
              disabled={phase === 'saving'}
              onClick={(): void => void save()}
              className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-medium text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:opacity-40"
            >
              {phase === 'saving' ? '保存中…' : '收藏'}
            </button>
          </div>
        </div>
      )}

      {/* 完成提示 */}
      {phase === 'done' && (
        <CompletionBox
          text={`已收藏到「${savedPath}」：《${title.trim() !== '' ? title.trim() : task.pageUrl}》`}
          linkHref={task.pageUrl}
          linkLabel="打开原网页"
          warn=""
          onDone={props.onDone}
        />
      )}
    </ExecutorCard>
  );
}
