// browser-extension/src/shared/storage/settings.ts
// 设置与缓存的 chrome.storage.local 封装：键名集中登记、读取时结构校验合并缺省值。
// 安全约束（手册 §7）：token/key 只入 chrome.storage，禁止 localStorage/sessionStorage。
// 书签树持久化逻辑在 bookmark-store.ts（自本文件拆出），键名仍集中于此登记。

import type { PluginSettings, SiteMeta, UserProfile } from '../types';

/** 存储键集中登记（全插件唯一来源，禁止散落魔术字符串） */
export const STORAGE_KEYS = {
  settings: 'plugin_settings_v1',
  profile: 'profile_cache_v1',
  siteMeta: 'site_meta_cache_v1',
  ballPosition: 'ball_position_v1',
  /** v2 树形书签（读写见 bookmark-store.ts） */
  bookmarks: 'bookmarks_v2',
  /** v1 扁平书签（迁移数据源，读取后保留不删，防回滚丢数据） */
  bookmarksLegacy: 'bookmarks_v1',
  /** 书签树中处于收起状态的文件夹/区块 ID 集合 */
  bookmarksCollapsed: 'bookmarks_collapsed_v1',
  /** AI 对话记录（当前会话消息流） */
  aiChat: 'ai_chat_v1',
  /** 用户自定义提示词列表 */
  aiPrompts: 'ai_prompts_v1',
  /** AI 历史会话列表 */
  aiSessions: 'ai_sessions_v1',
  /** 站点私有导航已解锁标记（密码校验通过的免输标记；断开连接即清除，密码不落盘） */
  navPrivateUnlocked: 'nav_private_unlocked_v1',
  /** 右键任务待执行载荷（结构见 shared/messages/types.ts ExecTask；消费后由下一任务覆盖） */
  execTask: 'exec_task_v1',
  /** 说说草稿篮（右键「加入选中文字/此图片」跨次累积，发送成功或清空后移除） */
  momentDraft: 'exec_moment_draft_v1',
} as const;

/** 默认设置（新装/字段缺失时的回退） */
export const DEFAULT_SETTINGS: PluginSettings = {
  apiBaseUrl: '',
  apiKey: '',
  theme: 'cool-moon',
  showBall: true,
  autoSyncNav: true,
  publishImageBed: 'none',
  cfBedUrl: '',
  cfBedKey: '',
};

/** 发布图床合法值白名单（读取时非法值回退 none） */
const PUBLISH_BEDS: readonly PluginSettings['publishImageBed'][] = ['none', 'tg', 'cf'];

/** 悬浮球屏幕位置（视口像素坐标） */
export interface BallPosition {
  x: number;
  y: number;
}

/** 归一化站点地址：trim、补协议、去尾斜杠（纯函数） */
export function normalizeBaseUrl(raw: string): string {
  let url: string = raw.trim();
  if (url === '') {
    return '';
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/u, '');
}

/** 判定设置是否已配置完整（纯函数） */
export function isConfigured(settings: PluginSettings): boolean {
  return settings.apiBaseUrl !== '' && settings.apiKey !== '';
}

/** 读取设置（缺失/类型不符的字段用默认值补齐） */
export async function readSettings(): Promise<PluginSettings> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = stored[STORAGE_KEYS.settings];
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const obj = raw as Record<string, unknown>;
  // 发布图床字段归一化：bed 非法值回退 none；CF 地址复用站点地址的归一规则
  const rawBed: unknown = obj.publishImageBed;
  const bed: PluginSettings['publishImageBed'] =
    PUBLISH_BEDS.indexOf(rawBed as PluginSettings['publishImageBed']) >= 0
      ? (rawBed as PluginSettings['publishImageBed'])
      : 'none';
  return {
    apiBaseUrl: typeof obj.apiBaseUrl === 'string' ? normalizeBaseUrl(obj.apiBaseUrl) : '',
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : '',
    theme: obj.theme === 'mist' ? 'mist' : 'cool-moon',
    showBall: obj.showBall !== false,
    autoSyncNav: obj.autoSyncNav !== false,
    publishImageBed: bed,
    cfBedUrl: typeof obj.cfBedUrl === 'string' ? normalizeBaseUrl(obj.cfBedUrl) : '',
    cfBedKey: typeof obj.cfBedKey === 'string' ? obj.cfBedKey : '',
  };
}

/** 持久化设置 */
export async function saveSettings(settings: PluginSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

/** 读取用户资料缓存（无效返回 null） */
export async function readCachedProfile(): Promise<UserProfile | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.profile);
  const raw = stored[STORAGE_KEYS.profile];
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'number' || typeof obj.nickname !== 'string') {
    return null;
  }
  return raw as UserProfile;
}

/** 写入用户资料缓存 */
export async function saveCachedProfile(profile: UserProfile): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.profile]: profile });
}

/** 读取站点信息缓存（无效返回 null） */
export async function readCachedSiteMeta(): Promise<SiteMeta | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.siteMeta);
  const raw = stored[STORAGE_KEYS.siteMeta];
  if (typeof raw !== 'object' || raw === null || typeof (raw as Record<string, unknown>).site_name !== 'string') {
    return null;
  }
  return raw as SiteMeta;
}

/** 写入站点信息缓存 */
export async function saveCachedSiteMeta(meta: SiteMeta): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.siteMeta]: meta });
}

/** 断开连接：清除 Key 与身份缓存（保留主题偏好），并同步清除私有导航解锁标记 */
export async function clearConnection(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.profile, STORAGE_KEYS.siteMeta, STORAGE_KEYS.navPrivateUnlocked]);
}

/** 读取私有导航解锁标记（true=密码校验通过过，免重复输入） */
export async function readNavPrivateUnlocked(): Promise<boolean> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.navPrivateUnlocked);
  return stored[STORAGE_KEYS.navPrivateUnlocked] === true;
}

/** 写入私有导航解锁标记（解锁成功置 true；「重新锁定」或站点配置变化置 false） */
export async function saveNavPrivateUnlocked(unlocked: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.navPrivateUnlocked]: unlocked });
}

/** 读取悬浮球位置（无效返回 null，由调用方回退默认位置） */
export async function readBallPosition(): Promise<BallPosition | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.ballPosition);
  const raw = stored[STORAGE_KEYS.ballPosition];
  if (
    typeof raw !== 'object' || raw === null ||
    typeof (raw as Record<string, unknown>).x !== 'number' ||
    typeof (raw as Record<string, unknown>).y !== 'number'
  ) {
    return null;
  }
  return raw as BallPosition;
}

/** 持久化悬浮球位置 */
export async function saveBallPosition(pos: BallPosition): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.ballPosition]: pos });
}
