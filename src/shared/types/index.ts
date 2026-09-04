// browser-extension/src/shared/types/index.ts
// 插件全域类型定义。
// 说明：UserProfile / PostSummaryItem / SiteMeta 等结构「复制自主站 frontend/src/types/api.ts
//       与后端 internal/model（手工同步）」，字段变更时两处需一起改。

/** 主题（与主站 tokens.css 双主题同名） */
export type Theme = 'cool-moon' | 'mist';

/** 侧边栏 Tab 标识 */
export type PanelTab = 'home' | 'ai' | 'bookmark';

/**
 * 发布图床（文章发布时正文图片的存储通道）：
 * none=站点服务器（默认，外链图转存媒体库）/ tg=TG图床（开放网关直传）/ cf=CF图床（R2 Worker 直连）。
 */
export type PublishImageBed = 'none' | 'tg' | 'cf';

/** 发布图床配置（设置面板「发布图床」分区提交载荷，App 层持久化） */
export interface ImageBedConfig {
  bed: PublishImageBed;
  /** CF 图床 Workers 地址（bed==='cf' 时生效，如 https://imgs.example.com） */
  cfUrl: string;
  /** CF 图床 API Key（Worker 部署时 wrangler secret put API_KEY 的值） */
  cfKey: string;
}

/** 后端统一响应信封（pkg/resp.Body） */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

/** 连接设置（站点地址 + 开放接口 Key，持久化于 chrome.storage.local） */
export interface PluginSettings {
  /** 站点根地址（如 https://blog.example.com，不含 /api/v1） */
  apiBaseUrl: string;
  /** 开放接口 API Key（oa_ 前缀） */
  apiKey: string;
  /** 当前主题 */
  theme: Theme;
  /** 是否在网页显示球形悬浮入口 */
  showBall: boolean;
  /** 打开书签页时是否自动同步站点导航镜像（需已连接站点且已导入过导航） */
  autoSyncNav: boolean;
  /** 文章发布图床通道（none=站点服务器，默认） */
  publishImageBed: PublishImageBed;
  /** CF 图床 Workers 地址（publishImageBed==='cf' 时发布直连上传用） */
  cfBedUrl: string;
  /** CF 图床 API Key（与 Worker 部署时的 API_KEY secret 同值） */
  cfBedKey: string;
}

/** 站点导航项（GET /open/meta 返回的 nav 子项，当前仅透传展示用） */
export interface NavLinkItem {
  title: string;
  url: string;
}

/** 站点元信息（GET /api/v1/open/meta → SiteMetaDTO） */
export interface SiteMeta {
  site_name: string;
  site_description: string;
  default_theme: string;
  maintenance_mode: string;
  nav: NavLinkItem[];
}

/** 用户公开资料（GET /api/v1/open/me → model.UserProfile 公开视角） */
export interface UserProfile {
  id: number;
  username: string;
  nickname: string;
  avatar_url: string;
  bio: string;
  role: string;
  post_count: number;
  like_count: number;
  follower_count: number;
  following_count: number;
  created_at: string;
}

/** 作者摘要（帖子列表内嵌） */
export interface AuthorSummary {
  id: number;
  username: string;
  nickname: string;
  avatar_url: string;
}

/** 帖子摘要（GET /api/v1/open/posts items 元素，节选插件展示所需字段） */
export interface PostSummaryItem {
  id: number;
  title: string;
  summary: string;
  content_type: string;
  post_kind: string;
  author: AuthorSummary;
  like_count: number;
  comment_count: number;
  view_count: number;
  published_at: string;
}

/** 时间线响应 */
export interface TimelineResult {
  page: number;
  page_size: number;
  total: number;
  items: PostSummaryItem[];
}

/** AI 供应商（脱敏后：GET /open/ai/models → providers 元素，节选） */
export interface AiProvider {
  id: number;
  name: string;
  models: string[];
  enabled: boolean;
}

/** AI 对话消息（OpenAI 兼容格式） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** AI 对话结果（POST /open/ai/chat 响应 data） */
export interface AiChatResult {
  model: string;
  reply: string;
}

/** ---------- 书签（本地存储；chrome.storage.local，与站点数据无关） ---------- */

/** 有效性检测结果 */
export interface BookmarkCheck {
  status: 'ok' | 'fail';
  at: number;
}

/**
 * 书签树节点（统一模型）：文件夹与链接共用一种节点，
 * children 保证兄弟次序可任意拖拽编排；folder 才有 children 数组。
 */
export interface BookmarkNode {
  id: string;
  kind: 'folder' | 'link';
  /** 文件夹名 / 书签标题 */
  title: string;
  /** 仅链接节点 */
  url: string;
  /** 仅链接节点 */
  addedAt: number;
  /** 仅链接节点：站点导航导入时携带的内嵌图标 dataURL（展示优先于浏览器 favicon） */
  icon?: string;
  /** 仅链接节点 */
  check?: BookmarkCheck;
  /** 仅文件夹节点（恒为数组，便于统一遍历） */
  children: BookmarkNode[];
}

