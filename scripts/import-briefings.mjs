import { readFile } from 'node:fs/promises';
import {
  loadBriefings,
  parseBriefing,
  validateCollection,
} from './content.mjs';
import {
  withArchiveLock,
  recoverBatch,
  commitBatch,
  readState,
} from './archive-store.mjs';
const args = process.argv.slice(2),
  replace = args.includes('--replace'),
  files = args.filter((arg) => arg !== '--replace');
try {
  if (!files.length)
    throw new Error(
      'Usage: npm run import -- <briefing.md> [more.md] [--replace]',
    );
  await withArchiveLock('.', async () => {
    await recoverBatch('.');
    const existing = await loadBriefings();
    const incoming = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, 'utf8');
        return { source, item: parseBriefing(source) };
      }),
    );
    validateCollection(incoming.map((entry) => entry.item));
    for (const { item } of incoming) {
      if (item.sample) throw new Error('SAMPLE_CONTENT_IS_NOT_PUBLISHABLE');
      const old = existing.find(
        (record) => record.briefingDate === item.briefingDate,
      );
      if (!old) continue;
      if (!replace)
        throw new Error('DATE_ALREADY_EXISTS_REVIEW_BEFORE_REPLACE');
      if (
        item.revision !== old.revision + 1 ||
        !item.corrections?.length ||
        item.corrections.length <= (old.corrections?.length ?? 0)
      )
        throw new Error('REPLACEMENT_REQUIRES_REVISION_AND_CORRECTION');
      if (
        old.stories.some(
          (story) => !item.stories.some((next) => next.id === story.id),
        )
      )
        throw new Error('REPLACEMENT_MUST_PRESERVE_STABLE_IDS');
    }
    const dates = new Set(incoming.map((entry) => entry.item.briefingDate));
    validateCollection([
      ...existing.filter((item) => !dates.has(item.briefingDate)),
      ...incoming.map((entry) => entry.item),
    ]);
    const state = await readState('.');
    state.publication = {
      ...state.publication,
      stage: 'archived',
      failedStage: null,
    };
    await commitBatch(
      '.',
      incoming.map(({ source, item }) => ({ date: item.briefingDate, source })),
      state,
    );
    console.log(
      `Imported ${incoming.length} validated briefings. Publication is pending.`,
    );
  });
} catch (error) {
  console.error(
    error instanceof SyntaxError ? 'INVALID_JSON' : error.code || error.message,
  );
  process.exitCode = 1;
}
