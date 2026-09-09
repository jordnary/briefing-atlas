import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { isWebUrl, isImagePath } from '../lib/resource-urls.mjs';
import { readingText } from '../lib/domain.mjs';
import { searchStories } from '../lib/search.mjs';
import { validateMarkdown, parseBriefing } from '../scripts/content.mjs';
import { renderMarkdown } from '../scripts/render-markdown.mjs';
import { galleryParts } from '../lib/gallery-content.mjs';
import {
  imageGroupKey,
  messageResources,
} from '../scripts/archive-resources.mjs';
import { convertMessage } from '../scripts/archive-convert.mjs';
import { exportThreadPages } from '../scripts/archive-input.mjs';
import { syncArchive } from '../scripts/archive-sync.mjs';
import { contentFile, readState } from '../scripts/archive-store.mjs';
import { importBrowserResources } from '../scripts/import-browser-resources.mjs';

const data = { query: ['original image'] };
const message = () => ({
  messageId: 'resource-message',
  role: 'assistant',
  status: 'completed',
  complete: true,
  text: `# AI & Tech Briefing · 2026-09-08\n\n导语。\n\n## 1. 原标题\n\nimage_group${JSON.stringify(data)}\n\n原文数字 129。citeturn0search0`,
});
const citation = {
  title: 'Original (article)',
  url: 'https://example.org/article_(edition)?a=1&b=2',
};
const originalImage = {
  url: 'https://example.org/original.jpg',
  alt: 'Original image',
  caption: 'Original caption',
  sourceUrl: 'https://example.org/article',
};
const batch = (m) => ({
  version: 1,
  source: 'resource-source',
  complete: true,
  messages: [m],
});

test('image and link validation agrees with rendering, including local images and HTTP links', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/png;base64,AA',
    '//example.org/img',
    'https://user:pass@example.org/a',
    'file:///image.png',
    'https://example.org/\\evil',
  ]) {
    assert.equal(isWebUrl(url), false);
    assert.throws(() => validateMarkdown(`[link](${url})`));
    assert.doesNotMatch(renderMarkdown(`[link](${url})`), /<a /);
  }
  for (const url of [
    'images/../secret.png',
    '/images/%2e%2e/secret.png',
    'images/a.png/../../a.png',
    '/images//a.png',
  ])
    assert.equal(isImagePath(url), false);
  assert.doesNotThrow(() =>
    validateMarkdown(
      '![local](images/sample.webp)\n[link](http://example.org/article)',
    ),
  );
  const html = renderMarkdown('![local](images/sample.webp "A caption")', {
    basePath: '/archive',
  });
  assert.match(html, /src="\/archive\/images\/sample.webp"/);
  assert.match(html, /alt="local"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /image-load-error/);
  assert.match(
    renderMarkdown('![Original \\| image](https://example.org/image.jpg)'),
    /alt="Original \| image"/,
  );
  assert.match(
    renderMarkdown('[link](http://example.org/article)'),
    /rel="noopener noreferrer"/,
  );
});

test('reading metrics and search snippets omit gallery metadata and destination URLs', () => {
  const body =
    ':::gallery\n![Gallery-only term](https://example.org/image.jpg)\n[Caption](https://example.org/source)\n:::\n\n正文 [Source](https://example.org/article) 与代码 `task()`。';
  assert.equal(readingText(body), '正文 Source 与代码 task()。');
  const records = [
    { title: 'Title', summary: 'Summary', body, tags: [], entities: [] },
  ];
  assert.equal(searchStories(records, { q: '正文 Source' }).length, 1);
  assert.equal(searchStories(records, { q: 'Gallery-only' }).length, 0);
  assert.equal(searchStories(records, { q: 'example.org' }).length, 0);
});

