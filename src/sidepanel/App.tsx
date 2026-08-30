// browser-extension/src/sidepanel/App.tsx
// 面板根组件：连接状态机（loading / welcome / ready）+ Tab 骨架 + 首页底部写说说。
import { useEffect, useState } from 'react';
import { getCurrentUser, getSiteMeta } from '../shared/api/endpoints';
import { ApiError } from '../shared/api/client';
import {
  DEFAULT_SETTINGS,
  clearConnection,
  isConfigured,
  normalizeBaseUrl,
  readCachedProfile,
  readCachedSiteMeta,
  readSettings,
  saveCachedProfile,
  saveCachedSiteMeta,
  saveSettings,
} from '../shared/storage/settings';
import type { PanelTab, PluginSettings, SiteMeta, UserProfile } from '../shared/types';
import {
  readCurrentMode,
  switchToDock,
  switchToFloat,
} from '../shared/panel-mode';
import type { PanelMode } from '../shared/panel-mode';
import { HeaderBar } from './components/HeaderBar';
import { WelcomeView } from './components/WelcomeView';
import { ManagePanel } from './components/ManagePanel';
import { HomeTab } from './components/HomeTab';
import { AiChatTab } from './components/ai/AiChatTab';
import { BookmarksTab } from './components/bookmarks/BookmarksTab';
import { MomentComposer } from './components/moment/MomentComposer';

/** 连接阶段 */
type Phase = 'loading' | 'welcome' | 'ready';

