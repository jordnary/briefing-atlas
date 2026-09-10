import {
  access,
  cp,
  mkdir,
  readdir,
  rm,
  writeFile,
  readFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
// Vinext nests exported pages under basePath; static hosts mount the artifact there.
// Normalize that output so the same artifact layout works on GitHub Pages.
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const root = path.resolve('dist/client');
if (base) {
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(base))
    throw new Error('Invalid base path.');
  const nested = path.resolve(root, `.${base}`);
  if (!nested.startsWith(root + path.sep) || nested === root)
    throw new Error('Export directory is outside the build output.');
  await access(path.join(nested, 'index.html'));
  for (const entry of await readdir(nested)) {
    const destination = path.resolve(root, entry);
    if (!destination.startsWith(root + path.sep))
      throw new Error('Invalid output entry.');
    await cp(path.join(nested, entry), destination, { recursive: true });
  }
  await access(path.join(root, 'index.html'));
  await rm(nested, { recursive: true });
}
await mkdir(root, { recursive: true });
await writeFile(path.join(root, '.nojekyll'), '');
const files = [];
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(full, relative);
    else if (
      entry.name.endsWith('.html') ||
      entry.name === 'search-index.json' ||
      entry.name === 'archive-manifest.json'
    )
      files.push(relative);
  }
}
await collect(root);
files.sort((a, b) => a.localeCompare(b));
const hashes = {};
for (const file of files)
  hashes[file] = createHash('sha256')
    .update(await readFile(path.join(root, file)))
    .digest('hex');
const archive = JSON.parse(
  await readFile(path.join(root, 'archive-manifest.json'), 'utf8'),
);
await writeFile(
  path.join(root, 'build-integrity.json'),
  JSON.stringify(
    { version: 1, archiveVersion: archive.archiveVersion, files: hashes },
    null,
    2,
  ) + '\n',
);
console.log('Static artifact prepared.');
