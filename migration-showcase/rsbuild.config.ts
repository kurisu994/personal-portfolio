import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './index.html',
  },
  output: {
    assetPrefix: './',
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
