import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  consumeSourceSnapshot,
  syncFromGitHub,
} from '../scripts/sync-source.mjs';

const exec = promisify(execFile);
const run = (cwd, ...args) => exec('git', args, { cwd });
const text = '# AI & Tech Briefing · 2026-09-10\n\n## 1. Story\n\nBody.\n';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(root, 'init', '-q');
  await run(root, 'config', 'user.email', 'test@example.invalid');
  await run(root, 'config', 'user.name', 'Test');
  const message = {
    messageId: 'm-1',
    role: 'assistant',
    status: 'completed',
    complete: true,
    briefingDate: '2026-09-10',
    text,
  };
  const daily = {
    version: 1,
    source: 'thread',
    complete: true,
    messages: [message],
  };
  await mkdir(path.join(root, 'briefings/2026/09'), { recursive: true });
  await writeFile(path.join(root, 'briefings/.gitkeep'), '');
  await writeFile(
    path.join(root, 'briefings/2026/09/2026-09-10.json'),
    JSON.stringify(daily),
  );
  await run(root, 'add', '.');
  await run(root, 'commit', '-qm', 'fixture');
  const exported = {
    version: 1,
    source: 'thread',
    complete: true,
    messages: [message],
    missingDates: [],
  };
  await mkdir(path.join(root, 'work'), { recursive: true });
  const exportText = `${JSON.stringify(exported, null, 2)}\n`;
  await writeFile(path.join(root, 'work/source-export.json'), exportText);
  const commit = (await run(root, 'rev-parse', 'HEAD')).stdout.trim();
  const hash = createHash('sha256').update(exportText).digest('hex');
  return { root, commit, hash };
}

test('consumes a complete committed snapshot and permits briefings/.gitkeep', async (t) => {
  const fixtureData = await fixture(t);
  const result = await consumeSourceSnapshot(fixtureData.root, {
    expectedCommit: fixtureData.commit,
    expectedExportSha256: fixtureData.hash,
  });
  assert.equal(result.data.messages[0].briefingDate, '2026-09-10');
  assert.equal(result.commit, fixtureData.commit);
});

test('rejects unexpected committed files and dirty tracked content', async (t) => {
  const fixtureData = await fixture(t);
  await writeFile(
    path.join(fixtureData.root, 'briefings/README.md'),
    'unexpected',
  );
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: fixtureData.commit,
      expectedExportSha256: fixtureData.hash,
    }),
    /SOURCE_CHECKOUT_DIRTY/,
  );
  await run(fixtureData.root, 'add', 'briefings/README.md');
  await run(fixtureData.root, 'commit', '-qm', 'unexpected file');
  const commit = (
    await run(fixtureData.root, 'rev-parse', 'HEAD')
  ).stdout.trim();
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: commit,
      expectedExportSha256: fixtureData.hash,
    }),
    /SOURCE_PATH_DATE_MISMATCH/,
  );
  await writeFile(path.join(fixtureData.root, 'briefings/.gitkeep'), 'changed');
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: commit,
      expectedExportSha256: fixtureData.hash,
    }),
    /SOURCE_CHECKOUT_DIRTY/,
  );
});

test('requires commit and export hash pinning', async (t) => {
  const fixtureData = await fixture(t);
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root),
    /SOURCE_COMMIT_REQUIRED/,
  );
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: fixtureData.commit,
    }),
    /SOURCE_EXPORT_HASH_REQUIRED/,
  );
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: '0'.repeat(40),
      expectedExportSha256: fixtureData.hash,
    }),
    /SOURCE_COMMIT_MISMATCH/,
  );
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: fixtureData.commit,
      expectedExportSha256: '0'.repeat(64),
    }),
    /SOURCE_EXPORT_HASH_MISMATCH/,
  );
});

test('rejects incomplete exports even when their byte hash matches', async (t) => {
  const fixtureData = await fixture(t);
  const exported = JSON.parse(
    await readFile(
      path.join(fixtureData.root, 'work/source-export.json'),
      'utf8',
    ),
  );
  exported.messages = [];
  const body = JSON.stringify(exported);
  await writeFile(path.join(fixtureData.root, 'work/source-export.json'), body);
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: fixtureData.commit,
      expectedExportSha256: createHash('sha256').update(body).digest('hex'),
    }),
    /SOURCE_EXPORT_OUT_OF_DATE/,
  );
});

test('rejects symlink placeholders in the committed tree', async (t) => {
  const fixtureData = await fixture(t);
  await run(fixtureData.root, 'config', 'core.symlinks', 'false');
  await writeFile(path.join(fixtureData.root, 'briefings/.gitkeep'), 'target');
  const object = (
    await run(fixtureData.root, 'hash-object', '-w', 'briefings/.gitkeep')
  ).stdout.trim();
  await run(
    fixtureData.root,
    'update-index',
    '--add',
    '--cacheinfo',
    `120000,${object},briefings/.gitkeep`,
  );
  await run(fixtureData.root, 'commit', '-qm', 'symlink fixture');
  const commit = (
    await run(fixtureData.root, 'rev-parse', 'HEAD')
  ).stdout.trim();
  await assert.rejects(
    consumeSourceSnapshot(fixtureData.root, {
      expectedCommit: commit,
      expectedExportSha256: fixtureData.hash,
    }),
    /SOURCE_TREE_ENTRY_INVALID/,
  );
});

test('resolves input and output against the target root and preserves unchanged files', async (t) => {
  const fixtureData = await fixture(t);
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-target-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    root,
    sourceRoot: fixtureData.root,
    expectedCommit: fixtureData.commit,
    expectedExportSha256: fixtureData.hash,
  };
  const first = await syncFromGitHub(options);
  assert.equal(first.status, 'archived');
  assert.equal(first.fetched.downloaded, true);
  const output = path.join(root, 'incoming/source-export.json');
  const archive = path.join(root, 'content/briefings/2026/09/2026-09-10.md');
  const fixedTime = new Date('2020-01-01T00:00:00Z');
  await utimes(output, fixedTime, fixedTime);
  await utimes(archive, fixedTime, fixedTime);
  const before = {
    output: (await stat(output)).mtimeMs,
    archive: (await stat(archive)).mtimeMs,
  };
  const second = await syncFromGitHub(options);
  assert.equal(second.status, 'unchanged');
  assert.equal(second.fetched.downloaded, false);
  assert.equal((await stat(output)).mtimeMs, before.output);
  assert.equal((await stat(archive)).mtimeMs, before.archive);
  const fromInput = await syncFromGitHub({
    root,
    input: 'incoming/source-export.json',
  });
  assert.equal(fromInput.status, 'unchanged');
});

test('refuses export paths outside the snapshot', async (t) => {
  const fixtureData = await fixture(t);
  for (const exportFile of [
    '../export.json',
    '/export.json',
    'C:/export.json',
  ]) {
    await assert.rejects(
      consumeSourceSnapshot(fixtureData.root, {
        expectedCommit: fixtureData.commit,
        expectedExportSha256: fixtureData.hash,
        exportFile,
      }),
      /SOURCE_EXPORT_PATH_INVALID/,
    );
  }
});

test('CLI reports a stable error code without filesystem details', async () => {
  const script = new URL('../scripts/sync-source.mjs', import.meta.url);
  await assert.rejects(
    exec(
      process.execPath,
      [fileURLToPath(script), 'missing-private-input.json'],
      { env: { ...process.env, SOURCE_DIRECTORY: '' } },
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stderr.trim(), 'ENOENT');
      assert.equal(error.stdout, '');
      return true;
    },
  );
});
