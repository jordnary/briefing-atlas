import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifySyncStatus,
  renderReviewMarkdown,
  sanitizeReviewText,
  writeReviewReport,
  writeWorkflowReport,
} from '../scripts/archive-review.mjs';

const review = {
  date: '2026-09-08',
  kind: 'source',
  beforeRevision: 3,
  changedStories: ['briefing-2026-09-08-01'],
  before: {
    title: '旧标题',
    intro: '旧导语',
    outro: '旧结语',
    stories: [
      { id: 'briefing-2026-09-08-01', title: '旧故事', body: '旧正文' },
    ],
  },
  after: {
    title: '新标题',
    intro: '新导语',
    outro: '新结语',
    stories: [
      { id: 'briefing-2026-09-08-01', title: '新故事', body: '新正文' },
    ],
  },
};

test('renders a readable bounded Markdown diff and redacts sensitive values', () => {
  const markdown = renderReviewMarkdown({
    ...review,
    after: {
      ...review.after,
      stories: [
        {
          ...review.after.stories[0],
          body: 'Token ghp_abc123 and https://user:pass@example.org/private at C:\\Users\\local\\secret.txt',
        },
      ],
    },
  });
  assert.match(markdown, /# Archive review: 2026-09-08/);
  assert.match(markdown, /Before title/);
  assert.match(markdown, /After body/);
  assert.match(markdown, /\[redacted-secret\]/);
  assert.match(markdown, /\[redacted-credential-url\]/);
  assert.match(markdown, /\[redacted-path\]/);
  assert.doesNotMatch(markdown, /ghp_abc123|user:pass|C:\\\\Users/);
});

test('classifies unchanged, pending, conflict, failure and success states', () => {
  assert.equal(classifySyncStatus({ status: 'unchanged' }), 'unchanged');
  assert.equal(
    classifySyncStatus({
      status: 'pending',
      pending: [{ code: 'REVISION_REVIEW_REQUIRED' }],
      syncOutcome: 'failure',
    }),
    'pending',
  );
  assert.equal(
    classifySyncStatus({
      status: 'pending',
      pending: [{ code: 'SAME_DATE_CONFLICT' }],
    }),
    'conflict',
  );
  assert.equal(
    classifySyncStatus({ error: 'BUILD_FAILED', exitCode: 1 }),
    'failure',
  );
  assert.equal(classifySyncStatus({ status: 'archived' }), 'success');
  assert.equal(classifySyncStatus({ status: 'reconciled' }), 'success');
  assert.equal(
    classifySyncStatus({
      stateOutcome: 'failure',
      error: 'CLOUD_CHECKPOINT_CONTENT_CONFLICT',
    }),
    'conflict',
  );
  assert.equal(
    classifySyncStatus({
      stateOutcome: 'failure',
      error: 'CLOUD_STATE_UNAVAILABLE',
    }),
    'failure',
  );
});

test('writes review report with restrictive permissions and stable contents', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'review.json');
  const output = path.join(root, 'reports', 'review.md');
  await writeFile(input, JSON.stringify(review));
  const markdown = await writeReviewReport({ input, output });
  assert.equal(await readFile(output, 'utf8'), `${markdown}\n`);
  assert.match(markdown, /Story differences/);
});

test('workflow report includes status and next action without exposing file names', async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'archive-workflow-review-'),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'last-run.json'),
    JSON.stringify({
      status: 'pending',
      pending: [{ date: '2026-09-08', code: 'REVISION_REVIEW_REQUIRED' }],
    }),
  );
  await writeFile(
    path.join(root, 'review-2026-09-08.json'),
    JSON.stringify(review),
  );
  const output = path.join(root, 'review-report.md');
  const markdown = await writeWorkflowReport({
    root,
    output,
    status: 'pending',
    syncOutcome: 'failure',
  });
  assert.match(markdown, /Status: \*\*PENDING\*\*/);
  assert.match(markdown, /Next action:/);
  assert.match(markdown, /Archive review: 2026-09-08/);
  assert.doesNotMatch(markdown, /review-2026-09-08\.json/);
});

test('sanitizes and bounds arbitrary text', () => {
  const value = sanitizeReviewText(
    `${'x'.repeat(1500)} https://example.org`,
    100,
  );
  assert.ok(value.length <= 101);
  assert.doesNotMatch(value, /https:\/\//);
});
