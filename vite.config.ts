// browser-extension/vite.config.ts
// 插件构建配置：Vite 多入口手动构建（不使用 crxjs，规避其维护风险）。
// 入口：① sidepanel.html（侧边栏/悬浮窗/网页内嵌共用页面）
//       ② background/main.ts（service worker，负责点击图标按三级降级打开面板）
//       ③ content/ball.ts（内容脚本：网页球形悬浮入口）
//       ④ content/dock.ts（内容脚本：页内停靠侧栏，无 sidePanel API 浏览器的等效形态）
// 产物固定名策略：入口 JS 不带 hash（manifest 需要静态引用），公共 chunk 进 assets/。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const EXTENSION_ROOT: string = __dirname;

export default defineConfig({
  // 构建根即插件工程根（manifest/icons 位于 public/，随构建拷贝到产物根）
  plugins: [react(), tailwindcss()],
  build: {
    // 产物输出到仓库 dist/browser-extension/（加载目录）
    // 输出目录默认主仓布局（仓库根 dist/）；开源仓 CI 以 EXT_OUT_DIR 覆盖（如 ./dist）
    outDir: process.env.EXT_OUT_DIR ?? resolve(EXTENSION_ROOT, '../dist/browser-extension'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome110',
    rollupOptions: {
      input: {
        sidepanel: resolve(EXTENSION_ROOT, 'src/sidepanel/index.html'),
        background: resolve(EXTENSION_ROOT, 'src/background/main.ts'),
        'content-ball': resolve(EXTENSION_ROOT, 'src/content/ball.ts'),
        'content-dock': resolve(EXTENSION_ROOT, 'src/content/dock.ts'),
      },
      output: {
        // manifest.json 静态引用入口文件名，因此入口不带 hash
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
