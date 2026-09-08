import { Marked } from 'marked';
import katex from 'katex';
import { isWebUrl, isImageUrl, imageHref } from '../lib/resource-urls.mjs';
export const escape = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const renderer = {
  html: ({ text }) => escape(text),
  link({ href, tokens }) {
    if (!isWebUrl(href)) return this.parser.parseInline(tokens);
    return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
  },
};
const math = (name, level, pattern, start) => ({
  name,
  level,
  start,
  tokenizer(src) {
    const m = src.match(pattern);
    if (m) return { type: name, raw: m[0], text: m[1] ?? m[2] };
  },
  renderer(token) {
    return katex.renderToString(token.text, {
      displayMode: level === 'block',
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    });
  },
});
export const renderMarkdown = (
  source,
  { basePath = process.env.NEXT_PUBLIC_BASE_PATH || '' } = {},
) => {
  const markdown = new Marked();
  markdown.use({
    renderer: {
      ...renderer,
      image({ href, text, title, tokens }) {
        if (tokens)
          text = this.parser.parseInline(tokens, this.parser.textRenderer);
        if (!isImageUrl(href))
          return `<span class="image-fallback">配图暂不可用 · ${escape(text)}</span>`;
        const src = escape(imageHref(href, basePath));
        return `<span class="inline-image"><img src="${src}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ''} loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="image-load-error">配图加载失败 · <a href="${src}" target="_blank" rel="noopener noreferrer">查看图片</a></span></span>`;
      },
    },
    extensions: [
      {
        name: 'imageGallery',
        level: 'block',
        start: (src) => src.indexOf(':::gallery\n'),
        tokenizer(src) {
          const match = src.match(/^:::gallery\n([\s\S]*?)\n:::(?:\n|$)/);
          if (match)
            return {
              type: 'imageGallery',
              raw: match[0],
              tokens: this.lexer.blockTokens(match[1]),
            };
        },
        renderer(token) {
          return `<div class="media-gallery" role="region" aria-label="原简报配图" tabindex="0">${this.parser.parse(token.tokens)}</div>`;
        },
      },
      math(
        'blockMath',
        'block',
        /^(?:\\\[\s*\n?([\s\S]*?)\\\]|\$\$\s*\n?([\s\S]*?)\$\$)(?:\n|$)/,
        (src) => {
          const i = src.search(/\\\[|\$\$/);
          return i < 0 ? undefined : i;
        },
      ),
      math(
        'inlineMath',
        'inline',
        /^(?:\\\(([^\n]*?)\\\)|\$([^\n$]+)\$)/,
        (src) => {
          const i = src.search(/\\\(|\$/);
          return i < 0 ? undefined : i;
        },
      ),
    ],
  });
  return markdown.parse(source, { async: false });
};
