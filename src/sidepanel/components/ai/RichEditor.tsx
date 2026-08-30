// browser-extension/src/sidepanel/components/ai/RichEditor.tsx
// 轻量富文本编辑器（contenteditable + execCommand 工具栏）：
// 与主站 tiptap 同为 HTML 输出（content_format=html），覆盖加粗/斜体/标题/
// 列表/链接/撤销重做/插入 HTML（AI 配图用）。非受控（受控会让光标跳动），
// 初值经 setHtml 注入、内部变更经 onHtmlChange 上报。
import { useEffect, useRef } from 'react';

interface RichEditorProps {
  /** 初值 HTML（挂载时注入一次；运行中更新请调用命令式 setHtml） */
  initialHtml: string;
  /** 内容变化上报（原始 HTML） */
  onHtmlChange: (html: string) => void;
  /** 占位提示 */
  placeholder: string;
  /** 命令式句柄回传容器（挂载时注入，供插入配图/整体替换） */
  editorRef: React.MutableRefObject<RichEditorHandle | null>;
}

/** 工具栏按钮定义 */
interface ToolDef {
  key: string;
  label: string;
  title: string;
  command: string;
  value?: string;
}

const TOOLS: readonly ToolDef[] = [
  { key: 'bold', label: 'B', title: '加粗', command: 'bold' },
  { key: 'italic', label: 'I', title: '斜体', command: 'italic' },
  { key: 'h2', label: 'H2', title: '二级标题', command: 'formatBlock', value: '<H2>' },
  { key: 'h3', label: 'H3', title: '三级标题', command: 'formatBlock', value: '<H3>' },
  { key: 'p', label: '¶', title: '正文段落', command: 'formatBlock', value: '<P>' },
  { key: 'ul', label: '•', title: '无序列表', command: 'insertUnorderedList' },
  { key: 'ol', label: '1.', title: '有序列表', command: 'insertOrderedList' },
  { key: 'undo', label: '↶', title: '撤销', command: 'undo' },
  { key: 'redo', label: '↷', title: '重做', command: 'redo' },
];

const TOOL_BTN: string =
  'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink';

export interface RichEditorHandle {
  /** 命令式注入 HTML 片段到光标处（AI 插图用） */
  insertHtml: (html: string) => void;
  /** 整体替换内容（润色结果填充用） */
  setHtml: (html: string) => void;
  /** 取纯文本（配图 prompt 提取用） */
  getPlainText: () => string;
}

export function RichEditor(props: RichEditorProps): React.ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current !== null && props.initialHtml !== '') {
      ref.current.innerHTML = props.initialHtml;
    }
    props.editorRef.current = handle;
    // 仅挂载时注入一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 执行工具命令（execCommand 虽标记废弃但浏览器均支持，富文本场景仍为主流做法） */
  function exec(command: string, value: string | undefined): void {
    ref.current?.focus();
    document.execCommand(command, false, value);
    if (ref.current !== null) {
      props.onHtmlChange(ref.current.innerHTML);
    }
  }

  /** 暴露给父组件的命令式操作 */
  const handle: RichEditorHandle = {
    insertHtml: (html: string): void => {
      ref.current?.focus();
      document.execCommand('insertHTML', false, html);
      if (ref.current !== null) {
        props.onHtmlChange(ref.current.innerHTML);
      }
    },
    setHtml: (html: string): void => {
      if (ref.current !== null) {
        ref.current.innerHTML = html;
        props.onHtmlChange(html);
      }
    },
    getPlainText: (): string => (ref.current?.innerText ?? '').slice(0, 4000),
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-elevated focus-within:border-accent">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        {TOOLS.map((tool: ToolDef): React.ReactNode => (
          <button
            key={tool.key}
            type="button"
            title={tool.title}
            onClick={(): void => exec(tool.command, tool.value)}
            className={TOOL_BTN}
          >
            {tool.label}
          </button>
        ))}
        <button
          type="button"
          title="插入链接"
          onClick={(): void => {
            const url: string | null = window.prompt('链接地址（https://…）');
            if (url !== null && url.trim() !== '') {
              exec('createLink', url.trim());
            }
          }}
          className={TOOL_BTN}
        >
          🔗
        </button>
      </div>

      {/* 可编辑区：复用 .md-body 内容样式 */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={props.placeholder}
        onInput={(e: React.FormEvent<HTMLDivElement>): void => {
          props.onHtmlChange((e.target as HTMLDivElement).innerHTML);
        }}
        onClick={(e: React.MouseEvent<HTMLDivElement>): void => {
          // 图片点选增强：contenteditable 原生点选 img 不稳定（常被当作拖拽），
          // 这里强制建立选区（连图块的 figure 一起选中），随后 Delete/Backspace 即删除
          const target: HTMLElement = e.target as HTMLElement;
          if (target.tagName !== 'IMG') {
            return;
          }
          e.preventDefault();
          const block: Element = target.closest('figure') ?? target;
          const selection: Selection | null = window.getSelection();
          if (selection === null) {
            return;
          }
          const range: Range = document.createRange();
          range.selectNode(block);
          selection.removeAllRanges();
          selection.addRange(range);
        }}
        className="md-body thin-scroll min-h-64 max-h-80 overflow-y-auto px-3 py-2.5 text-ink outline-none empty:before:text-ink-3 empty:before:content-[attr(data-placeholder)]"
      />
      <p className="px-3 pb-1.5 pt-1 text-[10px] text-ink-3">点击图片选中（虚线框），按 Delete 删除广告图等无关图片</p>
    </div>
  );
}

export type { RichEditorHandle as EditorHandle };
