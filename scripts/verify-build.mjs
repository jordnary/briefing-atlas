import { readFile, readdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadBriefings } from './content.mjs';
import { hash, serializeBriefing } from './archive-convert.mjs';
import { readState } from './archive-store.mjs';
const root = 'dist/client',
  base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const all = await loadBriefings(),
  published = all.filter((item) => item.status === 'published'),
  drafts = all.filter((item) => item.status === 'draft');
const routes = [
  '/',
  '/archive/',
  '/search/',
  '/bookmarks/',
  ...published.map((item) => `/briefings/${item.briefingDate}/`),
  ...published.flatMap((item) =>
    item.stories.map((story) => `/read/${item.briefingDate}/${story.id}/`),
  ),
];
for (const route of routes) {
  const html = await readFile(`${root}${route}index.html`, 'utf8');
  assert.match(html, /<html[^>]*lang="zh-CN"/);
  assert.ok(html.includes('Briefing Atlas'));
  for (const label of [
    '原简报完整归档',
    '日历归档',
    '归档保留原稿内容',
    '网站归档：',
  ])
    assert.ok(
      !html.includes(label),
      'Internal archive positioning must not appear on the website.',
    );
  assert.ok(html.includes(`${base}/archive/`));
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const url = match[1];
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    assert.ok(
      !base || url.startsWith(`${base}/`),
      `Unprefixed asset or link on ${route}`,
    );
    const clean = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
    await access(
      path.join(root, clean, clean.endsWith('/') ? 'index.html' : ''),
    );
  }
}
const index = JSON.parse(await readFile(`${root}/search-index.json`, 'utf8'));
const manifest = JSON.parse(
  await readFile(`${root}/archive-manifest.json`, 'utf8'),
);
assert.equal(manifest.archiveVersion, hash(JSON.stringify(manifest.issues)));
assert.deepEqual(
  manifest.issues,
  published.map((item) => ({
    date: item.briefingDate,
    revision: item.revision,
    formatRevision: item.formatRevision,
    hash: hash(serializeBriefing(item)),
  })),
);
assert.ok(
  !published.some((item) => item.sample),
  'Published samples are forbidden.',
);
assert.equal(
  index.length,
  published.reduce((count, item) => count + item.stories.length, 0),
);
for (const item of published) {
  const html = await readFile(
    `${root}/briefings/${item.briefingDate}/index.html`,
    'utf8',
  );
  for (const story of item.stories) {
    const readerPath = `/read/${item.briefingDate}/${story.id}/`;
    assert.ok(
      html.includes(`href="${base}${readerPath}"`),
      'Missing reader entry.',
    );
    const readerHtml = await readFile(`${root}${readerPath}index.html`, 'utf8');
    for (const id of ['reader-body', 'reader-sources', 'reader-next'])
      assert.ok(
        readerHtml.includes(`id="${id}"`),
        `Missing reader section: ${id}`,
      );
    assert.ok(
      readerHtml.includes('aria-current="page"'),
      'Reader must identify the current story.',
    );
    const indexed = index.find((result) => result.id === story.id);
    assert.ok(
      readerHtml.includes(indexed.html),
      'Reader body differs from published content.',
    );
    assert.equal(
      indexed?.body,
      story.body,
      'Search body differs from archived source.',
    );
    assert.equal(indexed?.briefingIntro, item.intro);
    assert.equal(indexed?.briefingOutro, item.outro);
    assert.equal(indexed?.archiveVersion, manifest.archiveVersion);
    assert.ok(
      html.includes(`id="${story.id}"`),
      `Missing stable anchor: ${story.id}`,
    );
    assert.ok(
      index.some(
        (result) =>
          result.id === story.id && result.briefingDate === item.briefingDate,
      ),
    );
  }
}
const localPaths = [
  process.cwd(),
  process.cwd().replaceAll('\\', '/'),
  process.env.USERPROFILE,
].filter(Boolean);
const privateState = await readState('.');
const privateValues = [
  privateState.source,
  ...Object.values(privateState.records).map((record) => record.sourceHash),
].filter(Boolean);
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    if (!/\.(html|js|json|css|txt|svg)$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    for (const value of privateValues)
      assert.ok(
        !source.includes(value),
        'Private source metadata leaked into a public asset.',
      );
    assert.ok(
      !/"(?:sourceHash|sourceMessageId|messageId|activeSource|storyMapping)"\s*:/.test(
        source,
      ),
      'Private metadata field leaked.',
    );
    for (const privatePath of localPaths)
      assert.ok(
        !source.includes(privatePath),
        'Build contains a local environment path.',
      );
    for (const draft of drafts)
      for (const story of draft.stories)
        assert.ok(
          !source.includes(story.id),
          'Draft content leaked into a public asset.',
        );
  }
}
await scan(root);
await access(`${root}/404.html`);
console.log(
  `Verified ${routes.length} pages, ${index.length} story anchors, asset paths, draft exclusion and build privacy (base: ${base || '/'}).`,
);
