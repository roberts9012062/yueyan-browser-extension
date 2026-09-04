// browser-extension/src/sidepanel/components/settings/ImageBedSection.tsx
// 「发布图床」设置分区：文章发布时正文图片的存储通道选择——
//   不使用图床（默认）= 保存站点服务器 / TG图床 = 开放网关直传 / CF图床 = R2 Worker 直连。
// 交互：单选即点即存（与面板其他开关一致）；CF 需另配 Workers 地址 + API Key，
//   凭证经「保存并连接」按钮提交（click 手势内申请 Worker 域名主机授权——Worker 不回
//   CORS 头，无授权直连会被浏览器拦截）；TG/CF 可用性探测均为零副作用请求，结果行内回显。

import { useEffect, useState } from 'react';
import { checkCfImageBedAvailable, checkTgImageBedAvailable } from '../../../shared/api/image-bed';
import { ensureWideHostPermission, hasWideHostPermission } from '../../../shared/permissions';
import { normalizeBaseUrl } from '../../../shared/storage/settings';
import type { ImageBedConfig, PluginSettings, PublishImageBed } from '../../../shared/types';

interface ImageBedSectionProps {
  /** 当前设置（回显已存图床选择与 CF 凭证） */
  settings: PluginSettings;
  /** 保存回调（App 层持久化；单选即时提交，CF 凭证经「保存并连接」提交） */
  onSave: (config: ImageBedConfig) => void;
}

/** 图床单选项定义（bed 与 PublishImageBed 对齐） */
const BED_OPTIONS: readonly { bed: PublishImageBed; title: string; desc: string }[] = [
  { bed: 'none', title: '不使用图床', desc: '发布时图片保存到站点服务器（默认）' },
  { bed: 'tg', title: 'TG图床', desc: '经站点开放网关直传，站点需启用 TG图床 插件' },
  { bed: 'cf', title: 'CF图床', desc: '直连你部署的 Cloudflare R2 Worker 上传' },
];

/** 探测状态（idle=未探测 / checking=探测中 / done=有结论） */
type ProbeState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'done'; ok: boolean; text: string };

const IDLE_PROBE: ProbeState = { phase: 'idle' };
const CHECKING_PROBE: ProbeState = { phase: 'checking' };

/** 探测结论行文案配色：可用绿（双主题各一档）/ 不可用警示色 / 过程中性灰 */
function probeColor(state: ProbeState): string {
  if (state.phase !== 'done') {
    return 'text-ink-3';
  }
  return state.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-like';
}

/** 单个探测状态行（三态渲染；idle 不占位） */
function ProbeLine(props: { state: ProbeState }): React.ReactNode {
  if (props.state.phase === 'idle') {
    return null;
  }
  const text: string =
    props.state.phase === 'checking' ? '正在检测可用性…' : props.state.text;
  return <p className={`mt-1 text-[11px] leading-relaxed ${probeColor(props.state)}`}>{text}</p>;
}

