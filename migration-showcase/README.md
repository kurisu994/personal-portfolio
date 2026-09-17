# 候鸟 · MIGRATION

一群折纸候鸟沿着河流飞过旧城、田野、雾、暮色、雪与星夜。这个目录是独立的 React / Rsbuild 宣传版，第一版继续保存在相邻的 `../migration/index.html`。

## 本地运行

使用 Node.js 22.12+ 和 pnpm。当前验证环境是 Node.js 24.12.0、pnpm 12.4.2。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的本地地址，默认 `http://127.0.0.1:3000/`。项目使用 Rsbuild，不依赖 Vite。

## 操作

- 开场选择起飞气候，点击「开始迁徙」。地点决定航线起点，之后仍沿同一条航线飞行。
- 移动鼠标或触摸画面为鸟群引入风。离开画面、松开触摸后，风缓缓消散。
- `AUTO` 连续自动运镜。滚轮暂时拉远观察，停手两秒后缓慢归位。
- `FREE` 使用拖拽控制俯仰和偏航，滚轮或双指捏合控制真实镜头距离。
- 顶部按钮分别切换诗句、声音和全屏。
- 手机竖屏时舞台旋转 90°；横握设备即可正常观看。系统允许时，起飞会请求全屏、横屏锁定和防息屏。

## 构建与部署

```sh
pnpm typecheck
pnpm build
pnpm preview
```

将 `dist/` 的**全部内容**上传到静态服务器即可，无需 Node.js 服务端。字体、配乐和图标均随构建自托管，运行时不依赖第三方 CDN。

本次交付另附 `artifacts/migration-dist.zip`，解压后直接得到站点文件，已排除调试 source map。

附有 [Nginx 配置示例](deploy/nginx.conf)。修改其中的域名和站点路径后启用；线上使用 HTTPS，浏览器才能正常提供防息屏等能力。也可以将 `dist/` 发布到任意静态托管服务。

支持部署在子目录，例如 `https://example.com/migration/`。访问地址需保留结尾的 `/`，以便相对路径正确读取配乐和资源。

`public/og-migration.jpg` 是真实页面生成的 1200 × 630 宣传分享图。正式发布前，将 `index.html` 中 `og:image` 改成该图片的完整线上 URL，并补充实际站点的 `og:url` / canonical 地址。

## 实现

| 模块 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/styles.css` | 起飞界面、镜头控制、诗句、沉浸模式、响应式排版 |
| `src/scene/MigrationEngine.ts` | Three.js 渲染、光照、雾、Bloom / FXAA / 纸粒、输入与性能适配 |
| `src/scene/World.ts` | 流式地形、双正弦河流、联排屋、尖塔、树木、石堤、小桥 |
| `src/scene/Flock.ts` | 30 / 22 只独立弹簧纸鸟、分离力、风场、软边界、投影 |
| `src/scene/PaperBird.ts` | 折纸头颈、龙骨、分层翼羽、纸纤维、翼尖滞后形变与尾羽调整 |
| `src/scene/Director.ts` | 16 个镜位、每圈六段、连续转场、规则化变奏 |
| `src/scene/climates.ts` | 每段约 8600 世界单位的五种气候与参差长锋面 |
| `src/scene/Atmosphere.ts` | 按地理位置换型的粒子、深度排序、星空和光晕 |
| `src/audio/Soundscape.ts` | 两首配乐、2.4 秒曲间间隔、五秒淡入、风 / 水 / 纸翼环境声 |
| `src/data/poems.ts` | 13 段中英短诗 |

地形由绝对分块索引与每次起飞的随机种子生成，沿途持续创建新地形并卸载后方地形；不是将固定地图首尾拼接。五种气候和十三首诗会轮换，两首配乐按要求交替。镜位序列按规则重新抽取变奏。

桌面默认 30 只鸟，触屏 22 只；活动世界始终保留 15 个分块。渲染按 DPR 提高清晰度，并在持续帧率偏低时降低像素密度。页面进入后台后暂停画面与声音，返回时平滑续行。

新版候鸟由 350 个三角面组成，拥有清晰的头颈、喙、墨色眼睛、立体胸腹和错落翼尖。薄纸双面与边缘封合，折痕合并在翼面中；整群共享几何和程序化纸纤维纹理，每只鸟仅使用四个网格。翼尖通过共享形变目标滞后弯折，尾羽随转向与升降轻摆。材质仍按每只鸟的位置连续采样气候颜色。

全屏、横屏锁定和防息屏受浏览器与系统支持限制；请求失败不阻止迁徙。WebGL2 不可用时显示说明与重试入口。

## 验证

```sh
pnpm typecheck
pnpm verify:simulation
pnpm verify:model
# 先在另一个终端运行 pnpm dev 或 pnpm preview
pnpm verify:visual
```

- `verify:simulation` 模拟 128 圈运镜，检查全部镜位、偏航约束、跨圈连续性、锋面颜色连续性及 200 次分块回收。
- `verify:visual` 使用真实 Chrome，覆盖五种起飞气候、声音解码、鼠标风场、自主镜头、诗句与声音开关，以及 390 × 844、1440 × 900、2200 × 1240、3300 × 1856 视口。手机场景还检查旋转坐标下的双指缩放。
- `verify:model` 检查模型顶点、法线、退化三角形和动画纹理数量，并拍摄四角度、上拍、下拍与夜航检视图；传入正在运行的页面地址，如 `pnpm verify:model http://127.0.0.1:3000/`，会额外通过实际拖拽与缩放拍摄飞行近景。结果保存在 `artifacts/model/`，检视页不进入生产构建。
- 截图和报告生成于 `artifacts/visual/`，分享图写入 `public/og-migration.jpg`。
- 可通过 `MIGRATION_URL` 指定预览地址。未安装 Chrome 时运行 `pnpm exec playwright install chromium`。

`tsx` 的 esbuild 安装脚本在 `pnpm-workspace.yaml` 中明确禁用，运行时使用 pnpm 已安装的对应平台二进制依赖。

## 素材与第一版

两首 `public/audio/` 配乐从第一版原有的 Base64 音频无损提取，未引入外部商业曲库。思源宋体 / Noto Serif SC 与 Manrope 使用 SIL Open Font License；运行时依赖的许可证副本保存在 `public/licenses/`，随静态部署包一同交付。

第一版保留文件大小：622,069 字节。

```text
SHA-256  ../migration/index.html
4f75030244a5607436b8441d554c6410389b21eee006b9b91175e9766be68cbc
```
