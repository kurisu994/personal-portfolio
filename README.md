# 拾羽集

个人作品集仓库，「拾羽集」是站点的名字。每件作品独占一个子目录，自带源码、构建配置、说明文档和许可证，彼此独立，可以单独运行、单独部署。

## 作品索引

| 作品 | 目录 | 形态 | 技术栈 |
| --- | --- | --- | --- |
| 候鸟 · MIGRATION · 简易版 | [`migration/`](./migration/) | 单文件，零第三方依赖 | 原生 HTML / CSS / JavaScript · Canvas 2D · WebAudio |
| 候鸟 · MIGRATION | [`migration-showcase/`](./migration-showcase/) | 工程化实现，Rsbuild 构建 | React 19 · TypeScript · Three.js · Rsbuild |
| 苔痕 · PATINA · 简易版 | [`patina/`](./patina/) | 单文件，零第三方依赖 | 原生 HTML / CSS / JavaScript · Canvas 2D · 反应扩散 |
| 苔痕 · PATINA | [`patina-showcase/`](./patina-showcase/) | 工程化实现，Rsbuild 构建 | React 19 · TypeScript · WebGL2 · Rsbuild |
| 一木 · ARBOR · 简易版 | [`arbor/`](./arbor/) | 单文件，零第三方依赖 | 原生 HTML / CSS / JavaScript · Canvas 2D · WebAudio |
| 一木 · ARBOR | [`arbor-showcase/`](./arbor-showcase/) | 工程化实现，Rsbuild 构建 | React 19 · TypeScript · Three.js · GSAP · Rsbuild |

《候鸟》是一趟程序化生成的迁徙旅程：一群折纸候鸟沿河流飞行，穿越暖纸、雾境、暮粉、雪境、夜航五种气候，全程没有终点，也没有两段相同的航线。

《苔痕》是一片程序化生长的苔：Gray-Scott 反应扩散从彼此不相连的斑点起，一路长成迷宫、珊瑚，最后铺满整张纸，再被一圈水渍洗回纸面。

《一木》是一棵从种子长成的树：落一粒种子，随滚动走过藏春、初见、向远、听风、归一，直到果熟鸟归。

《星轨》是一夜真实的星辰倾泻：输入地点与日期，用真实星表与 Meeus 天文算法算出一夜的星轨弧线与加性曝光显影。

仓库里每件作品都保留两种实现，各自完整可跑：`migration/`、`patina/`、`arbor/` 与 `star-trails/` 刻意不引入任何第三方运行时依赖，也不发起任何外部网络请求；`migration-showcase/`、`patina-showcase/`、`arbor-showcase/` 与 `star-trails-showcase/` 建立在现代前端工具链之上，带类型检查与自动化验收脚本。

## 目录约定

- 一件作品 = 一个子目录，目录名用小写英文。
- `deploy/` 与根目录的 `deploy.sh` 是部署基础设施，`docs/` 是规划文档（[路线图](./docs/roadmap.md)与各作品的设计稿），两者都不是作品。`deploy.sh` 依照这个约定跳过这两个目录。
- 每件作品自带 `README.md`，写清玩法、开发、构建与部署方式；根目录不重复这些内容。
- 依赖、构建产物和缓存由各作品目录内的 `.gitignore` 管理，互不影响。
- 第三方依赖的许可证副本放在作品自己的构建输入目录内（如 `public/`），构建会将其原样复制进部署产物，署名声明才能随站点一并分发；不要挪到作品目录之外。
- 根目录 `.gitignore` 只处理 `.DS_Store` 这类系统噪音。

## 本地运行

各作品的技术栈和运行方式不同，以对应目录下的 `README.md` 为准。当前八件：

```sh
# 简易版：无需构建、无需安装第三方包，直接预览
open migration/index.html
open patina/index.html
open arbor/index.html
# 星轨包含 WebAssembly 二进制，需静态服务同源加载：
cd star-trails && python3 -m http.server 8080

# 工程版：需要 Node.js 22.12+ 和 pnpm
cd migration-showcase   && pnpm install --frozen-lockfile && pnpm dev
cd patina-showcase      && pnpm install --frozen-lockfile && pnpm dev
cd arbor-showcase       && pnpm install --frozen-lockfile && pnpm dev
cd star-trails-showcase && pnpm install --frozen-lockfile && pnpm dev
```

工程版均附带类型检查、构建与验收脚本。`migration-showcase/` 有四组，`patina-showcase/` 有两组，`arbor-showcase/` 有一组，`star-trails-showcase/` 有离线天文精度对账（`pnpm verify:astro`）与真实浏览器视觉验收（`pnpm verify:visual`）。

## 部署

仓库内所有作品由单个 nginx 容器统一发布，入口是根目录的 [`deploy.sh`](./deploy.sh)：

```sh
./deploy.sh          # 构建镜像并启动，默认 http://127.0.0.1:8080/
./deploy.sh check    # 逐个请求入口页与每件作品，验证是否真的能打开
./deploy.sh down     # 停止

# 正式发布：设置站点根地址，使社交分享卡片能取到图
SITE_BASE_URL=https://example.com/ ./deploy.sh up
```

发布后的站点结构为 `/`（作品入口页）、`/migration/`、`/migration-showcase/`、`/patina/`、`/patina-showcase/`、`/arbor/`、`/arbor-showcase/`、`/star-trails/`、`/star-trails-showcase/`。目标机器只需安装 Docker，构建全部发生在镜像内，宿主机不需要 Node.js、pnpm 或 nginx。架构、HTTPS 终止方式、新增作品的接线步骤与故障排查见 [`deploy/README.md`](./deploy/README.md)。

## 新增一件作品

1. 在根目录创建子目录，例如 `new-work/`。
2. 放入源码，并按自己的技术栈写一份 `.gitignore`。
3. 在目录内写 `README.md`，说明运行和构建方式。
4. 回到本文件，在「作品索引」表格里补一行。
5. 按 [`deploy/README.md`](./deploy/README.md) 的「新增一件作品」把它接进部署，然后跑一次 `./deploy.sh check`。

## 许可证

**源代码采用 MIT 许可证**（见 [`LICENSE`](./LICENSE)）：可以自由使用、修改、分发，包括商业用途。**`LICENSE` 只覆盖代码**——画面、配乐和诗歌文本是创作素材，保留所有权利，转载或商用请先取得许可。

各作品及其素材的具体授权，以对应目录内 `README.md` 的说明为准。

- **第三方依赖**：`migration-showcase/` 运行时依赖 three、React、lucide 以及 Manrope / Noto Serif SC 两款字体，`patina-showcase/` 运行时依赖 React 与 Noto Serif SC，`arbor-showcase/` 运行时依赖 three、React、Simplex Noise、lucide 以及 Manrope / Noto Serif SC 两款字体（其中 **GSAP 使用 Standard “No Charge” GSAP License，并非 MIT**），它们的许可证原文保存在各自作品目录的 `public/licenses/` 下。该目录属于构建输入，Rsbuild 会将它原样复制到 `dist/licenses/`，许可证因此随部署产物一同分发。**不要把这份副本移出 `public/`**，否则线上站点会失去授权声明。
- **简易版**：`migration/`、`patina/` 与 `arbor/` 不依赖任何第三方库、字体或 CDN，配乐与图标都内嵌在单文件里，无需附带许可证副本。
