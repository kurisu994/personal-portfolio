# 部署说明

把仓库中所有作品构建成一个静态站点，运行在单个 nginx 容器里。

## 架构

```
deploy.sh                     仓库根目录的部署入口（唯一需要记的命令）
deploy/
  Dockerfile                  多阶段构建：每件作品一个构建阶段 + nginx 运行镜像
  compose.yaml                单服务编排：端口映射、健康检查、日志轮转
  nginx.conf                  站点配置：缓存策略、gzip、安全响应头
  security-headers.conf       安全响应头片段（原因见下文「设计取舍」）
  works.json                  站点入口页的作品元数据
  render-landing.mjs          构建期生成入口页（纯静态 HTML）
  tune-html.mjs               可选：把 og:image 改写为绝对地址
.dockerignore                 构建上下文排除规则（根目录）
```

镜像内只有一个 nginx 进程，站点结构：

```
/                      入口页，列出全部作品
/migration/            作品 · 简易版（零依赖单文件，直接复制）
/migration-showcase/   作品 · 工程版（Rsbuild 构建产物）
```

## 快速开始

```sh
./deploy.sh              # 等同于 up：构建镜像并启动
open http://127.0.0.1:8080/
```

| 命令 | 作用 |
| --- | --- |
| `./deploy.sh up` | 构建并启动（默认） |
| `./deploy.sh build` | 只构建镜像 |
| `./deploy.sh check` | 请求入口页与每件作品，验证是否真的能打开 |
| `./deploy.sh status` | 查看容器与健康状态 |
| `./deploy.sh logs` | 跟踪容器日志 |
| `./deploy.sh restart` | 重启容器 |
| `./deploy.sh down` | 停止并移除容器 |

加 `--no-cache` 可忽略构建缓存，例如 `./deploy.sh up --no-cache`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 宿主机端口。默认不用 80，避免需要 root 和与已有服务冲突。 |
| `SITE_BASE_URL` | 空 | 站点根地址，例如 `https://example.com/`。设置后会在构建期把工程版的相对 `og:image` 改写为绝对地址，并补上 `canonical` 与 `og:url`。留空则完全跳过。 |

正式对外发布时建议设置 `SITE_BASE_URL`，否则社交平台的分享卡片取不到图：

```sh
SITE_BASE_URL=https://example.com/ PORT=8080 ./deploy.sh up
```

## 上线到服务器

```sh
git clone <仓库地址> && cd personal-portfolio
SITE_BASE_URL=https://example.com/ ./deploy.sh up
```

只需要目标机器装有 Docker（含 compose 插件）。宿主机**不需要** Node.js、pnpm 或 nginx——构建全部发生在镜像内。

### HTTPS

容器只提供 HTTP，TLS 由外层终止，不要放进容器：证书续期一旦被塞进业务镜像，运维就被绑死了。

两种常见做法：

1. **已有反向代理**（Nginx / Traefik / 云负载均衡）：把 `https://example.com/` 转发到 `127.0.0.1:8080`，并放行 `Upgrade` 与 `Host` 头。
2. **没有反向代理**：另起一个 Caddy 容器负责证书，反代到本服务。

无论哪种，都必须保证访问地址**保留结尾斜杠**（见下文）。

## 新增一件作品

仓库约定「一件作品 = 一个根目录子目录」，部署侧需要动三处：

1. **`deploy/Dockerfile`** —— 加一行 `COPY`（静态作品）或加一个构建阶段（需要工具链的作品）。
2. **`deploy/works.json`** —— 加一条作品记录，供入口页展示。
3. **`README.md`**（根目录）—— 在作品索引表里补一行。

完成后执行 `./deploy.sh up && ./deploy.sh check`：`check` 会按目录自动发现作品并逐个请求，忘了改 Dockerfile 会直接以 404 暴露出来。

注意：`deploy.sh` 把「除 `deploy/` 外的所有根目录子目录」都视为作品，而 `works.json` 只负责入口页展示。**Dockerfile 才是「哪些作品真的会被发布」的唯一依据。**

## 设计取舍

**每件作品一个构建阶段。** 作品技术栈天生异构（零依赖单文件 / pnpm 构建 / 将来可能是 Rust + Wasm），统一构建脚本会互相牵制。多阶段让每种栈直接用自己的基础镜像，互不干扰。

**依赖安装在容器内进行。** 宿主机 `node_modules`（207 MB，含 macOS 平台的 esbuild 二进制）已由 `.dockerignore` 排除。跨平台拷贝二进制必然运行失败，必须在目标平台重新安装。

**子目录必须带结尾斜杠。** 工程版由 Rsbuild 以 `assetPrefix: './'` 构建，HTML 内资源全是相对路径（`./static/js/...`）。访问 `/migration-showcase`（缺斜杠）时浏览器会把 `./static/` 解析到站点根，导致整站资源 404。nginx 在 URI 命中目录且存在 `index.html` 时会自动 301 补斜杠，因此配置里**不手写 rewrite**，避免与自动重定向冲突；正确性由 `./deploy.sh check` 实际请求验证。

**不做 SPA 回退。** 两件作品都是没有前端路由的单页应用，`try_files ... /index.html` 会把 404 伪装成 200，掩盖部署错误。宁可暴露 404。

**HTML 不缓存。** 简易版整个应用就是一个约 607 KiB 的 `index.html`；它被强缓存的话，发布后用户会长期停留在旧版本。带内容哈希的构建产物才做一年 `immutable`。

**安全响应头抽成 include。** nginx 的 `add_header` 是整段覆盖而非逐条合并：只要某个 `location` 里出现一条 `add_header`，服务层级的全部 `add_header` 都会对该 location 失效。为免安全头在带缓存策略的 location 里静默消失，用 `security-headers.conf` 显式 include 到每一处。

**不加 CSP。** 简易版把全部脚本与样式内联在单个 HTML 里，有效的 CSP 必须放开 `unsafe-inline`，等于白写；而收紧到能拦住注入的程度会直接打断作品。若要引入 CSP，需要先改造简易版的资源组织方式，属于另一件事。

## 故障排查

**构建时拉取 `node:24-alpine` 失败，报 `EOF`。** 先确认守护进程能否出网，注意宿主机 `curl` 能通**不代表** daemon 能通——二者网络路径不同：

```sh
curl -x http://127.0.0.1:7890 -sS -o /dev/null -w '%{http_code}\n' https://registry-1.docker.io/v2/
curl --noproxy '*'  -sS -o /dev/null -w '%{http_code}\n' https://registry-1.docker.io/v2/
```

若前者正常（401 即未认证的正常响应）而后者失败，说明必须经代理，请到 **Docker Desktop → Settings → Resources → Proxies** 把 HTTP 与 **HTTPS** 都填成代理地址（常见为 `http://127.0.0.1:7890`），然后 Apply & Restart。只填 HTTP 不够，拉镜像是 HTTPS 流量。

**页面 404。** `./deploy.sh check` 会指出具体路径。多数情况是该作品没写进 `deploy/Dockerfile`。

**页面能打开但白屏。** 打开浏览器控制台看资源请求。若 `/static/...` 报 404，就是访问地址缺了结尾斜杠。

**端口被占用。** `PORT=8090 ./deploy.sh up`。
