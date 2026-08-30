// browser-extension/src/sidepanel/components/ai/AiComposer.tsx
// AI 助手输入区：上下文来源条 + 工具行 + 输入框（内嵌底栏：提示词按钮与发送钮在框内）。
// 在线状态展示于顶栏用户名旁（HeaderBar），不在本组件。
import { useState } from 'react';
import type { ReactNode } from 'react';

/** 上下文来源（网页 / 文件），用于来源条与「提问 / 总结」动作 */
export interface ComposerContext {
  label: string;
  kind: 'page' | 'file';
}

interface AiComposerProps {
  /** 上下文来源（null 隐藏来源条） */
  context: ComposerContext | null;
  onAskContext: () => void;
  onSummarizeContext: () => void;

  /** 模型选择 */
  models: readonly string[];
  model: string;
  onModelChange: (model: string) => void;

  /** 工具行动作 */
  onAttachFile: () => void;
  onSummarizePage: () => void;
  onOpenHistory: () => void;
  onClearChat: () => void;

  /** 提示词：激活中的角色（null=未启用）、面板数据与回调 */
  activePrompt: { name: string } | null;
  onClearPrompt: () => void;
  promptSlot: React.ReactNode;

  /** 联网搜索开关：灰=关，彩=开（开启后发送的消息先经站点 SearXNG 检索再作答） */
  webSearchOn: boolean;
  onToggleWebSearch: () => void;

  /** 输入框 */
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
}

/** 圆角小图标按钮 */
const TOOL_BTN: string =
  'flex size-7 items-center justify-center rounded-full text-sm text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink';

/** 工具行菜单容器（向上弹出） */
function Popover({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-full left-0 z-40 mb-2 w-56 rounded-xl border border-line bg-elevated p-1.5 shadow-[var(--yy-shadow-card-hover)]">
      <ul className="flex max-h-56 flex-col overflow-y-auto thin-scroll">{children}</ul>
    </div>
  );
}

export function AiComposer(props: AiComposerProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState<boolean>(false);

  const ctx = props.context;

  return (
    <div className="border-t border-line">
      {/* 上下文来源条：来源胶囊 + 提问 / 总结 动作 */}
      {ctx !== null && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5">
            <span aria-hidden>{ctx.kind === 'page' ? '🌐' : '📄'}</span>
            <span className="truncate text-[11px] text-ink-2" title={ctx.label}>{ctx.label}</span>
          </span>
          <button
            type="button"
            onClick={props.onAskContext}
            className="rounded-full px-2.5 py-1 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
          >
            提问
          </button>
          <span className="text-ink-3">|</span>
          <button
            type="button"
            onClick={props.onSummarizeContext}
            className="rounded-full px-2.5 py-1 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
          >
            总结
          </button>
        </div>
      )}

      {/* 工具行：模型胶囊 | 附件 | 清空 */}
      <div className="flex items-center gap-1 px-3 pt-2">
        <div className="relative">
          {modelMenuOpen && (
            <Popover>
              {props.models.length === 0 && (
                <li className="px-3 py-2 text-xs text-ink-3">站点未配置可用模型</li>
              )}
              {props.models.map((name: string) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={(): void => {
                      props.onModelChange(name);
                      setModelMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors duration-200 hover:bg-muted ${
                      name === props.model ? 'text-glow' : 'text-ink'
                    }`}
                  >
                    <span aria-hidden>🤖</span>
                    <span className="truncate">{name}</span>
                  </button>
                </li>
              ))}
            </Popover>
          )}
          <button
            type="button"
            onClick={(): void => setModelMenuOpen(!modelMenuOpen)}
            title="选择模型"
            className="flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[11px] text-ink transition-colors duration-200 hover:bg-accent-soft"
          >
            <span className="max-w-28 truncate">{props.model !== '' ? props.model : '选择模型'}</span>
            <span aria-hidden className="text-[9px]">▼</span>
          </button>
        </div>
        <span className="mx-auto" />
        <button type="button" onClick={props.onAttachFile} title="文件解析（文本类文件）" className={TOOL_BTN}>
          📎
        </button>
        <button type="button" onClick={props.onSummarizePage} title="总结当前打开的网页" className={TOOL_BTN}>
          🌍
        </button>
        <button type="button" onClick={props.onOpenHistory} title="历史对话" className={TOOL_BTN}>
          🕘
        </button>
        <button type="button" onClick={props.onClearChat} title="清空当前对话（开启新会话）" className={TOOL_BTN}>
          🧹
        </button>
      </div>

      {/* 激活提示词徽标 */}
      {props.activePrompt !== null && (
        <div className="mx-3 mt-2 flex items-center gap-1.5">
          <span className="flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[11px] text-glow">
            <span aria-hidden>📝</span>
            <span className="truncate">{props.activePrompt.name}</span>
            <button
              type="button"
              onClick={props.onClearPrompt}
              title="停用该提示词"
              className="rounded-full px-1 leading-none transition-colors duration-200 hover:bg-accent/20"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {/* 输入框（提示词与发送按钮内嵌框内底栏） */}
      <div className="mx-3 my-2 overflow-hidden rounded-xl border border-line bg-elevated focus-within:border-accent">
        <textarea
          rows={3}
          value={props.input}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void => props.onInputChange(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              props.onSend();
            }
          }}
          placeholder="请输入内容（Shift+Enter 换行）"
          className="thin-scroll block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-xs leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <div className="flex items-center px-2 pb-2 pt-0.5">
          <div className="relative shrink-0">
            {props.promptSlot}
            <button
              type="button"
              title="选择提示词"
              className="flex size-7 items-center justify-center rounded-full text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M9.5 2.5 5 13.5" />
                <path d="M3 14.5h10" />
              </svg>
            </button>
          </div>
          {/* 联网搜索开关：关=灰色地球，开=彩色点亮 */}
          <button
            type="button"
            onClick={props.onToggleWebSearch}
            title={props.webSearchOn ? '联网搜索已开启（发送时先检索再作答）' : '开启联网搜索'}
            aria-pressed={props.webSearchOn}
            className={`ml-0.5 flex size-7 items-center justify-center rounded-full text-sm transition-all duration-200 ${props.webSearchOn ? 'bg-accent-soft text-glow' : 'text-ink-3 hover:bg-muted hover:text-ink-2'}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <circle cx="8" cy="8" r="6.2" />
              <path d="M1.8 8h12.4" />
              <path d="M8 1.8c-2.4 2.2-2.4 10.2 0 12.4 2.4-2.2 2.4-10.2 0-12.4Z" />
            </svg>
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={props.onSend}
            disabled={props.input.trim() === '' || props.sending || props.model === ''}
            aria-label="发送"
            title="发送（Enter）"
            className="flex size-7 items-center justify-center rounded-full bg-ink text-bg transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {props.sending ? '…' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}
