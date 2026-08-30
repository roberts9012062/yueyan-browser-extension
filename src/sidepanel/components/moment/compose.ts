// browser-extension/src/sidepanel/components/moment/compose.ts
// 写说说的纯函数集合：字数统计、链接解析（视频/音乐）、正文 HTML 组装、大图压缩。
//
// 正文协议与主站富文本导出同构（前台 post-content.tsx 渲染 + DOMPurify 白名单）：
//   图片 <p><img src=站点地址></p>（media_id 另行进 media_ids 关联）
//   视频 <div data-video-embed="{platform}"><iframe src="{embed 地址}"></iframe></div>
//   音乐 <div data-music-embed="netease" data-music-id="{songId}" …></div>（前台拆为自研播放器）
//   链接 <p><a href target=_blank>文字</a></p>
// iframe 域约束与主站消毒白名单一致：player.bilibili.com / www.youtube.com。

import type { MomentAttach } from '../../../shared/types';

/** 说说纯文本字数上限（与后端 moment ≤2000 字限制一致） */
export const MOMENT_MAX_CHARS: number = 2000;

/** 本地压缩触发阈值（字节）：超过才压缩，避免小图无谓重编码（Nginx 默认 1m 限制的历史踩坑） */
const COMPRESS_THRESHOLD_BYTES: number = 1024 * 1024;

/** 压缩后目标参数：长边 2048 / JPEG 质量 0.85（截图压缩同款档位） */
const COMPRESS_MAX_EDGE: number = 2048;
const COMPRESS_QUALITY: number = 0.85;

/** 生成本地附件唯一 id（crypto 随机；仅前端标识用） */
export function newAttachId(): string {
  return crypto.randomUUID();
}

/** 统计纯文本字数（换行符计入；超限禁发） */
export function countChars(text: string): number {
  return text.replace(/\r/g, '').length;
}

/** 视频平台解析结果（platform 同步主站 videoEmbed 节点取值） */
export interface ParsedVideo {
  platform: 'bilibili' | 'youtube';
  embedUrl: string;
}

/**
 * parseVideoUrl 解析视频链接（纯函数）。
 * 支持：B站（BV 号 / bilibili.com/video/BVxxx 页面）、YouTube（watch?v= / youtu.be / shorts）。
 * 不支持返回 null：b23.tv 短链需服务端展开（iframe 无法跟随跳转），提示用户改用完整链接。
 */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  const input: string = raw.trim();
  if (input === '') {
    return null;
  }
  // B站：纯 BV 号（BV + 10 位左右 base58）
  if (/^BV[0-9A-Za-z]{8,12}$/.test(input)) {
    return { platform: 'bilibili', embedUrl: `https://player.bilibili.com/player.html?bvid=${input}` };
  }
  let url: URL;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host: string = url.hostname.replace(/^www\./, '');
  if (host === 'b23.tv') {
    return null; // 短链无法在前端展开为 bvid
  }
  if (host === 'bilibili.com' || host === 'm.bilibili.com') {
    const bv: string | null = /^\/video\/(BV[0-9A-Za-z]+)/.exec(url.pathname)?.[1]
      ?? url.searchParams.get('bvid');
    if (bv !== null) {
      return { platform: 'bilibili', embedUrl: `https://player.bilibili.com/player.html?bvid=${bv}` };
    }
    return null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const videoId: string | null = host === 'youtu.be'
      ? (url.pathname.slice(1).split('/')[0] ?? null)
      : url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (/^\/(?:shorts|embed)\/([\w-]+)/.exec(url.pathname)?.[1] ?? null);
    if (videoId !== null && videoId !== '') {
      return { platform: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
    }
    return null;
  }
  return null;
}

/**
 * parseMusicUrl 解析网易云歌曲链接（纯函数）：music.163.com/song?id=xxx 及路径形态 /song/xxx。
 * 仅放行网易云音乐（QQ 音乐外链需插件接口支撑，v1 不做）；返回歌曲数字 id 或 null。
 */
export function parseMusicUrl(raw: string): string | null {
  const input: string = raw.trim();
  let url: URL;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host: string = url.hostname.replace(/^www\./, '');
  if (host !== 'music.163.com' && host !== 'y.music.163.com') {
    return null;
  }
  const songId: string = url.searchParams.get('id')
    ?? (/^\/song\/(\d+)/.exec(url.pathname)?.[1] ?? '');
  return /^\d+$/.test(songId) ? songId : null;
}

/** escapeHtml 正文文本转义（防 XSS；与主站 post-content 同规则，另转义引号保属性安全） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * buildMomentHtml 组装说说正文 HTML（纯函数）：文本按换行分段 <p>，附件按添加顺序成块。
 * 附件块协议见文件头注释；空文本 + 无附件返回空串（调用方负责发送前校验）。
 */
export function buildMomentHtml(text: string, attaches: readonly MomentAttach[]): string {
  const parts: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const trimmed: string = line.trim();
    if (trimmed !== '') {
      parts.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }
  for (const attach of attaches) {
    if (attach.kind === 'image') {
      parts.push(`<p><img src="${escapeHtml(attach.url)}" alt="说说配图" loading="lazy"></p>`);
    } else if (attach.kind === 'video') {
      parts.push(
        `<div data-video-embed="${attach.platform}">`
        + `<iframe src="${escapeHtml(attach.embedUrl)}" scrolling="no" border="0" frameborder="no" `
        + `framespacing="0" allowfullscreen="true"></iframe></div>`,
      );
    } else if (attach.kind === 'music') {
      parts.push(
        `<div data-music-embed="netease" data-music-kind="song" data-music-id="${attach.songId}" `
        + `data-music-title="" data-music-artist="" data-music-cover=""></div>`,
      );
    } else {
      const label: string = attach.text === '' ? attach.url : attach.text;
      parts.push(
        `<p><a href="${escapeHtml(attach.url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></p>`,
      );
    }
  }
  return parts.join('');
}

/**
 * compressImageFile 大图本地压缩（超过 1MB 才压）：长边收敛 2048、JPEG 重编码。
 * 说明：站点反代历史上默认 client_max_body_size 1m（v0.14.1 踩坑），超大原图直传会被拒；
 * 小于阈值原样返回（保留 PNG 透明度等原始格式）。
 */
export async function compressImageFile(file: File): Promise<File> {
  if (file.size <= COMPRESS_THRESHOLD_BYTES) {
    return file;
  }
  const bitmap: ImageBitmap = await createImageBitmap(file);
  const scale: number = Math.min(1, COMPRESS_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob: Blob | null = await new Promise<Blob | null>((resolve: (b: Blob | null) => void): void => {
    canvas.toBlob((out: Blob | null): void => resolve(out), 'image/jpeg', COMPRESS_QUALITY);
  });
  if (blob === null || blob.size >= file.size) {
    return file; // 压缩无收益（或编码失败）→ 原样返回
  }
  const baseName: string = file.name.replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}
