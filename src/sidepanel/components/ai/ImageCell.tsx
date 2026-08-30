// browser-extension/src/sidepanel/components/ai/ImageCell.tsx
// 消息内图片渲染：优先 IndexedDB 本地缓存（离线/站点失效仍可看），未命中回退远程 URL。
import { useEffect, useState } from 'react';
import { getCachedImage } from '../../../shared/storage/image-cache';

interface ImageCellProps {
  /** 远程图片地址（站点媒体库） */
  src: string;
}

export function ImageCell(props: ImageCellProps): React.ReactNode {
  // 展示地址：先远程（立即可见），本地缓存命中后切换为 objectURL
  const [display, setDisplay] = useState<string>(props.src);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (props.src.startsWith('data:') || props.src.startsWith('blob:')) {
      return (): void => undefined;
    }
    void (async (): Promise<void> => {
      const blob: Blob | null = await getCachedImage(props.src);
      if (cancelled || blob === null) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setDisplay(objectUrl);
    })();
    return (): void => {
      cancelled = true;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [props.src]);

  return (
    <img
      src={display}
      alt="图片"
      onClick={(): void => {
        window.open(props.src, '_blank');
      }}
      className="max-h-64 w-full cursor-zoom-in rounded-lg object-cover"
    />
  );
}
