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

1. **WASM 天文内核同源复用**：工程版通过 `src/wasm/bridge.ts` 直接复用 `star-trails` 中的 Rust WebAssembly 模块，避免两套算法的重复实现和精度漂移。
2. **WebGL2 加性累积曝光**：
   - 双 FBO 与高动态半浮点纹理（`RGBA16F`）。
   - 每帧利用 `gl.blendFunc(gl.ONE, gl.ONE)` 将计算得到的当前星点光辉叠加到底片上，真实重现胶片长曝光星轨逐渐显影的过程感。
3. **高斯漫反射光晕**：双 Pass 分离卷积将累积的星光进行降采样模糊，叠加形成柔和深邃的夜空辉光。
4. **全天域与透视双重视界**：
   - 透视投影（FOV 40°~110° 可调）：面向北/南天极，星轨呈现严整同心圆。
   - 全天域立体投影：以天顶为中心囊括整个夜空。
5. **双语短诗与程序化音景**：10 段中英对照短诗与 WebAudio 自然夜风、稀疏虫鸣实时生成。

---

## 模块说明

| 模块 | 职责 |
| --- | --- |
| `src/wasm/bridge.ts` | 封装与调用 Rust WASM 天文模块接口 |
| `src/gl/renderer.ts` | WebGL2 渲染管线、VAO/VBO 管理、加性混合循环 |
| `src/gl/exposure.ts` | FBO 曝光底片与 Bloom 降采样纹理管理 |
| `src/gl/shaders.ts` | 恒星点精灵、高斯模糊、全屏纸墨色调合成 GLSL 着色器 |
| `src/ui/Controls.tsx` | 观测地点、日期、FOV 与投影模式面板 |
| `src/ui/Timeline.tsx` | 连续时间轴、播放/暂停、快照重置控制 |
| `src/ui/Poem.tsx` | 双语短诗淡入淡出组件 |
| `src/audio/nightscape.ts` | 自然夜风与随机虫鸣程序化音频合成 |
| `src/data/cities.ts` | 包含全球五大纬度带的代表性观测地经纬度 |
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
