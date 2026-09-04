// browser-extension/src/sidepanel/components/ai/publish-image-router.ts
// 文章发布前正文图片路由（自 ArticlePanel 拆出，控制其行数）：
// 按设置 publishImageBed 决定正文 <img> 的存储去向——
//   none：外链图经 media.transfer 转存站点媒体库（media_id 并入关联列表；原 ArticlePanel 行为）；
//   tg  ：全部可取图（http(s) 含本站 AI 配图、内联 dataURL）拉取为 File 后经开放网关直传 TG图床；
//   cf  ：同上直传 CF图床 R2 Worker（需已在设置中配好 Workers 地址与 API Key）。
// 失败策略三通道一致：单张失败保留原地址、聚合计数提示，不阻断发布。

import { ApiError } from '../../../shared/api/client';
import { transferImage } from '../../../shared/api/endpoints';
import { uploadCfImageBed, uploadTgImageBed, withBedRetry } from '../../../shared/api/image-bed';
import { ensureWideHostPermission } from '../../../shared/permissions';
import type { PluginSettings } from '../../../shared/types';

/** 路由结果：html=路由后正文（src 已替换）；mediaIds=需随发布关联的站点媒体库 ID（图床通道恒空） */
export interface ArticleImageRouteResult {
  html: string;
  mediaIds: number[];
  /** 失败张数（0=全部成功或无可处理图片） */
  failed: number;
  /** 首条失败原因（聚合计数提示用） */
  failMsg: string;
}

/** 单图上传入口签名（按所选图床注入，返回图床公开 URL；循环与错误聚合在公共路径处理） */
type BedUploader = (file: File) => Promise<string>;

/** TG/CF 图床共同接受的图片 MIME → 扩展名（CF Worker 校验文件名必须带白名单扩展名） */
const MIME_EXT: ReadonlyMap<string, string> = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

