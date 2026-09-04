// browser-extension/src/shared/storage/bookmark-db.ts
// 书签树 IndexedDB 主存（库 yueyan-bookmarks / 仓库 tree，单记录 key='tree'）。
//
// 背景：书签原存 chrome.storage.local（bookmarks_v2），用户要求升级/环境变化时更不易丢失——
// IndexedDB 走事务日志更抗损坏、容量随磁盘（unlimitedStorage）。现与 chrome.storage
// 双份互为兜底：写双写、读调和（savedAt 新者胜，读后把较旧一份收敛一致）。
// 边界：悬浮球是 content script，其 IndexedDB 属宿主页 origin（不可用于扩展数据），
//       仍写 chrome.storage——由本模块的调和逻辑保证其收藏被收敛进 IndexedDB 主存。

import type { BookmarkTree } from '../types';

/** 数据库名 / 仓库名 / 版本 / 单记录 key */
const DB_NAME: string = 'yueyan-bookmarks';
const STORE: string = 'tree';
const DB_VERSION: number = 1;
const RECORD_KEY: string = 'tree';

/** 数据库连接（惰性单例） */
let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开数据库（首次自动建仓库；失败抛错由调用方兜底） */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) {
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase>((resolve: (db: IDBDatabase) => void, reject: (e: Error) => void): void => {
    const req: IDBOpenDBRequest = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (): void => {
      if (req.result.objectStoreNames.contains(STORE) === false) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error ?? new Error('打开书签数据库失败'));
  });
  return dbPromise;
}

/** 结构守卫：有 roots 数组才视为合法树（IndexedDB 记录可能损坏/被旧版本写入） */
export function isBookmarkTree(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).roots);
}

/** 读取 IndexedDB 中的书签树（无记录 / 库不可用返回 null，由调用方调和兜底） */
export async function loadBookmarkTree(): Promise<BookmarkTree | null> {
  try {
    const db: IDBDatabase = await openDb();
    return await new Promise<BookmarkTree | null>((resolve: (t: BookmarkTree | null) => void, reject: (e: Error) => void): void => {
      const tx: IDBTransaction = db.transaction(STORE, 'readonly');
      const req: IDBRequest<unknown> = tx.objectStore(STORE).get(RECORD_KEY);
      req.onsuccess = (): void => resolve(isBookmarkTree(req.result) ? (req.result as BookmarkTree) : null);
      req.onerror = (): void => reject(req.error ?? new Error('读取书签数据库失败'));
    });
  } catch {
    return null;
  }
}

/** 写入 IndexedDB（调用方保证已带 savedAt；失败抛错由调用方兜底） */
export async function persistBookmarkTree(tree: BookmarkTree): Promise<void> {
  const db: IDBDatabase = await openDb();
  await new Promise<void>((resolve: () => void, reject: (e: Error) => void): void => {
    const tx: IDBTransaction = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(tree, RECORD_KEY);
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error('写入书签数据库失败'));
  });
}

/**
 * 双份调和（纯函数）：两份快照以 savedAt 新者胜（无 savedAt 视为 0），
 * 仅一边有则取该边；两份全空返回 null。
 */
export function mergeBookmarkTree(idb: BookmarkTree | null, storage: BookmarkTree | null): BookmarkTree | null {
  if (idb === null) {
    return storage;
  }
  if (storage === null) {
    return idb;
  }
  const savedInDb: number = idb.savedAt ?? 0;
  const savedInStorage: number = storage.savedAt ?? 0;
  return savedInDb >= savedInStorage ? idb : storage;
}

/**
 * 调和读取：输入 chrome.storage 快照与存储键（键名由 settings.ts 的 STORAGE_KEYS 提供，
 * 显式传参避免两模块互相 import 成环），内部读 IndexedDB 并调和，返回胜出树；
 * 同时把较旧/缺失的一份异步收敛为一致（失败静默，不阻塞读取）。
 */
export async function loadMergedBookmarkTree(
  storageSnapshot: BookmarkTree | null,
  storageKey: string,
): Promise<BookmarkTree | null> {
  const fromDb: BookmarkTree | null = await loadBookmarkTree();
  const merged: BookmarkTree | null = mergeBookmarkTree(fromDb, storageSnapshot);
  if (merged === null) {
    return null;
  }
  const savedAt: number = merged.savedAt ?? 0;
  if (fromDb === null || (fromDb.savedAt ?? 0) < savedAt) {
    void persistBookmarkTree(merged).catch((): undefined => undefined);
  }
  if (storageSnapshot === null || (storageSnapshot.savedAt ?? 0) < savedAt) {
    void chrome.storage.local.set({ [storageKey]: merged }).catch((): undefined => undefined);
  }
  return merged;
}
