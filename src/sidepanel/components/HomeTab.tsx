// browser-extension/src/sidepanel/components/HomeTab.tsx
// 首页 Tab：问候区 + 功能导航卡网格 + 最新帖子预览（对应参考版式的问候语与卡片宫格）。
import { PostList } from './PostList';
import type { PanelTab, PluginSettings, SiteMeta, UserProfile } from '../../shared/types';

interface HomeTabProps {
  /** 站点元信息 */
  meta: SiteMeta | null;
  /** 当前登录用户 */
  profile: UserProfile | null;
  /** 连接设置（帖子列表拉取用） */
  settings: PluginSettings;
  /** 外部刷新令牌（透传给列表） */
  refreshTick: number;
  /** 导航到其他 Tab */
  onGoTab: (tab: PanelTab) => void;
}

/** 功能卡片定义 */
interface FeatureCard {
  key: string;
  icon: string;
  title: string;
  description: string;
  action: 'goto-posts' | 'goto-ai' | 'goto-bookmark' | 'open-site';
}

/** 卡片内容静态配置（动作在组件内分发） */
const FEATURE_CARDS: readonly FeatureCard[] = [
  { key: 'posts', icon: '📰', title: '浏览帖子', description: '站点最新动态', action: 'goto-posts' },
  { key: 'ai', icon: '⚡', title: '智能问答', description: '调用站点 AI 对话', action: 'goto-ai' },
  { key: 'bookmark', icon: '⭐', title: '我的书签', description: '本地书签夹管理', action: 'goto-bookmark' },
  { key: 'site', icon: '🌏', title: '访问站点', description: '在新标签页打开', action: 'open-site' },
];

export function HomeTab(props: HomeTabProps) {
  const displayName: string = props.profile?.nickname ?? '朋友';
  const siteName: string = props.meta?.site_name ?? '';

  return (
    <div className="flex flex-col gap-5">
      {/* 问候区 */}
      <section>
        <p className="text-sm text-ink-2">👋 你好，{displayName}</p>
        <h2 className="font-display mt-0.5 text-lg font-semibold leading-snug text-ink">
          我是{siteName !== '' ? siteName : '月言'}站点助手
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
          作为你的站点伙伴，你可以通过我快速了解动态、与 AI 对话、查看开放接口。
        </p>
      </section>

      {/* 功能卡宫格 */}
      <section className="grid grid-cols-2 gap-2">
        {FEATURE_CARDS.map((card: FeatureCard) => (
          <button
            key={card.key}
            type="button"
            onClick={(): void => {
              if (card.action === 'goto-posts') {
                document.getElementById('home-posts')?.scrollIntoView({ behavior: 'smooth' });
                return;
              }
              if (card.action === 'open-site') {
                if (props.settings.apiBaseUrl !== '') {
                  window.open(props.settings.apiBaseUrl, '_blank');
                }
                return;
              }
              props.onGoTab(card.action === 'goto-ai' ? 'ai' : 'bookmark');
            }}
            className="rounded-xl border border-line bg-elevated px-3 py-3 text-left transition-shadow duration-200 hover:shadow-[var(--yy-shadow-card)]"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <span aria-hidden>{card.icon}</span>
              {card.title}
            </span>
            <span className="mt-1 block text-[11px] text-ink-3">{card.description}</span>
          </button>
        ))}
      </section>

      {/* 最新帖子 */}
      <section id="home-posts" className="flex flex-col gap-2 scroll-mt-4">
        <h3 className="text-xs font-medium tracking-wide text-ink-3">最新帖子</h3>
        <PostList
          apiBaseUrl={props.settings.apiBaseUrl}
          apiKey={props.settings.apiKey}
          count={8}
          refreshTick={props.refreshTick}
        />
      </section>
    </div>
  );
}
