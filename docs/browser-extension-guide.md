# 月言浏览器插件开发手册

| 项目 | 内容 |
|---|---|
| 手册版本 | v1.4 |
| 代码位置 | 仓库根目录 `browser-extension/` |
| 目标浏览器 | Google Chrome、Microsoft Edge（Chromium 内核） |
| 配套主站 | 月言博客平台（boke，架构文档见 `architecture.md`） |
| 读者 | AI 辅助开发会话、参与本插件开发的工程师 |

> **强制声明**：本手册是 `browser-extension/` 目录下所有开发的唯一规范来源。凡涉及浏览器插件的任何新增、修改、修复，开发者（含 AI 会话）**必须先完整阅读本手册，再动手写代码**。手册未覆盖的问题，先在 `discuss/` 目录写方案讨论，再修订手册、再开发。

---

## 1. 总则与强制开发流程

### 1.1 五条铁律

1. **先读手册再开发**：任何插件相关改动开始前，完整阅读本手册一遍。
2. **双浏览器等价支持**：Chrome 与 Edge 必须同时可用，功能与体验完全一致；只在一个浏览器验证过的代码视为未完成。
3. **Manifest V3 唯一**：不使用 MV2，不引入 MV2 遗留写法（`browser_action`、持久 background page、`chrome.extension.*` 等）。
4. **权限最小化**：只申请功能确实需要的权限与主机，多余权限一律禁止。
5. **无远程代码**：所有逻辑打包在插件内，禁止加载或执行任何来自网络的脚本。

### 1.2 AI 开发标准流程（每次必须执行）

```
第 1 步  完整阅读本手册（docs/browser-extension-guide.md）
第 2 步  阅读 browser-extension/ 现有代码，确认可复用逻辑
第 3 步  涉及新功能/架构变化时，方案先写入 discuss/ 目录再实现
第 4 步  按「构建与调试」章节用 scripts/*.sh 脚本构建
第 5 步  按「双浏览器验证清单」在 Chrome 与 Edge 各验证一遍
第 6 步  更新 CHANGELOG 与 manifest 版本号
```

---

## 2. 目标浏览器与兼容性基线

| 项目 | 基线要求 |
|---|---|
| Chrome | 稳定版，最低 110 |
| Edge | 稳定版，最低 110 |
| 内核假设 | 两者同为 Chromium，一套代码、一份产物，不分发两个版本 |
| manifest | `manifest_version: 3`，`minimum_chrome_version: "110"` |

### 2.1 兼容性规则

