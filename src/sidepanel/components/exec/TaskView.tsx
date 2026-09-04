// browser-extension/src/sidepanel/components/exec/TaskView.tsx
// 任务分发：按 ExecTask.kind 渲染对应执行器组件（执行框页与面板叠加层共用）。

import type { ReactNode } from 'react';

import type { ExecTask } from '../../../shared/messages/types';
import type { PluginSettings } from '../../../shared/types';
import { SummaryExec } from './tasks/SummaryExec';
import { BookmarkExec } from './tasks/BookmarkExec';
import { MomentExec } from './tasks/MomentExec';
import { ShotExec } from './tasks/ShotExec';

interface TaskViewProps {
  settings: PluginSettings;
  task: ExecTask;
  /** 任务完成/用户关闭：执行框页收起 iframe，叠加层卸载自身 */
  onDone: () => void;
}

export function TaskView(props: TaskViewProps): ReactNode {
  const { task } = props;
  if (task.kind === 'summary') {
    return <SummaryExec settings={props.settings} task={task} onDone={props.onDone} />;
  }
  if (task.kind === 'bookmark') {
    return <BookmarkExec settings={props.settings} task={task} onDone={props.onDone} />;
  }
  if (task.kind === 'moment') {
    return <MomentExec settings={props.settings} task={task} onDone={props.onDone} />;
  }
  return <ShotExec settings={props.settings} task={task} onDone={props.onDone} />;
}
