// 构建期生成站点入口页。
//
// 产物是纯静态 HTML（不依赖运行时 JavaScript），因此入口页本身能被正常索引与
// 分享；只有作品列表来自 works.json。链接一律使用相对路径（./<route>/），
// 这样无论站点挂在域名根还是子目录都能正确跳转。

import { readFileSync } from 'node:fs';

const manifestUrl = new URL('./works.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

/** 转义为 HTML 文本，避免作品元数据里的字符破坏页面结构。 */
const escapeHtml = (value) => String(value).replace(
  /[&<>"']/gu,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]),
);

const works = Array.isArray(manifest.works) ? manifest.works : [];

if (works.length === 0) {
  // 空站点是配置错误而非合法状态，让构建直接失败而不是产出空白页面。
  throw new Error('deploy/works.json 中没有任何作品，站点入口页将为空');
}

const cards = works.map((work, index) => {
  const position = String(index + 1).padStart(2, '0');
  return `        <li class="work">
          <a href="./${escapeHtml(work.route)}/">
            <span class="work__index">${position}</span>
            <span class="work__main">
              <span class="work__heading">
                <span class="work__name">${escapeHtml(work.name)}</span>
                <span class="work__variant">${escapeHtml(work.variant)}</span>
              </span>
              <span class="work__summary">${escapeHtml(work.summary)}</span>
              <span class="work__stack">${escapeHtml(work.stack)}</span>
            </span>
            <span class="work__arrow" aria-hidden="true">&#8594;</span>
          </a>
        </li>`;
}).join('\n');

const document = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f6f2e9" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%238e987d' d='M3 14 29 28 57 8 37 38 31 55 24 34Z'/%3E%3C/svg%3E" />
    <title>${escapeHtml(manifest.title)}</title>
    <meta name="description" content="${escapeHtml(manifest.description)}" />
    <style>
      :root {
        --paper: #f6f2e9;
        --ink: #3a362c;
        --muted: rgb(58 54 44 / 52%);
        --accent: #9b8154;
        --line: rgb(58 54 44 / 16%);
        --serif: "Songti SC", "Noto Serif CJK SC", "STSong", Georgia, serif;
        --sans: "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        padding: clamp(28px, 6vw, 88px) clamp(20px, 6vw, 96px) clamp(48px, 8vw, 112px);
        min-height: 100vh;
        color: var(--ink);
        font-family: var(--sans);
        background: var(--paper);
        -webkit-font-smoothing: antialiased;
      }

      header { max-width: 62rem; }

      .eyebrow {
        margin: 0;
        color: var(--accent);
        font-size: 0.7rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0.7em 0 0;
        font-family: var(--serif);
        font-size: clamp(2.1rem, 6vw, 3.4rem);
        font-weight: 400;
        letter-spacing: 0.14em;
      }

      .tagline {
        margin: 0.9em 0 0;
        font-family: var(--serif);
        font-size: clamp(0.95rem, 2vw, 1.15rem);
        letter-spacing: 0.1em;
      }

      .description {
        max-width: 34rem;
        margin: 1.6em 0 0;
        color: var(--muted);
        font-size: 0.85rem;
        line-height: 2;
      }

      .rule {
        margin: clamp(40px, 7vw, 72px) 0 clamp(20px, 3vw, 32px);
        border: 0;
        border-top: 1px solid var(--line);
      }

      .works {
        max-width: 62rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .work a {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: clamp(18px, 3vw, 40px);
        align-items: baseline;
        padding: clamp(22px, 3.4vw, 34px) 0;
        color: inherit;
        text-decoration: none;
        border-bottom: 1px solid var(--line);
        transition: color 180ms ease;
      }

      .work a:hover { color: var(--accent); }

      .work a:focus-visible {
        outline: 1px solid var(--accent);
        outline-offset: 6px;
      }

      .work__index {
        color: var(--muted);
        font-size: 0.7rem;
        letter-spacing: 0.16em;
      }

      .work__main {
        display: flex;
        flex-direction: column;
        gap: 0.75em;
      }

      .work__heading {
        display: flex;
        flex-wrap: wrap;
        gap: 0.85em;
        align-items: baseline;
      }

      .work__name {
        font-family: var(--serif);
        font-size: clamp(1.15rem, 2.6vw, 1.5rem);
        letter-spacing: 0.1em;
      }

      .work__variant {
        padding: 0.25em 0.7em;
        color: var(--accent);
        font-size: 0.68rem;
        letter-spacing: 0.16em;
        border: 1px solid currentcolor;
        border-radius: 999px;
      }

      .work__summary {
        max-width: 40rem;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.95;
      }

      .work__stack {
        color: var(--muted);
        font-size: 0.68rem;
        letter-spacing: 0.13em;
      }

      .work__arrow {
        font-size: 1.2rem;
        transition: transform 180ms ease;
      }

      .work a:hover .work__arrow { transform: translateX(6px); }

      footer {
        max-width: 62rem;
        margin-top: clamp(36px, 6vw, 60px);
        color: var(--muted);
        font-size: 0.68rem;
        letter-spacing: 0.14em;
      }
    </style>
  </head>
  <body>
    <header>
      <p class="eyebrow">Portfolio</p>
      <h1>${escapeHtml(manifest.title)}</h1>
      <p class="tagline">${escapeHtml(manifest.tagline)}</p>
      <p class="description">${escapeHtml(manifest.description)}</p>
    </header>

    <hr class="rule" />

    <ul class="works">
${cards}
    </ul>

    <footer>共 ${works.length} 件作品</footer>
  </body>
</html>
`;

process.stdout.write(document);
