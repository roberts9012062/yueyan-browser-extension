// browser-extension/src/sidepanel/components/exec/tasks/ShotExec.tsx
// 右键任务「🔍 截图本页，AI 分析」执行器：
//   直通态（background 已在右键手势内完成蒙版框选与全屏截图，任务携带数据）：
//     挂载即裁剪压缩 → ai.assist(recognize) → 结果展示；
//   兜底态（授权被拒等导致无数据）：执行框内「开始框选」手动走完整流程
//     （与 AI 助手「📸 网页截图」共用 screenshot-tools 工具）。

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../../../../shared/api/client';
import { aiAssist } from '../../../../shared/api/endpoints';
import type { ShotExecTask } from '../../../../shared/messages/types';
import { ensureWideHostPermission } from '../../../../shared/permissions';
import { isConfigured } from '../../../../shared/storage/settings';
import type { PluginSettings } from '../../../../shared/types';
import { compressScreenshot, cropScreenshot, pickRegion } from '../../ai/screenshot-tools';
import type { PickRect } from '../../ai/screenshot-tools';
import { MarkdownMessage } from '../../ai/MarkdownMessage';
import { ExecutorCard, NotConnectedGuide } from '../ExecutorCard';
import type { StepInfo, StepState } from '../ExecutorCard';

interface ShotExecProps {
  settings: PluginSettings;
  task: ShotExecTask;
  onDone: () => void;
}

/** 任务执行阶段（noconn=未连接 / ready=待框选 / picking=取景器已注入 / analyzing=识图中 / done=完成） */
type Phase = 'noconn' | 'ready' | 'picking' | 'analyzing' | 'done';

