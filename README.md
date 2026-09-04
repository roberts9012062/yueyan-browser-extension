# 月言博客助手（浏览器插件）

[月言博客平台（boke）](https://github.com/roberts9012062/boke)的浏览器侧边栏助手：站点动态、AI 问答、书签夹与开放接口中心。**同时支持 Google Chrome 与 Microsoft Edge**（Chromium / Manifest V3，最低版本 110），一套代码、一份产物。

凭站点 URL + API Key 连接使用——所有数据只保存在你的浏览器本地，凭证不入 localStorage。

## 功能速览

| 模块 | 能力 |
|---|---|
| 🏠 首页 | 站点动态时间线、底部快捷写说说（文字/图/视频/音乐/链接，可见性） |
| 🤖 AI 助手 | 多模型对话（流式）、联网搜索、文件/网页上下文、AI 生图、网页总结、区域截图识图、「生成文章」一键润色发布 |
| 🔖 书签夹 | 本地书签树（新建/拖拽/搜索/查重/失效检测）、导入浏览器书签、站点导航同步、AI 识别添加、私有导航 |
| 🖱️ 右键菜单 | 总结本页发布博客（AI 标签/SEO + 富文本编辑 + 图床路由）、收藏本页（AI 自动分类 / 指定文件夹）、发说说草稿篮（选中文字 + 图片组合）、截图本页 AI 分析（直通蒙版框选） |
| 🌙 悬浮球 | 可拖动月亮桌宠：悬停快捷菜单、点击开面板；右键任务在球旁弹出执行框（执行过程 / 交互 / 完成三态） |
| 🛏️ 发布图床 | 文章与说说图片可选 站点服务器 / TG 图床 / CF 图床（R2 Worker）三通道 |

## 安装

### 方式一：下载发布包（推荐）

到 [Releases](https://github.com/roberts9012062/yueyan-browser-extension/releases) 下载最新 `yueyan-browser-extension-v*.zip` 并解压：

| 步骤 | Chrome | Edge |
|---|---|---|
| 打开扩展页 | `chrome://extensions` | `edge://extensions` |
| 开发者模式 | 右上角开关 | 左下角「开发人员模式」 |
| 加载已解压 | 选择解压目录 | 同左 |

### 方式二：从源码构建

```bash
npm ci
npm run build   # 产物输出 dist/，浏览器加载该目录
```

## 使用

1. 点击工具栏图标或网页内的月亮悬浮球打开面板；
2. 在「站点连接」中填入你的月言博客站点地址与开放接口 API Key（站点后台「接口开放」生成）；
3. 开始使用。详细功能与开发规范见[开发手册](docs/browser-extension-guide.md)。

## 配套站点插件

浏览器插件的「发布图床 · TG 通道」依赖站点侧安装 **TG图床** 插件（月言插件市场，免费官方）。

### ✈️ [TG图床（tg-image-bed）](https://github.com/roberts9012062/yueyan-plugins/tree/main/tg-image-bed)

图片上传直达 **Telegram 频道**（Bot API `sendDocument` 原图保真），访客经站长自备的 [Cloudflare Worker 反代](https://github.com/roberts9012062/yueyan-plugins/blob/main/tg-image-bed/worker/README.md) 读图——Bot Token 只存在服务端，浏览器永远拿不到。

- **浏览器插件联动**：发说说 / 发文章插图时选择「TG 图床」通道，图片经开放接口 `tg-image-bed.upload` 直传频道（跳过前端压缩，保真），返回 Worker 直链插入正文；
- **站点后台图库**：上传历史、批量删除、复制 Markdown/URL；
- **图片体检（v0.4+）**：扫描全站说说与文章的正文图片，自动分类「外部图片（外链易失效）/ 本地图片（占服务器空间）/ 已TG」，勾选一键转存到 TG 图床并**自动替换帖子正文链接**——外链图搬家、服务器图片减负；
- **限制**：单图 ≤ 20MB（Telegram Bot API 上限）；webp 会被 TG 转为贴纸存储、gif 会转为 mp4 动画（Bot API 固有行为，直链照常可访问）。

**传送门**：[插件源码与文档](https://github.com/roberts9012062/yueyan-plugins/tree/main/tg-image-bed) · [安装包下载（Releases）](https://github.com/roberts9012062/yueyan-plugins/releases) · [月言插件库](https://github.com/roberts9012062/yueyan-plugins)

安装方式：站点后台 → 插件市场 → 搜索「TG图床」→ 安装 → 在插件设置中完成 Bot Token / Chat ID / 反代 Worker 地址三件套配对（详见插件 README）。

## 开发

- 技术栈：TypeScript（strict）+ Vite + React 19 + Tailwind CSS v4，Manifest V3
- 双浏览器验证：随版本附程序化验证脚本思路（Playwright 驱动 Edge 加载产物做全链路断言），详见手册 §12/§14
- 完整开发规范（权限、消息协议、存储键、目录结构）见 [docs/browser-extension-guide.md](docs/browser-extension-guide.md)

## 许可

[MIT](LICENSE) © 2026 月言（Yueyan）项目组
