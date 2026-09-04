// browser-extension/src/shared/permissions.ts
// 运行时主机授权封装：manifest 仅声明 optional_host_permissions（http/https 全域），
// 实际使用前按需申请（网页总结 / 区域截图 / 图床 Worker 直连共用同一授权）。
// chrome.permissions.request 必须在用户手势（click 等）调用栈内执行；
// 授权结果持久化生效，已授权时本函数静默通过、不再弹框。

/** 全域 http/https 主机授权所需的最小声明 */
const WIDE_HOSTS: chrome.permissions.Permissions = { origins: ['http://*/*', 'https://*/*'] };

/**
 * 只读检查是否已持有全域主机授权（不弹框、无手势要求）。
 * 非用户手势场景（如 useEffect 内的可用性探测）只能对已授权的域名发请求，前置判断用它。
 */
export async function hasWideHostPermission(): Promise<boolean> {
  return chrome.permissions.contains(WIDE_HOSTS).catch((): boolean => false);
}

/**
 * 确保已持有全域主机授权：已授权直接通过；未授权弹浏览器授权框（须在用户手势内调用）。
 * 返回 true=已授权；false=用户拒绝或申请失败（调用方自行提示）。
 */
export async function ensureWideHostPermission(): Promise<boolean> {
  if (await hasWideHostPermission()) {
    return true;
  }
  return chrome.permissions.request(WIDE_HOSTS).catch((): boolean => false);
}