1. **统一使用 `chrome.*` 命名空间**。Edge 完全兼容 `chrome.*`；禁止混用 `browser.*`（Firefox 风格），避免出现两套调用方式。
2. **禁止 Firefox 专属字段**：manifest 中不得出现 `browser_specific_settings`、`background.scripts`（MV2 写法）等。
3. **API 使用前查证**：用到任何非基础 API（如 `chrome.alarms`、`chrome.identity`、`chrome.scripting`）前，必须在 [developer.chrome.com/docs/extensions/reference](https://developer.chrome.com/docs/extensions/reference) 确认 Chrome 与 Edge 均已支持，且版本 ≥ 基线。
4. **不使用实验性 API**：`chrome.*` 中标注 preview / experimental / flag 开启的 API 一律禁止。
5. **能力探测兜底**：对可能存在差异的 API，用能力探测代替假设：

```typescript
// 正确：先探测再使用，探测失败走降级路径
const hasBadgeApi: boolean = typeof chrome.action?.setBadgeText === 'function';
```

### 2.2 两浏览器的已知差异备忘

| 差异点 | Chrome | Edge | 处理方式 |
|---|---|---|---|
| 侧边栏 API | `chrome.sidePanel`（114+） | **新版已实现**（v1.3 实测：Chromium 152 级内核 `sidePanel.open` 可用）；旧版 Edge 未实现 | manifest 保留 `side_panel` 字段。打开面板采用**三级降级**：① 原生 sidePanel.open（API 存在时）；② 页内停靠——content script（content-dock.js）经消息 `yy-dock-toggle` 在网页右缘展开全高 iframe，旧版 Edge 的等效侧边栏；③ 特权页不可注入时降级同尺寸独立弹窗。同一份页面以 URL 参数区分形态（无参数=dock / `?mode=float` / `?mode=embed`），面板顶栏提供形态开关组。收起原生侧栏无公开 close API，用 setOptions(enabled) 开关技巧实现 |
| 命令行加载扩展 | **Chrome 136+ 正式版已禁用 `--load-extension`**（仅开发者模式手动「加载已解压」可用） | 仍支持 `--load-extension` | 手工验证两浏览器均走扩展页开发者模式加载；自动化测试（Playwright 等）用 Edge 或 Chromium 内核承载（`scripts/verify-extension-*.sh` 即此策略） |
| 商店 | Chrome Web Store | Microsoft Edge Add-ons | 同一 zip 产物分别提交两个商店 |
| 开发者模式入口 | `chrome://extensions` | `edge://extensions` | 验证清单两个都要进 |
| 默认搜索引擎/新标签页 | — | Edge 有自己的首页体系 | 不依赖浏览器首页/新标签页行为 |
| 登录账号体系 | Google 账号 | Microsoft 账号 | 插件不请求浏览器账号身份，boke 账号体系独立登录 |
| 自动更新 | Web Store 驱动 | Add-ons 驱动 | 插件内不实现自更新逻辑 |

---

## 3. 技术栈与工程约束

| 项 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript（严格模式 `strict: true`） | 禁止 `any`、禁止未类型化变量 |
| 模块系统 | ESM（`"type": "module"`） | **严禁 CommonJS**（无 `require`、无 `module.exports`） |
| 构建 | Vite + `@crxjs/vite-plugin` | 若该插件与最新 Vite 不兼容，回退为 Vite 多入口多次构建，仍禁止引入 Webpack |
| UI 框架 | React 19 | 侧边栏面板页面使用（dock / float / embed 三形态共用同一份页面） |
| 样式 | Tailwind CSS v4 | 与主站 `frontend/` 保持一致，禁用 v3 及以下 |
| 依赖管理 | 与 `frontend/` 一致使用 npm（package-lock.json） | 一律通过 `scripts/` 脚本执行，不直接敲包管理命令 |
| 行数上限 | 每个源码文件 ≤ 300 行 | 超过即拆分模块 |
| 文件数上限 | 每层目录 ≤ 8 个文件 | 超过即规划子目录 |
| 入口脚本自包含 | background.js、content-*.js **不得出现 import/export 语句** | service worker 与 content script 均按经典脚本执行；这两个入口禁止跨模块引用共享代码（会生成带 import 的公共 chunk 导致 "Cannot use import statement outside a module"），所需常量本地声明并注释同步来源。页面入口（html+module script）不受此限。service worker 在 manifest 中额外声明 `"type": "module"` 作为兜底（未来引入共享 chunk 也不会崩）；**content script 没有等价开关，必须永久自包含** |
| 注释 | 中文，详细 | 与项目全局规则一致 |

### 3.1 与主站前端的关系

- 插件是**独立构建的工程**，不直接 `import` `frontend/` 的任何模块（避免拖入主站依赖树）。
- 后端 API 的类型定义在插件内 `src/shared/types/` 维护，文件头部注明「复制自主站 `frontend/src/types/api.ts` 与后端 `internal/model`（手工同步）」，字段变更时三处一起改。
- API 基地址、token 等环境差异通过 options 页配置，不编译期写死。

---

## 4. 目录结构规范

```
browser-extension/
├── README.md               # 目录说明 + 手册指引
├── CHANGELOG.md            # 版本变更记录
├── package.json            # type: module（npm 管理，含 package-lock.json）
├── package-lock.json
├── tsconfig.json
├── vite.config.ts          # 多入口构建：sidepanel / background / content-ball / content-dock
├── public/
│   ├── manifest.json       # manifest 源文件（随 Vite public/ 拷贝到产物根）
│   └── icons/              # 16/32/48/128 四套 PNG 图标
├── src/
│   ├── background/         # service worker（入口 main.ts：点击图标三级降级开面板 + 右键菜单任务投递）
│   ├── content/            # 内容脚本（ball.ts 球形悬浮+执行框 / dock.ts 页内停靠+取文取图，全站注入）
│   ├── sidepanel/          # 唯一 UI 页面（四形态共用）：index.html + main.tsx + App.tsx + globals.css
│   │   └── components/     # 面板组件（根级组件 + ai/、bookmarks/、settings/、moment/、exec/ 子目录；
│   │                       #   exec/=右键任务执行器（执行框页/面板叠加层共用组件），bookmarks/ 内部
│   │                       #   另分 hooks/ 与 site-nav/）
│   ├── styles/             # tokens.css（主站双主题设计令牌副本）
│   └── shared/             # 共享代码
│       ├── api/            # boke 开放网关 API 客户端（client.ts / endpoints.ts / image-bed.ts 图床上传）
│       ├── messages/       # 跨上下文消息与 ExecTask 任务判别联合（§8.1；通道超 10 条后集中定义）
│       ├── panel-mode.ts   # 面板形态识别与切换（dock / float / embed / exec）
│       ├── permissions.ts  # optional_host_permissions 运行时主机授权（网页总结/截图/图床直连共用）
│       ├── storage/        # 存储封装（settings.ts 键登记 / ai-history.ts / image-cache.ts→IndexedDB /
│       │                   #   bookmark-db.ts+bookmark-store.ts 书签树 / exec-task.ts 右键任务与草稿篮）
│       └── types/          # 类型定义（复制自主站 frontend + 后端 internal/model，手工同步）
└── （无 popup/ 与 options/——v1 起未落地，见下方说明）
```

> **目录演进说明（v1.1 核对实际代码后确立）**：v1.0 目录图中的 `popup/`、`options/`、`pages/` 与 `shared/messages/` 实际均未落地。现行为：点击工具栏图标经 service worker 三级降级直接打开面板（无 popup 页）；设置以侧边栏内置「站点连接」弹层（`ManagePanel`）承载（§10.5）；消息量少，以常量 + 注释手工同步（§8.1 现状）。若未来新增独立弹窗或设置页，再按本目录规范扩展。

规则：

1. background / content / sidepanel 各自有独立入口，公共逻辑一律下沉到 `shared/`，禁止在入口之间互相 import；content 入口（ball.ts / dock.ts）因经典脚本约束必须自包含（§3「入口脚本自包含」）。
2. sidepanel 页面目录内最多：`index.html`、`main.tsx`、`App.tsx`、`globals.css` 与组件子目录；组件优先按功能域拆子目录（现有 `ai/`、`bookmarks/`），单层超过 8 个文件必须再拆。
3. 构建产物输出到仓库根 `dist/browser-extension/`（构建脚本负责，源码目录内不出现产物）。

---

## 5. Manifest V3 规范

### 5.1 标准 manifest 模板

源文件为 `public/manifest.json`，构建时随 Vite `public/` 整体拷贝到产物根。模板与当前实际声明一致（`version` 随发版递增）：

```json
{
  "manifest_version": 3,
  "name": "月言博客助手",
  "version": "0.31.0",
  "minimum_chrome_version": "110",
  "description": "月言博客平台的浏览器侧边栏助手：站点动态、AI 问答与开放接口中心，凭站点 URL + API Key 连接使用。",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_title": "打开月言博客助手",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png"
    }
  },
  "side_panel": { "default_path": "src/sidepanel/index.html" },
  "options_page": "src/sidepanel/index.html",
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*", "file://*/*"],
      "js": ["content-ball.js", "content-dock.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/sidepanel/index.html", "icons/icon-*.png"],
      "matches": ["http://*/*", "https://*/*"]
    }
  ],
  "permissions": ["storage", "sidePanel", "contextMenus", "bookmarks", "favicon", "tabs", "scripting", "activeTab", "unlimitedStorage"],
  "optional_host_permissions": ["http://*/*", "https://*/*"],
  "host_permissions": []
}
```

模板要点（与实际实现的对应关系）：

1. `background.js`、`content-ball.js`、`content-dock.js` 均为 Vite 入口的**固定名产物**（`vite.config.ts` 入口不带 hash），manifest 静态引用的就是产物根文件名。
2. `action` **不设 `default_popup`**：点击工具栏图标由 service worker `action.onClicked` 接管，按三级降级打开面板（§2.2）。
3. **不声明 `default_locale`**：未提供 `_locales/` 目录时声明该字段会直接导致扩展加载失败；引入国际化时才随 `_locales/` 一起加。
4. `side_panel.default_path` 与 `options_page` 指向同一份 sidepanel 页面（§10.5：v1 以侧边栏内置连接弹层替代独立 options 页）。
5. `content_scripts` 全站注入球与停靠两个内容脚本（网页内入口），与"面板数据请求零主机权限"互不冲突——数据请求由扩展页面直连开放网关（§7.2），站点级注入授权走 `optional_host_permissions` 运行时申请（§6）。

### 5.2 manifest 硬性规则

1. `version` 使用三段语义化 `主.次.修订`，每次发版必须递增；两个商店共用同一版本号。
2. 图标必须齐全：16 / 32 / 48 / 128 四个尺寸 PNG。
3. `background.service_worker` 是唯一后台形态；service worker **没有 DOM**，禁止访问 `window`、`document`。
4. `web_accessible_resources` 采用 MV3 对象数组格式，且 `matches` 收敛到实际需要的站点，禁止 `"<all_urls>"`：

```json
"web_accessible_resources": [
  { "resources": ["icons/*.png"], "matches": ["https://example.boke.site/*"] }
]
```

5. 内容安全策略不显式放宽。插件默认 CSP 即要求 `script-src 'self'`，**禁止**添加任何允许远程脚本的 CSP 配置。

---

## 6. 权限规范

1. 权限三问：这个权限解决什么功能？能否用 `activeTab` 替代？能否放进 `optional_permissions` 运行时再申请？——三个问题都要有答案才能写入 manifest。
2. `host_permissions` 只写 boke 站点与功能必需的第三方站点；站点地址用户可配时，用 `optional_host_permissions` + 运行时申请。
3. 禁止申请的权限示例：`<all_urls>` 主机、`history`、`downloads`、`management`、`debugger`——除非某期功能明确立项并在 `discuss/` 有评审记录。
4. `tabs` 权限：读取标签页 url/title 所需（官方规则：无该权限时 tab.url 恒为 undefined）。「网页总结」定位用户正在看的页面依赖它；启用后 CHANGELOG 需说明。踩坑记录：v0.10.x 因缺此权限导致网页总结全量误判（v0.11.0 修复）。
5. `sidePanel` 权限：使用原生侧边栏 API 的插件**必须**在 manifest 中显式申请，否则 `chrome.sidePanel` 对象不存在、能力探测恒 false，会静默退化成页内停靠。本仓库因此踩坑（v0.5.1 修复）。
6. 新增权限 = 行为变更：必须在 CHANGELOG 中说明原因，并在双浏览器重新走完整验证清单。

### 6.1 现行权限清单（v1.3 核对 manifest 后落档）

每个权限的「权限三问」答案在此登记，新增或移除权限时同步维护本表：

| 权限 | 解决什么功能 | 为何不可省/不可替代 |
|---|---|---|
| `storage` | 全部本地持久化：连接配置、书签树、AI 会话/提示词、悬浮球位置、球显隐开关 | 凭证禁入 localStorage（§7.1），chrome.storage 是唯一合规载体 |
| `sidePanel` | Chrome 114+ 原生右侧边栏 | 缺失时 `chrome.sidePanel` 对象不存在，能力探测恒 false 静默降级（v0.5.1 踩坑） |
| `contextMenus` | 右键菜单「月言助手」（§14：总结发布/AI 收藏/指定收藏/发说说四条任务链路） | 注册右键菜单的唯一 API；无替代方案，且菜单须在 onInstalled 时注册、无法运行时再申请 |
| `bookmarks` | 「导入本地书签」读取浏览器书签树 | 无该权限读不到书签树；仅读，不写浏览器书签 |
| `favicon` | 书签条目经 `_favicon` 协议读取浏览器本地图标缓存 | 图标来自浏览器本地缓存，零网络请求；无替代协议 |
| `tabs` | 网页总结定位「用户正在看的页面」；右键任务读取来源页 url/title | 缺失时 `tab.url` 恒 undefined（v0.11.0 踩坑） |
| `scripting` + `activeTab` | 网页总结 / 区域截图时向当前页**一次性**注入抓取/取景函数 | 动态注入方案（v0.12.0）的基础，页面无需刷新 |
| `unlimitedStorage` | 生成图片 IndexedDB 本地缓存（Blob） | 图片缓存超 5MB 默认配额，容量需随磁盘 |
| `optional_host_permissions`（http/https） | 注入函数到目标站点前运行时申请主机授权（`permissions.request`） | 保持 `host_permissions` 为空，仅网页总结/截图实际触发时弹出授权，最小权限 |

---

## 7. 安全规范

1. **凭证存储**：boke 的 token / API 地址只存 `chrome.storage.local`；禁止存入 `localStorage` / `sessionStorage`（内容脚本环境中它们属于宿主页面域，会泄露给第三方脚本）。
2. **网络请求分层**：内容脚本禁止直接 `fetch` boke API（受宿主页 CSP 与 cookie 环境影响），须由 background 统一请求并回传结果；扩展自有页面（sidepanel / options）可在服务端 CORS 放行后直连 boke API——开放网关 `/api/v1/open/` 对插件源回显 Origin 且允许 `X-Api-Key` 头，因此插件保持零主机权限（host_permissions 为空，权限最小化）。球形悬浮的内容脚本只负责渲染 UI 与转发存储状态，`fetch` 一律发生在 iframe 内的扩展页面上，天然符合本条分层。
3. **消息安全**：
   - 插件内部通信使用 `chrome.runtime.sendMessage`，接收方必须校验 `sender.id` 与消息结构；
   - 不注册 `externally_connectable`，不接收任意网页发来的消息。
4. **防 XSS**：向页面注入 UI 时禁止 `innerHTML` 拼接不可信内容；一律使用 React 渲染或 `textContent` / DOM API。
5. **不越界采集**：只读取功能明确需要的页面信息（如当前页标题/URL/选中文本），不得读取或上传用户在其他站点的行为数据。
6. **依赖安全**：新增 npm 依赖前确认必要性（YAGNI），锁定版本写入 `package.json`，禁止引入会请求远程资源的包。

---

## 8. 代码规范

### 8.1 类型与消息协议

所有跨上下文消息走**强类型协议**：在 `src/shared/messages/` 集中定义判别联合，禁止裸字符串消息。

```typescript
// src/shared/messages/types.ts —— 消息协议集中定义
export type ExtensionMessage =
  | { type: 'page-info'; payload: { title: string; url: string; selection: string } }
  | { type: 'create-post'; payload: { title: string; content: string } }
  | { type: 'api-error'; payload: { status: number; message: string } };
```

**现状说明（v1.3 核对实际代码）**：通道数已超 10 条，按下方演进规则于 v0.31.0 落地 `src/shared/messages/types.ts`——`MSG` 消息常量与 `ExecTask` 任务判别联合集中定义，扩展页上下文（sidepanel 组件）一律 import 使用；background 与 content script（ball/dock）因自包含约束本地声明并注释同步。当前通道共 11 个：

| 消息 / 通道 | 方向 | 用途 |
|---|---|---|
| `open-dock` | 面板页 → background | 请求向活动网页注入页内停靠侧栏 |
| `yy-open-sidepanel` | 悬浮球 → background | 点击球后三级打开面板（§2.2） |
| `yy-dock-toggle` | background / panel-mode → dock | 页内停靠侧栏开关（收到应答 `ok` 判定成败） |
| `yy-dock-open` | background → dock | 仅打开页内停靠（幂等，不开不关） |
| `yy-page-text` | 扩展页 → dock | 抓取宿主页可见文本与内容区图片（网页总结与右键「总结本页」共用；应答 {ok,title,url,text,images}；图片收集规则与 AI 页注入抓取一致，两处一起改） |
| `yy-image-data` | 执行器 → dock | 页面上下文抓取图片转 dataURL（右键发说说的 blob:/受保护图通道；异步应答） |
| `yy-exec-offer` | background → 悬浮球 | 右键任务投递探测：球可见应答 {ok:true} 并展开执行框；隐藏应答 {ok:false} 走面板兜底（§14） |
| `yy-exec-run` | background → 扩展页广播 | 面板兜底领取 target=panel 的右键任务（ExecutorOverlay 双通道之一） |
| `yy-exec-close` | 执行器 → background → 悬浮球 | 执行框完成/关闭。**扩展页的 runtime.sendMessage 广播按官方语义不投递 content script**（0.31.1 踩坑：球从未收到收起指令导致执行框关不掉），须经 background 转发 tabs.sendMessage 到宿主页标签 |
| `yy-run-action` | 悬浮球 → runtime 广播 | 通知 embed 面板执行暂存动作（nonce 防过期重放） |
| `panel_action`（chrome.storage 暂存键） | 悬浮球菜单 → embed 面板 | 网页总结 / 截图动作载荷，面板消费后删除 |

演进规则：新增通道或结构化载荷一律先落 `src/shared/messages/` 集中判别联合；扩展侧上下文（sidepanel，可用 import）从该文件 import，background / content script 侧因自包含约束继续本地声明并注释同步。

### 8.2 存储封装

统一经过 `src/shared/storage/` 的封装读写，键名集中定义，禁止散落的魔术字符串：

```typescript
// src/shared/storage/keys.ts —— 存储键集中登记
export const STORAGE_KEYS = {
  apiBaseUrl: 'apiBaseUrl',
  authToken: 'authToken',
} as const;

// src/shared/storage/settings.ts —— 读写封装（纯函数，返回新值）
export async function readSettings(): Promise<{ apiBaseUrl: string; authToken: string }> {
  const stored: Record<string, unknown> = await chrome.storage.local.get([
    STORAGE_KEYS.apiBaseUrl,
    STORAGE_KEYS.authToken,
  ]);
  return {
    apiBaseUrl: typeof stored[STORAGE_KEYS.apiBaseUrl] === 'string' ? (stored[STORAGE_KEYS.apiBaseUrl] as string) : '',
    authToken: typeof stored[STORAGE_KEYS.authToken] === 'string' ? (stored[STORAGE_KEYS.authToken] as string) : '',
  };
}
```

**现行存储键登记（v1.1）**：键名常量集中于 `shared/storage/settings.ts` 的 `STORAGE_KEYS`；content script（ball.ts）因自包含约束本地声明并注释同步来源。

| 键 | 内容 |
|---|---|
| `plugin_settings_v1` | 连接配置与全局开关（API 地址、Key、主题、悬浮球显隐、发布图床通道及 CF 图床凭证等） |
| `profile_cache_v1` | 绑定用户公开资料缓存 |
| `site_meta_cache_v1` | 站点信息缓存 |
| `ball_position_v1` | 悬浮球位置（含边缘吸附态） |
| `bookmarks_v2` | 书签树**兜底存储**（`bookmarks_v1` 为旧扁平结构，首次读取自动迁移）。主存为 IndexedDB（`yueyan-bookmarks` 库，见下）；两份以 `savedAt` 时间戳调和（新者胜，读后收敛一致） |
| `bookmarks_collapsed_v1` | 文件夹折叠状态 |
| `ai_chat_v1` | 当前 AI 会话消息流 |
| `ai_prompts_v1` | 自定义提示词 |
| `ai_sessions_v1` | AI 历史会话归档 |
| `nav_private_unlocked_v1` | 站点私有导航「已解锁」免输标记（密码经站点公开 unlock 端点校验，密码本身不落盘；断开连接即清除） |
| `panel_action` | 悬浮球菜单待执行动作暂存（消费后删除） |
| `exec_task_v1` | 右键任务待执行载荷（`ExecTask` 判别联合，含 nonce/target/kind；被领取后 target 改写为 `claimed`，2 分钟未领取视为过期静默丢弃——见 §14） |
| `exec_moment_draft_v1` | 说说草稿篮（右键「加入选中文字/此图片」跨次累积 text + images；发送成功或清空后移除——见 §14） |

IndexedDB 例外（扩展页面 origin，存储结构化大数据）：

- 生成图片本地缓存：`shared/storage/image-cache.ts`（库名 `yueyan-image-cache`，存 Blob）——chrome.storage 不适合存大二进制；
- 书签树主存：`shared/storage/bookmark-db.ts`（库名 `yueyan-bookmarks`，单记录存整棵树）——升级/损坏场景更抗丢失，与 chrome.storage 双写互为兜底；
- 注意 content script 的 IndexedDB 属**宿主页 origin**，禁止用于扩展数据（悬浮球收藏因此只写 chrome.storage，靠 `savedAt` 调和收敛进主存）。

### 8.3 后端 API 客户端

- 只在 background 中实例化，`fetch` 显式带 `credentials: 'omit'` 与 token 头；
- 所有响应先做结构校验再使用，超时必须处理；
- 错误统一映射为 `api-error` 消息回传 UI，UI 层不出现裸 `fetch`。

### 8.4 通用代码规则（继承项目全局规则，重申关键点）

- 纯函数优先：只改返回值，不改入参与全局状态；
- 所有导入语句置于文件顶部；
- 禁止默认参数值，参数一律显式；
- 函数功能单一，不写多模式标记参数；
- 复用优先：写新代码前先查 `shared/` 是否已有实现（DRY）。

---

## 9. 性能规范

1. service worker 遵循事件驱动：注册监听在顶层同步完成，不做常驻循环，不保存可丢状态（worker 随时会被终止）。
2. 定时任务用 `chrome.alarms`（需 `alarms` 权限），禁止 `setInterval` 长轮询；提醒类轮询最小间隔不低于 1 分钟。
3. 内容脚本只在目标站点注入，注入体积保持精简；重 UI 用 Shadow DOM 隔离样式，避免污染宿主页。
4. 图标与静态资源压缩后再入包，插件包体积目标 ≤ 2 MB。
5. 网络请求合并去重：同一页面生命周期内相同请求复用结果。

---

## 10. UI 规范

1. 面板形态尺寸：原生侧边栏宽度随浏览器；页内停靠 430px（窄屏自动收敛，上限 72vw）；独立悬浮窗 420×780；网页内悬浮球展开 iframe 392×600（max-height 随视口收敛）；悬浮球旁执行框 320×430（max-height 随视口收敛，§14）。内容超出一律**内部滚动**——仅内容区滚动，输入区/工具行固定。
2. UI 语言为简体中文；文案与主站 `frontend/` 风格保持一致。
3. 深色模式跟随系统（`prefers-color-scheme`），Tailwind `dark:` 实现。
4. 所有按钮/交互需有 loading、成功、失败三态反馈；失败提示必须可读（含 HTTP 状态与后端 message）。
5. options 页要求：v1 以侧边栏内置「站点连接」弹层（`ManagePanel`）替代独立 options 页，`options_page` 指向 sidepanel 同一页面；弹层需包含 API 地址配置、Key 更新、断开连接与状态展示。

---

## 11. 构建与调试

### 11.1 脚本（唯一入口，禁止直接调用 pnpm/vite）

| 脚本 | 用途 |
|---|---|
| `scripts/setup-browser-extension.sh` | 首次安装依赖（npm ci 优先，无 lock 时 npm install），日志 `logs/browser-extension-setup-*.log` |
| `scripts/dev-browser-extension.sh` | 开发模式（watch 构建 + HMR），日志输出 `logs/browser-extension-dev.log` |
| `scripts/build-browser-extension.sh` | 生产构建：产出 `dist/browser-extension/`（加载目录）与 `dist/browser-extension.zip`（提商店），日志输出 `logs/browser-extension-build.log` |
| `scripts/verify-extension-edge.sh` | Edge 兜底链路程序化验证（右键任务→球隐藏→页内停靠→模态执行卡→任务认领闭环），日志 `logs/verify-extension-edge.log` |
| `scripts/verify-extension-e2e.sh` | 右键任务「真实发布」E2E（本地 mock 站点承载开放网关契约：连接→SSE 流式总结→文章发布→说说草稿篮文字+图片组合发布），日志 `logs/verify-extension-e2e.log` |

脚本本身出问题时先修脚本，再继续用脚本（全局规则）。

### 11.2 本地加载（两浏览器都要做）

| 步骤 | Chrome | Edge |
|---|---|---|
| 打开扩展页 | `chrome://extensions` | `edge://extensions` |
| 开启开发者模式 | 右上角开关 | 左下角「开发人员模式」 |
| 加载已解压 | 选择 `dist/browser-extension/` | 同左 |
| 改动后刷新 | 扩展卡片刷新按钮 + 重开 popup | 同左 |

---

## 12. 双浏览器验证清单（每次交付前逐项勾选）

- [ ] `scripts/build-browser-extension.sh` 构建成功，无 TS 报错、无产物体积超标
- [ ] Chrome：全新安装加载成功，无控制台报错
- [ ] Edge：全新安装加载成功，无控制台报错
- [ ] popup 正常打开、渲染、关闭再打开状态正确
- [ ] options 配置 API 地址后可保存，重开浏览器后仍在
- [ ] 登录态获取、失效重登流程可用
- [ ] 内容脚本仅在目标站点注入，其他站点不注入
- [ ] 消息链路（content → background → API → UI）全链路可用
- [ ] 断网 / 后端 5xx / token 过期三类异常提示友好
- [ ] 卸载后无残留存储（`chrome.storage.local` 已随卸载清除）
- [ ] manifest 版本号已递增，CHANGELOG 已更新

---

## 13. 版本管理与发布

1. 版本节奏：`主.次.修订`——不兼容变更提主版本，新功能提次版本，修复提修订版本。
2. 每次构建产出的 zip 用同一版本号先后提交：
   - Chrome Web Store（[chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)）
   - Microsoft Edge Add-ons（[partner.microsoft.com/dashboard/microsoftedge](https://partner.microsoft.com/dashboard/microsoftedge)）
3. 商店描述、截图两店保持一致；商店审核被拒原因记录进 `CHANGELOG.md` 备忘。
4. 发布前必须完成第 12 章全部清单项。

---

## 14. 右键菜单与悬浮球执行框（v0.31.0 落档）

方案评审：`discuss/browser-extension-context-menu-executor.md`。本节为该功能族的强制规范。

### 14.1 架构：三层投递

```
chrome.contextMenus.onClicked（background）
  ├─ 构建 ExecTask（shared/messages/types.ts 判别联合）写入 exec_task_v1（target=ball）
  ├─ ① tabs.sendMessage(tabId, yy-exec-offer) → 球可见应答 ok:true
  │     → 悬浮球在球旁展开执行框 iframe（sidepanel 页 ?mode=exec&nonce=…）
  └─ ② 球隐藏/失联 → target 改写 panel → openPanelForTask 三级降级开面板
        → runtime 广播 yy-exec-run → 面板 ExecutorOverlay 领取（模态执行卡）
```

硬性规则：

1. **执行器只能是扩展页面**（执行框 iframe / 面板页），所有网络请求（AI、发布、转存）发生在扩展页 origin（§7.2）；content script 一律不 fetch boke API。
2. **任务单消费者**：`exec_task_v1.target`（`ball | panel | claimed`）决定唯一执行者；被领取即改写 `claimed`。多面板上下文并发领取用「写 owner 后回读」两阶段认领（`claimPanelExecTask`），毫秒级竞态窗口可接受（最坏情形为两张执行卡，发布仍需各自人工点击）。
3. **任务时效**：2 分钟未被领取视为浏览器重启残留，静默丢弃（`EXEC_TASK_STALE_MS`）。
4. **菜单注册**：`onInstalled` 全量重建（removeAll + create 幂等），`onStartup` 补挂一次；菜单项限定 `documentUrlPatterns` http/https/file 与内容脚本注入范围一致。文件夹选择放执行器交互层，**禁止**随书签树动态重建菜单（僵化）。
5. **执行框不自动关闭**：球面板「点击外部关闭」的逻辑不作用于执行框（执行中用户可能回页面操作）；仅完成按钮 / 关闭按钮（`yy-exec-close`）收起。

### 14.2 四条任务链路

| 菜单 | 任务 kind | 过程 | 交互 | 完成 |
|---|---|---|---|---|
| 📝 总结本页，发布到博客 | `summary` | `yy-page-text` 取正文与内容区图片（≤9 张，与 AI 网页总结同规则）→ AI 流式总结（实时预览）→ markdown **渲染为富文本**（原文图片均匀插入、尾附原文出处）；并行 AI 生成标题/标签/SEO（`generateArticleMeta`，与「生成文章」同一套，失败降级手填） | RichEditor 富文本编辑（图片可视化）+ 标题/标签/SEO 编辑 + 可见性；存草稿 / 发布 | `routeArticleImages` 按设置图床路由（none/tg/cf，与「生成文章」一致）→ `createPost(article)`（含 seo 与 tags）+ `/posts/{id}` 链接 |
| ⭐ 收藏本页（AI 自动分类） | `bookmark` mode=ai | 读书签树 → AI 推荐 JSON（folder/new_folder/title） | 下拉改选（根级/路径/新建）+ 标题编辑 | 写书签树（savedAt 调和）；未连接自动降级手动 |
| 📁 收藏本页到指定文件夹… | `bookmark` mode=pick | 读书签树 | 同上（无 AI 步） | 同上；纯本地能力，未连接也可用 |
| 🔍 截图本页，AI 分析 | `shot` | **直通**：右键手势内授权→页面立即出蒙版框选（Esc 取消=安静结束）→ captureVisibleTab → 携截图+选区投递任务，执行框打开即「裁剪×dpr→压缩→识图」 | 授权被拒降级「开始框选」兜底（screenshot-tools 共用）；结果区（重新框选 / 完成） | `ai.assist(recognize)`，结果经 MarkdownMessage 渲染（.md-body，与 AI 助手消息同款）+ 截图预览展示在执行卡，附「复制文字」一键复制识别文本 |
| 💬 发说说：加入选中文字 / 此图片 | `moment` | 草稿篮累积（文字追加、图片去重）→ 发布时逐图按设置图床路由（moment-image-router：tg/cf 直传图床仅正文引用；none/图床失败降级服务器关联 media_ids；全失败原链接内嵌） | 文字编辑(≤2000)/缩略图删除/附来源/可见性 | `createMomentPost`；成功清空草稿篮 |

说说图片路由次序见 `moment-image-router.ts`；文章与说说的取图/压缩工具与 AI 助手共用（`screenshot-tools`、`publish-image-router.fetchImageAsFile`、`moment/compose.compressImageFile`），规则变更两处一起改。

### 14.3 桌宠观感

执行框打开期间球体加 `busy` 类（月晕呼吸加速，`moon-breathe` 动画时长 1.1s），关闭/完成恢复；执行框定位与球面板同款贴边翻转策略（左缘空间不足翻到球左侧），尺寸 320×430。

**关闭链路（0.31.1 修正）**：执行器页的关闭/完成 → `yy-exec-close` → **background 转发** `tabs.sendMessage` → 球收起执行框并移除 iframe（释放后台实例）。禁止在扩展页直接用 `runtime.sendMessage` 通知 content script——官方语义不投递（踩坑记录见 §8.1）。页内停靠面板另有「点击停靠区外收起」，与球面板体验一致；收起同样移除 iframe。

### 14.4 兜底面板

`openPanelForTask` 与 action 点击的 `openPanel` 区别：停靠走**只开不关**（`yy-dock-open`），避免已展开侧栏被误关。面板内执行卡（`ExecutorOverlay`）与执行框共用 `components/exec/` 的任务组件，形态差异只在宿主（模态叠加 vs iframe）。

---

## 15. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.4 | 2026-09-04 | 0.32.0 落档：右键「总结本页」发表前体验对齐「生成文章」——标签/SEO 由 AI 生成（generateArticleMeta 复用）、正文渲染为富文本（RichEditor + distributeImages/renderMarkdown）；§14.2 summary 行更新；执行器目录重排 tasks/ 子目录 |
| v1.3.1 | 2026-09-04 | 0.31.1 两处修复落档：①右键「总结本页」抓取内容区图片并按 publishImageBed 图床路由发布（yy-page-text 增 images、distributeImages 复用、routeArticleImages 接入）；②执行框关不掉根因（扩展页 runtime.sendMessage 不投递 content script）——yy-exec-close 改经 background 转发；dock 补点击外部收起；收起/关闭统一移除 iframe |
| v1.3 | 2026-09-04 | 新功能「右键菜单 + 悬浮球执行框」落档：新增 §14（contextMenus 四条任务链路、ExecTask 三层投递、任务单消费者与两阶段认领、说说草稿篮、图片转存次序、桌宠忙碌态、面板兜底）；§8.1 消息通道超 10 条，`shared/messages/types.ts` 集中判别联合落地；§8.2 登记 `exec_task_v1` / `exec_moment_draft_v1`；§6.1 登记 `contextMenus` 权限；manifest 模板与目录结构对齐 v0.31.0 |
| v1.2 | 2026-09-04 | 新功能「发布图床」落档：设置面板新增发布图床三选一（站点服务器/TG图床/CF图床，方案见 discuss/browser-extension-publish-image-bed.md）——`plugin_settings_v1` 扩展 `publishImageBed`/`cfBedUrl`/`cfBedKey`；新增 `shared/permissions.ts` 运行时主机授权封装（optional_host_permissions 按需申请，网页总结/截图/图床直连共用）；CF图床 Worker 直连不回 CORS 头，必须持主机权限后扩展页面 fetch |
| v1.1 | 2026-08-29 | 手册对齐实际实现：目录结构（popup/options/pages/messages 从未落地，实为 sidepanel 单页面三形态）、manifest 模板（产物固定名、无 default_popup、去掉 default_locale 隐患、实际权限与全站注入声明）、新增现行权限清单（§6.1）、消息通道现状表（§8.1）、存储键登记（§8.2）、面板三形态尺寸（§10.1）、脚本说明 pnpm 修正为 npm |
| v1.0 | 2026-08-25 | 首版：确立 Chrome + Edge 双浏览器兼容、MV3、TypeScript + Vite + React 19 + Tailwind 4 技术基线与全部强制规范 |
