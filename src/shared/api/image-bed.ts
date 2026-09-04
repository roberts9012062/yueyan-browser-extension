// browser-extension/src/shared/api/image-bed.ts
// 图床插件开放端点调用：TG图床（tg-image-bed，经开放网关泛化转发）与
// CF图床（image-cdn 配对的 Cloudflare R2 Worker 直连）的上传与可用性探测。
// TG 端点由插件清单 open_endpoints 声明、开放网关转发（/api/v1/open/plugins/:id/*path）；
// CF Worker 无开放端点（image-cdn 未声明 open_endpoints），按其部署契约直连
// （POST /upload Bearer + multipart file；GET /health 配对测试）。
// 路径与请求/响应结构手工同步 marketplace-repo/tg-image-bed/yueyan-plugin.json、
// marketplace-repo/image-cdn/worker/index.js 与各插件 main.go。

import { ApiError, fetchWithTimeout, openPost } from './client';

/** API 版本前缀（与 endpoints.ts 的 API_PREFIX 同值；独立文件故本地声明） */
const API_PREFIX = '/api/v1';

/** TG图床上传端点路径（清单声明 path，手工同步） */
const TG_UPLOAD_PATH: string = `${API_PREFIX}/open/plugins/tg-image-bed/upload`;

/** TG图床上传响应（网关信封 data；与插件 uploadResponse 对齐，仅取插件侧实际使用的字段） */
export interface TgImageBedUploadResult {
  /** 公开访问地址（{反代 Worker}/f/{file_id}，说说正文 <img> 直用） */
  url: string;
  /** TG 文件标识（storage_key） */
  storage_key: string;
  mime: string;
  size: number;
  /** Markdown 形态 ![文件名](URL)（插件图库复制用，说说场景暂不消费） */
  markdown: string;
}

/** File 转 base64（纯异步函数）：经 dataURL 中转，避免大文件 btoa 逐字符编码的性能问题 */
function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve: (v: string) => void, reject: (e: Error) => void): void => {
    const reader: FileReader = new FileReader();
    reader.onload = (): void => {
      const dataUrl: string = String(reader.result);
      const comma: number = dataUrl.indexOf(',');
      if (comma < 0) {
        reject(new Error('文件读取结果异常'));
        return;
      }
      resolve(dataUrl.slice(comma + 1));
    };
    reader.onerror = (): void => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 上传图片到 TG 图床（原图保真，不压缩；单图 ≤ 20MB，jpg/jpeg/png/gif/webp 由插件端校验）。
 * 超时 120s：TG Bot API 上传较慢，给足余量。失败抛 ApiError（message 含插件端错误原因）。
 */
export async function uploadTgImageBed(
  baseUrl: string,
  apiKey: string,
  file: File,
): Promise<TgImageBedUploadResult> {
  const contentB64: string = await fileToBase64(file);
  return openPost<TgImageBedUploadResult>(baseUrl, apiKey, TG_UPLOAD_PATH, {
    filename: file.name,
    mime: file.type,
    content_b64: contentB64,
  }, 120000);
}

/**
 * TG图床可用性探测（零副作用）：对 upload 端点发空对象 body——
 * 开放网关的 Key 鉴权中间件先于插件执行，故返回 HTTP 400（插件参数校验拦下）
 * 即证明「插件已装并启用 + Key 已勾选该端点」→ 可用；
 * 403=Key 未勾选 / 404=未装或站点后端过旧 / 503=插件未启用 / 其他=站点不可达 → 均不可用。
 */
export async function checkTgImageBedAvailable(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    await openPost<unknown>(baseUrl, apiKey, TG_UPLOAD_PATH, {}, 15000);
    return false; // 200 = 空参数竟上传成功（插件语义已变），保守视为不可用
  } catch (err: unknown) {
    return err instanceof ApiError && err.status === 400;
  }
}

/** ---------- CF图床（image-cdn 配对的 Cloudflare R2 Worker 直连） ---------- */

/** CF 图床 Worker 上传响应（与 worker/index.js handleUpload 返回体对齐） */
export interface CfImageBedUploadResult {
  /** 公开访问地址（{PUBLIC_BASE}/f/{key}，正文 <img src> 直用） */
  url: string;
  /** R2 对象键（yyyymm/16hex.ext） */
  key: string;
  size: number;
  mime: string;
}

/**
 * CF Worker 原生 JSON 请求（非开放网关信封协议）：Bearer 鉴权、HTTP 状态码即语义，
 * 非 2xx 时透传 Worker 的 error 字段（如「unsupported image type」「image too large」）抛 ApiError。
 */
async function cfRequest<T>(
  workerUrl: string,
  apiKey: string,
  method: 'GET' | 'POST',
  path: string,
  body: BodyInit | undefined,
  timeoutMs: number,
): Promise<T> {
  const response: Response = await fetchWithTimeout(workerUrl, {
    url: path,
    method,
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  }, timeoutMs);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // 非 JSON 响应体（网关错误页等）保留 null，下方按状态码兜底提示
  }
  if (!response.ok) {
    const msg: string =
      typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).error === 'string'
        ? (data as Record<string, unknown>).error as string
        : '';
    throw new ApiError(msg !== '' ? msg : `CF图床返回异常（HTTP ${response.status}）`, response.status);
  }
  return data as T;
}

/**
 * 上传图片到 CF 图床（Worker POST /upload：multipart 字段 file，Bearer API_KEY）。
 * 文件名须带 jpg/jpeg/png/gif/webp 扩展名、≤10MB（Worker 白名单校验，错误信息透传）。
 * 前提：已获 Worker 域名的主机授权（Worker 不回 CORS 头，无授权会被浏览器拦截）。
 */
export async function uploadCfImageBed(
  workerUrl: string,
  apiKey: string,
  file: File,
): Promise<CfImageBedUploadResult> {
  const form: FormData = new FormData();
  form.append('file', file);
  return cfRequest<CfImageBedUploadResult>(workerUrl, apiKey, 'POST', '/upload', form, 60000);
}

/**
 * CF 图床可用性探测（零副作用配对测试）：GET /health 鉴权通过且 R2 绑定就绪返回 {ok:true}；
 * 401=Key 不对 / 网络失败（含未授权主机被拦截）= 不可用。
 */
export async function checkCfImageBedAvailable(workerUrl: string, apiKey: string): Promise<boolean> {
  try {
    const result = await cfRequest<{ ok: boolean }>(workerUrl, apiKey, 'GET', '/health', undefined, 15000);
    return result.ok === true;
  } catch {
    return false;
  }
}

/**
 * 图床上传瞬时故障重试包装（纯异步函数，TG/CF 通道共用）：
 * TG API / CF Worker 偶发网络抖动（如连续快速失败、DNS 抖动）时静默重试一次，
 * 两次都失败才抛第二次的错误。退避 800ms：业务性错误（格式/大小被拒）重试仍会
 * 失败，仅多等一次的成本；瞬时网络故障则被救回，避免整批图片标记失败。
 */
export async function withBedRetry<T>(upload: () => Promise<T>): Promise<T> {
  try {
    return await upload();
  } catch {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 800);
    });
    return upload();
  }
}
