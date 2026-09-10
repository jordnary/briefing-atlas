import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncFromGitHub } from '../scripts/sync-source.mjs';

const exec = promisify(execFile);
const git = (cwd, ...args) => exec('git', args, { cwd });
const source = 'source-pipeline-fixture';

function message(date, id, body = 'Body.') {
  return {
    messageId: id,
    role: 'assistant',
    status: 'completed',
    complete: true,
    briefingDate: date,
    text: `# AI & Tech Briefing · ${date}\n\n## 1. Story\n\n${body}\n`,
  };
}

async function fixture(t) {
  const root = await fsTemp('atlas-pipeline-');
  const sourceRoot = path.join(root, 'source');
  const atlasRoot = path.join(root, 'atlas');
  await mkdir(path.join(sourceRoot, 'briefings'), { recursive: true });
  await mkdir(atlasRoot, { recursive: true });
  await git(sourceRoot, 'init', '-q');
  await git(sourceRoot, 'config', 'user.email', 'test@example.invalid');
  await git(sourceRoot, 'config', 'user.name', 'Test');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, sourceRoot, atlasRoot };
}

async function fsTemp(prefix) {
  return (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSource(sourceRoot, messages, missingDates = []) {
  for (const message of messages) {
    const file = path.join(
      sourceRoot,
      'briefings',
      message.briefingDate.slice(0, 4),
      message.briefingDate.slice(5, 7),
      `${message.briefingDate}.json`,
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({ version: 1, source, complete: true, messages: [message], missingDates }, null, 2)}\n`,
    );
  }
  await git(sourceRoot, 'add', 'briefings');
  await git(sourceRoot, 'commit', '-qm', 'fixture source');
  const exportData = {
    version: 1,
    source,
    complete: true,
    messages: [...messages].sort((a, b) => a.briefingDate.localeCompare(b.briefingDate)),
    missingDates,
  };
  const exportText = `${JSON.stringify(exportData, null, 2)}\n`;
  const exportFile = path.join(sourceRoot, 'work', 'source-export.json');
  await mkdir(path.dirname(exportFile), { recursive: true });
  await writeFile(exportFile, exportText);
  const commit = (await git(sourceRoot, 'rev-parse', 'HEAD')).stdout.trim();
  const exportSha256 = createHash('sha256').update(exportText).digest('hex');
  return { expectedCommit: commit, expectedExportSha256: exportSha256 };
}

const archiveFile = (root, date) =>
  path.join(root, 'content', 'briefings', date.slice(0, 4), date.slice(5, 7), `${date}.md`);

test('source snapshot pipeline is idempotent, defers revisions, and accepts late briefings', async (t) => {
  const { sourceRoot, atlasRoot } = await fixture(t);
  const late = message('2026-09-10', 'message-10', 'Original.');
  let pin = await writeSource(sourceRoot, [late], ['2026-09-09']);
  const first = await syncFromGitHub({ root: atlasRoot, sourceRoot, ...pin });
  assert.equal(first.status, 'archived');
  assert.equal((await readFile(archiveFile(atlasRoot, '2026-09-10'), 'utf8')).includes('Original.'), true);

  const repeated = await syncFromGitHub({ root: atlasRoot, sourceRoot, ...pin });
  assert.equal(repeated.status, 'unchanged');
  assert.equal(repeated.fetched.downloaded, false);

  const revised = message('2026-09-10', 'message-10-revision', 'Revised.');
  await writeSource(sourceRoot, [revised], ['2026-09-09']);
  pin = {
    expectedCommit: (await git(sourceRoot, 'rev-parse', 'HEAD')).stdout.trim(),
    expectedExportSha256: createHash('sha256').update(await readFile(path.join(sourceRoot, 'work/source-export.json'))).digest('hex'),
  };
  const pending = await syncFromGitHub({ root: atlasRoot, sourceRoot, ...pin });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.pending[0].code, 'SAME_DATE_CONFLICT');
  assert.equal((await readFile(archiveFile(atlasRoot, '2026-09-10'), 'utf8')).includes('Original.'), true);

  const onTime = message('2026-09-09', 'message-09', 'Late but complete.');
  pin = await writeSource(sourceRoot, [onTime, late], []);
  const lateResult = await syncFromGitHub({ root: atlasRoot, sourceRoot, ...pin });
  assert.equal(lateResult.status, 'archived');
  assert.equal(lateResult.changes.some((change) => change.date === '2026-09-09'), true);
  const state = JSON.parse(await readFile(path.join(atlasRoot, 'work', 'archive-sync', 'state.json'), 'utf8'));
  assert.deepEqual(state.missingDates, []);
});
