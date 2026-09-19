import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './index.html',
  },
  output: {
    assetPrefix: 'auto',
    distPath: {
      root: 'dist',
    },
    sourceMap: {
      js: 'source-map',
      css: true,
    },
    copy: [
      {
        from: '../star-trails/pkg/star_trails_bg.wasm',
        to: './pkg/star_trails_bg.wasm',
      },
    ],
  },
  performance: {
    chunkSplit: {
      strategy: 'split-by-experience',
    },
  },
});
