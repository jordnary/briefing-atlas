import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, rename, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { isDate } from '../lib/domain.mjs';
import { readSourceExport } from './archive-input.mjs';
import { readMaybe } from './archive-store.mjs';
import { syncArchive } from './archive-sync.mjs';
import { fetchSource } from './fetch-source.mjs';

const exec = promisify(execFile);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Consume an already checked-out private source snapshot without running its code. */
export async function consumeSourceSnapshot(
  sourceRoot,
  {
    exportFile = 'work/source-export.json',
    expectedCommit,
    expectedExportSha256,
  } = {},
) {
  const git = async (...args) => {
    try {
      return (
        await exec('git', args, {
          cwd: sourceRoot,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000,
        })
      ).stdout;
    } catch {
      throw new Error('SOURCE_GIT_FAILED');
    }
  };
  if (!expectedCommit || !/^[0-9a-f]{40}$/.test(expectedCommit))
    throw new Error('SOURCE_COMMIT_REQUIRED');
  if (!expectedExportSha256 || !/^[0-9a-f]{64}$/.test(expectedExportSha256))
    throw new Error('SOURCE_EXPORT_HASH_REQUIRED');
  if (
    typeof exportFile !== 'string' ||
    !exportFile ||
    /[\\:]/.test(exportFile) ||
    exportFile.includes('\0') ||
    exportFile.startsWith('/') ||
    exportFile.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('SOURCE_EXPORT_PATH_INVALID');
  if ((await git('rev-parse', '--show-prefix')).trim())
    throw new Error('SOURCE_ROOT_INVALID');
  const commit = (await git('rev-parse', 'HEAD')).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('SOURCE_COMMIT_INVALID');
  if (expectedCommit && commit !== expectedCommit)
    throw new Error('SOURCE_COMMIT_MISMATCH');
  const assertClean = async () => {
    const status = await git(
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
    );
    // A freshly generated export may be untracked; tracked edits still fail.
    if (status.split('\0').some((line) => line && line !== `?? ${exportFile}`))
      throw new Error('SOURCE_CHECKOUT_DIRTY');
  };
  await assertClean();
  // Inspect the committed tree, rather than trusting the checkout filesystem.
  // .gitkeep is a permitted placeholder in an otherwise empty month directory.
  const tree = await git('ls-tree', '-r', '-z', commit, '--', 'briefings');
  const entries = tree
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const meta = line.slice(0, tab).split(' ');
      return {
        mode: meta[0],
        type: meta[1],
        object: meta[2],
        name: line.slice(tab + 1),
      };
    });
  for (const entry of entries)
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
      throw new Error('SOURCE_TREE_ENTRY_INVALID');
  const names = entries.filter(({ name }) => !/(^|\/)\.gitkeep$/.test(name));
  if (!names.length) throw new Error('SOURCE_BRIEFINGS_MISSING');
  const messages = [];
  let source;
  const missingDates = new Set();
  const ids = new Set();
  for (const { name, object } of names) {
    if (!/^briefings\/20\d{2}\/\d{2}\/20\d{2}-\d{2}-\d{2}\.json$/.test(name))
      throw new Error('SOURCE_PATH_DATE_MISMATCH');
    let data;
    try {
      const raw = await git('cat-file', 'blob', object);
      if (Buffer.byteLength(raw) > 5 * 1024 * 1024)
        throw new Error('SOURCE_FILE_SIZE_LIMIT');
      data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('SOURCE_JSON_INVALID');
    }
    if (
      !data ||
      data.version !== 1 ||
      data.complete !== true ||
      typeof data.source !== 'string' ||
      !data.source ||
      !Array.isArray(data.messages) ||
      data.messages.length !== 1
    )
      throw new Error('SOURCE_DAILY_EXPORT_INVALID');
    const message = data.messages[0];
    const date = message?.briefingDate;
    if (
      !isDate(date) ||
      !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
      name !== `briefings/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.json`
    )
      throw new Error('SOURCE_PATH_DATE_MISMATCH');
    if (
      typeof message.messageId !== 'string' ||
      !message.messageId ||
      message.role !== 'assistant' ||
      message.status !== 'completed' ||
      message.complete !== true ||
      typeof message.text !== 'string' ||
      !message.text.trim()
    )
      throw new Error('SOURCE_DAILY_EXPORT_INVALID');
    if (ids.has(message.messageId))
      throw new Error('SOURCE_DUPLICATE_MESSAGE_ID');
    ids.add(message.messageId);
    if (
      data.source.startsWith('example-') ||
      message.messageId.startsWith('example-')
    )
      throw new Error('SOURCE_EXAMPLE_NOT_PUBLISHABLE');
    if (
      data.missingDates !== undefined &&
      (!Array.isArray(data.missingDates) ||
        !data.missingDates.every(
          (d) => isDate(d) && /^20\d{2}-\d{2}-\d{2}$/.test(d),
        ) ||
        new Set(data.missingDates).size !== data.missingDates.length)
    )
      throw new Error('SOURCE_MISSING_DATES_INVALID');
    if (source && source !== data.source)
      throw new Error('SOURCE_MIXED_THREADS');
    source = data.source;
    messages.push(message);
    for (const missing of data.missingDates ?? []) missingDates.add(missing);
  }
  messages.sort((a, b) => a.briefingDate.localeCompare(b.briefingDate));
  const value = {
    version: 1,
    source,
    complete: true,
    messages,
    missingDates: [...missingDates]
      .filter((d) => !messages.some((m) => m.briefingDate === d))
      .sort((a, b) => a.localeCompare(b)),
  };
  const exportPath = path.resolve(sourceRoot, exportFile);
  let exported;
  try {
    let current = path.resolve(sourceRoot);
    for (const part of exportFile.split('/')) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('SOURCE_EXPORT_SYMLINK');
    }
    if ((await lstat(exportPath)).size > 10 * 1024 * 1024)
      throw new Error('SOURCE_EXPORT_TOO_LARGE');
    exported = await readFile(exportPath, 'utf8');
  } catch (error) {
    if (error.message.startsWith('SOURCE_EXPORT_')) throw error;
    throw new Error('SOURCE_EXPORT_MISSING');
  }
  if (expectedExportSha256 && sha256(exported) !== expectedExportSha256)
    throw new Error('SOURCE_EXPORT_HASH_MISMATCH');
  let parsed;
  try {
    parsed = JSON.parse(exported);
  } catch {
    throw new Error('SOURCE_EXPORT_INVALID');
  }
  if (!isDeepStrictEqual(parsed, value))
    throw new Error('SOURCE_EXPORT_OUT_OF_DATE');
  if ((await git('rev-parse', 'HEAD')).trim() !== commit)
    throw new Error('SOURCE_COMMIT_MISMATCH');
  await assertClean();
  return { data: value, commit, exportSha256: sha256(exported) };
}
export async function syncFromGitHub({ root = '.', input, ...options } = {}) {
  const output =
    input ||
    options.output ||
    process.env.SOURCE_OUTPUT ||
    'incoming/source-export.json';
  const outputPath = path.resolve(root, output);
  const relativeOutput = path
    .relative(path.resolve(root), outputPath)
    .split(path.sep)
    .join('/');
  const reportOutput =
    relativeOutput.startsWith('../') || path.isAbsolute(relativeOutput)
      ? '[private-export]'
      : relativeOutput;
  let fetched;
  if (options.sourceRoot) {
    const snapshot = await consumeSourceSnapshot(
      path.resolve(root, options.sourceRoot),
      options,
    );
    const serialized = `${JSON.stringify(snapshot.data, null, 2)}\n`;
    const previous = await readMaybe(outputPath);
    if (previous !== serialized) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(`${outputPath}.tmp`, serialized, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(`${outputPath}.tmp`, outputPath);
    }
    fetched = {
      downloaded: previous !== serialized,
      output: reportOutput,
      commit: snapshot.commit,
      exportSha256: snapshot.exportSha256,
    };
  } else if (input) fetched = { downloaded: false, output: reportOutput };
  else {
    fetched = await fetchSource({ ...options, output: outputPath });
    fetched.output = reportOutput;
  }
  const result = await syncArchive(await readSourceExport(outputPath), {
    root,
    acceptRevisions: false,
    retireSamples: false,
  });
  const report = {
    status: result.status,
    changes: result.changes || [],
    pending: result.pending || [],
    fetched,
  };
  const reportFile = path.join(root, 'work/archive-sync/last-run.json');
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const arg = process.argv.slice(2).find((x) => !x.startsWith('--'));
    const sourceRoot = process.env.SOURCE_DIRECTORY;
    const result = await syncFromGitHub({
      input: arg,
      sourceRoot,
      expectedCommit: process.env.SOURCE_COMMIT,
      expectedExportSha256: process.env.SOURCE_EXPORT_SHA256,
    });
    console.log(`Source sync: ${result.status}.`);
    if (result.status === 'pending') process.exitCode = 2;
  } catch (error) {
    const code = error.code || error.message;
    console.error(
      typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)
        ? code
        : 'SOURCE_SYNC_FAILED',
    );
    process.exitCode = 1;
  }
}
