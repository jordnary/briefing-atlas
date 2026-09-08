import { mkdir, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBriefings, validateCollection } from './content.mjs';
import { renderMarkdown } from './render-markdown.mjs';
import { assertArchiveReady, withArchiveLock } from './archive-store.mjs';
import { hash, serializeBriefing } from './archive-convert.mjs';
export async function buildContent() {
  await assertArchiveReady('.');
  const all = await loadBriefings();
  for (const warning of validateCollection(all)) console.warn(warning);
  const published = all.filter((item) => item.status === 'published');
  if (published.some((item) => item.sample))
    throw new Error('SAMPLE_CONTENT_IS_NOT_PUBLISHABLE');
  if (published.some((item) => !item.archivedAt || !item.revision))
    throw new Error('ARCHIVE_METADATA_REQUIRED_FOR_PUBLICATION');
  const manifest = {
    version: 1,
    issues: published.map((item) => ({
      date: item.briefingDate,
      revision: item.revision,
      formatRevision: item.formatRevision,
      hash: hash(serializeBriefing(item)),
    })),
  };
  manifest.archiveVersion = hash(JSON.stringify(manifest.issues));
  const records = [];
  for (const item of published) {
    item.introHtml = renderMarkdown(item.intro || '');
    item.outroHtml = renderMarkdown(item.outro || '');
    for (const story of item.stories) {
      story.html = renderMarkdown(story.body);
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
        briefingIntro: item.intro,
        briefingOutro: item.outro,
        revision: item.revision,
        archiveVersion: manifest.archiveVersion,
      });
    }
  }
  await mkdir('generated', { recursive: true });
  await mkdir('public', { recursive: true });
  for (const { file, data } of [
    { file: 'generated/briefings.json', data: published },
    { file: 'public/search-index.json', data: records },
    { file: 'public/archive-manifest.json', data: manifest },
  ]) {
    await writeFile(`${file}.tmp`, JSON.stringify(data), 'utf8');
    await rename(`${file}.tmp`, file);
  }
  console.log(
    `Validated ${all.length} briefings; published ${published.length} issues and ${records.length} stories.`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await withArchiveLock('.', buildContent);
