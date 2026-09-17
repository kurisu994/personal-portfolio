import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './index.html',
  },
  output: {
    // 保持 'auto'：CSS 内的图标字体用相对 URL，写成 './' 会让浏览器相对
    // CSS 文件解析而请求到 /static/css/static/font/...。'auto' 在站点根与
    // 子目录部署下都正确。理由与 migration-showcase 一致。
    assetPrefix: 'auto',
    distPath: {
      root: 'dist',
    },
    sourceMap: {
      js: 'source-map',
      css: true,
    },
  },
  performance: {
    chunkSplit: {
      strategy: 'split-by-experience',
    },
  },
});