test('galleries carry safe structured images with full captions and retain unusual Markdown as a fallback', () => {
  const source =
    ':::gallery\n![A & B \\| image](images/sample.webp)\n[Full **caption** & source](https://example.org/source?a=1&b=2)\n:::';
  const html = renderMarkdown(source, { basePath: '/archive' });
  const attribute = html.match(/data-gallery="([^"]+)"/)[1];
  const images = JSON.parse(
    attribute
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&'),
  );
  assert.equal(images[0].src, '/archive/images/sample.webp');
  assert.equal(images[0].alt, 'A & B | image');
  assert.equal(images[0].caption, 'Full caption & source');
  assert.match(images[0].captionHtml, /<strong>caption<\/strong>/);
  assert.match(images[0].captionHtml, /rel="noopener noreferrer"/);
  assert.match(html, /<img /);
  const parts = galleryParts(
    `<p>Before</p>${html}<p>Between</p>${html}<p>After</p>`,
  );
  assert.deepEqual(
    parts.filter((part) => 'html' in part).map((part) => part.html),
    ['<p>Before</p>', '<p>Between</p>', '<p>After</p>'],
  );
  assert.deepEqual(parts[1].images, images);
  assert.deepEqual(parts[3].images, images);
  const nested = renderMarkdown(
    '> :::gallery\n> ![A](images/sample.webp)\n> :::',
  );
  assert.doesNotMatch(nested, /data-gallery=/);
  assert.deepEqual(galleryParts(nested), [{ html: nested }]);
  assert.doesNotMatch(
    renderMarkdown(':::gallery\n![bad](javascript:alert)\n:::'),
    /data-gallery=/,
  );
  assert.doesNotMatch(
    renderMarkdown(':::gallery\n## Heading\n\n![A](images/sample.webp)\n:::'),
    /data-gallery=/,
  );
});

test('thread export retains explicit citation and image metadata', () => {
  const m = message();
  const result = exportThreadPages([
    {
      thread: { id: 'resource-source' },
      page: { hasMore: false },
      turns: [
        {
          status: 'completed',
          items: [
            {
              type: 'agentMessage',
              id: m.messageId,
              text: m.text,
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: { ...citation, ref_id: 'turn0search0' },
                },
              ],
              imageGroups: { [imageGroupKey(data)]: [originalImage] },
            },
          ],
        },
      ],
    },
  ]);
  const item = convertMessage(result.messages[0]);
  assert.equal(item.stories[0].citationStatus, 'preserved');
  assert.equal(item.stories[0].imageStatus, 'preserved');
  assert.match(item.stories[0].body, /!\[Original image\]/);
  assert.match(item.stories[0].body, /article_%28edition%29/);
  assert.match(renderMarkdown(item.stories[0].body), /<img /);
  assert.equal(item.stories[0].summary, '原文数字 129。');
  assert.throws(
    () =>
      messageResources({
        citations: { ref: { title: 'bad', url: 'javascript:alert(1)' } },
      }),
    /INVALID_RESOURCE_LINK/,
  );
});