export function ImageBedSection(props: ImageBedSectionProps): React.ReactNode {
  const bed: PublishImageBed = props.settings.publishImageBed;
  // CF 凭证输入草稿（本地态，点「保存并连接」才提交；初始从已存设置回填）
  const [cfUrlDraft, setCfUrlDraft] = useState<string>(props.settings.cfBedUrl);
  const [cfKeyDraft, setCfKeyDraft] = useState<string>(props.settings.cfBedKey);
  const [tgProbe, setTgProbe] = useState<ProbeState>(IDLE_PROBE);
  const [cfProbe, setCfProbe] = useState<ProbeState>(IDLE_PROBE);

  // 选中 TG 时探测站点 tg-image-bed 插件可用性（对 upload 端点发空请求，
  // HTTP 400=鉴权已过即可用，零副作用；连接配置或选择变化时重探）
  useEffect((): (() => void) => {
    if (bed !== 'tg') {
      setTgProbe(IDLE_PROBE);
      return (): void => undefined;
    }
    let cancelled: boolean = false;
    setTgProbe(CHECKING_PROBE);
    void checkTgImageBedAvailable(props.settings.apiBaseUrl, props.settings.apiKey).then((ok: boolean): void => {
      if (cancelled) {
        return;
      }
      setTgProbe({
        phase: 'done',
        ok,
        text: ok
          ? '✓ TG图床 可用，发布时图片将直传 TG 图床'
          : '✗ 暂不可用：站点未安装/未启用 TG图床 插件，或 Key 未勾选其「上传图片」接口（此时发布上传将失败，图片保留原地址）',
      });
    });
    return (): void => {
      cancelled = true;
    };
  }, [bed, props.settings.apiBaseUrl, props.settings.apiKey]);

  // CF 凭证已配置完整时自动探测（重开面板回显 / 保存并连接后生效，两种来源统一走这里）。
  // 探测是跨域请求且 Worker 不回 CORS 头，仅在已持有全域主机授权时发起；
  // 未授权不弹框（request 需用户手势），提示走「保存并连接」申请。
  useEffect((): (() => void) => {
    if (bed !== 'cf' || props.settings.cfBedUrl === '' || props.settings.cfBedKey === '') {
      setCfProbe(IDLE_PROBE);
      return (): void => undefined;
    }
    let cancelled: boolean = false;
    setCfProbe(CHECKING_PROBE);
    void (async (): Promise<void> => {
      const granted: boolean = await hasWideHostPermission();
      if (cancelled) {
        return;
      }
      if (!granted) {
        setCfProbe({ phase: 'done', ok: false, text: '尚未授权网络访问：点击「保存并连接」按提示授权后检测' });
        return;
      }
      const ok: boolean = await checkCfImageBedAvailable(props.settings.cfBedUrl, props.settings.cfBedKey);
      if (cancelled) {
        return;
      }
      setCfProbe({
        phase: 'done',
        ok,
        text: ok
          ? '✓ CF图床 连接成功，发布时图片将直传 R2'
          : '✗ 连接失败：请检查 Workers 地址与 API Key（需与 Worker 部署配置一致）',
      });
    })();
    return (): void => {
      cancelled = true;
    };
  }, [bed, props.settings.cfBedUrl, props.settings.cfBedKey]);

  /** 提交 CF 凭证（用户手势）：归一化地址 → 申请主机授权 → 保存（探测由设置变化自动触发） */
  async function saveCfConfig(): Promise<void> {
    const url: string = normalizeBaseUrl(cfUrlDraft);
    const key: string = cfKeyDraft.trim();
    if (url === '' || key === '') {
      setCfProbe({ phase: 'done', ok: false, text: '请先填写 Workers 地址与 API Key' });
      return;
    }
    const granted: boolean = await ensureWideHostPermission();
    if (!granted) {
      setCfProbe({ phase: 'done', ok: false, text: '未获网络访问授权，无法直连 Worker，请重试并允许授权' });
      return;
    }
    setCfUrlDraft(url);
    props.onSave({ bed: 'cf', cfUrl: url, cfKey: key });
  }

  return (
    <section className="flex flex-col gap-2">
      {BED_OPTIONS.map((option: { bed: PublishImageBed; title: string; desc: string }): React.ReactNode => {
        const active: boolean = bed === option.bed;
        return (
          <button
            key={option.bed}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={(): void => props.onSave({ bed: option.bed, cfUrl: props.settings.cfBedUrl, cfKey: props.settings.cfBedKey })}
            className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors duration-200 ${
              active ? 'border-accent bg-accent-soft' : 'border-line bg-elevated hover:bg-muted'
            }`}
          >
            <span
              className={`mt-0.5 size-4 shrink-0 rounded-full border-2 ${
                active ? 'border-accent' : 'border-ink-3/50'
              } flex items-center justify-center`}
            >
              {active && <span className="size-2 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm ${active ? 'text-glow' : 'text-ink'}`}>{option.title}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{option.desc}</span>
            </span>
          </button>
        );
      })}

      {/* TG 通道可用性探测结论 */}
      {bed === 'tg' && <ProbeLine state={tgProbe} />}

      {/* CF 凭证配置（选中 CF 时展开） */}
      {bed === 'cf' && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-elevated px-3 py-3">
          <input
            type="text"
            value={cfUrlDraft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setCfUrlDraft(e.target.value)}
            placeholder="Workers 地址（如 https://imgs.example.com）"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            value={cfKeyDraft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setCfKeyDraft(e.target.value)}
            placeholder="API Key（Worker 部署时 wrangler secret put API_KEY 的值）"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-3">
              地址与 Key 与站点「CF图床」插件设置一致，可在站点后台查看。
            </p>
            <button
              type="button"
              onClick={(): void => void saveCfConfig()}
              className="shrink-0 rounded-full bg-accent-soft px-3.5 py-1.5 text-xs text-glow transition-opacity duration-200 hover:opacity-80"
            >
              保存并连接
            </button>
          </div>
          <ProbeLine state={cfProbe} />
        </div>
      )}
    </section>
  );
}
