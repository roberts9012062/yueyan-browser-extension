// browser-extension/src/sidepanel/components/exec/ExecutorOverlay.tsx
// 面板叠加层执行器（悬浮球不可用时的兜底）：面板任意形态（原生侧栏/页内停靠/悬浮窗）
// 挂载本组件，经「挂载检查 + yy-exec-run 广播」双通道领取 target=panel 的右键任务，
// 以模态卡片在面板内执行（与球旁执行框同一套执行器组件）。

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { MSG } from '../../../shared/messages/types';
import type { ExecTask } from '../../../shared/messages/types';
import { claimPanelExecTask } from '../../../shared/storage/exec-task';
import type { PluginSettings } from '../../../shared/types';
import { TaskView } from './TaskView';

interface ExecutorOverlayProps {
  settings: PluginSettings;
}

export function ExecutorOverlay(props: ExecutorOverlayProps): ReactNode | null {
  const [task, setTask] = useState<ExecTask | null>(null);
  /** 已认领过的 nonce（防广播重复触发） */
  const claimedRef = useRef<Set<string>>(new Set());

  /** 领取任务（两阶段 owner 认领；成功且未重复才展示） */
  const tryClaim = (broadcastNonce: string): void => {
    void (async (): Promise<void> => {
      const claimed: ExecTask | null = await claimPanelExecTask(broadcastNonce);
      if (claimed === null || claimedRef.current.has(claimed.nonce)) {
        return;
      }
      claimedRef.current.add(claimed.nonce);
      setTask(claimed);
    })();
  };

  useEffect((): (() => void) => {
    // 通道①：挂载检查（background 先写 storage 再开面板的场景，面板加载完成时补领）
    tryClaim('');
    // 通道②：运行时广播（面板早已打开的场景，任务到达立即领取）
    const listener = (msg: unknown): void => {
      const payload = msg as Record<string, unknown> | null;
      if (typeof payload !== 'object' || payload === null || payload.type !== MSG.execRun) {
        return;
      }
      const nonce: unknown = payload.nonce;
      tryClaim(typeof nonce === 'string' ? nonce : '');
    };
    chrome.runtime.onMessage.addListener(listener);
    return (): void => {
      chrome.runtime.onMessage.removeListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (task === null) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="h-[520px] w-[340px] max-h-full">
        {/* key=nonce：连续第二个任务到来时强制重挂载（草稿增量等挂载期逻辑需对新任务重跑） */}
        <TaskView key={task.nonce} settings={props.settings} task={task} onDone={(): void => setTask(null)} />
      </div>
    </div>
  );
}
