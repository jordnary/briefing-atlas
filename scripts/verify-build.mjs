import { readFile, readdir, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadBriefings } from './content.mjs';
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
];
for (const route of routes) {
  const html = await readFile(`${root}${route}index.html`, 'utf8');
  assert.match(html, /<html[^>]*lang="zh-CN"/);
  assert.ok(html.includes('Briefing Atlas'));
  assert.ok(html.includes(`${base}/archive/`));
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const url = match[1];
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    assert.ok(
      !base || url.startsWith(`${base}/`),
      `Unprefixed asset or link on ${route}`,
    );
    const clean = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
    if (clean.endsWith('/')) continue;
    await access(path.join(root, clean));
  }
}
const index = JSON.parse(await readFile(`${root}/search-index.json`, 'utf8'));
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
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    if (!/\.(html|js|json|css|txt|svg)$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
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
