# boke 浏览器插件

基于 boke 博客平台的浏览器插件，同时支持 **Google Chrome** 与 **Microsoft Edge**。

> **⚠️ 开发前必读**
>
> 任何涉及本目录的开发（新增、修改、修复），**必须先完整阅读开发手册：**
> [`docs/browser-extension-guide.md`](../docs/browser-extension-guide.md)
>
> 该手册是本插件的唯一规范来源（Manifest V3、权限与安全、代码规范、构建脚本、双浏览器验证清单等），由项目 `AGENTS.md` 第 7 节强制约束。

## 快速开始

```bash
# 1. 安装依赖（唯一入口，禁止直接调用 pnpm）
./scripts/setup-browser-extension.sh

# 2. 开发模式（watch 构建，日志见 logs/browser-extension-dev.log）
./scripts/dev-browser-extension.sh

# 3. 生产构建（产出 dist/browser-extension/ 与 zip）
./scripts/build-browser-extension.sh
```

构建后在浏览器加载 `dist/browser-extension/` 目录：

- Chrome：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序
- Edge：`edge://extensions` → 开发人员模式 → 加载解压缩的扩展

## 目录说明

详见手册第 4 章「目录结构规范」。本目录与 `frontend/`（Next.js 网页前端）相互独立、独立构建。
