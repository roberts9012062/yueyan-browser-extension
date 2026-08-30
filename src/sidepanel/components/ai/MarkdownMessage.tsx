// browser-extension/src/sidepanel/components/ai/MarkdownMessage.tsx
// AI 回复的轻量 Markdown 渲染：标题/加粗/斜体/行内代码/代码块/列表/引用/链接/分隔线。
// 安全策略：先整体 HTML 转义再做 Markdown 替换（防 XSS）；链接仅允许 http(s)。
// 样式集中在 globals.css 的 .md-body 下按元素选择器定义。

/** HTML 转义（纯函数） */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 行内元素：行内代码 → 加粗 → 斜体 → 链接（输入须已转义；纯函数） */
function renderInline(escaped: string): string {
  let out: string = escaped;

  // 图片 ![alt](url)：仅放行 http(s)，须先于链接规则处理（否则 ![]() 被当作链接）
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m: string, alt: string, url: string): string => {
      if (!/^https?:\/\//i.test(url)) {
        return alt;
      }
      return `<img src="${url}" alt="${alt}" />`;
    },
  );

  // 行内代码（内容不再做其他替换，避免嵌套歧义）
  out = out.replace(/`([^`]+)`/g, (_m: string, code: string): string => `<code>${code}</code>`);

  // 加粗 **text** / 斜体 *text*
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // 链接 [text](url)：仅放行 http(s)，其余协议只显示文字
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m: string, text: string, url: string): string => {
      if (!/^https?:\/\//i.test(url)) {
        return text;
      }
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  );
  return out;
}

/**
 * Markdown → 安全 HTML（纯函数，行状态机处理块级结构）。
 * 支持范围刻意收敛为 AI 回复的常见形态，复杂表格等不做（YAGNI）。
 */
export function renderMarkdown(md: string): string {
  const lines: string[] = md.split('\n');
  const out: string[] = [];

  let inCode: boolean = false;
  let codeBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let quoteOpen: boolean = false;

  /** 关闭打开的列表与引用块 */
  const closeBlocks = (): void => {
    if (listType !== null) {
      out.push(`</${listType}>`);
      listType = null;
    }
    if (quoteOpen) {
      out.push('</blockquote>');
      quoteOpen = false;
    }
  };

  for (const rawLine of lines) {
    const line: string = rawLine.trimEnd();

    // ---------- 代码块围栏 ----------
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        closeBlocks();
        inCode = true;
        codeBuf = [];
      } else {
        inCode = false;
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(rawLine);
      continue;
    }

    const trimmed: string = line.trim();

    // ---------- 空行：收束段落级块 ----------
    if (trimmed === '') {
      closeBlocks();
      continue;
    }

    // ---------- 标题 ----------
    const heading: RegExpMatchArray | null = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading !== null) {
      closeBlocks();
      const level: number = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    // ---------- 分隔线 ----------
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeBlocks();
      out.push('<hr />');
      continue;
    }

    // ---------- 引用块 ----------
    if (trimmed.startsWith('>')) {
      if (listType !== null) {
        out.push(`</${listType}>`);
        listType = null;
      }
      if (!quoteOpen) {
        out.push('<blockquote>');
        quoteOpen = true;
      }
      out.push(`<p>${renderInline(escapeHtml(trimmed.replace(/^>\s?/, '')))}</p>`);
      continue;
    }

    // ---------- 无序列表 ----------
    const ul: RegExpMatchArray | null = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul !== null) {
      if (quoteOpen) {
        out.push('</blockquote>');
        quoteOpen = false;
      }
      if (listType !== 'ul') {
        if (listType === 'ol') {
          out.push('</ol>');
        }
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${renderInline(escapeHtml(ul[1]))}</li>`);
      continue;
    }

    // ---------- 有序列表 ----------
    const ol: RegExpMatchArray | null = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ol !== null) {
      if (quoteOpen) {
        out.push('</blockquote>');
        quoteOpen = false;
      }
      if (listType !== 'ol') {
        if (listType === 'ul') {
          out.push('</ul>');
        }
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${renderInline(escapeHtml(ol[1]))}</li>`);
      continue;
    }

    // ---------- 普通段落 ----------
    if (quoteOpen) {
      out.push('</blockquote>');
      quoteOpen = false;
    }
    if (listType !== null) {
      out.push(`</${listType}>`);
      listType = null;
    }
    out.push(`<p>${renderInline(escapeHtml(trimmed))}</p>`);
  }

  // ---------- 收尾：未闭合的代码块/列表/引用 ----------
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  closeBlocks();

  return out.join('\n');
}

/** 消息渲染组件：assistant 气泡内容用 */
export function MarkdownMessage(props: { content: string }): React.ReactNode {
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(props.content) }} />;
}