/** 判定 src 是否为远程图片地址（纯函数） */
function isRemoteImage(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** 判定 src 是否为内联 base64 图片（粘贴图场景；纯函数） */
function isInlineDataImage(src: string): boolean {
  return /^data:image\//i.test(src);
}

/**
 * 图片源转 File（图床上传入参）：fetch 支持 http(s) 与 dataURL 两种源；
 * 校验 Blob mime 在白名单内，文件名优先沿用 URL 自带的合法扩展名（可读性），否则序号命名。
 * 导出供说说图床路由复用（moment-image-router 同款取图规则，两处一起改）。
 */
export async function fetchImageAsFile(src: string, index: number): Promise<File> {
  const response: Response = await fetch(src, { credentials: 'omit' });
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status}`, response.status);
  }
  const blob: Blob = await response.blob();
  const ext: string | undefined = MIME_EXT.get(blob.type);
  if (ext === undefined) {
    throw new ApiError('无法识别的图片格式', 0);
  }
  let name: string = `image-${index}${ext}`;
  try {
    const last: string = new URL(src).pathname.split('/').pop() ?? '';
    // 文件名末段形如 xxx.jpg（扩展名精确匹配）才沿用，避免把 query 段误当文件名
    if (new RegExp(`^[A-Za-z0-9._-]+\\${ext}$`, 'i').test(decodeURIComponent(last))) {
      name = decodeURIComponent(last);
    }
  } catch {
    // dataURL 无 URL 路径语义，使用默认序号名
  }
  return new File([blob], name, { type: blob.type });
}

/**
 * 站点服务器通道（none，原 ArticlePanel.transferExternalImages 迁入）：
 * 编辑器中指向其它站点的 <img> 逐张调 media.transfer 转存，src 替换为本站持久地址、
 * media_id 并入关联列表；本站地址（AI 配图已落媒体库）跳过；单张失败保留原址继续。
 */
async function transferToServer(
  sourceHtml: string,
  settings: PluginSettings,
  onProgress: (text: string) => void,
): Promise<ArticleImageRouteResult> {
  const doc: Document = new DOMParser().parseFromString(sourceHtml, 'text/html');
  const imgs: HTMLImageElement[] = Array.from(doc.querySelectorAll('img'));
  const siteHost: string = (() => {
    try {
      return new URL(settings.apiBaseUrl).host;
    } catch {
      return '';
    }
  })();

  const collected: number[] = [];
  let failed: number = 0;
  let failMsg: string = '';
  let index: number = 0;
  for (const img of imgs) {
    const src: string = img.getAttribute('src') ?? '';
    index += 1;
    if (!isRemoteImage(src)) {
      continue;
    }
    // 本站地址（AI 配图已转存过）跳过
    let host: string = '';
    try {
      host = new URL(src).host;
    } catch {
      continue;
    }
    if (host === siteHost) {
      continue;
    }
    onProgress(`正在转存外链图片 ${index}/${imgs.length}…`);
    try {
      const result = await transferImage(settings.apiBaseUrl, settings.apiKey, src);
      if (result.url !== '') {
        img.setAttribute('src', result.url);
      }
      if (typeof result.media_id === 'number') {
        collected.push(result.media_id);
      }
    } catch {
      failed += 1;
      failMsg = '源站拒绝或非图片';
    }
  }
  return { html: doc.body.innerHTML, mediaIds: collected, failed, failMsg };
}

/**
 * 图床通道（tg / cf）：全部可取图拉取为 File 后上传所选图床，src 替换为图床公开 URL。
 * 与服务器通道不同：本站 AI 配图也一并转图床（media_id 不再关联站点媒体库）。
 * 前置：http 图跨域拉取需全域主机授权（Worker 无 CORS、本站 media 地址同样受 CORS 约束）。
 */
async function uploadToBed(
  sourceHtml: string,
  settings: PluginSettings,
  onProgress: (text: string) => void,
): Promise<ArticleImageRouteResult> {
  const doc: Document = new DOMParser().parseFromString(sourceHtml, 'text/html');
  const imgs: HTMLImageElement[] = Array.from(doc.querySelectorAll('img'));
  const bedName: string = settings.publishImageBed === 'tg' ? 'TG图床' : 'CF图床';
  // 可处理项：远程图 + 内联 dataURL 图（相对路径等无法取源的跳过保留）
  const targets: HTMLImageElement[] = imgs.filter((img: HTMLImageElement): boolean => {
    const src: string = img.getAttribute('src') ?? '';
    return isRemoteImage(src) || isInlineDataImage(src);
  });
  const noop: ArticleImageRouteResult = { html: doc.body.innerHTML, mediaIds: [], failed: 0, failMsg: '' };

  // CF 凭证缺失：全部按失败计数提示（保留原地址，不阻断发布）
  if (settings.publishImageBed === 'cf' && (settings.cfBedUrl === '' || settings.cfBedKey === '')) {
    return { ...noop, failed: targets.length, failMsg: 'CF图床未配置 Workers 地址或 API Key' };
  }
  // 远程图跨域拉取需要主机授权（发布按钮手势链内可达，可直接弹授权框）
  const hasRemote: boolean = targets.some((img: HTMLImageElement): boolean =>
    isRemoteImage(img.getAttribute('src') ?? ''),
  );
  if (hasRemote && !(await ensureWideHostPermission())) {
    return { ...noop, failed: targets.length, failMsg: '未获「读取网站信息」授权，无法读取图片上传图床' };
  }

  // 按图床注入单图上传：TG 走开放网关（站点 Key），CF 直连 Worker（Bearer）
  const uploader: BedUploader =
    settings.publishImageBed === 'tg'
      ? (file: File): Promise<string> =>
          uploadTgImageBed(settings.apiBaseUrl, settings.apiKey, file).then(
            (result: { url: string }): string => result.url,
          )
      : (file: File): Promise<string> =>
          uploadCfImageBed(settings.cfBedUrl, settings.cfBedKey, file).then(
            (result: { url: string }): string => result.url,
          );

  let failed: number = 0;
  let failMsg: string = '';
  let index: number = 0;
  for (const img of targets) {
    index += 1;
    onProgress(`正在上传图片到${bedName} ${index}/${targets.length}…`);
    try {
      const file: File = await fetchImageAsFile(img.getAttribute('src') ?? '', index);
      img.setAttribute('src', await withBedRetry((): Promise<string> => uploader(file)));
    } catch (err: unknown) {
      failed += 1;
      failMsg = err instanceof ApiError ? err.message : '上传失败';
    }
  }
  return { html: doc.body.innerHTML, mediaIds: [], failed, failMsg };
}

/**
 * 发布前正文图片路由主入口：按 publishImageBed 分派（单一分支标记，无多模式参数）。
 * onProgress 逐张回传进度文案（调用方接 UI 状态，如 setNotice）。
 */
export async function routeArticleImages(
  sourceHtml: string,
  settings: PluginSettings,
  onProgress: (text: string) => void,
): Promise<ArticleImageRouteResult> {
  if (settings.publishImageBed === 'none') {
    return transferToServer(sourceHtml, settings, onProgress);
  }
  return uploadToBed(sourceHtml, settings, onProgress);
}
