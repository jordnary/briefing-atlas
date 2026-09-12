import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncArchive } from '../scripts/archive-sync.mjs';
import { hash } from '../scripts/archive-convert.mjs';
import { parseBriefing } from '../scripts/content.mjs';
import {
  contentFile,
  readState,
  saveState,
} from '../scripts/archive-store.mjs';
import {
  publishArchive,
  archiveVersion,
} from '../scripts/archive-publication.mjs';

const now = '2026-09-08T10:00:00.000Z';
const sourceCommit = 'a'.repeat(40);
const nextSourceCommit = 'b'.repeat(40);
const message = (date = '2026-09-08', body = 'Original body.') => ({
  messageId: `message-${date}`,
  role: 'assistant',
  status: 'completed',
  complete: true,
  briefingDate: date,
  text: `# AI & Tech Briefing · ${date}\n\n## 1. Story\n\n${body}\n`,
});
const batch = (messages) => ({
  version: 1,
  source: 'approval-fixture',
  complete: true,
  messages,
  missingDates: [],
});
const pin = (input, commit = sourceCommit) => ({
  sourceCommit: commit,
  exportSha256: hash(JSON.stringify(input)),
});

async function fixture(t, { includeNewIssue = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-approval-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = batch([message()]);
  await syncArchive(original, { root, now, ...pin(original) });
  const file = contentFile(root, '2026-09-08');
  const before = await readFile(file, 'utf8');
  const revision = batch([
    message('2026-09-08', 'Reviewed replacement body.'),
    ...(includeNewIssue ? [message('2026-09-09')] : []),
  ]);
  const options = { root, now, ...pin(revision, nextSourceCommit) };
  return { root, file, before, revision, options };
}

async function preview(data) {
  const result = await syncArchive(data.revision, data.options);
  assert.equal(result.status, 'pending');
  assert.equal(result.pending[0].code, 'REVISION_REVIEW_REQUIRED');
  assert.match(result.review.id, /^[a-f0-9]{64}$/);
  return result.review;
}

test('revision preview binds a review ID and leaves the whole archive unpublished', async (t) => {
  const data = await fixture(t, { includeNewIssue: true });
  const beforeState = await readState(data.root);
  const review = await preview(data);
  assert.equal(review.sourceCommit, data.options.sourceCommit);
  assert.equal(review.exportSha256, data.options.exportSha256);
  assert.match(review.inputHash, /^[a-f0-9]{64}$/);
  assert.match(review.checkpointVersion, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(review.converterVersion));
  assert.equal(Date.parse(review.createdAt), Date.parse(now));
  assert.equal(
    Date.parse(review.expiresAt) - Date.parse(review.createdAt),
    7 * 24 * 60 * 60 * 1000,
  );
  assert.equal(await readFile(data.file, 'utf8'), data.before);
  await assert.rejects(
    readFile(contentFile(data.root, '2026-09-09')),
    /ENOENT/,
  );
  const afterState = await readState(data.root);
  assert.deepEqual(afterState.records, beforeState.records);
  assert.deepEqual(afterState.publication, beforeState.publication);
  assert.deepEqual(afterState.review, review);
  let calls = 0;
  const adapter = async () => {
    calls += 1;
  };
  await assert.rejects(
    publishArchive({
      root: data.root,
      build: adapter,
      deploy: adapter,
      verify: adapter,
    }),
    /RESOLVE_PENDING_BEFORE_PUBLICATION/,
  );
  assert.equal(calls, 0);
});

test('an approved review applies the reviewed batch once and permits publication', async (t) => {
  const data = await fixture(t, { includeNewIssue: true });
  const review = await preview(data);
  const result = await syncArchive(data.revision, {
    ...data.options,
    reviewId: review.id,
    acceptRevisions: true,
  });
  assert.equal(result.status, 'archived');
  const issue = parseBriefing(await readFile(data.file, 'utf8'));
  assert.equal(issue.revision, 2);
  assert.match(issue.stories[0].body, /Reviewed replacement body/);
  assert.equal(issue.corrections.length, 1);
  assert.equal(
    parseBriefing(await readFile(contentFile(data.root, '2026-09-09'), 'utf8'))
      .revision,
    1,
  );
  const state = await readState(data.root);
  assert.deepEqual(state.pending, []);
  assert.ok(!state.review);
  const publicCommit = 'b'.repeat(40);
  state.sourceCommit = data.options.sourceCommit;
  state.checkpointBinding = {
    commit: publicCommit,
    archiveVersion: await archiveVersion(data.root),
    sourceCommit: state.sourceCommit,
  };
  state.publication = { stage: 'archived', binding: state.checkpointBinding };
  await saveState(data.root, state);
  const stages = [];
  const published = await publishArchive({
    root: data.root,
    gitCommit: publicCommit,
    build: async () => {
      stages.push('build');
    },
    deploy: async () => {
      stages.push('deploy');
      return { id: 'approved-receipt', url: 'https://example.org/' };
    },
    verify: async () => {
      stages.push('verify');
      return true;
    },
  });
  assert.equal(published.status, 'verified');
  assert.deepEqual(stages, ['build', 'deploy', 'verify']);
  await assert.rejects(
    syncArchive(data.revision, {
      ...data.options,
      reviewId: review.id,
      acceptRevisions: true,
    }),
    /REVIEW_NOT_FOUND/,
  );
  assert.equal(parseBriefing(await readFile(data.file, 'utf8')).revision, 2);
});

test('a superseded or incorrect review ID cannot approve newer pending content', async (t) => {
  const data = await fixture(t);
  const oldReview = await preview(data);
  await assert.rejects(
    syncArchive(data.revision, {
      ...data.options,
      reviewId: '0'.repeat(64),
      acceptRevisions: true,
    }),
    /REVIEW_ID_MISMATCH/,
  );
  const nextRevision = batch([
    message('2026-09-08', 'A newer replacement body.'),
  ]);
  const nextOptions = { ...data.options, ...pin(nextRevision, 'c'.repeat(40)) };
  const latest = await syncArchive(nextRevision, nextOptions);
  assert.notEqual(latest.review.id, oldReview.id);
  await assert.rejects(
    syncArchive(nextRevision, {
      ...nextOptions,
      reviewId: oldReview.id,
      acceptRevisions: true,
    }),
    /REVIEW_ID_MISMATCH/,
  );
  assert.equal(await readFile(data.file, 'utf8'), data.before);
});

test('reviews expire after seven days without changing public content', async (t) => {
  const data = await fixture(t);
  const review = await preview(data);
  await assert.rejects(
    syncArchive(data.revision, {
      ...data.options,
      now: review.expiresAt,
      reviewId: review.id,
      acceptRevisions: true,
    }),
    /REVIEW_EXPIRED/,
  );
  assert.equal(await readFile(data.file, 'utf8'), data.before);
});

test('approval revalidates the source commit and exact exported bytes', async (t) => {
  const data = await fixture(t);
  const review = await preview(data);
  for (const [field, value, expected] of [
    ['sourceCommit', 'c'.repeat(40), /REVIEW_SOURCE_COMMIT_MISMATCH/],
    ['exportSha256', 'c'.repeat(64), /REVIEW_EXPORT_MISMATCH/],
  ]) {
    await assert.rejects(
      syncArchive(data.revision, {
        ...data.options,
        [field]: value,
        reviewId: review.id,
        acceptRevisions: true,
      }),
      expected,
    );
    assert.equal(await readFile(data.file, 'utf8'), data.before);
  }
});

test('approval rejects changed source data even if supplied commit and export pins match', async (t) => {
  const data = await fixture(t);
  const review = await preview(data);
  const altered = batch([message('2026-09-08', 'Unreviewed body.')]);
  await assert.rejects(
    syncArchive(altered, {
      ...data.options,
      reviewId: review.id,
      acceptRevisions: true,
    }),
    /REVIEW_INPUT_MISMATCH/,
  );
  assert.equal(await readFile(data.file, 'utf8'), data.before);
});

test('checkpoint and converter changes invalidate an otherwise matching review', async (t) => {
  const data = await fixture(t);
  const review = await preview(data);
  await assert.rejects(
    syncArchive(data.revision, {
      ...data.options,
      reviewId: review.id,
      acceptRevisions: true,
      converterVersion: review.converterVersion + 1,
    }),
    /REVIEW_CONVERTER_MISMATCH/,
  );
  const state = await readState(data.root);
  state.publication.failedStage = 'build';
  await saveState(data.root, state);
  await assert.rejects(
    syncArchive(data.revision, {
      ...data.options,
      reviewId: review.id,
      acceptRevisions: true,
    }),
    /REVIEW_CHECKPOINT_MISMATCH/,
  );
  assert.equal(await readFile(data.file, 'utf8'), data.before);
});

test('concurrent approvals consume a review only once', async (t) => {
  const data = await fixture(t);
  const review = await preview(data);
  const options = {
    ...data.options,
    reviewId: review.id,
    acceptRevisions: true,
  };
  const results = await Promise.allSettled([
    syncArchive(data.revision, options),
    syncArchive(data.revision, options),
  ]);
  const succeeded = results.filter((result) => result.status === 'fulfilled');
  const failed = results.filter((result) => result.status === 'rejected');
  assert.equal(succeeded.length, 1);
  assert.equal(succeeded[0].value.status, 'archived');
  assert.equal(failed.length, 1);
  assert.match(failed[0].reason.message, /^(ARCHIVE_LOCKED|REVIEW_NOT_FOUND)$/);
  const issue = parseBriefing(await readFile(data.file, 'utf8'));
  assert.equal(issue.revision, 2);
  assert.equal(issue.corrections.length, 1);
});

test('legacy blanket acceptance cannot bypass a specific human review', async (t) => {
  const data = await fixture(t);
  await assert.rejects(
    syncArchive(data.revision, { ...data.options, acceptRevisions: true }),
    /REVIEW_ID_REQUIRED/,
  );
  assert.equal(await readFile(data.file, 'utf8'), data.before);
  await preview(data);
  await assert.rejects(
    syncArchive(data.revision, { ...data.options, acceptRevisions: true }),
    /REVIEW_ID_REQUIRED/,
  );
  assert.equal(await readFile(data.file, 'utf8'), data.before);
});
