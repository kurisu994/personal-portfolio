import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './index.html',
  },
  output: {
    // 必须是 'auto'（即 Rsbuild 默认值），由构建器按资源之间的相对位置计算路径。
    // 不能写成 './'：那会把 CSS 里的字体写成 url(./static/font/x.woff2)，而 CSS
    // 内部的相对 URL 是相对该 CSS 文件解析的，最终会请求到
    // /static/css/static/font/x.woff2 而全部 404，字体静默回退成系统字体。
    // 'auto' 会写成 ../font/x.woff2，在站点根与子目录部署下都正确。
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
