// browser-extension/src/shared/storage/ai-history.ts
// AI 会话历史的读写（chrome.storage.local）：多会话列表 CRUD，供 AiChatTab 与历史面板使用。
import type { AiSession } from '../types';
import { STORAGE_KEYS } from './settings';

/** 读取全部会话（按更新时间倒序；结构异常回退空数组） */
export async function readAiSessions(): Promise<AiSession[]> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.aiSessions);
  const raw = stored[STORAGE_KEYS.aiSessions];
  if (!Array.isArray(raw)) {
    return [];
  }
  const sessions: AiSession[] = [];
  for (const item of raw) {
    const obj = item as Record<string, unknown>;
    if (
      typeof obj.id === 'string' &&
      typeof obj.title === 'string' &&
      typeof obj.updatedAt === 'number' &&
      Array.isArray(obj.messages)
    ) {
      sessions.push(obj as unknown as AiSession);
    }
  }
  return sessions.sort((a: AiSession, b: AiSession): number => b.updatedAt - a.updatedAt);
}

/** 覆写会话列表（时间倒序保持） */
async function writeSessions(sessions: readonly AiSession[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.aiSessions]: [...sessions] });
}

/** 新增或更新一个会话（按 id 匹配；更新时间戳） */
export async function upsertAiSession(session: AiSession): Promise<void> {
  const sessions: AiSession[] = await readAiSessions();
  const idx: number = sessions.findIndex((s: AiSession): boolean => s.id === session.id);
  const next: AiSession = { ...session, updatedAt: Date.now() };
  if (idx >= 0) {
    sessions[idx] = next;
  } else {
    sessions.unshift(next);
  }
  await writeSessions(sessions);
}

/** 删除一个会话 */
export async function deleteAiSession(id: string): Promise<void> {
  const sessions: AiSession[] = await readAiSessions();
  await writeSessions(sessions.filter((s: AiSession): boolean => s.id !== id));
}

/** 清空全部历史会话 */
export async function clearAiSessions(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.aiSessions);
}

/** 关键词过滤（标题或任一消息内容；大小写不敏感；空串返回全部） */
export function filterSessions(sessions: readonly AiSession[], query: string): AiSession[] {
  const q: string = query.trim().toLowerCase();
  if (q === '') {
    return [...sessions];
  }
  return sessions.filter((s: AiSession): boolean => {
    if (s.title.toLowerCase().includes(q)) {
      return true;
    }
    return s.messages.some((m) => m.content.toLowerCase().includes(q));
  });
}
