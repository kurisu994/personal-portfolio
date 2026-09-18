# 一木 · ARBOR

> 不催一叶，不问归期。

落一粒种子，随滚动看它藏春、初见、向远、听风，直到果熟鸟归。

这是独立的 **TypeScript / React / Rsbuild / Three.js** 工程版，与 `migration-showcase/`、`patina-showcase/` 使用同样的开发方式。原零依赖版本由 `shuzhi/index.html` 更名为 [`../arbor/index.html`](../arbor/index.html)，两者独立运行。

## 开始

使用 fnm、Node.js `lts-krypton` 和 pnpm 12.4.2：

```sh
cd arbor-showcase
fnm use
pnpm install --frozen-lockfile
pnpm dev
```

开发地址：`http://127.0.0.1:3002/`。

## 观赏

- 点击「落子生根」，开始旅程并允许声音。
- 向下滚动，让树生长；向上滚动，回看种子。有效滚动距离为 10000px，五章各 2000px；文档另加一屏高度以完整抵达终点。
- 普通鼠标移动不影响树形，也不会带动镜头；枝叶只有轻微的自然风摆。
- 在画面中按住拖拽，可以小幅观察；停手两秒后镜头用阻尼弹簧回归。手机保留原生纵向滚动，横向拖拽可微调观察。
- 顶部按钮切换声音、诗句、全屏。全屏仅在点击按钮时请求；声音不可用不会中断生长。
- 尊重系统「减少动态效果」设置。切换到后台时暂停画面并平滑静音。

## 构建与部署

```sh
pnpm typecheck
pnpm verify:simulation
pnpm build
pnpm preview
```

将 `dist/` 的全部内容部署到静态服务器，无需 Node.js 后端。库、字体与许可证随构建自托管；运行时没有第三方 CDN、外部图片、模型或音频请求。纸纹、树木、果实、鸟、粒子及声音均在本地生成。

支持 `/arbor-showcase/` 子目录，访问路径应保留结尾 `/`。Rsbuild 使用 `assetPrefix: 'auto'`，CSS 字体相对路径与 JS 路径适用于根站点及子目录。

本次未修改仓库的聚合作品页、Docker 与部署脚本；若使用根部署流程，需另行将此作品接入其构建清单，不能把源码目录当成构建产物上传。

## 实现

| 模块 | 用途 |
| --- | --- |
| `src/App.tsx`、`src/styles.css` | 透明开场、响应式留白、逐字诗句、控件、可访问性与错误提示 |
| `src/scene/ArborEngine.ts` | Three.js 调度、灯光、雾、EffectComposer、输入、后台暂停、DPR 与清理 |
| `src/scene/Lifecycle.ts` | GSAP / ScrollTrigger 的唯一可逆生命进度 |
| `src/scene/TreeModel.ts` | 534 条根枝、2566 片实例叶、42 颗朱红果实、线条鸟巢、种子与子叶 |
| `src/scene/materials.ts` | 三维颜料噪声、暗边水渍、木质与叶深度预通道、Multiply 材质、GSAP 生长缓动 |
| `src/scene/Director.ts` | 生长取景、安全区、俯仰偏航与弹簧归位 |
| `src/scene/Flock.ts` | 五只纸鸟、Boids、收翼着陆、倒回重放，两个实例化 draw call |
| `src/scene/Atmosphere.ts` | 动态生成的 DataURL 纸纹、背景与土壤水渍、300 粒子 |
| `src/scene/climates.ts`、`math.ts` | 四阶 Bézier 气候插值、固定种子、共用世界空间自然风 |
| `src/audio/Soundscape.ts` | 噪声风、叶响、五声音阶与终章 FM 鸟鸣，无音频文件 |
| `src/data/poems.ts` | 为本作品重新编写的五章诗句，不是古诗引用 |

父枝长到挂接点后，子枝与器官才出现。树、果、巢、栖鸟共享同一形变公式，避免分段弯曲时脱节。成熟镜头上移时，地下根系收回土层中，不保留悬空根须。

React 只接收约每秒八次的展示快照；模拟与着色不依赖 React 帧刷新。像素比上限 2，持续慢帧会降低内部渲染比例。背景粒子持续流动，成熟程度只由滚动决定。

`?debug` 额外公开只读 `window.__ARBOR__.snapshot()`，便于读取生命进度、挂点统计、鸟群、相机偏移、绘制调用与像素比；不提供修改页面的调试控制。

## 文案

- **藏春**：一粒入深土，万籁归于静。未见枝头春，根已知归处。
- **初见**：微光穿薄雾，新绿破苔痕。不问春深浅，先将一叶伸。
- **向远**：枝向远天去，根于深土安。风来身自直，雨过心犹宽。
- **听风**：万叶各有声，听来只一风。影随云往复，坐久见山空。
- **归一**：果熟枝低处，鸟归暮色中。因缘归一木，天地此心宽。

## 验证范围

`verify:simulation` 检查四阶曲线端点、单调性与气候连续性；三组随机种子的正反向生长挂点；42 果及 15/30/60/120fps 的五鸟终点落地与重放。它不替代视觉检查。

浏览器检查和截图放在被忽略的 `artifacts/`，实际验证记录见 `artifacts/verification.md`。本机测试不能代替 Safari/Firefox、手机真机和音频听感评审；本作品不承诺所有设备固定 60fps。

## 许可证

项目源代码遵循仓库 [MIT 许可证](../LICENSE)。画面、原创诗歌等创作素材的授权范围遵循仓库约定。

Three.js、React、React DOM、Simplex Noise 为 MIT；Lucide 使用其 ISC/MIT 声明；Noto Serif SC 与 Manrope 使用 SIL Open Font License。GSAP 使用 **Standard “No Charge” GSAP License**，并非 MIT；本作品不是无代码动画编辑器。相关声明位于 `public/licenses/`，随构建分发。
