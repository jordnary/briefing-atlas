import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';

const MAX_TEXT = 1200;
const ABSOLUTE_PATH =
  /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|workspace|runner)\b)[^\s]*/g;
const CREDENTIAL_URL = /\bhttps?:\/\/[^\s/]+(?::[^\s/@]+)?@[^\s]+/gi;
const URL = /\bhttps?:\/\/[^\s)]+/gi;
const TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+|(?:token|secret|password|authorization)\s*[=:]\s*[^\s,;]+)/gi;

/** Keep report text useful while removing host-specific and credential material. */
export function sanitizeReviewText(value, max = MAX_TEXT) {
  if (value == null) return '';
  let text = String(value)
    .replace(CREDENTIAL_URL, '[redacted-credential-url]')
    .replace(TOKEN, '[redacted-secret]')
    .replace(ABSOLUTE_PATH, '[redacted-path]')
    .replace(URL, '[redacted-url]');
  text = text.replace(/```/g, "'''").trim();
  if (text.length > max) text = `${text.slice(0, max)}…`;
  return text;
}

function markdownCell(value) {
  return sanitizeReviewText(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function storyMap(review, side) {
  const stories = review?.[side]?.stories;
  return Array.isArray(stories) ? stories : [];
}

/** Render one review JSON object as a bounded, safe Markdown diff report. */
export function renderReviewMarkdown(review) {
  if (!review || typeof review !== 'object')
    throw new Error('REVIEW_JSON_INVALID');
  const date = typeof review.date === 'string' ? review.date : 'unknown-date';
  const kind = typeof review.kind === 'string' ? review.kind : 'unknown';
  const beforeRevision = Number.isInteger(review.beforeRevision)
    ? review.beforeRevision
    : 'unknown';
  const changed = Array.isArray(review.changedStories)
    ? review.changedStories.map(String)
    : [];
  const beforeStories = storyMap(review, 'before');
  const afterStories = storyMap(review, 'after');
  const afterById = new Map(
    afterStories.map((story) => [String(story.id), story]),
  );
  const beforeById = new Map(
    beforeStories.map((story) => [String(story.id), story]),
  );
  const ids = [
    ...new Set([...changed, ...beforeById.keys(), ...afterById.keys()]),
  ];
  const lines = [
    `# Archive review: ${markdownCell(date)}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Change type | ${markdownCell(kind)} |`,
    `| Previous revision | ${markdownCell(beforeRevision)} |`,
    `| Changed stories | ${changed.length ? changed.map(markdownCell).join(', ') : 'none'} |`,
    '',
    '## Overview',
    '',
    `**Before title:** ${markdownCell(review.before?.title) || '(empty)'}`,
    '',
    `**After title:** ${markdownCell(review.after?.title) || '(empty)'}`,
    '',
    `**Before intro:** ${markdownCell(review.before?.intro) || '(empty)'}`,
    '',
    `**After intro:** ${markdownCell(review.after?.intro) || '(empty)'}`,
    '',
    `**Before outro:** ${markdownCell(review.before?.outro) || '(empty)'}`,
    '',
    `**After outro:** ${markdownCell(review.after?.outro) || '(empty)'}`,
    '',
    '## Story differences',
    '',
  ];
  if (!ids.length) lines.push('_No story-level differences recorded._', '');
  for (const id of ids) {
    const before = beforeById.get(id);
    const after = afterById.get(id);
    lines.push(`### Story ${markdownCell(id)}`, '');
    lines.push(
      `**Before title:** ${markdownCell(before?.title) || '(missing)'}`,
      '',
    );
    lines.push(
      `**After title:** ${markdownCell(after?.title) || '(missing)'}`,
      '',
    );
    lines.push(
      '',
      '**Before body**',
      '',
      '```text',
      sanitizeReviewText(before?.body),
      '```',
      '',
    );
    lines.push(
      '**After body**',
      '',
      '```text',
      sanitizeReviewText(after?.body),
      '```',
      '',
    );
  }
  lines.push(
    '---',
    '',
    '_Generated from a private review record; URLs, credentials and local paths are redacted._',
    '',
  );
  return lines.join('\n');
}

/** Classify workflow-visible state into the stable five-state vocabulary. */
export function classifySyncStatus({
  status,
  pending = [],
  error,
  exitCode,
  stateOutcome,
  syncOutcome,
  validateOutcome,
} = {}) {
  const normalized = typeof status === 'string' ? status.toLowerCase() : '';
  const entries = Array.isArray(pending) ? pending : [];
  const codes = entries.map((item) => String(item?.code ?? '').toUpperCase());
  if (normalized === 'unchanged') return 'unchanged';
  if (
    codes.some((code) => code.includes('CONFLICT')) ||
    String(error || '')
      .toUpperCase()
      .includes('CONFLICT')
  )
    return 'conflict';
  if (normalized === 'pending' || entries.length || Number(exitCode) === 2)
    return 'pending';
  if (
    validateOutcome === 'failure' ||
    syncOutcome === 'failure' ||
    stateOutcome === 'failure' ||
    error ||
    (exitCode != null && Number(exitCode) !== 0)
  )
    return 'failure';
  if (['archived', 'reconciled', 'success', 'verified'].includes(normalized))
    return 'success';
  return normalized ? 'failure' : 'pending';
}

