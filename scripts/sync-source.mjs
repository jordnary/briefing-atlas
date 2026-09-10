import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readSourceExport } from './archive-input.mjs';
import { syncArchive } from './archive-sync.mjs';
import { fetchSource } from './fetch-source.mjs';

const exec = promisify(execFile);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Consume an already checked-out private source snapshot without running its code. */
export async function consumeSourceSnapshot(
  sourceRoot,
  { exportFile = 'work/source-export.json', expectedCommit, expectedExportSha256 } = {},
) {
  const git = async (...args) => (await exec('git', args, { cwd: sourceRoot })).stdout.trim();
  const commit = await git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('SOURCE_COMMIT_INVALID');
  if (expectedCommit && commit !== expectedCommit) throw new Error('SOURCE_COMMIT_MISMATCH');
  const status = await git('status', '--porcelain');
  if (status) throw new Error('SOURCE_CHECKOUT_DIRTY');
  const names = (await git('ls-tree', '-r', '--name-only', commit, '--', 'briefings'))
    .split('\n').filter(Boolean);
  if (!names.length) throw new Error('SOURCE_BRIEFINGS_MISSING');
  const messages = [];
  let source;
  const missingDates = new Set();
  for (const name of names) {
    if (!/^briefings\/20\d{2}\/\d{2}\/20\d{2}-\d{2}-\d{2}\.json$/.test(name))
      throw new Error('SOURCE_PATH_DATE_MISMATCH');
    const file = path.join(sourceRoot, name);
    let data;
    try { data = JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('SOURCE_JSON_INVALID'); }
    if (!data || data.version !== 1 || data.complete !== true || !Array.isArray(data.messages) || data.messages.length !== 1)
      throw new Error('SOURCE_DAILY_EXPORT_INVALID');
    const message = data.messages[0];
    const date = message.briefingDate;
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || name !== `briefings/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.json`)
      throw new Error('SOURCE_PATH_DATE_MISMATCH');
    if (source && source !== data.source) throw new Error('SOURCE_MIXED_THREADS');
    source = data.source;
    messages.push(message);
    for (const missing of data.missingDates ?? []) missingDates.add(missing);
  }
  messages.sort((a, b) => a.briefingDate.localeCompare(b.briefingDate));
  const value = { version: 1, source, complete: true, messages, missingDates: [...missingDates].filter((d) => !messages.some((m) => m.briefingDate === d)).sort((a, b) => a.localeCompare(b)) };
  const exportPath = path.resolve(sourceRoot, exportFile);
  let exported;
  try { exported = await readFile(exportPath, 'utf8'); } catch { throw new Error('SOURCE_EXPORT_MISSING'); }
  if (expectedExportSha256 && sha256(exported) !== expectedExportSha256) throw new Error('SOURCE_EXPORT_HASH_MISMATCH');
  let parsed;
  try { parsed = JSON.parse(exported); } catch { throw new Error('SOURCE_EXPORT_INVALID'); }
  if (JSON.stringify(parsed) !== JSON.stringify(value)) throw new Error('SOURCE_EXPORT_OUT_OF_DATE');
  return { data: value, commit, exportSha256: sha256(exported) };
}
export async function syncFromGitHub({ root='.', input, ...options } = {}) {
  const output = input || options.output || process.env.SOURCE_OUTPUT || 'incoming/source-export.json';
  let fetched;
  if (options.sourceRoot) {
    const snapshot = await consumeSourceSnapshot(options.sourceRoot, options);
    const serialized = `${JSON.stringify(snapshot.data, null, 2)}\n`;
    const destination = path.resolve(root, output);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(`${destination}.tmp`, serialized, 'utf8');
    await rename(`${destination}.tmp`, destination);
    fetched = { downloaded: true, output, commit: snapshot.commit, exportSha256: snapshot.exportSha256 };
  } else fetched = input ? { downloaded: false, output } : await fetchSource({ ...options, output });
  const result = await syncArchive(await readSourceExport(output), { root, acceptRevisions: false, retireSamples: false });
  const report = { status: result.status, changes: result.changes || [], pending: result.pending || [], fetched };
  const reportFile = path.join(root, 'work/archive-sync/last-run.json');
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
  } catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
}
