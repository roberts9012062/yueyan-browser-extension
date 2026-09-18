// browser-extension/src/shared/bili-video.ts
// B 站视频字幕抓取与播放器块构造（共享模块）：
//   - AI 助手「网页总结」的 B 站视频分支（AiChatTab.summarizeBiliVideo）；
//   - 右键「总结本页，发布到博客」执行器（SummaryExec 的 B 站视频分支）。
// 两处此前各自内联 / 缺失，现统一复用本模块（规则变更两处一起改）。
//
// 链路：chrome.scripting.executeScript 向 B 站视频页注入自包含抓取函数——
//   页面上下文（同源请求自动携带用户登录态）依次取 view（cid/标题/简介/封面）、
//   nav（wbi keys）→ wbi 签名调 player/wbi/v2 拿字幕列表（失败回退旧 player/v2），
//   优先 ai-zh AI 中文字幕、回退 CC 中文字幕；字幕文件由扩展页拉取
//   （主机权限免跨域）拼成全文。未在浏览器登录 B 站时通常无 AI 字幕可取。

/** B 站视频页地址判定（www / m / 裸域，pathname 均为 /video/BV…） */
const BILI_VIDEO_URL_RE: RegExp = /^https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\//i;

/** 字幕全文长度上限（字符）：与普通网页总结的正文截断一致 */
export const BILI_TRANSCRIPT_LIMIT: number = 12000;

/** 注入函数回传的字幕元信息（ok=false 时 reason 说明失败环节） */
export interface BiliSubtitleMeta {
  ok: boolean;
  reason?: string;
  title?: string;
  desc?: string;
  bvid?: string;
  subtitleUrl?: string;
  lan?: string;
  cid?: number;
  cover?: string;
  author?: string;
  duration?: number;
}

/** 判定 URL 是否为 B 站视频页（右键任务与 AI 网页总结共用同一规则） */
export function isBiliVideoUrl(url: string): boolean {
  return BILI_VIDEO_URL_RE.test(url);
}

/**
 * 注入到 B 站视频页的字幕元信息抓取函数。
 * 硬性约束：executeScript 会把函数体序列化后在页面隔离环境执行，
 * 因此必须完全自包含——只允许引用浏览器全局（location/fetch/Math/Date 等），
 * 禁止闭包任何模块级变量或 import；类型标注在编译后被剥离，不受影响。
 */
