// browser-extension/src/sidepanel/components/moment/use-image-upload.ts
// 写说说图片上传双通道 hook（自 MomentComposer 拆出，控制主视图文件行数）：
//   - TG图床可用性：挂载 / 连接配置变化时探测一次缓存（对 upload 端点发空请求，
//     HTTP 400=鉴权已过即可用，零副作用；fileInput.click 须在用户手势同步栈内，
//     故点击时只读此缓存，不做异步探测）；
//   - 双通道上传：server=站点媒体库（>1MB 自动压缩，mediaId 随发布关联）/
//     tg=TG图床插件原图保真直传（无媒体库 ID，mediaId 恒 null，仅正文引用）；
//   - 批量循环公共化：单图上传逻辑由通道函数注入，失败聚合计数提示，无通道分支。

import { useEffect, useState } from 'react';

import { ApiError } from '../../../shared/api/client';
import { uploadMedia } from '../../../shared/api/endpoints';
import {
  checkTgImageBedAvailable,
  uploadTgImageBed,
  withBedRetry,
} from '../../../shared/api/image-bed';
import type { TgImageBedUploadResult } from '../../../shared/api/image-bed';
import type { MomentAttach, PluginSettings, UploadResult } from '../../../shared/types';
import { compressImageFile, newAttachId } from './compose';

/** hook 事件回调：单图上传成功入附件条 / 批量结束失败聚合计数（组件层接 UI 状态） */
interface ImageUploadHandlers {
  onAttach: (attach: MomentAttach) => void;
  onFail: (text: string) => void;
}

/** 通道上传入口签名（FileList → 附件；批量与错误聚合在 hook 内公共处理） */
type ChannelUploader = (files: FileList) => Promise<void>;

/** hook 返回（组件消费：uploading 控按钮态，tgBedReady 决定点击是否弹通道选择） */
export interface ImageUploadHook {
  uploading: boolean;
  tgBedReady: boolean;
  uploadToServer: ChannelUploader;
  uploadToTg: ChannelUploader;
}

export function useImageUpload(settings: PluginSettings, handlers: ImageUploadHandlers): ImageUploadHook {
  const { onAttach, onFail } = handlers;
  const [uploading, setUploading] = useState<boolean>(false);
  const [tgBedReady, setTgBedReady] = useState<boolean>(false);

  const { apiBaseUrl, apiKey } = settings;

  // 挂载 / 连接配置变化时探测一次 TG图床可用性（失败=不可用，安全降级服务器通道）
  useEffect((): (() => void) => {
    let cancelled: boolean = false;
    void checkTgImageBedAvailable(apiBaseUrl, apiKey).then((ok: boolean): void => {
      if (!cancelled) {
        setTgBedReady(ok);
      }
    });
    return (): void => {
      cancelled = true;
    };
  }, [apiBaseUrl, apiKey]);

  /**
   * 批量上传公共循环：逐张调用注入的单图上传函数，成功经 onAttach 入附件条，失败聚合计数提示。
   */
  const uploadImages = async (files: FileList, uploadOne: (raw: File) => Promise<MomentAttach>): Promise<void> => {
    const images: File[] = Array.from(files).filter((f: File): boolean => f.type.startsWith('image/'));
    if (images.length === 0) {
      return;
    }
    setUploading(true);
    let failed: number = 0;
    let failMsg: string = '';
    for (const raw of images) {
      try {
        onAttach(await uploadOne(raw));
      } catch (err: unknown) {
        failed += 1;
        failMsg = err instanceof ApiError ? err.message : '上传失败';
      }
    }
    setUploading(false);
    if (failed > 0) {
      const summary: string = failed === images.length
        ? failMsg
        : `${images.length - failed}/${images.length} 张上传成功，${failed} 张失败：${failMsg}`;
      onFail(summary);
    }
  };

  /** 服务器通道：逐张压缩（>1MB）→ media.upload → 带 mediaId 附件 */
  const uploadToServer: ChannelUploader = (files: FileList): Promise<void> =>
    uploadImages(files, async (raw: File): Promise<MomentAttach> => {
      const file: File = await compressImageFile(raw);
      const result: UploadResult = await uploadMedia(apiBaseUrl, apiKey, file);
      return { kind: 'image', id: newAttachId(), url: result.url, mediaId: result.media_id, source: 'server' };
    });

  /** TG图床通道：直传原图不压缩（保真；≤20MB 与格式白名单由插件端校验报错），瞬时网络故障静默重试一次 */
  const uploadToTg: ChannelUploader = (files: FileList): Promise<void> =>
    uploadImages(files, async (raw: File): Promise<MomentAttach> => {
      const result = await withBedRetry((): Promise<TgImageBedUploadResult> => uploadTgImageBed(apiBaseUrl, apiKey, raw));
      return { kind: 'image', id: newAttachId(), url: result.url, mediaId: null, source: 'tg' };
    });

  return { uploading, tgBedReady, uploadToServer, uploadToTg };
}