/** 书签整体存储（多棵顶级序列即整棵森林；根级散链归属「未分类」区块） */
export interface BookmarkTree {
  roots: BookmarkNode[];
  /** 最后写入时间戳（毫秒）：IndexedDB 主存与 chrome.storage 兜底双份调和用；旧数据无此字段视为 0 */
  savedAt?: number;
}

/** ---------- 旧版（v1 扁平结构，仅供一次性迁移读取） ---------- */

export interface BookmarkLegacyFolder {
  id: string;
  name: string;
}

export interface BookmarkLegacyItem {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  addedAt: number;
}

export interface BookmarkLegacyStore {
  folders: BookmarkLegacyFolder[];
  items: BookmarkLegacyItem[];
}

/** ---------- AI 会话（多轮历史；chrome.storage.local） ---------- */

/** 会话消息（与消息流共用；content 展示 / payload 发送原文 / images 附图） */
export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  payload?: string;
  images?: string[];
  /** 联网搜索来源（assistant 消息附带，气泡下方渲染） */
  sources?: AiSearchSource[];
}

/** 一次会话（标题取首条用户消息摘要） */
export interface AiSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: AiChatMessage[];
}

/** 联网搜索来源（SearXNG 检索结果条目，消息渲染与历史持久化用） */
export interface AiSearchSource {
  title: string;
  url: string;
}

/** ---------- 写说说（moment 发布；本地图经开放网关上传，媒体 ID 关联） ---------- */

/** 媒体上传结果（POST /api/v1/open/media 响应 data；与后端 model.UploadResult 一致） */
export interface UploadResult {
  /** 本站持久地址（/media/...） */
  url: string;
  media_id: number;
  mime_type: string;
  size_bytes: number;
}

/**
 * 写说说附件（四类可插入内容）。
 * id 为前端生成的本地唯一标识（渲染 key 与删除定位用，不提交后端）。
 * 图片附件按上传通道分 source：server=站点媒体库（mediaId 关联发布）；tg=TG图床插件（无媒体库 ID，
 * mediaId 恒 null，仅正文 <img src> 引用公开 URL）。
 */
export type MomentAttach =
  | { kind: 'image'; id: string; url: string; mediaId: number | null; source: 'server' | 'tg' }
  | { kind: 'video'; id: string; url: string; embedUrl: string; platform: 'bilibili' | 'youtube' }
  | { kind: 'music'; id: string; url: string; songId: string }
  | { kind: 'link'; id: string; url: string; text: string };

/** 插入弹层类型（图片通道选择 / 视频 / 音乐 / 链接四个底部弹层的开关标识） */
export type InsertKind = 'image' | 'video' | 'music' | 'link';

/** 图片上传通道（ImageSheet 选项；server=站点媒体库自动压缩，tg=TG图床原图保真） */
export type ImageUploadTarget = 'server' | 'tg';

/** ---------- 站点导航（navlinks.list：精品导航插件数据；GET /open/nav/links） ---------- */

/**
 * 导航可见性：open=公开（站点默认，同步载荷中省略字段）/ private=私有
 * （同步到站点时写入 navlinks.save 的 visibility 字段，站点端 omitempty）。
 */
export type NavVisibility = 'open' | 'private';

/** 导航链接条目（与主站精品导航插件数据结构对齐，手工同步） */
export interface SiteNavLink {
  id: number;
  name: string;
  url: string;
  /** 分类名（如「设计工具」） */
  category: string;
  tags: string[];
  description: string;
  /** 内嵌图标 dataURL（可为空串） */
  icon: string;
  sort: number;
  created_at: string;
  /** 同步到私有导航时携带 private（列表返回不含此字段：公开/私有列表各自只含本侧条目） */
  visibility?: NavVisibility;
}

/** 导航列表响应 data */
export interface SiteNavLinksResult {
  /** 聚合分类名清单 */
  categories: string[];
  links: SiteNavLink[];
}

/**
 * 私有导航访问配置（navlinks.private.config：GET /open/nav/private/config 响应 data）。
 * mode：self=仅自己可见（未开启密码访问）/ password=密码访问；
 * has_password=false 表示尚未设置访问密码（需先到站点设置）；不含任何密码材料。
 */
export interface SiteNavPrivateConfig {
  mode: 'self' | 'password';
  has_password: boolean;
  /** 私有导航页标题（站点侧配置，空回退「私有导航」） */
  title: string;
  subtitle: string;
  /** 站点当前私有条目数 */
  count: number;
}
