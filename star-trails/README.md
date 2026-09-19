# 星轨 · STAR TRAILS（零依赖版）

输入地点与日期，基于真实 Yale BSC5 亮星表与 Meeus 天文算法，通过 WebAssembly 在浏览器 Canvas 2D 纯手写推演一夜星轨。

这是「拾羽集」作品集中第一件经得起离线天文基准对账的数学艺术作品。

---

## 核心特性

- **WASM 天文算法内核**：纯 Rust 实现的无状态高精度天文算法（儒略日、格林尼治恒星时、地方恒星时、J2000 到观测日期的三转角岁差修正、地平坐标转换、Saemundsson/Bennett 大气折射、太阳升落与天文暮光）。
- **零外部运行时依赖**：浏览器端仅包含 `index.html` 与编译后的 `star_trails_bg.wasm`，不引用任何 CDN 或外部字体库。
- **双投影模式**：
  - **天极透视投影**：视线对准天极，星轨划出严格的同心圆弧，视场角（FOV 40°~110°）自由调节。
  - **全天域立体投影**：将可见半球压入画框，展现全天圆弧交织的宏大苍穹。
- **动态夜空与前景剪影**：山川轮廓如墨染，衬托星辰倾泻。
- **URL 参数还原**：`?lat=&lon=&date=&fov=&mode=` 支持完整复刻当下星空视角并随处分享。
- **WebAudio 自然夜风**：程序化白噪多级低通滤波实时合成微弱夜风，无需加载任何音频资源。

---

## 本地运行

因为浏览器加载 WebAssembly 二进制受同源安全策略限制，需通过本地静态服务预览：

```bash
# 方式一：使用 Python 内置服务器
cd star-trails
python3 -m http.server 8080

# 方式二：使用 npx serve
npx serve star-trails
```

在浏览器中打开 `http://localhost:8080` 即可体验。

---

## 重新构建 WASM

若修改了 `src/` 中的 Rust 天文算法或星表数据，运行以下命令重新构建：

```bash
cd star-trails
wasm-pack build --target web --release
```

产物将自动更新至 `star-trails/pkg/` 目录。

---

## 算法验证与测试

```bash
# 运行全部 16 个单元测试与离线 Meeus 权威参考对账集成测试
cd star-trails
cargo test --release
```

---

## 星表数据与开源许可

- **代码许可**：MIT License（遵循仓库根目录 LICENSE）。
- **星表数据来源**：Yale Bright Star Catalogue, 5th Revised Edition (BSC5)。
  - 引用：*Hoffleit, D. and Warren, Jr., W.H., 1991, "The Bright Star Catalog, 5th Revised Edition (Preliminary Version)"*。
  - 经由 CDS VizieR 目录服务（Catalogue V/50）获取并筛选 `Vmag ≤ 4.5`，以 16 字节浮点小端序紧凑内嵌于二进制中。
- **诗文与视觉**：保留所有权利（All Rights Reserved）。
