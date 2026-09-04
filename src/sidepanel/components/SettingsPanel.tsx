// browser-extension/src/sidepanel/components/SettingsPanel.tsx
// 设置面板（顶栏齿轮打开）：通用偏好（悬浮球开关、导航自动同步）、发布图床（TG/CF）、
// 站点连接（身份/改配置重连/断开）。后续新增设置项按分区（SectionTitle）追加在对应分组下。
import { ConnectForm } from './ConnectForm';
import { REPO_URL, REPO_LABEL } from '../../shared/repo';
import { ImageBedSection } from './settings/ImageBedSection';
import type { ImageBedConfig, PluginSettings, UserProfile } from '../../shared/types';

interface SettingsPanelProps {
  /** 当前设置（回显 url 与 key 掩码） */
  settings: PluginSettings;
  /** 当前登录用户（用于展示身份） */
  profile: UserProfile | null;
  /** 提交中标志 */
  submitting: boolean;
  /** 上次操作失败的文案 */
  error: string;
  /** 提交回调（重新连接） */
  onSubmit: (url: string, key: string) => void;
  /** 断开连接回调 */
  onDisconnect: () => void;
  /** 切换网页球形悬浮显示 */
  onToggleBall: (show: boolean) => void;
  /** 切换站点导航自动同步（打开书签页时静默刷新镜像） */
  onToggleAutoSync: (on: boolean) => void;
  /** 保存发布图床配置（文章发布时正文图片的存储通道） */
  onSaveImageBed: (config: ImageBedConfig) => void;
  /** 关闭弹层 */
  onClose: () => void;
}

/** Key 展示掩码：保留前缀与前几位，其余隐藏 */
function maskKey(key: string): string {
  if (key.length <= 16) {
    return `${key.slice(0, 4)}****`;
  }
  return `${key.slice(0, 12)}****${key.slice(-4)}`;
}

/** 分区小标题（设置项分组用） */
function SectionTitle(props: { text: string }) {
  return <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{props.text}</h3>;
}

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">设置</h2>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-full px-2 py-0.5 text-lg leading-none text-ink-2 transition-colors duration-200 hover:bg-muted hover:text-ink"
          aria-label="关闭"
        >
          ×
        </button>
      </header>

      <div className="flex flex-col gap-5 overflow-y-auto thin-scroll px-5 py-5">
        {/* ---------- 通用 ---------- */}
        <SectionTitle text="通用" />

        {/* 球形悬浮入口开关 */}
        <section className="flex items-center justify-between rounded-xl border border-line bg-elevated px-4 py-3">
          <div className="min-w-0 pr-3">
            <p className="text-sm text-ink">球形悬浮</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">在浏览的网页上显示可拖动的浮球入口，点击即可展开面板</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={props.settings.showBall}
            onClick={(): void => props.onToggleBall(!props.settings.showBall)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
              props.settings.showBall ? 'bg-accent' : 'bg-muted'
            }`}
          >
            <span
              className="absolute top-0.5 size-4 rounded-full bg-elevated shadow transition-all duration-200"
              style={{ left: props.settings.showBall ? 18 : 2 }}
            />
          </button>
        </section>

        {/* 站点导航自动同步开关 */}
        <section className="flex items-center justify-between rounded-xl border border-line bg-elevated px-4 py-3">
          <div className="min-w-0 pr-3">
            <p className="text-sm text-ink">站点导航自动同步</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">打开书签页时自动刷新「站点导航」文件夹（与站点精品导航数据保持一致）</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={props.settings.autoSyncNav}
            onClick={(): void => props.onToggleAutoSync(!props.settings.autoSyncNav)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
              props.settings.autoSyncNav ? 'bg-accent' : 'bg-muted'
            }`}
          >
            <span
              className="absolute top-0.5 size-4 rounded-full bg-elevated shadow transition-all duration-200"
              style={{ left: props.settings.autoSyncNav ? 18 : 2 }}
            />
          </button>
        </section>

        {/* ---------- 发布图床 ---------- */}
        <SectionTitle text="发布图床" />

        <p className="text-xs leading-relaxed text-ink-3">
          选择 AI 生成文章发布时正文图片的保存位置；仅影响「生成文章」的发布，写说说的图片通道在发布器内单独选择。
        </p>

        <ImageBedSection settings={props.settings} onSave={props.onSaveImageBed} />

        {/* ---------- 关于 ---------- */}
        <SectionTitle text="关于" />

        <section className="flex items-center justify-between rounded-xl border border-line bg-elevated px-4 py-3">
          <div className="min-w-0 pr-3">
            <p className="text-sm text-ink">开源仓库</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">本插件以 MIT 协议开源，源码与各版本发布包见 GitHub 仓库</p>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[11px] text-ink-2 transition-colors duration-200 hover:bg-muted"
          >
            {REPO_LABEL}
          </a>
        </section>

        {/* ---------- 站点连接 ---------- */}
        <SectionTitle text="站点连接" />

        {/* 当前身份卡 */}
        <section className="flex items-center gap-3 rounded-xl border border-line bg-elevated px-4 py-3">
          {props.profile !== null && props.profile.avatar_url !== '' ? (
            <img
              src={props.profile.avatar_url}
              alt={props.profile.nickname}
              className="size-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-base text-glow">
              🙂
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{props.profile?.nickname ?? '未绑定用户'}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3">{maskKey(props.settings.apiKey)}</p>
          </div>
        </section>

        <p className="text-xs leading-relaxed text-ink-3">
          更换站点或 Key 后保存即重新连接；断开仅清除本机存储的凭证，不影响站点后台的 Key。
        </p>

        <ConnectForm
          initialUrl={props.settings.apiBaseUrl}
          initialKey={props.settings.apiKey}
          submitting={props.submitting}
          error={props.error}
          onSubmit={props.onSubmit}
        />

        <button
          type="button"
          onClick={props.onDisconnect}
          className="w-full rounded-full border border-line py-2.5 text-sm text-ink-2 transition-colors duration-200 hover:border-like hover:text-like"
        >
          断开连接
        </button>
      </div>
    </div>
  );
}
