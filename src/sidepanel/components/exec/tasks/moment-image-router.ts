// browser-extension/src/sidepanel/components/exec/tasks/moment-image-router.ts
// 右键「发说说」的图片发布路由（自 MomentExec 拆出）：
//   按设置 publishImageBed 决定单张图片的去向——
//     tg ：扩展页取回原图 File → 开放网关直传 TG图床（不压缩保真），仅正文 <img> 引用；
//     cf ：同上直连 CF图床 Worker（须已配置地址与 Key，缺一视为「未配置」走服务器）；
//     none（默认）/ 图床失败降级：站点服务器通道——http 图优先 media.transfer 服务端转存
//     （关联 media_ids），失败或 data:/blob: 源经压缩后 media.upload 直传。
//   图床失败（withBedRetry 重试后）自动降级服务器；服务器也失败才抛错
//   （调用方按原链接内嵌正文并计数提示）。
// 与「生成文章」的 routeArticleImages 语义一致（用户配置优先，未配置走服务器）。

import { transferImage, uploadMedia } from '../../../../shared/api/endpoints';
import { uploadCfImageBed, uploadTgImageBed, withBedRetry } from '../../../../shared/api/image-bed';
import { ensureWideHostPermission } from '../../../../shared/permissions';
import type { PluginSettings } from '../../../../shared/types';
import { fetchImageAsFile } from '../../ai/publish-image-router';
import { compressImageFile } from '../../moment/compose';

/** 单图路由结果（mediaId=null 表示仅正文引用，如 TG/CF 图床地址） */
export interface MomentImageResult {
  url: string;
  mediaId: number | null;
}

/** 经宿主页内容脚本取 blob:/受保护图（扩展页跨 origin 不可达；返回 dataURL） */
async function fetchViaDock(tabId: number, src: string): Promise<string> {
  const reply: unknown = await chrome.tabs.sendMessage(tabId, { type: 'yy-image-data', src });
  const obj = reply as { ok?: boolean; dataUrl?: string } | null;
  if (typeof obj !== 'object' || obj === null || obj.ok !== true || typeof obj.dataUrl !== 'string') {
    throw new Error('page-fetch-failed');
  }
  return obj.dataUrl;
}

/** 任意图片源取回为 File（http 跨域前须已持主机授权；blob: 经 dock 中转） */
async function toFile(tabId: number, src: string): Promise<File> {
  if (/^https?:/i.test(src) || src.startsWith('data:')) {
    return fetchImageAsFile(src, 0);
  }
  return fetchImageAsFile(await fetchViaDock(tabId, src), 0);
}

/** 站点服务器通道：http 图服务端转存优先（关联 media_ids）；失败/本地源压缩后直传 */
async function routeToServer(settings: PluginSettings, tabId: number, src: string): Promise<MomentImageResult> {
  if (/^https?:/i.test(src)) {
    try {
      const res = await transferImage(settings.apiBaseUrl, settings.apiKey, src);
      return { url: res.url, mediaId: res.media_id };
    } catch {
      // 服务端转存失败（源站拒绝等）→ 本页取图直传兜底（跨域取图需主机授权）
    }
    if (!(await ensureWideHostPermission())) {
      throw new Error('未获「读取网站信息」授权，无法取图上传');
    }
  }
  const file: File = await compressImageFile(await toFile(tabId, src));
  const uploaded = await uploadMedia(settings.apiBaseUrl, settings.apiKey, file);
  return { url: uploaded.url, mediaId: uploaded.media_id };
}

/** 主机授权（发布按钮手势链内调用）：http 图跨域取回与 CF Worker 直连都需要 */
async function grantWideHost(src: string, always: boolean): Promise<boolean> {
  if (!always && !/^https?:/i.test(src)) {
    return true; // data:/blob: 源无需授权
  }
  return ensureWideHostPermission();
}

/**
 * 单张图片按设置图床路由。调用点须在用户手势内（授权弹框依赖）。
 */
export async function routeMomentImage(
  settings: PluginSettings,
  tabId: number,
  src: string,
): Promise<MomentImageResult> {
  // ① TG图床：站点开放网关直传（站点自身转发，扩展页仅需取到原图字节）
  if (settings.publishImageBed === 'tg') {
    if (!(await grantWideHost(src, false))) {
      return routeToServer(settings, tabId, src); // 未获授权（无法取原图）→ 服务器转存兜底
    }
    try {
      const file: File = await toFile(tabId, src);
      const res = await withBedRetry((): Promise<{ url: string }> =>
        uploadTgImageBed(settings.apiBaseUrl, settings.apiKey, file),
      );
      return { url: res.url, mediaId: null };
    } catch {
      return routeToServer(settings, tabId, src); // 图床不可用（未装插件/超时）→ 降级服务器
    }
  }

  // ② CF图床：Worker 直连（须凭证齐全，缺一视为「未配置」走服务器）
  if (settings.publishImageBed === 'cf' && settings.cfBedUrl !== '' && settings.cfBedKey !== '') {
    if (!(await grantWideHost(src, true))) {
      return routeToServer(settings, tabId, src);
    }
    try {
      const file: File = await toFile(tabId, src);
      const res = await withBedRetry((): Promise<{ url: string }> =>
        uploadCfImageBed(settings.cfBedUrl, settings.cfBedKey, file),
      );
      return { url: res.url, mediaId: null };
    } catch {
      return routeToServer(settings, tabId, src);
    }
  }

  // ③ 站点服务器（默认 / 未配置 CF / 图床降级）
  return routeToServer(settings, tabId, src);
}
