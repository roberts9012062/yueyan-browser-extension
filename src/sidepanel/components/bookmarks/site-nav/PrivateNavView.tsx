// browser-extension/src/sidepanel/components/bookmarks/site-nav/PrivateNavView.tsx
// 书签页「🔒 私有导航」视图：站点私有导航的门禁与浏览。
// 门禁状态机：连接检测 → 读站点私有配置（mode/是否已设密码）→
//   未设密码引导去站点设置（配置随后同步过来）→ 已设密码则密码卡解锁
//   （密码经站点公开 unlock 端点真校验，本地只记「已解锁」标记，密码本身不落盘）→
//   解锁后凭 Key 拉私有条目内存渲染（不写入任何本地存储）。

import { useEffect, useState } from 'react';

import { ApiError } from '../../../../shared/api/client';
import {
  getPrivateNavConfig,
  listPrivateNavLinks,
  unlockPrivateNav,
} from '../../../../shared/api/endpoints';
import {
  isConfigured,
  readNavPrivateUnlocked,
  readSettings,
  saveNavPrivateUnlocked,
} from '../../../../shared/storage/settings';
import type { BookmarkNode, PluginSettings, SiteNavPrivateConfig } from '../../../../shared/types';
import { getFaviconUrl } from '../tools';
import { buildPrivateNavTree } from './private-nav';

/** 门禁阶段：loading=检测中 / disconnected=未连接站点 / unavailable=站点不可达或接口缺失 /
 *  need-setup=站点未设置访问密码 / locked=待输入密码 / ready=已解锁浏览 */
type GatePhase = 'loading' | 'disconnected' | 'unavailable' | 'need-setup' | 'locked' | 'ready';

