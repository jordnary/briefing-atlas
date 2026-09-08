import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import {
  loadBriefings,
  parseBriefing,
  validateCollection,
} from './content.mjs';
const args = process.argv.slice(2),
  replace = args.includes('--replace');
const files = args.filter((arg) => arg !== '--replace');
if (!files.length) {
  console.error('Usage: npm run import -- <briefing.md> [more.md] [--replace]');
  process.exit(1);
}
try {
  const existing = await loadBriefings();
  const incoming = await Promise.all(
    files.map(async (file) => ({ source: await readFile(file, 'utf8') })),
  );
  for (const entry of incoming) entry.item = parseBriefing(entry.source);
  validateCollection(incoming.map((entry) => entry.item));
  for (const entry of incoming) {
    if (
      !replace &&
      existing.some((item) => item.briefingDate === entry.item.briefingDate)
    )
      throw new Error(
        'Date already exists. Review the revision, then use --replace.',
      );
  }
  const dates = new Set(incoming.map((entry) => entry.item.briefingDate));
  const combined = [
    ...existing.filter((item) => !dates.has(item.briefingDate)),
    ...incoming.map((entry) => entry.item),
  ];
  for (const warning of validateCollection(combined)) console.warn(warning);
  for (const entry of incoming) {
    const date = entry.item.briefingDate;
    const directory = `content/briefings/${date.slice(0, 4)}/${date.slice(5, 7)}`;
    await mkdir(directory, { recursive: true });
    const file = `${directory}/${date}.md`;
    await writeFile(`${file}.tmp`, entry.source, 'utf8');
    await rename(`${file}.tmp`, file);
    console.log(
      `Imported ${date}: ${entry.item.stories.length} stories (${entry.item.status}).`,
    );
  }
} catch (error) {
  console.error(
    error instanceof SyntaxError ? 'Invalid JSON frontmatter.' : error.message,
  );
  process.exit(1);
}