test('resource-only updates are imported once and survive later text-only reads', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resource-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const m = message();
  assert.equal((await syncArchive(batch(m), { root })).status, 'archived');
  const enriched = {
    ...m,
    citations: { turn0search0: citation },
    imageGroups: { [imageGroupKey(data)]: [originalImage] },
  };
  assert.equal(
    (await syncArchive(batch(enriched), { root })).status,
    'archived',
  );
  const file = contentFile(root, '2026-09-08'),
    before = await readFile(file, 'utf8');
  const item = parseBriefing(before);
  assert.equal(item.revision, 1);
  assert.equal(item.formatRevision, 2);
  assert.equal(item.stories[0].citationStatus, 'preserved');
  assert.equal(item.stories[0].id, 'briefing-2026-09-08-01');
  assert.equal(
    (await syncArchive(batch(enriched), { root })).status,
    'unchanged',
  );
  assert.equal((await syncArchive(batch(m), { root })).status, 'unchanged');
  assert.equal(await readFile(file, 'utf8'), before);
  assert.ok((await readState(root)).records['2026-09-08'].resourceHash);
  const bad = {
    ...enriched,
    citations: { turn0search0: { title: 'bad', url: 'javascript:alert(1)' } },
  };
  assert.equal((await syncArchive(batch(bad), { root })).status, 'pending');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('browser capture validates message, story, citation context and image group counts', () => {
  const m = message();
  const capture = {
    messages: [
      {
        messageId: m.messageId,
        title: 'AI & Tech Briefing · 2026-09-08',
        stories: [
          {
            title: '1. 原标题',
            citations: [
              {
                title: 'Original',
                url: citation.url,
                context: '原文数字 129。Original',
              },
            ],
            images: [originalImage],
          },
        ],
      },
    ],
    galleries: [{ messageId: m.messageId, story: 1, images: [originalImage] }],
  };
  const result = importBrowserResources(batch(m), capture);
  assert.equal(result.stats.images, 1);
  const item = convertMessage(result.input.messages[0]);
  assert.equal(item.stories[0].citationStatus, 'preserved');
  assert.match(renderMarkdown(item.stories[0].body), /class="media-gallery"/);
  assert.equal(
    item.stories[0].sources.length,
    1,
    'Image attribution is not a news reference.',
  );
  const different = structuredClone(capture);
  different.messages[0].stories[0].citations[0].context = 'A different claim';
  assert.throws(
    () => importBrowserResources(batch(m), different),
    /CONTEXT_MISMATCH/,
  );
  const missing = structuredClone(capture);
  missing.galleries = [];
  assert.throws(
    () => importBrowserResources(batch(m), missing),
    /IMAGE_GROUP_COUNT_MISMATCH/,
  );
  const duplicate = structuredClone(capture);
  duplicate.messages.push(duplicate.messages[0]);
  assert.throws(
    () => importBrowserResources(batch(m), duplicate),
    /DUPLICATE_BROWSER_MESSAGE/,
  );
  const extra = structuredClone(capture);
  extra.galleries[0].story = 2;
  assert.throws(
    () => importBrowserResources(batch(m), extra),
    /GALLERY_NOT_IN_MESSAGE/,
  );
  const noOriginal = structuredClone(capture);
  noOriginal.galleries = [];
  noOriginal.messages[0].stories[0].images = [];
  assert.equal(
    importBrowserResources(batch(m), noOriginal).stats.unresolvedImageGroups,
    1,
  );
  const partial = importBrowserResources(
    batch({
      ...m,
      text: m.text.replace('turn0search0', 'turn0search0turn0search1'),
    }),
    capture,
  );
  assert.equal(partial.stats.unresolvedCitations, 1);
  assert.match(
    convertMessage(partial.input.messages[0]).stories[0].body,
    /另有 1 条原引用链接暂未恢复/,
  );
});

test('combined citations reuse exact ids proven by standalone citations in the same message', () => {
  const m = message();
  m.text =
    m.text.replace('turn0search0', 'turn0search0turn0search1') +
    '\n\n第二段原文数字 256。citeturn0search1';
  const capture = {
    messages: [
      {
        messageId: m.messageId,
        title: 'AI & Tech Briefing · 2026-09-08',
        stories: [
          {
            title: '1. 原标题',
            images: [],
            citations: [
              {
                title: 'First +1',
                url: 'https://example.org/first',
                context: '原文数字 129。First +1',
              },
              {
                title: 'Second',
                url: 'https://example.org/second',
                context: '第二段原文数字 256。Second',
              },
            ],
          },
        ],
      },
    ],
    galleries: [],
  };
  const result = importBrowserResources(batch(m), capture);
  assert.equal(result.stats.unresolvedCitations, 0);
  const item = convertMessage(result.input.messages[0]);
  assert.equal(item.stories[0].citationStatus, 'preserved');
  assert.match(
    item.stories[0].body,
    /\[First\]\(https:\/\/example.org\/first\) · \[Second\]\(https:\/\/example.org\/second\)/,
  );
  assert.equal(
    result.input.messages[0].citations.turn0search0,
    undefined,
    'A combined pill does not identify which ref is its primary link.',
  );
});
