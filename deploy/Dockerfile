# 作品集静态站点镜像。
#
# 设计要点：每件需要工具链的作品拥有自己的构建阶段。
# 作品技术栈本就是异构的（零依赖单文件 / pnpm 构建 / 将来可能是 Rust），
# 用统一构建脚本反而会互相牵制；多阶段让每种栈直接使用自己的基础镜像。
#
# 构建上下文是仓库根目录：
#   docker build -f deploy/Dockerfile -t personal-portfolio .

# ══ 阶段 1：工程版构建 ═════════════════════════════════════════════════
FROM node:24-alpine AS build-migration-showcase

ENV CI=1
WORKDIR /work

# 先只复制依赖清单，单独成层：源码变动时依赖层仍能命中缓存。
COPY migration-showcase/package.json \
     migration-showcase/pnpm-lock.yaml \
     migration-showcase/pnpm-workspace.yaml \
     ./

# corepack 按 package.json 的 packageManager 字段（pnpm@12.4.2）拉取同一版本，
# 保证锁文件与本地一致。esbuild 等平台二进制由容器内的 pnpm 安装，
# 与宿主机架构无关（宿主机 node_modules 已由 .dockerignore 排除）。
RUN corepack enable && pnpm install --frozen-lockfile

COPY migration-showcase/ ./
RUN pnpm build

# ══ 阶段 2：入口页生成与 HTML 微调 ════════════════════════════════════
FROM node:24-alpine AS site-entry

WORKDIR /site

COPY deploy/works.json deploy/render-landing.mjs ./
RUN node render-landing.mjs > /site/index.html

COPY --from=build-migration-showcase /work/dist /site/migration-showcase

# 可选：设置 SITE_BASE_URL 后，把相对 og:image 改写为绝对地址并补上
# canonical / og:url。留空则完全跳过，不触碰构建产物。
ARG SITE_BASE_URL=""
COPY deploy/tune-html.mjs ./
RUN node tune-html.mjs /site/migration-showcase "$SITE_BASE_URL"

# ══ 阶段 3：运行镜像 ═══════════════════════════════════════════════════
FROM nginx:alpine AS runtime

COPY deploy/nginx.conf             /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf  /etc/nginx/snippets/security-headers.conf

# 站点入口页
COPY --from=site-entry /site/index.html /usr/share/nginx/html/index.html

# 作品 · 简易版：零第三方依赖，文件本身就是应用，直接复制，无需构建。
COPY migration/index.html /usr/share/nginx/html/migration/index.html

# 作品 · 工程版：使用构建产物。
COPY --from=site-entry /site/migration-showcase/ /usr/share/nginx/html/migration-showcase/

# 仓库自己的 MIT 许可证：站点分发的是 MIT 代码，声明必须随产物一同交付。
COPY LICENSE /usr/share/nginx/html/LICENSE

EXPOSE 80
