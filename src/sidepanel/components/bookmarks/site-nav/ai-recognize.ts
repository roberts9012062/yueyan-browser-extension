// browser-extension/src/sidepanel/components/bookmarks/ai-recognize.ts
// AI 识别站点信息（「AI 添加站点」用）：prompt 构建（纯函数）+ 响应宽松解析。
// 解析三级容错（对齐 ArticlePanel parseMeta 的踩坑经验）：
//   剥 <think> 思考段 → 整体 JSON 解析 → 截断时逐字段正则兜底。

import type { ChatMessage } from '../../../../shared/types';

/** AI 识别结果草稿（四项均可能为空串，由调用方决定回填策略） */
export interface SiteInfoDraft {
  name: string;
  category: string;
  tags: string[];
  description: string;
}

/**
 * 构建识别对话消息（纯函数）。
 * 参数：url 站点地址；nameHint 用户已填的名称（空串=未填）；categories 现有分类（引导归档一致）。
 */
export function buildRecognizeMessages(url: string, nameHint: string, categories: readonly string[]): ChatMessage[] {
  const categoryHint: string = categories.length > 0
    ? `优先从现有分类中选择最贴切的一个：${categories.slice(0, 30).join('、')}；都不合适才起新的简短中文分类名。`
    : '分类用简短中文名（如：开发工具）。';
  const system: string = [
    '你是网站信息识别助手：根据站点地址与域名推断网站的名称、分类、标签与一句话简介。',
    categoryHint,
    '标签给 2-6 个；简介 ≤80 字、中文。',
    '只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释：',
    '{"name":"网站名","category":"分类","tags":["标签"],"description":"简介"}',
  ].join('\n');
  const user: string = `站点地址：${url}${
    nameHint !== '' ? `\n（用户已填名称「${nameHint}」，name 直接采用它）` : ''
  }`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 剥思考段并截取 JSON 主体（纯函数） */
function extractJsonBody(raw: string): string {
  const noThink: string = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced: RegExpMatchArray | null = noThink.match(/\{[\s\S]*\}/);
  return fenced !== null ? fenced[0] : noThink.trim();
}

/** 从字符串数组字段提取标签（清洗 + 上限 10） */
function extractTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((t: unknown): boolean => typeof t === 'string' && (t as string).trim() !== '')
    .map((t: unknown): string => (t as string).trim())
    .slice(0, 10);
}

/**
 * 解析 AI 识别输出（宽松解析；名称与分类全空视为失败返回 null）。
 * 整体 JSON 解析失败（截断）时逐字段正则救回已生成部分。
 */
export function parseRecognizeResult(raw: string): SiteInfoDraft | null {
  const body: string = extractJsonBody(raw);
  if (body === '') {
    return null;
  }
  let name: string = '';
  let category: string = '';
  let tags: string[] = [];
  let description: string = '';
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    name = typeof obj.name === 'string' ? obj.name.trim() : '';
    category = typeof obj.category === 'string' ? obj.category.trim() : '';
    tags = extractTags(obj.tags);
    description = typeof obj.description === 'string' ? obj.description.trim().slice(0, 200) : '';
  } catch {
    // 截断抗性兜底：逐字段正则（支持值内转义引号）
    const field = (key: string): string => {
      const m: RegExpMatchArray | null = body.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'u'));
      return m !== null ? m[1].replace(/\\"/g, '"').trim() : '';
    };
    name = field('name');
    category = field('category');
    const tagsMatch: RegExpMatchArray | null = body.match(/"tags"\s*:\s*\[([^\]]*)/);
    tags = tagsMatch !== null
      ? tagsMatch[1]
        .split(',')
        .map((s: string): string => s.replace(/["\s]/g, ''))
        .filter((s: string): boolean => s !== '')
        .slice(0, 10)
      : [];
    description = field('description').slice(0, 200);
  }
  if (name === '' && category === '') {
    return null;
  }
  return { name, category, tags, description };
}
