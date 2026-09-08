import { mkdir, writeFile, rename, access } from 'node:fs/promises';
import { marked } from 'marked';
import katex from 'katex';
import { loadBriefings, validateCollection } from './content.mjs';
const escape = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const renderer = new marked.Renderer();
renderer.html = ({ text }) => escape(text);
renderer.link = ({ href, tokens }) => {
  if (!/^https:\/\//i.test(href)) return marked.Parser.parseInline(tokens);
  return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${marked.Parser.parseInline(tokens)}</a>`;
};
renderer.image = ({ text }) =>
  `<span class="image-fallback">${escape(text || '图片')} · 请使用新闻 image 字段添加配图</span>`;
marked.use({
  renderer,
  extensions: [
    {
      name: 'math',
      level: 'inline',
      start: (src) => src.indexOf('$'),
      tokenizer(src) {
        const m = src.match(/^\$([^\n$]+)\$/);
        if (m) return { type: 'math', raw: m[0], text: m[1] };
      },
      renderer(token) {
        return katex.renderToString(token.text, {
          throwOnError: false,
          trust: false,
          output: 'htmlAndMathml',
        });
      },
    },
  ],
});
const all = await loadBriefings();
for (const warning of validateCollection(all)) console.warn(warning);
const records = [];
const published = all.filter((item) => item.status === 'published');
for (const item of published) {
  for (const story of item.stories) {
    story.html = marked.parse(story.body, { async: false });
    if (story.image) {
      try {
        await access(`public/${story.image.path}`);
        story.image.available = true;
      } catch {
        story.image.available = false;
      }
    }
    records.push({
      ...story,
      briefingDate: item.briefingDate,
      briefingTitle: item.title,
      sample: item.sample,
    });
  }
}
if (!published.length)
  throw new Error('At least one published briefing is required.');
await mkdir('generated', { recursive: true });
for (const { file, data } of [
  { file: 'generated/briefings.json', data: published },
  { file: 'public/search-index.json', data: records },
]) {
  await writeFile(`${file}.tmp`, JSON.stringify(data), 'utf8');
  await rename(`${file}.tmp`, file);
}
console.log(
  `Validated ${all.length} briefings; published ${published.length} issues and ${records.length} stories.`,
);
