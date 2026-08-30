// browser-extension/src/sidepanel/components/ConnectForm.tsx
// 连接表单：站点 URL + 开放接口 API Key（欢迎页与管理弹层共用）。
import { useState } from 'react';

interface ConnectFormProps {
  /** 预填站点地址（编辑场景回显） */
  initialUrl: string;
  /** 预填 Key（编辑场景回显） */
  initialKey: string;
  /** 提交中标志（按钮 loading 与禁用） */
  submitting: boolean;
  /** 上次提交失败的文案 */
  error: string;
  /** 提交回调（父级负责请求与持久化） */
  onSubmit: (url: string, key: string) => void;
}

/** 输入框公共样式（表单内复用） */
const INPUT_CLASS: string =
  'w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';

export function ConnectForm(props: ConnectFormProps) {
  const [url, setUrl] = useState<string>(props.initialUrl);
  const [key, setKey] = useState<string>(props.initialKey);

  const canSubmit: boolean = url.trim() !== '' && key.trim() !== '' && !props.submitting;

  /** 明文 HTTP 且非本机回环的站点：在安全环境（HTTPS 网页内嵌面板）中会被浏览器拦截 */
  const isPlainHttp: boolean = /^http:\/\//i.test(url.trim()) &&
    !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url.trim());

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) {
          return;
        }
        props.onSubmit(url.trim(), key.trim());
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">站点地址</span>
        <input
          type="text"
          value={url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          placeholder="如 https://blog.example.com"
          className={INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-2">API Key</span>
        <input
          type="password"
          value={key}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKey(e.target.value)}
          placeholder="oa_ 开头，在后台「接口开放」生成"
          className={`${INPUT_CLASS} font-mono`}
        />
      </label>

      {isPlainHttp && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
          提醒：明文 HTTP 站点无法在 HTTPS 网页的悬浮面板中调用（浏览器混合内容策略），侧边栏与悬浮窗也可能受限。
          建议为站点配置 HTTPS（如 Nginx/Caddy 反向代理 + 域名证书）。
        </p>
      )}

      {props.error !== '' && (
        <p className="rounded-lg border border-like/40 bg-like/10 px-3 py-2 text-xs leading-relaxed text-like">
          {props.error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-1 w-full rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {props.submitting ? '连接中…' : '连接站点'}
      </button>
    </form>
  );
}
