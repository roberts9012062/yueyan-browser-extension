// browser-extension/src/sidepanel/components/exec/ExecutorCard.tsx
// 执行框通用外壳（桌宠卡片）：标题栏 + 步骤条（执行过程）+ 任务自定义内容区（交互/完成）。
// 三类右键任务（总结发布 / 收藏 / 发说说）共用本外壳，各自实现过程与交互细节。

import type { ReactNode } from 'react';

/** 单个执行步骤的状态（pending=待执行 / running=执行中 / done=完成 / error=失败） */
export type StepState = 'pending' | 'running' | 'done' | 'error';

/** 步骤描述（label 主文案；note 次级说明，如失败原因或进度提示） */
export interface StepInfo {
  label: string;
  state: StepState;
  note: string;
}

interface ExecutorCardProps {
  /** 任务图标（emoji） */
  icon: string;
  /** 任务标题 */
  title: string;
  /** 执行步骤列表（顺序展示） */
  steps: readonly StepInfo[];
  /** 右上角关闭（收起执行框 / 叠加层） */
  onClose: () => void;
  /** 内容区：交互表单 / 完成提示等任务自定义部分 */
  children?: ReactNode;
}

/** 步骤状态 → 前缀符号与配色 */
function stepMark(state: StepState): { mark: string; cls: string } {
  if (state === 'done') {
    return { mark: '✓', cls: 'text-emerald-500' };
  }
  if (state === 'error') {
    return { mark: '✗', cls: 'text-red-500' };
  }
  if (state === 'running') {
    return { mark: '◐', cls: 'text-accent animate-spin' };
  }
  return { mark: '○', cls: 'text-ink-3' };
}

export function ExecutorCard(props: ExecutorCardProps): ReactNode {
  return (
    <div className="flex h-full w-full max-h-full flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-lg">
      {/* 标题栏 */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="text-base leading-none">{props.icon}</span>
        <h3 className="flex-1 truncate text-xs font-medium text-ink">{props.title}</h3>
        <button
          type="button"
          aria-label="关闭"
          onClick={props.onClose}
          className="rounded-full px-1.5 text-lg leading-none text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
        >
          ×
        </button>
      </header>

      {/* 步骤条（执行过程） */}
      <ul className="shrink-0 space-y-1 px-3 py-2">
        {props.steps.map((step: StepInfo): ReactNode => {
          const mark = stepMark(step.state);
          return (
            <li key={step.label} className="flex items-center gap-2 text-[11px] leading-5">
              <span className={`inline-block w-3.5 text-center font-bold ${mark.cls}`}>{mark.mark}</span>
              <span className={step.state === 'pending' ? 'text-ink-3' : 'text-ink-2'}>{step.label}</span>
              {step.note !== '' && <span className="flex-1 truncate text-right text-ink-3">{step.note}</span>}
            </li>
          );
        })}
      </ul>

      {/* 内容区（内部滚动） */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">{props.children}</div>
    </div>
  );
}

/** 任务表单输入统一样式（三个任务组件共用，替代各自重复声明） */
export const EXEC_INPUT_CLS: string =
  'w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';

/** 通用完成态（✓ 文案 + 可选查看链接 / 警示 + 完成按钮收起执行框） */
export function CompletionBox(props: {
  text: string;
  linkHref: string;
  linkLabel: string;
  warn: string;
  onDone: () => void;
}): ReactNode {
  return (
    <div className="space-y-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-[11px] text-ink-2">
      <p>
        <span className="mr-1 text-emerald-500">✓</span>
        {props.text}
      </p>
      {props.warn !== '' && <p className="text-amber-600 dark:text-amber-400">{props.warn}</p>}
      <div className="flex items-center gap-2">
        <a
          href={props.linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line px-3 py-1.5 text-ink-2 transition-colors duration-200 hover:bg-muted"
        >
          {props.linkLabel}
        </a>
        <span className="flex-1" />
        <button
          type="button"
          onClick={props.onDone}
          className="rounded-full bg-accent px-3.5 py-1.5 font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
        >
          完成
        </button>
      </div>
    </div>
  );
}

/** 未连接站点引导（三类任务的公共前置态：右键任务均依赖站点 AI/发布能力） */
export function NotConnectedGuide(): ReactNode {
  return (
    <div className="space-y-2 rounded-lg border border-line bg-elevated px-3 py-3 text-[11px] text-ink-2">
      <p>该任务需要先连接月言站点（站点地址 + API Key）。</p>
      <p className="text-ink-3">点击悬浮球或工具栏图标打开完整面板，在「站点连接」中完成配置后再试。</p>
    </div>
  );
}