export function PrivateNavView() {
  const [phase, setPhase] = useState<GatePhase>('loading');
  /** unavailable / 解锁与拉取失败的可读原因 */
  const [hint, setHint] = useState<string>('');
  const [config, setConfig] = useState<SiteNavPrivateConfig | null>(null);
  const [tree, setTree] = useState<BookmarkNode[]>([]);
  const [password, setPassword] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // ---------- 门禁检测：设置 → 私有配置 → 分派阶段（挂载与「重新检测」共用） ----------
  async function detect(): Promise<void> {
    setPhase('loading');
    setError('');
    setHint('');
    const settings: PluginSettings = await readSettings();
    if (!isConfigured(settings)) {
      setPhase('disconnected');
      return;
    }
    try {
      const cfg: SiteNavPrivateConfig = await getPrivateNavConfig(settings.apiBaseUrl, settings.apiKey);
      setConfig(cfg);
      if (cfg.mode !== 'password' || !cfg.has_password) {
        setPhase('need-setup');
        return;
      }
      if (await readNavPrivateUnlocked()) {
        await loadList(settings.apiBaseUrl, settings.apiKey);
        return;
      }
      setPhase('locked');
    } catch (err: unknown) {
      setHint(err instanceof ApiError ? err.message : '无法连接站点，请检查网络与站点状态');
      setPhase('unavailable');
    }
  }

  useEffect(() => {
    void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 拉取私有条目（解锁标记有效或解锁成功后；仅内存渲染，不落盘） ----------
  async function loadList(baseUrl: string, apiKey: string): Promise<void> {
    try {
      const data = await listPrivateNavLinks(baseUrl, apiKey);
      setTree(buildPrivateNavTree(data.links));
      setPhase('ready');
    } catch (err: unknown) {
      // Key 未授权私有列表 / 站点异常：退回锁定页并说明原因（避免空列表误判为无数据）
      setHint(err instanceof ApiError ? err.message : '私有导航数据拉取失败');
      setPhase('unavailable');
    }
  }

  // ---------- 密码解锁：站点公开 unlock 端点真校验；通过后记免输标记并进列表 ----------
  async function handleUnlock(): Promise<void> {
    const settings: PluginSettings = await readSettings();
    if (!isConfigured(settings) || password === '' || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const verdict = await unlockPrivateNav(settings.apiBaseUrl, password);
      if (verdict === 'ok') {
        await saveNavPrivateUnlocked(true);
        setPassword('');
        await loadList(settings.apiBaseUrl, settings.apiKey);
        return;
      }
      if (verdict === 'self_only') {
        // 站点已改回「仅自己可见」：配置已变，重新走门禁检测
        await detect();
        return;
      }
      setError(verdict === 'bad_password' ? '访问密码不正确，请重试' : '站点暂不可用，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  /** 重新锁定：清除免输标记，回到密码卡 */
  async function handleRelock(): Promise<void> {
    await saveNavPrivateUnlocked(false);
    setTree([]);
    setError('');
    setPhase('locked');
  }

  const pageTitle: string = config !== null && config.title !== '' ? config.title : '私有导航';

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {phase === 'loading' && <Placeholder icon="⏳" text="正在检测站点私有导航配置…" />}

      {phase === 'disconnected' && (
        <Placeholder icon="🔌" text="尚未连接站点：请先在「设置」中完成站点连接，再访问私有导航" />
      )}

      {phase === 'unavailable' && (
        <Placeholder icon="⚠️" text={hint} extra={<RetryButton label="重新检测" onClick={(): void => void detect()} />} />
      )}

      {phase === 'need-setup' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 pb-10 text-center">
          <span className="text-5xl" aria-hidden>🔒</span>
          <p className="text-sm font-medium text-ink">私有导航尚未设置访问密码</p>
          <p className="max-w-[300px] text-xs leading-relaxed text-ink-2">
            请到站点后台「精品导航」插件的「私有设置」中，将访问方式设为
            <b className="text-ink">「密码访问」</b>并设置访问密码；设置完成后回到这里点「重新检测」，配置会自动同步过来。
          </p>
          <div className="flex gap-2">
            <OpenSiteButton />
            <RetryButton label="重新检测" onClick={(): void => void detect()} />
          </div>
        </div>
      )}

      {phase === 'locked' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 pb-10 text-center">
          <span className="text-5xl" aria-hidden>🔐</span>
          <p className="text-sm font-medium text-ink">{pageTitle}已开启密码访问</p>
          <p className="text-xs text-ink-2">请输入访问密码解锁浏览（密码在站点后台设置）</p>
          <form
            className="flex w-full max-w-[260px] flex-col gap-2"
            onSubmit={(e: React.FormEvent): void => {
              e.preventDefault();
              void handleUnlock();
            }}
          >
            <input
              type="password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setPassword(e.target.value)}
              placeholder="访问密码"
              autoFocus
              className="w-full rounded-full border border-line bg-elevated px-4 py-2 text-center text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            {error !== '' && <p className="text-[11px] text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={password === '' || busy}
              className="rounded-full bg-accent px-5 py-2 text-xs font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? '验证中…' : '解锁'}
            </button>
          </form>
        </div>
      )}

      {phase === 'ready' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              🔒 {pageTitle}
              {config !== null && config.count > 0 && (
                <span className="ml-1.5 text-[11px] font-normal text-ink-3">{config.count} 条</span>
              )}
            </p>
            <button
              type="button"
              onClick={(): void => void detect()}
              className="rounded-full border border-line px-3 py-1 text-[11px] text-ink-2 transition-colors hover:bg-muted"
            >
              🔄 刷新
            </button>
            <button
              type="button"
              onClick={(): void => void handleRelock()}
              className="rounded-full border border-line px-3 py-1 text-[11px] text-ink-2 transition-colors hover:border-like hover:text-like"
            >
              重新锁定
            </button>
          </div>
          {tree.length === 0 ? (
            <p className="py-10 text-center text-xs text-ink-3">
              站点还没有私有导航条目：可在书签「同步到站点」时把同步目标选为「私有导航」
            </p>
          ) : (
            tree.map((folder: BookmarkNode) => (
              <section key={folder.id}>
                <p className="mb-1 text-[11px] font-medium text-ink-3">{folder.title}</p>
                <ul className="flex flex-col">
                  {folder.children.map((link: BookmarkNode) => (
                    <PrivateLinkRow key={link.id} node={link} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 链接行（站点内嵌图标优先，回退浏览器 favicon 缓存；新标签页打开） */
function PrivateLinkRow(props: { node: BookmarkNode }) {
  const [failed, setFailed] = useState<boolean>(false);
  return (
    <li>
      <button
        type="button"
        onClick={(): void => { window.open(props.node.url, '_blank'); }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
      >
        {props.node.icon !== undefined && props.node.icon !== '' ? (
          <img src={props.node.icon} alt="" className="size-4 shrink-0 rounded-sm" />
        ) : failed ? (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px]" aria-hidden>🌐</span>
        ) : (
          <img
            src={getFaviconUrl(props.node.url)}
            alt=""
            onError={(): void => setFailed(true)}
            className="size-4 shrink-0 rounded-sm"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-ink">{props.node.title}</span>
      </button>
    </li>
  );
}

/** 占位卡（检测中 / 未连接 / 不可达共用） */
function Placeholder(props: { icon: string; text: string; extra?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 pb-10 text-center">
      <span className="text-5xl" aria-hidden>{props.icon}</span>
      <p className="max-w-[300px] text-xs leading-relaxed text-ink-2">{props.text}</p>
      {props.extra}
    </div>
  );
}

/** 新标签页打开站点（引导去后台设置密码时用） */
function OpenSiteButton() {
  const [baseUrl, setBaseUrl] = useState<string>('');
  useEffect(() => {
    void readSettings().then((s: PluginSettings): void => setBaseUrl(s.apiBaseUrl));
  }, []);
  return (
    <button
      type="button"
      disabled={baseUrl === ''}
      onClick={(): void => { window.open(baseUrl, '_blank'); }}
      className="rounded-full border border-line px-4 py-1.5 text-xs text-ink transition-colors hover:bg-muted disabled:opacity-40"
    >
      打开站点
    </button>
  );
}

/** 重试按钮（重新检测 / 重试共用样式） */
function RetryButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90"
    >
      {props.label}
    </button>
  );
}
