// 发布期 HTML 微调（可选）。
//
// 背景：工程版的 og:image 是相对路径（./og-migration.jpg）。社交平台的抓取器
// 不解析相对地址，导致分享卡片没有图。migration-showcase/README.md 原本把
// 「改成完整线上 URL」列为发布前手工步骤——手工修改构建产物容易遗漏，
// 这里改为由 SITE_BASE_URL 构建参数自动完成。
//
// 未设置 SITE_BASE_URL 时完全跳过，不触碰构建产物。

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [workDir, baseUrlRaw] = process.argv.slice(2);

if (!workDir) {
  throw new Error('用法：node tune-html.mjs <workDir> <siteBaseUrl>');
}

const baseUrl = (baseUrlRaw ?? '').trim();

if (baseUrl === '') {
  console.log('未设置 SITE_BASE_URL，跳过 HTML 微调');
  process.exit(0);
}

if (!/^https?:\/\//u.test(baseUrl)) {
  throw new Error(`SITE_BASE_URL 必须以 http:// 或 https:// 开头，当前为：${baseUrl}`);
}

// 作品自身的公开地址：站点根地址 + 作品目录名。
const siteBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
const workBase = `${siteBase}${basename(workDir)}/`;

const indexPath = join(workDir, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const before = html;

// og:image 之类指向站内资源的相对地址，统一按作品地址展开为绝对地址。
html = html.replace(
  /(<meta\s[^>]*property="og:image"[^>]*content=")([^"]+)(")/iu,
  (match, head, value, tail) => {
    if (/^https?:\/\//u.test(value)) return match;
    return `${head}${new URL(value, workBase).href}${tail}`;
  },
);

// 补齐 canonical 与 og:url。已存在时不重复插入。
const extras = [];
if (!/<link\s[^>]*rel="canonical"/iu.test(html)) {
  extras.push(`<link rel="canonical" href="${workBase}">`);
}
if (!/<meta\s[^>]*property="og:url"/iu.test(html)) {
  extras.push(`<meta property="og:url" content="${workBase}">`);
}
if (extras.length > 0) {
  html = html.replace(/<\/head>/iu, `${extras.join('')}</head>`);
}

if (html === before) {
  console.log('HTML 微调未产生变化');
  process.exit(0);
}

writeFileSync(indexPath, html);
console.log(`HTML 微调完成：作品地址 ${workBase}`);