/** Tab 定义（顺序即渲染顺序） */
const TABS: readonly { key: PanelTab; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'ai', label: 'AI 助手' },
  { key: 'bookmark', label: '书签' },
];

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [meta, setMeta] = useState<SiteMeta | null>(null);
  const [tab, setTab] = useState<PanelTab>('home');
  const [manageOpen, setManageOpen] = useState<boolean>(false);

  // 面板形态（dock=右侧栏 / float=悬浮窗 / embed=网页内嵌）
  const [mode] = useState<PanelMode>((): PanelMode => readCurrentMode());

  // 连接表单共用状态
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string>('');

  // 数据刷新令牌
  const [refreshTick, setRefreshTick] = useState<number>(0);

  // ---------- 启动：读存储并静默校验身份 ----------
  useEffect(() => {
    void (async () => {
      const loaded: PluginSettings = await readSettings();
      setSettings(loaded);
      document.documentElement.dataset.theme = loaded.theme;

      if (!isConfigured(loaded)) {
        setPhase('welcome');
        return;
      }
      const cachedProfile: UserProfile | null = await readCachedProfile();
      const cachedMeta: SiteMeta | null = await readCachedSiteMeta();
      try {
        const me: UserProfile = await getCurrentUser(loaded.apiBaseUrl, loaded.apiKey);
        void saveCachedProfile(me).catch(() => undefined);
        setProfile(me);
        setPhase('ready');
      } catch (err: unknown) {
        // 会话失效/网络失败：回欢迎页，预填站点地址并提示原因
        setConnectError(err instanceof ApiError ? err.message : '连接校验失败，请重新保存');
        setProfile(cachedProfile);
        setPhase('welcome');
      }
      if (cachedMeta !== null) {
        setMeta(cachedMeta);
      }
    })();
  }, []);

  // ---------- 主题跟随设置 ----------
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // ---------- 连接提交（表单与 Key 校验） ----------
  async function handleConnect(url: string, key: string): Promise<void> {
    setSubmitting(true);
    setConnectError('');
    const baseUrl: string = normalizeBaseUrl(url);

    try {
      const [siteMeta, me]: [SiteMeta, UserProfile] = await Promise.all([
        getSiteMeta(baseUrl, key),
        getCurrentUser(baseUrl, key),
      ]);

      const next: PluginSettings = {
        apiBaseUrl: baseUrl,
        apiKey: key,
        theme: settings.theme,
        showBall: settings.showBall,
      };
      await saveSettings(next);
      void saveCachedProfile(me).catch(() => undefined);
      void saveCachedSiteMeta(siteMeta).catch(() => undefined);

      setSettings(next);
      setProfile(me);
      setMeta(siteMeta);
      setManageOpen(false);
      setTab('home');
      setRefreshTick((n: number) => n + 1);
      setPhase('ready');
    } catch (err: unknown) {
      setConnectError(err instanceof ApiError ? err.message : '连接失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- 断开连接 ----------
  async function handleDisconnect(): Promise<void> {
    await clearConnection();
    const next: PluginSettings = { ...settings, apiKey: '' };
    await saveSettings(next);
    setSettings(next);
    setProfile(null);
    setConnectError('');
    setManageOpen(false);
    setPhase('welcome');
  }

  // ---------- 刷新：静默重拉身份与站点信息 ----------
  async function handleRefresh(): Promise<void> {
    if (!isConfigured(settings)) {
      return;
    }
    try {
      const [siteMeta, me]: [SiteMeta, UserProfile] = await Promise.all([
        getSiteMeta(settings.apiBaseUrl, settings.apiKey),
        getCurrentUser(settings.apiBaseUrl, settings.apiKey),
      ]);
      void saveCachedProfile(me).catch(() => undefined);
      void saveCachedSiteMeta(siteMeta).catch(() => undefined);
      setProfile(me);
      setMeta(siteMeta);
    } catch {
      // 刷新失败不打断界面，保持既有展示
    }
    setRefreshTick((n: number) => n + 1);
  }

  // ---------- 球形悬浮开关 ----------
  async function toggleBall(show: boolean): Promise<void> {
    const next: PluginSettings = { ...settings, showBall: show };
    setSettings(next);
    await saveSettings(next);
  }

  // ---------- 面板形态切换（悬浮窗 / 浏览器右侧栏；无原生侧栏的浏览器走页内停靠） ----------
  async function handleSetShape(shape: 'float' | 'dock'): Promise<void> {
    // 已处于目标形态时不再重复动作
    if (shape === mode) {
      return;
    }
    if (shape === 'float') {
      await switchToFloat();
      return;
    }
    await switchToDock();
  }

  // ---------- 主题切换 ----------
  async function toggleTheme(): Promise<void> {
    const next: PluginSettings = {
      ...settings,
      theme: settings.theme === 'cool-moon' ? 'mist' : 'cool-moon',
    };
    setSettings(next);
    await saveSettings(next);
  }

  // ---------- 加载中骨架 ----------
  if (phase === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="animate-pulse text-sm text-ink-3">加载中…</p>
      </div>
    );
  }

  // ---------- 未连接 ----------
  if (phase === 'welcome') {
    return (
      <div className="relative h-full">
        <WelcomeView
          initialUrl={settings.apiBaseUrl}
          submitting={submitting}
          error={connectError}
          onSubmit={(url: string, key: string) => void handleConnect(url, key)}
        />
      </div>
    );
  }

  // ---------- 已连接 ----------
  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        profile={profile}
        meta={meta}
        settings={settings}
        mode={mode}
        showShapeButtons={mode !== 'embed'}
        onSetShape={(shape: 'float' | 'dock'): void => void handleSetShape(shape)}
        onToggleBall={(): void => void toggleBall(!settings.showBall)}
        onOpenManage={(): void => {
          setConnectError('');
          setManageOpen(true);
        }}
        onRefresh={(): void => void handleRefresh()}
        onToggleTheme={(): void => void toggleTheme()}
      />

      {/* Tab 栏 */}
      <nav className="mx-3 mt-2.5 flex gap-1 rounded-full bg-muted p-1">
        {TABS.map((item: { key: PanelTab; label: string }) => {
          const active: boolean = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={(): void => setTab(item.key)}
              className={`flex-1 rounded-full py-1.5 text-xs font-medium transition-colors duration-200 ${
                active ? 'bg-elevated text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* 内容区 */}
      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === 'home' && (
          <HomeTab
            meta={meta}
            profile={profile}
            settings={settings}
            refreshTick={refreshTick}
            onGoTab={(next: PanelTab): void => setTab(next)}
          />
        )}
        {tab === 'bookmark' && (
          <div className="-mx-4 -my-4 h-[calc(100%+2rem)]">
            <div className="relative flex h-full flex-col overflow-hidden">
              <BookmarksTab />
            </div>
          </div>
        )}
        {tab === 'ai' && (
          <div className="-mx-4 -my-4 h-[calc(100%+2rem)]">
            <AiChatTab settings={settings} seedText="" onConsumeSeed={(): undefined => undefined} onRequestGoAi={(): void => setTab('ai')} />
          </div>
        )}
      </main>

      {/* 底部写说说（仅首页展示；AI 页自带输入框，书签页需要完整空间） */}
      {tab === 'home' && <MomentComposer settings={settings} />}

      {/* 连接管理弹层 */}
      {manageOpen && (
        <ManagePanel
          settings={settings}
          profile={profile}
          submitting={submitting}
          error={connectError}
          onSubmit={(url: string, key: string) => void handleConnect(url, key)}
          onDisconnect={(): void => void handleDisconnect()}
          onToggleBall={(show: boolean): void => void toggleBall(show)}
          onClose={(): void => setManageOpen(false)}
        />
      )}
    </div>
  );
}
