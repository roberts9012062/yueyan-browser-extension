// browser-extension/src/shared/messages/types.ts
// 跨上下文消息与执行任务的集中定义（手册 §8.1：消息通道超过 10 条后必须集中判别联合）。
//
// 同步约定：background 与 content script（ball/dock）因「入口自包含」约束无法 import 本文件，
// 各自在本地声明所用常量/结构并注释「同步自 shared/messages/types.ts」；
// 扩展页上下文（sidepanel 各组件）一律从本文件 import，禁止再散落声明。

/** 消息类型常量（同步点：background/main.ts、content/ball.ts、content/dock.ts、components/exec/*） */
export const MSG = {
  /** background → 悬浮球：探测球可用并交付任务（球应答 {ok:boolean}，true=已展开执行框） */
  execOffer: 'yy-exec-offer',
  /** background → 扩展页广播：面板形态领取待执行任务 */
  execRun: 'yy-exec-run',
  /** 执行器 → 悬浮球：收起执行框 */
  execClose: 'yy-exec-close',
  /** 执行器 → dock：页面上下文抓取图片二进制转 dataURL（blob:/受 CSP 保护图兜底） */
  imageData: 'yy-image-data',
} as const;

/** 右键任务种类 */
export type ExecTaskKind = 'summary' | 'bookmark' | 'moment';

/** 任务消费者：ball=悬浮球旁执行框 iframe / panel=面板（任一形态）内叠加执行卡 */
export type ExecTarget = 'ball' | 'panel';

/** 任务载荷（判别联合；由 background 右键菜单构建，执行器消费） */
export type ExecTask =
  | {
    kind: 'summary';
    nonce: string;
    target: ExecTarget;
    createdAt: number;
    /** 来源标签页 ID（抓正文 / 取图消息的目标） */
    tabId: number;
    /** 来源页地址与标题（展示与 AI 上下文用） */
    pageUrl: string;
    pageTitle: string;
  }
  | {
    kind: 'bookmark';
    nonce: string;
    target: ExecTarget;
    createdAt: number;
    tabId: number;
    pageUrl: string;
    pageTitle: string;
    /** ai=AI 自动分类推荐 / pick=手动指定文件夹 */
    mode: 'ai' | 'pick';
  }
  | {
    kind: 'moment';
    nonce: string;
    target: ExecTarget;
    createdAt: number;
    tabId: number;
    pageUrl: string;
    pageTitle: string;
    /** 本次右键加入草稿的选中文字（空串=无） */
    addText: string;
    /** 本次右键加入草稿的图片地址（空串=无） */
    addImage: string;
  }
  | {
    kind: 'shot';
    nonce: string;
    target: ExecTarget;
    createdAt: number;
    tabId: number;
    pageUrl: string;
    pageTitle: string;
    /** 框选完成的全屏截图（dataUrl；空串=授权失败降级，执行框内走手动框选兜底） */
    imageDataUrl: string;
    /** 用户框选区域（空=null，与 imageDataUrl 配套） */
    rect: { x: number; y: number; w: number; h: number; dpr: number } | null;
  };

/** 说说草稿篮（跨右键累积：一段话 + 图片 → 一条说说；发送成功或清空后移除） */
export interface MomentDraft {
  /** 已累积的文字（可编辑后回写） */
  text: string;
  /** 已累积的图片地址（http(s)/data:/blob:；去重） */
  images: string[];
  updatedAt: number;
}

/** 三类任务载荷的窄化别名（执行器组件 props 用） */
export type SummaryExecTask = Extract<ExecTask, { kind: 'summary' }>;
export type BookmarkExecTask = Extract<ExecTask, { kind: 'bookmark' }>;
export type MomentExecTask = Extract<ExecTask, { kind: 'moment' }>;
export type ShotExecTask = Extract<ExecTask, { kind: 'shot' }>;

/** 未知结构宽解析为任务（非法/缺失返回 null；纯函数） */
export function parseExecTask(raw: unknown): ExecTask | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const baseOk: boolean =
    typeof obj.nonce === 'string' &&
    typeof obj.createdAt === 'number' &&
    typeof obj.tabId === 'number' &&
    typeof obj.pageUrl === 'string' &&
    typeof obj.pageTitle === 'string' &&
    (obj.target === 'ball' || obj.target === 'panel');
  if (!baseOk) {
    return null;
  }
  const base = {
    nonce: obj.nonce as string,
    target: obj.target as ExecTarget,
    createdAt: obj.createdAt as number,
    tabId: obj.tabId as number,
    pageUrl: obj.pageUrl as string,
    pageTitle: obj.pageTitle as string,
  };
  if (obj.kind === 'summary') {
    return { kind: 'summary', ...base };
  }
  if (obj.kind === 'bookmark' && (obj.mode === 'ai' || obj.mode === 'pick')) {
    return { kind: 'bookmark', mode: obj.mode, ...base };
  }
  if (
    obj.kind === 'moment'
    && typeof obj.addText === 'string'
    && typeof obj.addImage === 'string'
  ) {
    return { kind: 'moment', addText: obj.addText, addImage: obj.addImage, ...base };
  }
  if (obj.kind === 'shot') {
    const rectRaw: unknown = obj.rect;
    const rectOk: boolean =
      rectRaw === null
      || (typeof rectRaw === 'object' && rectRaw !== null
        && ['x', 'y', 'w', 'h', 'dpr'].every((k: string): boolean => typeof (rectRaw as Record<string, unknown>)[k] === 'number'));
    if (typeof obj.imageDataUrl === 'string' && rectOk) {
      return {
        kind: 'shot',
        imageDataUrl: obj.imageDataUrl,
        rect: rectRaw as { x: number; y: number; w: number; h: number; dpr: number } | null,
        ...base,
      };
    }
  }
  return null;
}
