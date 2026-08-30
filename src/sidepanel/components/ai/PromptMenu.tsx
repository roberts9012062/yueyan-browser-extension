// browser-extension/src/sidepanel/components/ai/PromptMenu.tsx
// 提示词选择面板（点击输入区左下角「提示词」按钮向上弹出）：
// 预置提示词清单 + 用户自定义（新增/删除），点选即作为当前角色设定。
import { useState } from 'react';
import { PRESET_PROMPTS } from './presets';
import type { PromptPreset } from './presets';

/** 自定义提示词 */
export interface PromptCustom {
  id: string;
  name: string;
  content: string;
}

/** 当前激活提示词（名称 + 内容） */
export interface ActivePrompt {
  name: string;
  content: string;
}

interface PromptMenuProps {
  /** 激活中的提示词名（null=未启用角色） */
  activeName: string | null;
  customs: readonly PromptCustom[];
  onPick: (prompt: ActivePrompt) => void;
  onAddCustom: (name: string, content: string) => void;
  onDeleteCustom: (id: string) => void;
  onClose: () => void;
}

/** 新增表单（内嵌切换） */
function AddForm(props: { onAdd: (name: string, content: string) => void; onCancel: () => void }) {
  const [name, setName] = useState<string>('');
  const [content, setContent] = useState<string>('');

  const canSave: boolean = name.trim() !== '' && content.trim() !== '';

  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <input
        type="text"
        autoFocus
        placeholder="提示词名称"
        value={name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setName(e.target.value)}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <textarea
        rows={3}
        placeholder="提示词内容（角色设定 / 任务要求）"
        value={content}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void => setContent(e.target.value)}
        className="thin-scroll w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={props.onCancel}
          className="flex-1 rounded-full border border-line py-1.5 text-xs text-ink-2 transition-colors duration-200 hover:bg-muted"
        >
          取消
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={(): void => {
            props.onAdd(name.trim(), content.trim());
            props.onCancel();
          }}
          className="flex-1 rounded-full bg-accent py-1.5 text-xs font-medium text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </div>
  );
}

export function PromptMenu(props: PromptMenuProps) {
  const [adding, setAdding] = useState<boolean>(false);

  const renderRow = (icon: string, name: string, content: string, customId: string | null): React.ReactNode => {
    const active: boolean = props.activeName === name;
    return (
      <li key={customId ?? `preset-${name}`} className="relative">
        <button
          type="button"
          onClick={(): void => {
            props.onPick({ name, content });
            props.onClose();
          }}
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors duration-200 hover:bg-muted ${
            active ? 'text-glow' : 'text-ink'
          }`}
        >
          <span aria-hidden className="text-sm">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {active && <span className="text-[10px]">使用中</span>}
        </button>
        {customId !== null && (
          <button
            type="button"
            title="删除"
            onClick={(e: React.MouseEvent): void => {
              e.stopPropagation();
              props.onDeleteCustom(customId);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 text-xs text-ink-3 transition-colors duration-200 hover:bg-like/10 hover:text-like"
          >
            ×
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="absolute bottom-full left-0 z-40 mb-2 w-72 rounded-xl border border-line bg-elevated shadow-[var(--yy-shadow-card-hover)]">
      <header className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="text-xs font-medium text-ink">选择提示词</span>
        <button
          type="button"
          onClick={(): void => setAdding(!adding)}
          className="rounded-full px-2 py-0.5 text-[11px] text-glow transition-colors duration-200 hover:bg-muted"
        >
          ＋ 新增
        </button>
      </header>
      <div className="max-h-64 overflow-y-auto thin-scroll border-t border-line pt-1">
        {adding ? (
          <AddForm
            onAdd={props.onAddCustom}
            onCancel={(): void => setAdding(false)}
          />
        ) : (
          <ul className="flex flex-col pb-1.5">
            {PRESET_PROMPTS.map((p: PromptPreset) => renderRow(p.icon, p.name, p.content, null))}
            {props.customs.map((c: PromptCustom) => renderRow('🌟', c.name, c.content, c.id))}
            {props.customs.length === 0 && (
              <li className="px-3 pb-2 pt-1 text-[10px] text-ink-3">没有自定义提示词，点右上「＋ 新增」创建</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
