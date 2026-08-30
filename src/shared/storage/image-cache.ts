// browser-extension/src/shared/storage/image-cache.ts
// 生成图片的本地缓存（IndexedDB，存 Blob）：站点媒体库地址 → 本地副本，
// 离线/站点清理后仍可查看。chrome.storage 不适合存大二进制，故走 IndexedDB。
// 配合 manifest 的 unlimitedStorage 权限，容量随磁盘。

/** 缓存条目（key = 图片 URL） */
interface CacheEntry {
  url: string;
  blob: Blob;
  cachedAt: number;
}

/** IndexedDB 库名/仓库名/版本 */
const DB_NAME: string = 'yueyan-image-cache';
const STORE: string = 'images';
const DB_VERSION: number = 1;

/** 打开数据库（惰性单例） */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve: (db: IDBDatabase) => void, reject: () => void): void => {
    const req: IDBOpenDBRequest = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (): void => {
      if (req.result.objectStoreNames.contains(STORE)) {
        return;
      }
      req.result.createObjectStore(STORE, { keyPath: 'url' });
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject();
  });
  return dbPromise;
}

/** 写入缓存（失败静默——缓存是渐进增强，不阻塞主流程） */
export async function putCachedImage(url: string, blob: Blob): Promise<void> {
  try {
    const db: IDBDatabase = await openDb();
    await new Promise<void>((resolve: () => void, reject: () => void): void => {
      const tx: IDBTransaction = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ url, blob, cachedAt: Date.now() } as CacheEntry);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject();
    });
  } catch {
    // 忽略：无痕模式/配额不足等
  }
}

/** 读取缓存（未命中返回 null） */
export async function getCachedImage(url: string): Promise<Blob | null> {
  try {
    const db: IDBDatabase = await openDb();
    const blob: Blob | null = await new Promise((resolve: (b: Blob | null) => void, reject: () => void): void => {
      const tx: IDBTransaction = db.transaction(STORE, 'readonly');
      const req: IDBRequest<unknown> = tx.objectStore(STORE).get(url);
      req.onsuccess = (): void => {
        const entry = req.result as CacheEntry | undefined;
        resolve(entry !== undefined ? entry.blob : null);
      };
      req.onerror = (): void => reject();
    });
    return blob;
  } catch {
    return null;
  }
}

/** 下载远程图片并存入缓存（供图片生成成功后调用；失败静默回退远程展示） */
export async function downloadAndCache(url: string): Promise<void> {
  if (url === '' || url.startsWith('data:') || url.startsWith('blob:')) {
    return;
  }
  try {
    const res: Response = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      return;
    }
    await putCachedImage(url, await res.blob());
  } catch {
    // 站点未放行跨域且未授权主机权限时失败——远程 URL 展示兜底
  }
}
