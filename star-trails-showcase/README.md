# 星轨 · STAR TRAILS（工程版）

输入地点与日期，基于真实 Yale BSC5 亮星表与 Meeus 天文算法，通过 WebGL2 浮点累积曝光与加性混合，推演一夜星轨。

这是「拾羽集」作品集中第一件经得起离线天文基准对账的工程化作品。双版本中的零依赖版位于 [`../star-trails/index.html`](../star-trails/index.html)。

---

## 本地运行

使用 Node.js 22.12+ 和 pnpm。

```sh
# 确保 star-trails 的 wasm 已构建
cd ../star-trails && wasm-pack build --target web --release && cd ../star-trails-showcase

pnpm install
pnpm dev
```

打开终端显示的本地地址，默认 `http://127.0.0.1:3000/`。

---

## 核心架构与技术亮点

1. **WASM 天文内核同源复用**：星点位置与日落日出直接调用 `star-trails` 的 Rust WebAssembly 模块，避免两套算法的精度漂移。内核的日落日出按 UT 日期取值，西经与极地站点会得到负时长，`src/astro/night.ts` 以当地正午为界重新挑选，并用太阳高度扫描判定极昼与极夜。
2. **固定步长的长曝光**：每 7.5 秒天文时间采样一次（天球约转 0.03°），用加性混合累积进浮点底片。轨迹连续且亮度与帧率无关；拖动时间轴或切换参数后，底片按每帧 10ms 的预算从日落重新显影到目标时刻。
3. **胶片式合成**：高光按指数曲线压缩，半分辨率高斯光晕做柔焦；天空颜色取自真实太阳高度与方位（暮光余晖从日落方向退去、黎明从日出方向亮起），叠加各地的光污染光穹。
4. **地平线与剪影**：面向天极的针孔相机里地平线是一条直线，按纬度与视场算出它的位置，再用移轴把它压到画面下部。前景剪影由着色器按种子生成：北京的长城、漠河的落叶松、莫纳克亚的望远镜圆顶、新加坡的天际线；临水站点的水面会倒映星轨。
5. **银河与流星**：银道面按银经分布亮度与宽度，随曝光被拖成柔光带；流星按地点与日期的种子确定，同一条链接得到同一张底片。
6. **分享与导出**：`?lat=&lon=&date=&fov=&mode=&t=` 可完整还原画面，带坐标的链接跳过开场直接显影；导出的底片不含界面，下沿写有地点、坐标与曝光时长。

---

## 模块说明

| 模块 | 职责 |
| --- | --- |
| `src/engine/NightExposure.ts` | 曝光引擎：固定步长采样、显影预算、银河与流星、底片导出 |
| `src/astro/night.ts` | 一夜窗口解析（跨日期、极昼极夜）、时间轴刻度与暮光渐变 |
| `src/astro/sky.ts` | 太阳低精度位置、银道面、与内核一致的投影、取景移轴、时区换算 |
| `src/wasm/bridge.ts` | 加载并导出 Rust WASM 天文接口 |
| `src/gl/renderer.ts` | WebGL2 管线：累积、实时星点、光晕、全屏合成 |
| `src/gl/exposure.ts` | 浮点底片、实时层与光晕缓冲（按扩展支持选择精度） |
| `src/gl/shaders.ts` | 星点、柔光、模糊与合成着色器（天空、剪影、倒影、颗粒） |
| `src/ui/SitePicker.tsx` | 按纬度排列的观测地列表与星轨形状小样 |
| `src/ui/NightBand.tsx` | 按太阳高度着色的夜晚时间轴，可拖动与键盘操作 |
| `src/ui/PoleDial.tsx` | 随天球转动的天极时角盘与曝光转角 |
| `src/ui/SetupDrawer.tsx` | 观测设置：地点、日期、镜头、朝向、速度 |
| `src/ui/Poem.tsx` | 按夜晚进程切换的竖排短诗 |
| `src/audio/nightscape.ts` | 自然夜风与随机虫鸣程序化音频合成 |
| `src/data/cities.ts` | 观测地坐标、时区、地貌、光污染与极限星等；镜头焦距表 |
| `src/data/poems.ts` | 10 段中英对照短诗数据 |

---

## 构建与验收

```sh
# 1. 严格类型检查
pnpm typecheck

# 2. 离线天文精度对账审计（纯 Node）
pnpm verify:astro

# 3. 生产打包
pnpm build
```

---

## 开源许可与数据来源

- **代码许可**：MIT License（遵循仓库根目录 LICENSE）。
- **星表数据**：Yale Bright Star Catalogue, 5th Revised Edition (BSC5)。
  - 引用：*Hoffleit, D. and Warren, Jr., W.H., 1991, "The Bright Star Catalog, 5th Revised Edition (Preliminary Version)"*。
- **视觉、诗歌与音效**：保留所有权利（All Rights Reserved）。
