// browser-extension/src/sidepanel/components/WelcomeView.tsx
// 未连接欢迎页：整屏引导 + 连接表单。
import { ConnectForm } from './ConnectForm';

interface WelcomeViewProps {
  /** 预填站点地址（上次未完成配置时回显） */
  initialUrl: string;
  /** 提交中标志 */
  submitting: boolean;
  /** 失败文案（含会话失效提示） */
  error: string;
  /** 提交回调 */
  onSubmit: (url: string, key: string) => void;
}

/** 连接步骤说明文案 */
const STEPS: readonly string[] = [
  '① 打开站点后台「接口开放」页面',
  '② 勾选需要的接口（含「我的资料」），备注名可填「浏览器插件」，生成 Key',
  '③ 在下方填入站点地址与生成的 Key',
];

export function WelcomeView(props: WelcomeViewProps) {
  return (
    <div className="flex h-full flex-col justify-center gap-6 overflow-y-auto thin-scroll px-5 py-8">
      <header>
        <p className="mb-1 text-sm text-ink-2">👋 你好</p>
        <h1 className="font-display text-xl font-semibold leading-snug text-ink">连接你的月言站点</h1>
        <p className="mt-2 text-xs leading-relaxed text-ink-2">
          月言博客助手通过站点的开放接口工作：
          被站长勾选授权的接口即可远程调用。只需一次连接，即可浏览站点动态、体验 AI 问答。
        </p>
      </header>

      <ol className="flex flex-col gap-1.5 rounded-lg border border-line bg-elevated px-4 py-3 text-xs leading-relaxed text-ink-2">
        {STEPS.map((step: string) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <ConnectForm
        initialUrl={props.initialUrl}
        initialKey=""
        submitting={props.submitting}
        error={props.error}
        onSubmit={props.onSubmit}
      />
    </div>
  );
}
