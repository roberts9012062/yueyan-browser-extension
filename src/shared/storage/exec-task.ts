// browser-extension/src/shared/storage/exec-task.ts
// 右键任务与说说草稿篮的存取封装（仅扩展页上下文使用；background 因自包含约束本地写 storage）。

import { parseExecTask } from '../messages/types';
import type { ExecTarget, ExecTask, MomentDraft } from '../messages/types';
import { STORAGE_KEYS } from './settings';

/** 任务过期时限（毫秒）：超龄任务视为浏览器重启残留，面板领取时静默丢弃 */
export const EXEC_TASK_STALE_MS: number = 2 * 60 * 1000;

/** 读取当前待执行任务（无/非法/已过期返回 null；纯读取，不清除） */
export async function readExecTask(): Promise<ExecTask | null> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.execTask);
  const task: ExecTask | null = parseExecTask(stored[STORAGE_KEYS.execTask]);
  if (task === null || Date.now() - task.createdAt > EXEC_TASK_STALE_MS) {
    return null;
  }
  return task;
}

/** 改写任务消费者标记（background 球探测失败转面板兜底时调用） */
export async function writeExecTaskTarget(target: ExecTarget): Promise<void> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.execTask);
  const task: ExecTask | null = parseExecTask(stored[STORAGE_KEYS.execTask]);
  if (task === null) {
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.execTask]: { ...task, target } });
}

/** 清除待执行任务 */
export async function clearExecTask(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.execTask);
}

/**
 * 面板上下文两阶段认领：先把自己写为 owner（target 改写为 'claimed' 使后续 parse 失败），
 * 再回读确认 owner 未被覆盖。多面板（原生侧栏/页内停靠/悬浮窗/他页 embed）同时收到
 * 广播时只有最后落笔且回读一致者胜出，把并发窗口压到毫秒级。
 */
export async function claimPanelExecTask(broadcastNonce: string): Promise<ExecTask | null> {
  const KEY: string = STORAGE_KEYS.execTask;
  const stored: Record<string, unknown> = await chrome.storage.local.get(KEY);
  const task: ExecTask | null = parseExecTask(stored[KEY]);
  if (task === null || task.target !== 'panel') {
    return null;
  }
  if (broadcastNonce !== '' && task.nonce !== broadcastNonce) {
    return null;
  }
  const owner: string = crypto.randomUUID();
  await chrome.storage.local.set({ [KEY]: { ...task, target: 'claimed', owner } });
  const raw = (await chrome.storage.local.get(KEY))[KEY] as Record<string, unknown> | undefined;
  if (typeof raw !== 'object' || raw === null || raw.owner !== owner) {
    return null; // 已被其他面板上下文抢先认领
  }
  return task;
}

/**
 * 执行框 iframe 页认领（悬浮球旁）：URL 携带的 nonce 与 storage 任务匹配（target=ball）即占用。
 * 执行框全局唯一（悬浮球单例），无并发竞争，直接标记 claimed。
 */
export async function claimBallExecTask(urlNonce: string): Promise<ExecTask | null> {
  const KEY: string = STORAGE_KEYS.execTask;
  const stored: Record<string, unknown> = await chrome.storage.local.get(KEY);
  const task: ExecTask | null = parseExecTask(stored[KEY]);
  if (task === null || task.target !== 'ball' || task.nonce !== urlNonce) {
    return null;
  }
  await chrome.storage.local.set({ [KEY]: { ...task, target: 'claimed' } });
  return task;
}

/** 读取说说草稿篮（无记录返回空草稿） */
export async function readMomentDraft(): Promise<MomentDraft> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.momentDraft);
  const raw = stored[STORAGE_KEYS.momentDraft];
  if (typeof raw !== 'object' || raw === null) {
    return { text: '', images: [], updatedAt: 0 };
  }
  const obj = raw as Record<string, unknown>;
  return {
    text: typeof obj.text === 'string' ? obj.text : '',
    images: Array.isArray(obj.images) ? obj.images.filter((v: unknown): boolean => typeof v === 'string') : [],
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : 0,
  };
}

/** 持久化说说草稿篮 */
export async function saveMomentDraft(draft: MomentDraft): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.momentDraft]: { ...draft, updatedAt: Date.now() } });
}

/** 清空说说草稿篮（发送成功 / 用户点清空） */
export async function clearMomentDraft(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.momentDraft);
}

/**
 * 应用一次右键增量到草稿篮（纯函数）：文字追加（换行衔接）、图片追加去重。
 * 返回新草稿；无变化时原样返回。
 */
export function applyMomentDelta(draft: MomentDraft, addText: string, addImage: string): MomentDraft {
  let text: string = draft.text;
  if (addText !== '') {
    text = text === '' ? addText : `${text}\n${addText}`;
  }
  const images: string[] =
    addImage !== '' && draft.images.indexOf(addImage) < 0 ? [...draft.images, addImage] : draft.images;
  return { text, images, updatedAt: Date.now() };
}
