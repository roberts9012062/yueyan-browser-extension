// browser-extension/src/sidepanel/components/AiConnectGuide.tsx
// AI 助手 Tab 未连接占位：AI 问答与生图均经站点开放网关调用，未连接站点时引导先完成连接
// （书签等本地能力不受影响，本组件只负责 AI 入口的引导）。

interface AiConnectGuideProps {
  /** 「去连接」回调（打开设置面板的连接表单） */
  onOpenSettings: () => void;
}

/** AI 助手未连接占位视图 */
export function AiConnectGuide(props: AiConnectGuideProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 pb-16 text-center">
      <span className="text-5xl" aria-hidden>⚡</span>
      <p className="text-sm font-medium text-ink">AI 助手需要先连接站点</p>
      <p className="max-w-[300px] text-xs leading-relaxed text-ink-2">
        AI 问答与生图通过你站点的开放接口调用，连接后即可使用；书签夹在未连接时也可以正常使用。
      </p>
      <button
        type="button"
        onClick={props.onOpenSettings}
        className="rounded-full bg-accent px-5 py-2 text-xs font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
      >
        去连接站点
      </button>
    </div>
  );
}
