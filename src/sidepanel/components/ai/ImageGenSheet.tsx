// browser-extension/src/sidepanel/components/ai/ImageGenSheet.tsx
// 「图片生成」描述输入弹层：输入画面描述 → ai.assist(image) 文生图。
interface ImageGenSheetProps {
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}

export function ImageGenSheet(props: ImageGenSheetProps) {
  let prompt = '';

  return (
    <div
      className="absolute inset-0 z-50 flex items-end bg-black/30"
      onClick={(e: React.MouseEvent): void => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <section className="w-full rounded-t-2xl border-t border-line bg-bg px-4 pb-5 pt-3 shadow-[var(--yy-shadow-card-hover)]">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">图片生成</h3>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="关闭"
            className="rounded-full px-2 text-lg leading-none text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
          >
            ×
          </button>
        </header>
        <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
          描述想要的画面（主体、场景、风格），由站点配置的文生图模型生成，图片会转存到站点媒体库。
        </p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: React.FormEvent): void => {
            e.preventDefault();
            const trimmed: string = prompt.trim();
            if (trimmed !== '') {
              props.onSubmit(trimmed);
            }
          }}
        >
          <textarea
            rows={3}
            autoFocus
            placeholder="如：一只戴眼镜的橘猫在月光下看书，水彩风格"
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void => {
              prompt = e.target.value;
            }}
            className="thin-scroll w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-accent py-2.5 text-sm font-medium text-on-accent transition-opacity duration-200 hover:opacity-90"
          >
            生成图片
          </button>
        </form>
      </section>
    </div>
  );
}
