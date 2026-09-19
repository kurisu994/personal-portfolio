#!/usr/bin/env bash
#
# 作品集部署脚本：把仓库里的所有作品构建成静态站点，跑在一个 nginx 容器里。
#
#   ./deploy.sh up            构建并启动（默认命令）
#   ./deploy.sh build         只构建镜像
#   ./deploy.sh bundle        本地构建站点并打包成 amd64 镜像 tar（供传输到服务器）
#   ./deploy.sh check         请求入口页与每件作品，验证是否真的能打开
#   ./deploy.sh status        查看容器与健康状态
#   ./deploy.sh logs          跟踪容器日志
#   ./deploy.sh restart       重启容器
#   ./deploy.sh down          停止并移除容器
#   ./deploy.sh config        打印生效的 compose 配置
#
# 选项：
#   --no-cache                构建时忽略缓存（写在 up / build 之后）
#   --no-build                不构建，直接使用已存在的镜像（服务器端配合 bundle 使用）
#
# 环境变量：
#   PORT                      宿主机端口，默认 8080
#   BIND_HOST                 绑定地址，默认 127.0.0.1（仅本机可访问）
#                             反向代理场景保持默认；需局域网直连时改为 0.0.0.0
#   IMAGE_TAG                 使用的镜像名，默认 personal-portfolio:local
#   SITE_BASE_URL             站点根地址，例如 https://example.com/
#                             设置后会把工程版的 og:image 改写成绝对地址，
#                             使社交平台的分享卡片能取到图。
#
# 约定：仓库根目录下除 deploy/ 与 docs/ 之外的每个子目录都被视为一件作品，
#       并以同名子路径发布（migration/ 发布在 /migration/）。

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR
readonly COMPOSE_FILE="$ROOT_DIR/deploy/compose.yaml"
readonly PROJECT_NAME="personal-portfolio"

# 非作品目录：deploy/ 是部署基础设施，docs/ 是仓库文档，
# build/ 是 bundle 的本地中转目录（站点产物与镜像 tar），不属于任何作品。
readonly INFRA_DIRS=$'deploy\ndocs\nbuild\n'

export PORT="${PORT:-8080}"
export BIND_HOST="${BIND_HOST:-127.0.0.1}"
export IMAGE_TAG="${IMAGE_TAG:-personal-portfolio:local}"
export SITE_BASE_URL="${SITE_BASE_URL:-}"

# bundle 产出的镜像标签与 tar 路径。
readonly BUNDLE_IMAGE="personal-portfolio:release"
readonly BUNDLE_TAR="$ROOT_DIR/build/personal-portfolio-amd64.tar"

# --no-build 由 main 解析后置为 1。
NO_BUILD=0

if [ -t 1 ]; then
  readonly C_DIM=$'\033[2m' C_INFO=$'\033[36m' C_OK=$'\033[32m' C_WARN=$'\033[33m' C_ERR=$'\033[31m' C_OFF=$'\033[0m'
else
  readonly C_DIM='' C_INFO='' C_OK='' C_WARN='' C_ERR='' C_OFF=''
fi

info() { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()  { printf '%s  ✗%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

base_url() { printf 'http://127.0.0.1:%s' "$PORT"; }

# 列出所有作品目录名，每行一个。
discover_works() {
  local path name
  for path in "$ROOT_DIR"/*/; do
    [ -d "$path" ] || continue
    name="$(basename -- "$path")"
    case "$name" in
      .*) continue ;;
    esac
    if printf '%s' "$INFRA_DIRS" | grep -qxF -- "$name"; then
      continue
    fi
    printf '%s\n' "$name"
  done | LC_ALL=C sort
}

compose() {
  docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die '未找到 docker，请先安装 Docker'
  docker info >/dev/null 2>&1 || die 'Docker 守护进程未运行，请先启动 Docker'
}

# 请求状态码。curl 在连接失败时仍会输出 000 并以非零状态退出，
# 所以不能再用 || 追加内容，否则会得到 000000 这种重复值。
http_code() {
  local code=''
  code="$(curl --silent --output /dev/null --max-time 8 --write-out '%{http_code}' "$1" 2>/dev/null)" || code=''
  printf '%s' "${code:-000}"
}

# 轮询入口页直到返回 200，避免启动后立刻检查导致误报。
wait_ready() {
  local deadline=$((SECONDS + 40))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(http_code "$(base_url)/")" = '200' ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

report_plan() {
  local works
  works="$(discover_works)"
  if [ -z "$works" ]; then
    warn "在 $ROOT_DIR 下没有发现任何作品目录"
    return 0
  fi
  info "本次将发布以下作品："
  local name
  while IFS= read -r name; do
    printf '%s      /%s/%s\n' "$C_DIM" "$name" "$C_OFF"
  done <<< "$works"
  if [ -z "$SITE_BASE_URL" ]; then
    printf '%s      未设置 SITE_BASE_URL，跳过 og:image 绝对化%s\n' "$C_DIM" "$C_OFF"
  else
    printf '%s      SITE_BASE_URL=%s%s\n' "$C_DIM" "$SITE_BASE_URL" "$C_OFF"
  fi
}

cmd_build() {
  local extra=("$@")
  require_docker
  report_plan
  info "构建镜像 personal-portfolio:local ..."
  compose build "${extra[@]+"${extra[@]}"}"
  ok '镜像构建完成'
}

cmd_up() {
  local extra=("$@")
  require_docker
  report_plan
  # 变量必须用 ${} 括起：macOS 自带的 bash 3.2 存在多字节解析缺陷，
  # $PORT 紧跟全角括号时，会把括号的首字节并入变量名，导致 unbound variable。
  if [ "$NO_BUILD" -eq 1 ]; then
    info "使用已存在的镜像启动（跳过构建）：$IMAGE_TAG"
    compose up --detach "${extra[@]+"${extra[@]}"}"
  else
    info "构建并启动容器（监听 ${BIND_HOST}:${PORT}）..."
    compose up --detach --build "${extra[@]+"${extra[@]}"}"
  fi
  if wait_ready; then
    ok "站点已启动：$(base_url)/"
    cmd_check
  else
    warn '容器已启动，但入口页在 40 秒内未返回 200'
    warn '可执行 ./deploy.sh logs 查看日志'
    exit 1
  fi
}

cmd_bundle() {
  local site_dir="$ROOT_DIR/build/site"
  local revision
  # 简易版直接复制源码目录里的单文件（星轨另带 WASM 内核，见下方组装步骤）；
  # 工程版取各自 dist/ 构建产物。
  # Dockerfile 侧同样是枚举式的，两处都要随新增作品同步。
  local simple_works=(migration patina arbor star-trails)
  local showcase_works=(migration-showcase patina-showcase arbor-showcase star-trails-showcase)
  local work

  command -v docker >/dev/null 2>&1 || die '未找到 docker'
  command -v node   >/dev/null 2>&1 || die '未找到 node，bundle 需要在本机构建站点'
  command -v pnpm   >/dev/null 2>&1 || die '未找到 pnpm'

  report_plan

  info '1/5 构建工程版 ...'
  for work in "${showcase_works[@]}"; do
    if [ ! -d "$ROOT_DIR/$work/node_modules" ]; then
      ( cd "$ROOT_DIR/$work" && pnpm install --frozen-lockfile ) || die "$work 依赖安装失败"
    fi
    ( cd "$ROOT_DIR/$work" && pnpm build ) || die "$work 构建失败"
  done

  info '2/5 组装站点目录 ...'
  rm -rf "$site_dir"
  mkdir -p "$site_dir"
  node "$ROOT_DIR/deploy/render-landing.mjs" > "$site_dir/index.html" || die '入口页生成失败'
  for work in "${simple_works[@]}"; do
    mkdir -p "$site_dir/$work"
    cp "$ROOT_DIR/$work/index.html" "$site_dir/$work/index.html"
  done
  # 星轨简易版的 WASM 内核以相对路径 ./pkg/ 加载，是「单文件」约定之外唯一的
  # 附加资源；漏拷时页面本身仍是 200，打开才报错，所以必须随站点一起复制。
  mkdir -p "$site_dir/star-trails/pkg"
  cp -R "$ROOT_DIR/star-trails/pkg/." "$site_dir/star-trails/pkg/"
  for work in "${showcase_works[@]}"; do
    mkdir -p "$site_dir/$work"
    cp -R "$ROOT_DIR/$work/dist/." "$site_dir/$work/"
  done
  # 站点分发的是 MIT 代码，许可证声明必须随产物一同交付。
  cp "$ROOT_DIR/LICENSE" "$site_dir/LICENSE"

  info '3/5 应用 SITE_BASE_URL ...'
  for work in "${showcase_works[@]}"; do
    node "$ROOT_DIR/deploy/tune-html.mjs" "$site_dir/$work" "$SITE_BASE_URL" || die "$work HTML 微调失败"
  done

  info "4/5 交叉打包 linux/amd64 镜像：$BUNDLE_IMAGE"
  revision="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf 'unknown')"
  docker build \
    --platform linux/amd64 \
    --file "$ROOT_DIR/deploy/Dockerfile.bundle" \
    --tag "$BUNDLE_IMAGE" \
    --label "org.opencontainers.image.revision=$revision" \
    "$ROOT_DIR" || die '镜像打包失败'

  info '5/5 导出镜像 tar ...'
  mkdir -p "$ROOT_DIR/build"
  docker save "$BUNDLE_IMAGE" --output "$BUNDLE_TAR" || die '镜像导出失败'

  ok "已生成：${BUNDLE_TAR}（$(du -h "$BUNDLE_TAR" | cut -f1)）"
  printf '%s      镜像 %s，架构 linux/amd64，修订 %s%s\n' "$C_DIM" "$BUNDLE_IMAGE" "${revision:0:12}" "$C_OFF"
  printf '%s      服务器端：docker load -i %s && IMAGE_TAG=%s ./deploy.sh up --no-build%s\n' "$C_DIM" "$(basename -- "$BUNDLE_TAR")" "$BUNDLE_IMAGE" "$C_OFF"
}

cmd_check() {
  local base works route url asset code slash_code failures=0 connection_failed=0

  command -v curl >/dev/null 2>&1 || die '未找到 curl，无法执行检查'
  base="$(base_url)"

  # 入口页
  code="$(http_code "$base/")"
  if [ "$code" = '200' ]; then
    ok "入口页      $base/  ($code)"
  else
    warn "入口页      $base/  ($code)"
    failures=$((failures + 1))
    [ "$code" = '000' ] && connection_failed=1
  fi

  works="$(discover_works)"
  if [ -z "$works" ]; then
    warn '没有发现任何作品目录'
  fi

  while IFS= read -r route; do
    [ -n "$route" ] || continue
    url="$base/$route/"
    code="$(http_code "$url")"
    if [ "$code" = '200' ]; then
      ok "作品        $url  ($code)"
    else
      warn "作品        $url  ($code)"
      failures=$((failures + 1))
      [ "$code" = '000' ] && connection_failed=1
    fi

    # 结尾斜杠重定向：工程版资源全是相对路径，缺斜杠会让 ./static/... 解析到
    # 站点根而整站 404。这里不只验证状态码，还跟随重定向确认最终地址正确：
    # 若 Location 是绝对 URL，nginx 会用容器内端口（80）拼接，从而丢掉宿主机
    # 映射端口、并在 HTTPS 下退化成 http，因此必须断言最终落到预期地址。
    slash_code="$(http_code "$base/$route")"
    expected="$base/$route/"
    effective="$(curl --silent --output /dev/null --location --max-time 10 \
      --write-out '%{url_effective}' "$base/$route" 2>/dev/null)" || effective=''
    if [ "$slash_code" = '301' ] || [ "$slash_code" = '302' ]; then
      if [ "$effective" = "$expected" ]; then
        printf '%s      结尾斜杠重定向 %s -> %s%s\n' "$C_DIM" "$base/$route" "$expected" "$C_OFF"
      else
        warn "结尾斜杠重定向 $base/$route 最终落在 ${effective}，预期 ${expected}"
        failures=$((failures + 1))
      fi
    elif [ "$slash_code" = '404' ]; then
      warn "结尾斜杠      $base/$route 返回 404，子目录访问将失效"
      failures=$((failures + 1))
    else
      warn "结尾斜杠      $base/$route 返回 ${slash_code}，预期 301"
      failures=$((failures + 1))
    fi
  done <<< "$works"

  # 附加资源不体现在作品目录的请求里（例如星轨简易版的 WASM 内核），单独请求
  # 一次：漏拷时目录请求仍是 200，只有真正打开作品才会报错。
  for asset in /star-trails/pkg/star_trails.js /star-trails/pkg/star_trails_bg.wasm; do
    code="$(http_code "$base$asset")"
    if [ "$code" = '200' ]; then
      ok "附加资源    $base$asset  ($code)"
    else
      warn "附加资源    $base$asset  ($code)"
      failures=$((failures + 1))
      [ "$code" = '000' ] && connection_failed=1
    fi
  done

  # gzip 是否生效：简易版整个应用是一个约 607 KiB 的 HTML，压缩收益明显。
  if command -v curl >/dev/null 2>&1; then
    local raw gzipped
    raw="$(curl --silent --output /dev/null --max-time 8 --write-out '%{size_download}' "$base/migration/" 2>/dev/null || printf '0')"
    gzipped="$(curl --silent --output /dev/null --max-time 8 --header 'Accept-Encoding: gzip' --write-out '%{size_download}' "$base/migration/" 2>/dev/null || printf '0')"
    if [ "$raw" != '0' ] && [ "$gzipped" != '0' ] && [ "$gzipped" -lt "$raw" ]; then
      printf '%s      gzip 生效：/migration/ %s B -> %s B%s\n' "$C_DIM" "$raw" "$gzipped" "$C_OFF"
    fi
  fi

  if [ "$failures" -eq 0 ]; then
    ok '全部检查通过'
    return 0
  fi
  if [ "$connection_failed" -eq 1 ]; then
    warn "无法连接 $(base_url)/ —— 容器可能未运行，先执行 ./deploy.sh up"
  fi
  warn "检查发现 $failures 处问题"
  return 1
}

cmd_status() {
  require_docker
  compose ps
}

cmd_logs() {
  require_docker
  compose logs --follow --tail 100
}

cmd_restart() {
  require_docker
  info '重启容器 ...'
  compose restart
  if wait_ready; then
    ok "已恢复：$(base_url)/"
  else
    warn '重启后入口页未就绪'
    exit 1
  fi
}

cmd_down() {
  require_docker
  info '停止并移除容器 ...'
  compose down
  ok '已停止'
}

usage() {
  # 打印文件头部注释块：跳过 shebang，输出连续的 # 注释行，遇到第一个
  # 非注释行即停止。不依赖行号，改注释头不会错位。
  awk 'NR == 1 { next }
       /^#/ { sub(/^# ?/, ""); print; next }
       { exit }' "${BASH_SOURCE[0]}"
}

main() {
  local command="${1:-up}"
  shift || true

  # 先摘出 --no-build（它不是 compose 的参数），其余原样透传给子命令。
  # bash 3.2 下 `set -- "${arr[@]}"` 在数组为空时会报 unbound，所以分情况处理。
  local passthrough=()
  local arg
  for arg in "$@"; do
    case "$arg" in
      --no-build) NO_BUILD=1 ;;
      *) passthrough+=("$arg") ;;
    esac
  done
  if [ "${#passthrough[@]}" -gt 0 ]; then
    set -- "${passthrough[@]}"
  else
    set --
  fi

  case "$command" in
    up)      cmd_up "$@" ;;
    build)   cmd_build "$@" ;;
    bundle)  cmd_bundle ;;
    check)   cmd_check ;;
    status)  cmd_status ;;
    logs)    cmd_logs ;;
    restart) cmd_restart ;;
    down)    cmd_down ;;
    config)  require_docker; compose config ;;
    help|-h|--help) usage ;;
    *)
      warn "未知命令：$command"
      printf '\n'
      usage
      exit 1
      ;;
  esac
}

main "$@"
