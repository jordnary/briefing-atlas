import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { readSourceExport } from './archive-input.mjs';
import { syncArchive } from './archive-sync.mjs';
import { fetchSource } from './fetch-source.mjs';
export async function syncFromGitHub({ root='.', input, ...options } = {}) {
  const output = input || options.output || process.env.SOURCE_OUTPUT || 'incoming/source-export.json';
  const fetched = input ? { downloaded: false, output } : await fetchSource({ ...options, output });
  const result = await syncArchive(await readSourceExport(output), { root, acceptRevisions: false, retireSamples: false });
  const report = { status: result.status, changes: result.changes || [], pending: result.pending || [], fetched };
  const reportFile = path.join(root, 'work/archive-sync/last-run.json');
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const arg = process.argv.slice(2).find((x) => !x.startsWith('--')); const result = await syncFromGitHub({ input: arg }); console.log(`Source sync: ${result.status}.`); if (result.status === 'pending') process.exitCode = 2; } catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
}
