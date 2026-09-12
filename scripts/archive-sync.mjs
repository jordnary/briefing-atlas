import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceExport } from './archive-input.mjs';
import {
  messageResources,
  mergeResources,
  resourceHash,
} from './archive-resources.mjs';
import { loadBriefings, validateCollection } from './content.mjs';
import {
  CONVERTER_VERSION,
  convertMessage,
  serializeBriefing,
  hash,
} from './archive-convert.mjs';
import {
  withArchiveLock,
  recoverBatch,
  readState,
  saveState,
  commitBatch,
  contentFile,
  readMaybe,
  privateDir,
  atomicWrite,
  unlockAbandoned,
} from './archive-store.mjs';
import {
  reviewBinding,
  createReview,
  validateReview,
} from './revision-review.mjs';

export async function syncArchive(
  input,
  {
    root = '.',
    now = new Date().toISOString(),
    acceptRevisions = false,
    retireSamples = false,
    interruptAfter,
    converterVersion = CONVERTER_VERSION,
    sourceCommit = null,
    exportSha256,
    reviewId,
  } = {},
) {
  return withArchiveLock(root, async () => {
    await recoverBatch(root);
    const state = await readState(root);
    if (
      input.version !== 1 ||
      input.complete !== true ||
      typeof input.source !== 'string' ||
      !input.source ||
      !Array.isArray(input.messages)
    )
      throw new Error('INVALID_SOURCE_EXPORT');
    if (state.source && state.source !== input.source)
      throw new Error('SOURCE_SELECTION_MISMATCH');
    const originalState = JSON.stringify(state);
    const binding = reviewBinding(input, state, {
      sourceCommit,
      exportSha256,
      converterVersion,
    });
    const sameReview =
      state.review &&
      Number.isFinite(Date.parse(state.review.expiresAt)) &&
      Date.parse(now) < Date.parse(state.review.expiresAt) &&
      [
        'sourceCommit',
        'exportSha256',
        'inputHash',
        'checkpointVersion',
        'converterVersion',
      ].every((field) => state.review[field] === binding[field]);
    const pendingReview = sameReview
      ? state.review
      : createReview(binding, now);
    const approvalId = reviewId;
    if (acceptRevisions) {
      // Local library callers from before the workflow gate may omit a source
      // pin; the CI path always supplies one and therefore requires the ID.
      const effectiveId =
        approvalId || (sourceCommit === null ? state.review?.id : null);
      if (effectiveId) validateReview(state.review, effectiveId, binding, now);
      else if (sourceCommit !== null) throw new Error('REVIEW_ID_REQUIRED');
    }
    const next = structuredClone(state);
    next.source = input.source;
    const existing = await loadBriefings(path.join(root, 'content/briefings'));
    const byDate = new Map(existing.map((item) => [item.briefingDate, item]));
    const entries = new Map(),
      pending = [],
      changes = [];
    const seen = new Set();
    for (const message of input.messages) {
      let date = null;
      try {
        if (typeof message.messageId !== 'string' || !message.messageId)
          throw new Error('MESSAGE_ID_REQUIRED');
        const key = hash(`${input.source}\n${message.messageId}`);
        if (seen.has(key)) throw new Error('DUPLICATE_MESSAGE_IN_EXPORT');
        seen.add(key);
        // Validate completion and date even when a familiar message is returned.
        let candidate = convertMessage(message, { now });
        date = candidate.briefingDate;
        const sourceHash = hash(message.text);
        const old = byDate.get(date);
        const record = next.records[date];
        const resources = mergeResources(
          record?.sourceHash === sourceHash ? record.resources : null,
          messageResources(message),
        );
        const resourcesHash = resourceHash(resources);
        const effectiveMessage = { ...message, ...resources };
        candidate = convertMessage(effectiveMessage, { now });
        if (record) {
          const saved =
            entries.get(date)?.source ??
            (await readMaybe(contentFile(root, date)));
          if (!saved || hash(saved) !== record.archiveHash)
            throw new Error('ARCHIVE_STATE_DIVERGED');
          if (
            record.sources[key] === sourceHash &&
            record.resourceHash === resourcesHash &&
            record.converterVersion === converterVersion
          )
            continue;
        }
        let item = candidate,
          kind = 'new';
        if (old && !old.sample) {
          if (!record) throw new Error('SOURCE_RECEIPT_REQUIRED');
          if (
            record.sourceHash === sourceHash &&
            record.resourceHash === resourcesHash &&
            record.converterVersion === converterVersion
          ) {
            record.sources[key] = sourceHash;
            changes.push({ date, kind: 'duplicate-source' });
            continue;
          }
          const formatOnly = record.sourceHash === sourceHash;
          const sameMessage = record.activeSource === key;
          const correction =
            message.correctionOf &&
            record.sources[hash(`${input.source}\n${message.correctionOf}`)];
          if (!formatOnly && !sameMessage && !correction)
            throw new Error('SAME_DATE_CONFLICT');
          const revised = convertMessage(effectiveMessage, {
            now,
            previous: old,
          });
          const difference = {
            date,
            kind: formatOnly ? 'format' : 'source',
            beforeRevision: old.revision,
            changedStories: revised.stories
              .filter((s) => {
                const prev = old.stories.find((o) => o.id === s.id);
                return prev?.body !== s.body || prev?.title !== s.title;
              })
              .map((s) => s.id),
            before: {
              title: old.title,
              intro: old.intro,
              outro: old.outro,
              stories: old.stories.map((s) => ({
                id: s.id,
                title: s.title,
                body: s.body,
              })),
            },
            after: {
              title: revised.title,
              intro: revised.intro,
              outro: revised.outro,
              stories: revised.stories.map((s) => ({
                id: s.id,
                title: s.title,
                body: s.body,
              })),
            },
          };
          const reviewFile = pendingReview.id;
          await atomicWrite(
            path.join(privateDir(root), `review-${reviewFile}-${date}.json`),
            JSON.stringify(difference, null, 2),
          );
          if (!formatOnly && !acceptRevisions)
            throw new Error('REVISION_REVIEW_REQUIRED');
          item = revised;
          kind = formatOnly ? 'format' : 'revision';
          item.revision = old.revision + (formatOnly ? 0 : 1);
          item.formatRevision = old.formatRevision + (formatOnly ? 1 : 0);
          item.corrections = [
            ...old.corrections,
            {
              date: now.slice(0, 10),
              kind: formatOnly ? 'format' : 'source',
              note: formatOnly
                ? '更新资源导入与页面格式，保留原稿文字和新闻编号。'
                : '原稿已修订；已对照差异保存，原有新闻链接保持不变。',
            },
          ];
        } else if (old?.sample && !retireSamples)
          throw new Error('SAMPLE_REPLACEMENT_REQUIRES_MIGRATION');
        const source = serializeBriefing(item);
        entries.set(date, { date, source });
        byDate.set(date, item);
        next.records[date] = {
          sourceHash,
          resourceHash: resourcesHash,
          resources,
          activeSource: key,
          sources: { ...record?.sources, [key]: sourceHash },
          archiveHash: hash(source),
          converterVersion,
          revision: item.revision,
          formatRevision: item.formatRevision,
          archivedAt: item.archivedAt,
          history: [
            ...(record?.history ?? []),
            ...(record
              ? [
                  {
                    sourceHash: record.sourceHash,
                    archiveHash: record.archiveHash,
                    converterVersion: record.converterVersion,
                    revision: record.revision,
                    formatRevision: record.formatRevision,
                  },
                ]
              : []),
          ],
          storyMapping: item.stories.map((s) => ({
            id: s.id,
            titleHash: hash(s.title),
            bodyHash: hash(s.body),
          })),
        };
        changes.push({ date, kind, stories: item.stories.length });
      } catch (error) {
        pending.push({
          date,
          code: error.message,
          messageKey:
            typeof message.messageId === 'string'
              ? hash(message.messageId)
              : null,
        });
      }
    }
    // Cross-issue corrections require an explicit target and an exact quoted passage.
    if (!pending.length)
      for (const message of input.messages)
        for (const correction of message.corrections ?? []) {
          const target = byDate.get(correction.targetDate);
          if (
            !target ||
            !next.records[correction.targetDate] ||
            typeof correction.note !== 'string' ||
            !message.text.includes(correction.note) ||
            !correction.note.includes(correction.targetDate)
          ) {
            pending.push({
              date: correction.targetDate ?? null,
              code: 'CORRECTION_TARGET_UNCONFIRMED',
            });
            continue;
          }
          if (
            target.corrections.some(
              (c) => c.kind === 'cross-issue' && c.note === correction.note,
            )
          )
            continue;
          target.corrections.push({
            date: now.slice(0, 10),
            kind: 'cross-issue',
            note: correction.note,
          });
          target.revision += 1;
          target.archivedAt = now;
          const source = serializeBriefing(target);
          entries.set(correction.targetDate, {
            date: correction.targetDate,
            source,
          });
          Object.assign(next.records[correction.targetDate], {
            archiveHash: hash(source),
            revision: target.revision,
            archivedAt: now,
          });
          changes.push({ date: correction.targetDate, kind: 'cross-issue' });
        }
    if (pending.length) {
      // No half-batch publication. A deterministic pending list is the only write.
      if (
        JSON.stringify(state.pending) !== JSON.stringify(pending) ||
        !sameReview
      ) {
        state.pending = pending;
        state.review = pendingReview;
        state.review.files = pending
          .filter((item) => item.date)
          .map((item) => `review-${pendingReview.id}-${item.date}.json`);
        await saveState(root, state);
      }
      return { status: 'pending', pending, changes: [], review: state.review };
    }
    if (retireSamples)
      for (const item of existing)
        if (item.sample && byDate.get(item.briefingDate)?.sample) {
          entries.set(item.briefingDate, {
            date: item.briefingDate,
            source: null,
          });
          byDate.delete(item.briefingDate);
        }
    validateCollection([...byDate.values()]);
    next.pending = [];
    next.review = undefined;
    next.missingDates = [
      ...new Set([
        ...(state.missingDates ?? []),
        ...(input.missingDates ?? []),
      ]),
    ]
      .filter((date) => !byDate.has(date))
      .sort((a, b) => a.localeCompare(b));
    if (entries.size) {
      next.publication = {
        ...state.publication,
        stage: 'archived',
        failedStage: null,
      };
      await commitBatch(root, [...entries.values()], next, { interruptAfter });
    } else if (JSON.stringify(next) !== originalState)
      await saveState(root, next);
    return {
      status: entries.size
        ? 'archived'
        : JSON.stringify(next) === originalState
          ? 'unchanged'
          : 'reconciled',
      changes,
      pending: [],
      review: undefined,
      missingDates: next.missingDates,
    };
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--unlock')) await unlockAbandoned('.');
    else if (args.includes('--recover'))
      await withArchiveLock('.', () => recoverBatch('.'));
    else {
      const file = args.find((arg) => !arg.startsWith('--'));
      if (!file)
        throw new Error(
          'Usage: npm run archive:sync -- <source-export.json> [--accept-revisions] [--retire-samples]',
        );
      const hasReviewId = args.some(
        (arg, index) =>
          arg === '--review-id' ||
          arg.startsWith('--review-id=') ||
          (index > 0 && args[index - 1] === '--review-id'),
      );
      if (args.includes('--accept-revisions') && !hasReviewId)
        throw new Error('REVIEW_ID_REQUIRED');
      const result = await syncArchive(await readSourceExport(file), {
        acceptRevisions: args.includes('--accept-revisions'),
        retireSamples: args.includes('--retire-samples'),
        reviewId:
          args.find((arg) => arg.startsWith('--review-id='))?.slice(12) ||
          args[args.indexOf('--review-id') + 1],
        sourceCommit: args
          .find((arg) => arg.startsWith('--source-commit='))
          ?.slice(16),
      });
      if (result.status !== 'unchanged')
        console.log(
          JSON.stringify(
            {
              ...result,
              pending: result.pending.map(({ date, code }) => ({ date, code })),
            },
            null,
            2,
          ),
        );
      if (result.status === 'pending') process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