async function biliSubtitleCollector(): Promise<BiliSubtitleMeta> {
  // ---- 自包含 md5（Paul Johnston 经典实现，Node 环境已验证与标准值一致）----
  const md5 = (input: string): string => {
    const safeAdd: (x: number, y: number) => number = (x: number, y: number): number => {
      const lsw: number = (x & 0xffff) + (y & 0xffff);
      const msw: number = (x >> 16) + (y >> 16) + (lsw >> 16);
      return (msw << 16) | (lsw & 0xffff);
    };
    const bitRol: (n: number, c: number) => number = (n: number, c: number): number =>
      (n << c) | (n >>> (32 - c));
    const cmn: (q: number, a: number, b: number, x: number, s: number, t: number) => number = (
      q: number, a: number, b: number, x: number, s: number, t: number,
    ): number => safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
    const ff: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
      a: number, b: number, c: number, d: number, x: number, s: number, t: number,
    ): number => cmn((b & c) | (~b & d), a, b, x, s, t);
    const gg: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
      a: number, b: number, c: number, d: number, x: number, s: number, t: number,
    ): number => cmn((b & d) | (c & ~d), a, b, x, s, t);
    const hh: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
      a: number, b: number, c: number, d: number, x: number, s: number, t: number,
    ): number => cmn(b ^ c ^ d, a, b, x, s, t);
    const ii: (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => number = (
      a: number, b: number, c: number, d: number, x: number, s: number, t: number,
    ): number => cmn(c ^ (b | ~d), a, b, x, s, t);

    /** 字节序列 → 32 位字数组并跑主循环 */
    const binl: (words: number[], byteLen: number) => number[] = (words: number[], byteLen: number): number[] => {
      words[byteLen >> 5] |= 0x80 << (byteLen % 32);
      words[(((byteLen + 64) >>> 9) << 4) + 14] = byteLen;
      let a: number = 1732584193;
      let b: number = -271733879;
      let c: number = -1732584194;
      let d: number = 271733878;
      for (let i: number = 0; i < words.length; i += 16) {
        const oa: number = a;
        const ob: number = b;
        const oc: number = c;
        const od: number = d;
        a=ff(a,b,c,d,words[i],7,-680876936);d=ff(d,a,b,c,words[i+1],12,-389564586);c=ff(c,d,a,b,words[i+2],17,606105819);b=ff(b,c,d,a,words[i+3],22,-1044525330);
        a=ff(a,b,c,d,words[i+4],7,-176418897);d=ff(d,a,b,c,words[i+5],12,1200080426);c=ff(c,d,a,b,words[i+6],17,-1473231341);b=ff(b,c,d,a,words[i+7],22,-45705983);
        a=ff(a,b,c,d,words[i+8],7,1770035416);d=ff(d,a,b,c,words[i+9],12,-1958414417);c=ff(c,d,a,b,words[i+10],17,-42063);b=ff(b,c,d,a,words[i+11],22,-1990404162);
        a=ff(a,b,c,d,words[i+12],7,1804603682);d=ff(d,a,b,c,words[i+13],12,-40341101);c=ff(c,d,a,b,words[i+14],17,-1502002290);b=ff(b,c,d,a,words[i+15],22,1236535329);
        a=gg(a,b,c,d,words[i+1],5,-165796510);d=gg(d,a,b,c,words[i+6],9,-1069501632);c=gg(c,d,a,b,words[i+11],14,643717713);b=gg(b,c,d,a,words[i],20,-373897302);
        a=gg(a,b,c,d,words[i+5],5,-701558691);d=gg(d,a,b,c,words[i+10],9,38016083);c=gg(c,d,a,b,words[i+15],14,-660478335);b=gg(b,c,d,a,words[i+4],20,-405537848);
        a=gg(a,b,c,d,words[i+9],5,568446438);d=gg(d,a,b,c,words[i+14],9,-1019803690);c=gg(c,d,a,b,words[i+3],14,-187363961);b=gg(b,c,d,a,words[i+8],20,1163531501);
        a=gg(a,b,c,d,words[i+13],5,-1444681467);d=gg(d,a,b,c,words[i+2],9,-51403784);c=gg(c,d,a,b,words[i+7],14,1735328473);b=gg(b,c,d,a,words[i+12],20,-1926607734);
        a=hh(a,b,c,d,words[i+5],4,-378558);d=hh(d,a,b,c,words[i+8],11,-2022574463);c=hh(c,d,a,b,words[i+11],16,1839030562);b=hh(b,c,d,a,words[i+14],23,-35309556);
        a=hh(a,b,c,d,words[i+1],4,-1530992060);d=hh(d,a,b,c,words[i+4],11,1272893353);c=hh(c,d,a,b,words[i+7],16,-155497632);b=hh(b,c,d,a,words[i+10],23,-1094730640);
        a=hh(a,b,c,d,words[i+13],4,681279174);d=hh(d,a,b,c,words[i],11,-358537222);c=hh(c,d,a,b,words[i+3],16,-722521979);b=hh(b,c,d,a,words[i+6],23,76029189);
        a=hh(a,b,c,d,words[i+9],4,-640364487);d=hh(d,a,b,c,words[i+12],11,-421815835);c=hh(c,d,a,b,words[i+15],16,530742520);b=hh(b,c,d,a,words[i+2],23,-995338651);
        a=ii(a,b,c,d,words[i],6,-198630844);d=ii(d,a,b,c,words[i+7],10,1126891415);c=ii(c,d,a,b,words[i+14],15,-1416354905);b=ii(b,c,d,a,words[i+5],21,-57434055);
        a=ii(a,b,c,d,words[i+12],6,1700485571);d=ii(d,a,b,c,words[i+3],10,-1894986606);c=ii(c,d,a,b,words[i+10],15,-1051523);b=ii(b,c,d,a,words[i+1],21,-2054922799);
        a=ii(a,b,c,d,words[i+8],6,1873313359);d=ii(d,a,b,c,words[i+15],10,-30611744);c=ii(c,d,a,b,words[i+6],15,-1560198380);b=ii(b,c,d,a,words[i+13],21,1309151649);
        a=ii(a,b,c,d,words[i+4],6,-145523070);d=ii(d,a,b,c,words[i+11],10,-1120210379);c=ii(c,d,a,b,words[i+2],15,718787259);b=ii(b,c,d,a,words[i+9],21,-343485551);
        a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
      }
      return [a, b, c, d];
    };

    // 字符串 → UTF-8 字节 → 32 位字数组 → 摘要 → 十六进制
    const bytes: number[] = [];
    for (let i: number = 0; i < input.length; i += 1) {
      const code: number = input.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    const words: number[] = [];
    for (let i: number = 0; i < bytes.length * 8; i += 8) {
      words[i >> 5] = (words[i >> 5] || 0) | (bytes[i / 8] << (i % 32));
    }
    const digest: number[] = binl(words, bytes.length * 8);
    const toHex: (l: number) => string = (l: number): string => {
      let s: string = '';
      for (let i: number = 0; i < 4; i += 1) {
        const val: number = (l >> (i * 8)) & 0xff;
        s += '0123456789abcdef'.charAt((val >>> 4) & 0x0f) + '0123456789abcdef'.charAt(val & 0x0f);
      }
      return s;
    };
    return toHex(digest[0]) + toHex(digest[1]) + toHex(digest[2]) + toHex(digest[3]);
  };

  // ---- wbi 签名（B 站 2023+ 风控：字幕接口须带 w_rid）----
  const MIXIN: number[] = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
  const signWbi = (params: Record<string, string>, imgKey: string, subKey: string): string => {
    const raw: string = imgKey + subKey;
    let mixinKey: string = '';
    for (let i: number = 0; i < 32; i += 1) {
      mixinKey += raw[MIXIN[i]];
    }
    const query: string[][] = Object.entries({ ...params, wts: String(Math.floor(Date.now() / 1000)) })
      .filter((pair: [string, string]): boolean => !/[!'()*]/.test(pair[1]))
      .sort((x: [string, string], y: [string, string]): number => (x[0] < y[0] ? -1 : 1));
    const qs: string = new URLSearchParams(query).toString();
    return `${qs}&w_rid=${md5(qs + mixinKey)}`;
  };

  const match: RegExpMatchArray | null = location.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/);
  if (match === null) {
    return { ok: false, reason: 'not-video' };
  }
  const bvid: string = match[1];
  try {
    const viewResp: Response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { credentials: 'include' });
    const view = (await viewResp.json()) as {
      code: number;
      message?: string;
      data?: { cid: number; title: string; desc: string; pic: string; owner?: { name: string }; duration: number };
    };
    if (view.code !== 0 || view.data === undefined) {
      return { ok: false, reason: `view-${view.code}`, bvid };
    }
    const cid: number = view.data.cid;
    const title: string = view.data.title;
    const desc: string = (view.data.desc ?? '').slice(0, 500);

    // nav 拿 wbi keys（未登录也返回）→ wbi 签名调 player 接口；失败回退旧 v2
    const navResp: Response = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
    const nav = (await navResp.json()) as { data?: { wbi_img?: { img_url: string; sub_url: string } } };
    const imgUrl: string = nav.data?.wbi_img?.img_url ?? '';
    const subUrl: string = nav.data?.wbi_img?.sub_url ?? '';
    const pickKeys = (u: string): string => u.slice(u.lastIndexOf('/') + 1).split('.')[0];
    let subs: { lan: string; subtitle_url: string }[] = [];
    let lastErr: string = 'no-subtitle';
    if (imgUrl !== '' && subUrl !== '') {
      const signed: string = signWbi(
        { bvid, cid: String(cid), fnval: '4048', fno: '0', qn: '80' },
        pickKeys(imgUrl),
        pickKeys(subUrl),
      );
      const wbiResp: Response = await fetch(`https://api.bilibili.com/x/player/wbi/v2?${signed}`, { credentials: 'include' });
      const wbi = (await wbiResp.json()) as { code: number; message?: string; data?: { subtitle?: { subtitles?: { lan: string; subtitle_url: string }[] } } };
      if (wbi.code === 0) {
        subs = wbi.data?.subtitle?.subtitles ?? [];
      } else {
        lastErr = `wbi-${wbi.code}`;
      }
    }
    if (subs.length === 0 && lastErr !== 'no-subtitle') {
      // wbi 失败时回退旧接口再试一次
      const pResp: Response = await fetch(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`, { credentials: 'include' });
      const player = (await pResp.json()) as { code: number; data?: { subtitle?: { subtitles?: { lan: string; subtitle_url: string }[] } } };
      if (player.code === 0) {
        subs = player.data?.subtitle?.subtitles ?? [];
      }
    }
    if (subs.length === 0) {
      return { ok: false, reason: lastErr, title, desc, bvid };
    }
    const pick = subs.find((s) => s.lan === 'ai-zh') ?? subs.find((s) => /zh/i.test(s.lan)) ?? subs[0];
    let subtitleUrl: string = pick.subtitle_url ?? '';
    if (subtitleUrl.startsWith('//')) {
      subtitleUrl = `https:${subtitleUrl}`;
    }
    return {
      ok: subtitleUrl !== '',
      title,
      desc,
      bvid,
      subtitleUrl,
      lan: pick.lan,
      cid: view.data.cid,
      cover: view.data.pic ?? '',
      author: view.data.owner?.name ?? '',
      duration: view.data.duration ?? 0,
    };
  } catch (err: unknown) {
    const detail: string = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `fetch-error(${detail.slice(0, 60)})`, bvid };
  }
}

/**
 * 向 B 站视频页注入字幕元信息抓取函数。
 * 前置条件：已持有目标站主机权限（调用方负责保证；未授权时本函数抛错，
 * 调用方自行 catch 并降级）。
 */
export async function collectBiliSubtitleMeta(tabId: number): Promise<BiliSubtitleMeta | undefined> {
  const results: chrome.scripting.InjectionResult<unknown>[] = await chrome.scripting.executeScript({
    target: { tabId },
    func: biliSubtitleCollector,
  });
  return results[0]?.result as BiliSubtitleMeta | undefined;
}

/**
 * 扩展页拉取字幕文件并拼成全文（空白归一、截断到 BILI_TRANSCRIPT_LIMIT）。
 * 字幕 CDN 域与 B 站主站不同，依赖已授予的主机权限免跨域。
 */
export async function fetchBiliTranscript(subtitleUrl: string): Promise<string> {
  const subResp: Response = await fetch(subtitleUrl, { credentials: 'omit' });
  const subJson = (await subResp.json()) as { body?: { content: string }[] };
  return (subJson.body ?? [])
    .map((line: { content: string }): string => line.content)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, BILI_TRANSCRIPT_LIMIT);
}

/** 组装 B 站播放器块参数（boke bilibili-video 插件的 data-props 协议） */
export function buildBiliPlayerProps(meta: BiliSubtitleMeta): Record<string, unknown> {
  return {
    bvid: meta.bvid ?? '',
    cid: meta.cid ?? 0,
    title: meta.title ?? '',
    cover: meta.cover ?? '',
    author: meta.author ?? '',
    duration: meta.duration ?? 0,
  };
}

/**
 * 构造 B 站播放器块 HTML：
 * <div data-plugin-block="bilibili" data-props="{&quot;…}"></div>
 * （props 值内引号须 &quot; 转义；参数缺 bvid 时返回空串，调用方直接拼接）。
 */
export function buildBiliPlayerBlock(biliProps: Record<string, unknown> | null): string {
  const bvidInProps: unknown = biliProps?.bvid;
  if (biliProps !== null && typeof bvidInProps === 'string' && bvidInProps !== '') {
    const propsJson: string = JSON.stringify(biliProps).replace(/"/g, '&quot;');
    return `<div data-plugin-block="bilibili" data-props="${propsJson}"></div>`;
  }
  return '';
}