export const nextActionForStatus = (status) =>
  ({
    unchanged: 'No publication is needed. Keep the current Pages deployment.',
    pending:
      'Review the attached report, then rerun with accept_revisions enabled.',
    conflict:
      'Resolve the checkpoint or date conflict manually; no files were published.',
    failure:
      'Inspect the failed step and rerun after correcting the reported error.',
    success: 'Continue with site validation and Pages publication.',
  })[status] ?? 'Inspect the workflow logs before taking action.';

export async function readReviewFile(file) {
  let value;
  try {
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw new Error('REVIEW_JSON_TOO_LARGE');
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.message === 'REVIEW_JSON_TOO_LARGE') throw error;
    throw new Error('REVIEW_JSON_INVALID');
  }
  return value;
}

export async function writeReviewReport({
  root = 'work/archive-sync',
  output,
  status,
  syncOutcome,
  stateOutcome,
  validateOutcome,
  error,
  exitCode,
  runId,
  input,
} = {}) {
  let lastRun = {};
  try {
    lastRun = JSON.parse(
      await readFile(path.join(root, 'last-run.json'), 'utf8'),
    );
  } catch {
    /* The workflow may fail before sync writes last-run.json. */
  }
  const effectiveStatus = classifySyncStatus({
    status: status || lastRun.status,
    pending: lastRun.pending,
    error,
    exitCode,
    stateOutcome,
    syncOutcome,
    validateOutcome,
  });
  let files = [];
  try {
    files = (await readdir(root))
      .filter((name) => /^review-[^/]+\.json$/.test(name))
      .sort();
  } catch {
    /* No review records is valid for unchanged and failed runs. */
  }
  if (input && !files.length) files = [path.basename(input)];
  const lines = [
    '# Archive sync review',
    '',
    `- Status: **${effectiveStatus.toUpperCase()}**`,
    `- Run: ${markdownCell(runId || process.env.GITHUB_RUN_ID || 'local')}`,
    `- Next action: ${nextActionForStatus(effectiveStatus)}`,
    '',
  ];
  if (files.length) {
    lines.push(`## Review records (${files.length})`, '');
    for (const file of files) {
      try {
        const fullPath =
          input && files.length === 1 ? input : path.join(root, file);
        lines.push(
          `<!-- ${path.basename(file)} -->`,
          renderReviewMarkdown(await readReviewFile(fullPath)),
          '',
        );
      } catch {
        lines.push(
          `- ${path.basename(file)}: unable to read review record safely.`,
          '',
        );
      }
    }
  } else lines.push('_No revision diff records were generated._', '');
  lines.push(
    '---',
    '',
    '_Review excerpts are bounded; URLs, credentials and local paths are redacted._',
    '',
  );
  const markdown = lines.join('\n');
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, `${markdown}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return markdown;
}

/** Build the workflow summary and append every review JSON in a private directory. */
export async function writeWorkflowReport({
  root = '.',
  output,
  status,
  syncOutcome,
  stateOutcome,
  validateOutcome,
  errorCode,
} = {}) {
  let run = null;
  try {
    run = JSON.parse(await readFile(path.join(root, 'last-run.json'), 'utf8'));
  } catch {
    // A failed validation can happen before last-run.json exists.
  }
  const classified = classifySyncStatus({
    status: status || run?.status,
    pending: run?.pending,
    stateOutcome,
    syncOutcome,
    validateOutcome,
    error: errorCode,
  });
  const lines = [
    '# Archive sync report',
    '',
    `- Status: **${classified.toUpperCase()}**`,
    `- Next action: ${nextActionForStatus(classified)}`,
  ];
  if (Array.isArray(run?.pending) && run.pending.length) {
    const codes = run.pending
      .map((item) => String(item?.code || 'UNKNOWN'))
      .filter((code) => /^[A-Z][A-Z0-9_]+$/.test(code));
    if (codes.length) lines.push(`- Pending checks: ${codes.join(', ')}`);
  }
  const files = (await readdir(root).catch(() => []))
    .filter((name) => /^review-[^/]+\.json$/i.test(name))
    .sort();
  for (const file of files) {
    try {
      lines.push(
        '',
        renderReviewMarkdown(await readReviewFile(path.join(root, file))),
      );
    } catch {
      lines.push('', `> A review record could not be rendered safely.`);
    }
  }
  lines.push(
    '',
    '---',
    '',
    '_Sensitive URLs, credentials and local paths are redacted._',
    '',
  );
  const markdown = lines.join('\n');
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, markdown, { encoding: 'utf8', mode: 0o600 });
  }
  return markdown;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    let input;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      const match = /^(--[a-z-]+)=(.*)$/.exec(arg);
      const key = match?.[1] || arg;
      const value = match ? match[2] : args[index + 1];
      if (
        key === '--root' ||
        key === '--output' ||
        key === '--status' ||
        key === '--sync-outcome' ||
        key === '--state-outcome' ||
        key === '--validate-outcome' ||
        key === '--error-code'
      ) {
        options[key.slice(2).replaceAll('-', '_')] = value;
        if (!match) index += 1;
      } else if (!arg.startsWith('--') && input === undefined) input = arg;
    }
    const root = options.root || '.';
    const output = options.output;
    const markdown = input
      ? await writeReviewReport({ input, output })
      : await writeWorkflowReport({
          root,
          output,
          status: options.status,
          syncOutcome: options.sync_outcome,
          stateOutcome: options.state_outcome,
          validateOutcome: options.validate_outcome,
          errorCode: options.error_code,
        });
    if (!output) process.stdout.write(`${markdown}\n`);
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
