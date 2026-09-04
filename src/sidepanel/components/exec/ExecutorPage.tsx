// browser-extension/src/sidepanel/components/exec/ExecutorPage.tsx
// 执行框页（?mode=exec&nonce=…，悬浮球旁 iframe 的独占视图）：
// 认领 storage 中 target=ball 的任务并渲染对应执行器；完成/关闭时通知悬浮球收起执行框。

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { MSG } from '../../../shared/messages/types';
import type { ExecTask } from '../../../shared/messages/types';
import { claimBallExecTask } from '../../../shared/storage/exec-task';
import { readSettings } from '../../../shared/storage/settings';
import type { PluginSettings } from '../../../shared/types';
import { TaskView } from './TaskView';

/** 页面状态（loading=认领中 / ready=执行 / miss=任务缺失或已被处理） */
type PageState =
  | { phase: 'loading' }
  | { phase: 'ready'; settings: PluginSettings; task: ExecTask }
  | { phase: 'miss' };

/** 通知悬浮球收起执行框（球失联时静默；面板兜底形态无此消息接收方，同样静默） */
function notifyClose(): void {
  void chrome.runtime.sendMessage({ type: MSG.execClose }).catch((): void => undefined);
}

export function ExecutorPage(): ReactNode {
  const [state, setState] = useState<PageState>({ phase: 'loading' });

  useEffect((): void => {
    void (async (): Promise<void> => {
      const nonce: string = new URLSearchParams(window.location.search).get('nonce') ?? '';
      if (nonce === '') {
        setState({ phase: 'miss' });
        return;
      }
      const [settings, task] = await Promise.all([readSettings(), claimBallExecTask(nonce)]);
      if (task === null) {
        setState({ phase: 'miss' });
        return;
      }
      setState({ phase: 'ready', settings, task });
    })();
  }, []);

  return (
    <div className="h-dvh w-full p-2">
      {state.phase === 'loading' && (
        <p className="animate-pulse p-6 text-center text-xs text-ink-3">准备执行…</p>
      )}
      {state.phase === 'ready' && (
        <TaskView settings={state.settings} task={state.task} onDone={notifyClose} />
      )}
      {state.phase === 'miss' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-line bg-bg px-4 text-center">
          <p className="text-xs text-ink-2">任务已过期或已被处理</p>
          <button
            type="button"
            onClick={notifyClose}
            className="rounded-full border border-line px-3.5 py-1.5 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
