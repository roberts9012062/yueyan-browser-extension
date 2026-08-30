// browser-extension/src/shared/api/client.ts
// 后端 HTTP 客户端（开放网关专用）：统一信封解析、超时与错误类型。
//
// 网络策略（手册 §7.2 修订版）：sidepanel/options 属扩展页面，直连 boke API；
// 跨域依赖服务端 CORS 对 /api/v1/open/ 放行（X-Api-Key 即凭证），插件侧零主机权限。

import type { ApiEnvelope } from '../types';

/** API 错误：携带 HTTP 状态（0=网络不可达/超时）与后端 message */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS: number = 15000;

/** 查询参数构造（undefined 值跳过；纯函数） */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs: string = search.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** 判定是否为本机回环地址的 HTTP 服务（如 http://localhost:3000；此类地址不受混合内容拦截） */
function isLocalHttp(baseUrl: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(baseUrl);
}

/** 构造网络级失败的说明文案（区分「超时」「明文 HTTP 拦截」与普通不可达） */
function describeNetworkError(baseUrl: string, aborted: boolean): string {
  if (aborted) {
    return '请求超时：站点处理时间过长（识图/生图等任务上游较慢），请稍后重试';
  }
  if (/^http:\/\//i.test(baseUrl) && !isLocalHttp(baseUrl)) {
    return '请求已被浏览器拦截：明文 HTTP 站点无法在安全环境中调用（混合内容策略）。请为站点配置 HTTPS（如经 Nginx/Caddy 反向代理 + 域名证书），并将插件中的站点地址改为 HTTPS';
  }
  return '无法连接站点：请检查站点地址是否正确、服务是否在线';
}

/** 开放网关请求描述（url 为以 /api/v1 开头的完整路径） */
interface OpenRequestInit {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
}

/**
 * 带超时的 fetch 封装：超时 abort 与真实网络故障统一抛 ApiError（status=0），
 * 文案按 baseUrl 与 aborted 区分（超时曾被误报为「无法连接站点」）。
 */
async function fetchWithTimeout(baseUrl: string, init: OpenRequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let aborted: boolean = false;
  const timer = setTimeout((): void => {
    aborted = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(`${baseUrl}${init.url}`, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      credentials: 'omit',
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(describeNetworkError(baseUrl, aborted), 0);
  } finally {
    clearTimeout(timer);
  }
}

/** 解析开放接口统一信封（非 JSON 网关错误页兜底；业务失败抛 ApiError） */
async function unwrapEnvelope<T>(response: Response): Promise<T> {
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(`站点返回异常（HTTP ${response.status}）`, response.status);
  }
  if (!response.ok || envelope.code !== 0) {
    throw new ApiError(envelope.message || `请求失败（HTTP ${response.status}）`, response.status);
  }
  return envelope.data;
}

/**
 * 开放接口通用请求。
 * 参数：baseUrl 站点根地址；apiKey 开放 Key；method GET/POST；path 以 /api/v1 开头的完整路径；
 *      body POST 请求体（可选）；timeoutMs 超时毫秒（快接口 15s，识图/生图等慢任务给足余量）。
 * 返回信封 data；失败抛 ApiError。
 */
async function openRequest<T>(
  baseUrl: string,
  apiKey: string,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const headers: Record<string, string> = { 'X-Api-Key': apiKey };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response: Response = await fetchWithTimeout(baseUrl, {
    url: path,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, timeoutMs);
  return unwrapEnvelope<T>(response);
}

/** GET 开放接口（timeoutMs：普通查询 15s） */
export async function openGet<T>(baseUrl: string, apiKey: string, path: string): Promise<T> {
  return openRequest<T>(baseUrl, apiKey, 'GET', path, undefined, REQUEST_TIMEOUT_MS);
}

/** POST 开放接口（JSON 体；timeoutMs 显式传入：对话 60s / 识图与文生图 90s） */
export async function openPost<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  return openRequest<T>(baseUrl, apiKey, 'POST', path, body, timeoutMs);
}

/**
 * multipart 文件上传（openUpload；timeoutMs 显式传入：图片类 60s）。
 * 说明：不设 Content-Type（浏览器自动补 multipart boundary），仅带 Key 头。
 */
export async function openUpload<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  file: File,
  timeoutMs: number,
): Promise<T> {
  const form: FormData = new FormData();
  form.append('file', file);
  const response: Response = await fetchWithTimeout(baseUrl, {
    url: path,
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  }, timeoutMs);
  return unwrapEnvelope<T>(response);
}
