import { Marked } from 'marked';
import katex from 'katex';
export const escape = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const markdown = new Marked();
const renderer = {
  html: ({ text }) => escape(text),
  link({ href, tokens }) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return this.parser.parseInline(tokens);
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      return this.parser.parseInline(tokens);
    return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
  },
  image: ({ text }) =>
    `<span class="image-fallback">原配图暂未恢复${text ? ` · ${escape(text)}` : ''}</span>`,
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
markdown.use({
  renderer,
  extensions: [
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
export const renderMarkdown = (source) =>
  markdown.parse(source, { async: false });