export function ShotExec(props: ShotExecProps): ReactNode {
  const { settings, task } = props;
  const connected: boolean = isConfigured(settings);
  const [phase, setPhase] = useState<Phase>(
    !connected ? 'noconn'
    : task.imageDataUrl !== '' && task.rect !== null ? 'analyzing'
    : 'ready',
  );
  const [failNote, setFailNote] = useState<string>('');
  const [dataUrl, setDataUrl] = useState<string>('');
  const [answer, setAnswer] = useState<string>('');
  /** 复制成功反馈（2 秒自恢复） */
  const [copied, setCopied] = useState<boolean>(false);

  /** 复制识别文字到剪贴板（markdown 源文本；clipboard API 失败回退 execCommand） */
  async function copyAnswer(): Promise<void> {
    let ok: boolean = false;
    try {
      await navigator.clipboard.writeText(answer);
      ok = true;
    } catch {
      // iframe 焦点受限等场景兜底：临时 textarea 选中复制
      const ta: HTMLTextAreaElement = document.createElement('textarea');
      ta.value = answer;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    }
    if (ok) {
      setCopied(true);
      window.setTimeout((): void => setCopied(false), 2000);
    }
  }

  // 直通态：background 已携截图与选区投递，挂载即分析（无数据则停在「开始框选」兜底）
  useEffect((): void => {
    if (connected && task.imageDataUrl !== '' && task.rect !== null) {
      void analyze(task.rect, task.imageDataUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 兜底路径：授权 → 注入取景器 → 框选后在扩展页截全屏 → 分析 */
  async function startPick(): Promise<void> {
    setFailNote('');
    setPhase('picking');
    if (!(await ensureWideHostPermission())) {
      setPhase('ready');
      setFailNote('需要「读取网站信息」授权：请在扩展详情中开启网站访问权限后重试');
      return;
    }
    try {
      const rect: PickRect | null = await pickRegion(task.tabId);
      if (rect === null) {
        // 用户取消（Esc / 误触小框）→ 回到待框选态，可重新开始
        setPhase('ready');
        setFailNote('已取消框选，可重新开始');
        return;
      }
      const raw: string = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, {
        format: 'jpeg',
        quality: 90,
      });
      void analyze(rect, raw);
    } catch {
      setPhase('ready');
      setFailNote('取景器注入失败（页面可能限制注入），请重试');
    }
  }

  /** 截图 → 裁剪压缩 → AI 识图（raw 为全屏截图，rect 为用户选区） */
  async function analyze(rect: PickRect, raw: string): Promise<void> {
    setPhase('analyzing');
    try {
      const shot: string = await compressScreenshot(await cropScreenshot(raw, rect));
      setDataUrl(shot);
      const result = await aiAssist(settings.apiBaseUrl, settings.apiKey, 'recognize', '', shot);
      setAnswer(result.text ?? '（未返回识别结果）');
      setPhase('done');
    } catch (err: unknown) {
      setPhase('ready');
      setFailNote(err instanceof ApiError ? err.message : '截图分析失败，请稍后重试');
    }
  }

  // 步骤条状态纯推导（三步：框选区域 / 截图与压缩 / AI 分析；直通态前两步即时完成）
  const direct: boolean = task.imageDataUrl !== '' && task.rect !== null;
  const s1: StepState =
    phase === 'done' || dataUrl !== '' || direct ? 'done'
    : phase === 'picking' ? 'running'
    : phase === 'ready' || phase === 'noconn' ? 'pending'
    : 'done';
  const s2: StepState =
    dataUrl !== '' || direct ? 'done'
    : phase === 'analyzing' ? 'running'
    : 'pending';
  const s3: StepState =
    phase === 'done' ? 'done' : phase === 'analyzing' ? 'running' : 'pending';
  const steps: readonly StepInfo[] = [
    { label: '框选分析区域', state: s1, note: phase === 'picking' ? '请在页面上拖拽框选…' : direct ? '已框选' : '' },
    { label: '截图与压缩', state: s2, note: '' },
    { label: 'AI 识图分析', state: s3, note: phase === 'analyzing' ? '识别中…' : '' },
  ];

  return (
    <ExecutorCard icon="🔍" title="截图本页，AI 分析" steps={steps} onClose={props.onDone}>
      {phase === 'noconn' && <NotConnectedGuide />}

      {failNote !== '' && (
        <p className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-500">{failNote}</p>
      )}

      {/* 待框选 / 已取消：入口按钮（用户手势内完成授权申请） */}
      {phase === 'ready' && (
        <button
          type="button"
          onClick={(): void => void startPick()}
          className="w-full rounded-full bg-accent px-3.5 py-2 text-[11px] font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
        >
          开始框选（在页面上拖拽选择要分析的区域）
        </button>
      )}

      {/* 框选中提示 */}
      {phase === 'picking' && (
        <p className="animate-pulse text-[11px] text-ink-2">请在页面上拖拽框选，按 Esc 取消…</p>
      )}

      {/* 分析中：截图预览 */}
      {phase === 'analyzing' && dataUrl !== '' && (
        <div className="space-y-2">
          <img src={dataUrl} alt="待分析截图" className="max-h-36 w-full rounded-lg border border-line object-contain" />
          <p className="animate-pulse text-[11px] text-ink-3">AI 正在识别图片内容…</p>
        </div>
      )}

      {/* 完成态：截图 + 分析结果（Markdown 渲染，与 AI 助手消息同款） */}
      {phase === 'done' && (
        <div className="space-y-2">
          <img src={dataUrl} alt="已分析截图" className="max-h-32 w-full rounded-lg border border-line object-contain" />
          <div className="thin-scroll max-h-40 overflow-y-auto rounded-lg border border-line bg-elevated px-2.5 py-2 text-[11px] leading-5 text-ink-2">
            <MarkdownMessage content={answer} />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={(): void => void startPick()}
              className="rounded-full border border-line px-3 py-1.5 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted"
            >
              重新框选
            </button>
            <button
              type="button"
              onClick={(): void => void copyAnswer()}
              className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors duration-200 ${
                copied ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400' : 'border-line text-ink-2 hover:bg-muted'
              }`}
            >
              {copied ? '已复制 ✓' : '复制文字'}
            </button>
            <button
              type="button"
              onClick={props.onDone}
              className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
            >
              完成
            </button>
          </div>
        </div>
      )}
    </ExecutorCard>
  );
}
