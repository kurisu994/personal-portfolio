# 个人作品集

个人作品集仓库。每件作品独占一个子目录，自带源码、构建配置、说明文档和许可证，彼此独立，可以单独运行、单独部署。

## 作品索引

| 作品 | 目录 | 形态 | 技术栈 |
| --- | --- | --- | --- |
| 候鸟 · MIGRATION · 简易版 | [`migration/`](./migration/) | 单文件，零第三方依赖 | 原生 HTML / CSS / JavaScript · Canvas 2D · WebAudio |
| 候鸟 · MIGRATION | [`migration-showcase/`](./migration-showcase/) | 工程化实现，Rsbuild 构建 | React 19 · TypeScript · Three.js · Rsbuild |

《候鸟》是一趟程序化生成的迁徙旅程：一群折纸候鸟沿河流飞行，穿越暖纸、雾境、暮粉、雪境、夜航五种气候，全程没有终点，也没有两段相同的航线。

仓库里保留两种实现，各自完整可跑：`migration/` 刻意不引入任何第三方依赖，也不发起任何网络请求，用浏览器原生 API 手写；`migration-showcase/` 建立在 React 与 Three.js 之上，带类型检查和自动化验收脚本。

## 目录约定

- 一件作品 = 一个子目录，目录名用小写英文。
- 每件作品自带 `README.md`，写清玩法、开发、构建与部署方式；根目录不重复这些内容。
- 依赖、构建产物和缓存由各作品目录内的 `.gitignore` 管理，互不影响。
- 第三方依赖的许可证副本放在作品自己的构建输入目录内（如 `public/`），构建会将其原样复制进部署产物，署名声明才能随站点一并分发；不要挪到作品目录之外。
- 根目录 `.gitignore` 只处理 `.DS_Store` 这类系统噪音。

## 本地运行

各作品的技术栈和运行方式不同，以对应目录下的 `README.md` 为准。当前两件：

```sh
# 简易版：单文件，无需构建、无需安装、无需联网，浏览器直接打开即可
open migration/index.html

# 工程版：需要 Node.js 22.12+ 和 pnpm
cd migration-showcase
pnpm install --frozen-lockfile
pnpm dev
```

`migration-showcase/` 另附类型检查、构建和四组验收脚本（`pnpm typecheck`、`pnpm build`、`pnpm verify:model` / `verify:river` / `verify:simulation` / `verify:visual`），部署方式见 [`migration-showcase/README.md`](./migration-showcase/README.md)。

## 新增一件作品

1. 在根目录创建子目录，例如 `new-work/`。
2. 放入源码，并按自己的技术栈写一份 `.gitignore`。
3. 在目录内写 `README.md`，说明运行和部署方式。
4. 回到本文件，在「作品索引」表格里补一行。

## 许可证

各作品及其素材的授权，以对应目录内的说明为准。

- **第三方依赖**：`migration-showcase/` 运行时依赖 three、React、lucide 以及 Manrope / Noto Serif SC 两款字体，其许可证原文（MIT / ISC / OFL）保存在 [`migration-showcase/public/licenses/`](./migration-showcase/public/licenses/)。该目录属于构建输入，Rsbuild 会将它原样复制到 `dist/licenses/`，许可证因此随部署产物一同分发。**不要把这份副本挪出 `public/`**，否则线上站点会失去授权声明。
- **简易版**：`migration/` 不依赖任何第三方库、字体或 CDN，配乐与图标都内嵌在单文件里，无需附带许可证副本。
