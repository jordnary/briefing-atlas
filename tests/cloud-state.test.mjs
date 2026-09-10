import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  stateClient,
  makeCheckpoint,
  restoreCheckpoint,
} from '../scripts/cloud-state.mjs';
import { syncArchive } from '../scripts/archive-sync.mjs';
import { contentFile, saveState } from '../scripts/archive-store.mjs';
import { hash } from '../scripts/archive-convert.mjs';

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const href = (value) => (typeof value === 'string' ? value : value.href);

test('private state client enforces repository, branch and token configuration', () => {
  assert.throws(() => stateClient(), /PRIVATE_STATE_CONFIGURATION_REQUIRED/);
  assert.throws(
    () => stateClient({ repo: 'owner/repo', branch: 'bad/branch', token: 'x' }),
    /PRIVATE_STATE_CONFIGURATION_REQUIRED/,
  );
});

test('restore checks privacy and decodes the checkpoint without exposing credentials', async () => {
  const checkpoint = { version: 1, state: { version: 1 }, contents: [] };
  const encoded = Buffer.from(JSON.stringify(checkpoint)).toString('base64');
  const calls = [];
  const client = stateClient({
    repo: 'owner/private',
    token: 'secret-token',
    fetcher: async (url, options) => {
      calls.push({
        url: href(url),
        authorization: options.headers.Authorization,
      });
      if (href(url).endsWith('/repos/owner/private'))
        return response({ private: true, default_branch: 'main' });
      return response({
        encoding: 'base64',
        content: encoded,
        sha: 'blob-sha',
      });
    },
  });
  const result = await client.restore();
  assert.deepEqual(result.checkpoint, checkpoint);
  assert.equal(result.sha, 'blob-sha');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, 'Bearer secret-token');
});

test('normal save requires a restore session and uses compare-and-swap sha', async () => {
  let put;
  const client = stateClient({
    repo: 'owner/private',
    token: 'token',
    fetcher: async (url, options) => {
      if (options.method === 'PUT') {
        put = { url: href(url), body: JSON.parse(options.body) };
        return response({ content: { sha: 'new-sha' } });
      }
      if (href(url).includes('/contents/')) return response({ sha: 'old-sha' });
      return response({ private: true, default_branch: 'main' });
    },
  });
  await assert.rejects(
    client.save({ value: 1 }, null),
    /PRIVATE_STATE_SESSION_REQUIRED/,
  );
  const saved = await client.save(
    { value: 1 },
    { sha: 'old-sha', digest: 'different' },
  );
  assert.equal(saved.sha, 'new-sha');
  assert.equal(put.body.sha, 'old-sha');
  assert.equal(put.body.branch, 'atlas-sync-state');
});

test('bootstrap never overwrites an existing state file', async () => {
  const client = stateClient({
    repo: 'owner/private',
    token: 'token',
    fetcher: async (url, options) => {
      const value = href(url);
      if (value.endsWith('/repos/owner/private'))
        return response({ private: true, default_branch: 'main' });
      if (value.includes('/git/ref/heads/atlas-sync-state'))
        return response({ object: { sha: 'head' } });
      if (value.includes('/contents/atlas-checkpoint.json'))
        return response({ sha: 'existing' });
      throw new Error(`unexpected request ${options.method} ${value}`);
    },
  });
  await assert.rejects(
    client.bootstrap({ version: 1 }),
    /PRIVATE_STATE_ALREADY_INITIALIZED/,
  );
});

test('public repositories and the production branch cannot store private state', async () => {
  for (const [metadata, error] of [
    [
      { private: false, default_branch: 'main' },
      /STATE_REPOSITORY_MUST_BE_PRIVATE/,
    ],
    [
      { private: true, default_branch: 'atlas-sync-state' },
      /STATE_BRANCH_MUST_BE_SEPARATE/,
    ],
  ]) {
    let requests = 0;
    const client = stateClient({
      repo: 'owner/private',
      token: 'token',
      fetcher: async () => {
        requests++;
        return response(metadata);
      },
    });
    await assert.rejects(client.restore(), error);
    await assert.rejects(client.save({}, { sha: 'old-sha' }), error);
    await assert.rejects(client.bootstrap({}), error);
    assert.equal(requests, 3);
  }
});

test('unchanged checkpoint makes no writes but still detects a stale session', async () => {
  const checkpoint = { value: 1 };
  const session = { sha: 'old-sha', digest: hash(JSON.stringify(checkpoint)) };
  let remoteSha = 'old-sha',
    writes = 0;
  const client = stateClient({
    repo: 'owner/private',
    token: 'token',
    fetcher: async (url, options) => {
      if (options.method !== 'GET') writes++;
      return response(
        href(url).includes('/contents/')
          ? { sha: remoteSha }
          : { private: true, default_branch: 'main' },
      );
    },
  });
  assert.deepEqual(await client.save(checkpoint, session), session);
  remoteSha = 'concurrent-sha';
  await assert.rejects(
    client.save(checkpoint, session),
    /PRIVATE_STATE_WRITE_CONFLICT/,
  );
  assert.equal(writes, 0);
});

test('concurrent checkpoint updates stop on GitHub compare-and-swap conflicts', async () => {
  const client = stateClient({
    repo: 'owner/private',
    token: 'token',
    fetcher: async (url, options) => {
      if (options.method === 'PUT') return response({}, 409);
      return response(
        href(url).includes('/contents/')
          ? { sha: 'old-sha' }
          : { private: true, default_branch: 'main' },
      );
    },
  });
  await assert.rejects(
    client.save({ value: 2 }, { sha: 'old-sha' }),
    /PRIVATE_STATE_WRITE_CONFLICT/,
  );
});

test('restore validates the complete batch before writing any content', async (t) => {
  const sourceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'cloud-state-source-'),
  );
  const targetRoot = await mkdtemp(
    path.join(os.tmpdir(), 'cloud-state-target-'),
  );
  t.after(() =>
    Promise.all([
      rm(sourceRoot, { recursive: true, force: true }),
      rm(targetRoot, { recursive: true, force: true }),
    ]),
  );
  const message = (date) => ({
    messageId: date,
    role: 'assistant',
    status: 'completed',
    complete: true,
    sourcePublishedAt: null,
    text: `# AI & Tech Briefing · ${date}\n\n导语。\n\n## 1. 标题 ${date}\n\n正文。\n`,
  });
  await syncArchive(
    {
      version: 1,
      source: 'test-source',
      complete: true,
      messages: [message('2026-09-08'), message('2026-09-09')],
    },
    { root: sourceRoot },
  );
  const checkpoint = await makeCheckpoint(sourceRoot);
  checkpoint.contents[1].text = 'corrupt';
  await assert.rejects(
    restoreCheckpoint(targetRoot, checkpoint),
    /CLOUD_CHECKPOINT_INVALID/,
  );
  await assert.rejects(
    readFile(contentFile(targetRoot, checkpoint.contents[0].date)),
    /ENOENT/,
  );
});

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloud-state-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const issueMessage = (body = '正文。') => ({
  messageId: 'test-message',
  role: 'assistant',
  status: 'completed',
  complete: true,
  sourcePublishedAt: null,
  text: `# AI & Tech Briefing · 2026-09-08\n\n导语。\n\n## 1. 测试标题\n\n${body}\n`,
});
const issueBatch = (body) => ({
  version: 1,
  source: 'test-source',
  complete: true,
  messages: [issueMessage(body)],
});

test('checkpoint creation refuses to reconstruct lost private source receipts', async (t) => {
  const root = await workspace(t);
  await assert.rejects(makeCheckpoint(root), /PRIVATE_STATE_RECOVERY_REQUIRED/);
  await saveState(root, {
    version: 1,
    records: {},
    pending: [],
    publication: { stage: 'unpublished' },
  });
  await assert.rejects(makeCheckpoint(root), /PRIVATE_STATE_RECOVERY_REQUIRED/);
});

test('restoration recovers a known historical content version and rejects unrecognized edits', async (t) => {
  const root = await workspace(t);
  await syncArchive(issueBatch(), { root, now: '2026-09-08T10:00:00Z' });
  const file = contentFile(root, '2026-09-08');
  const historical = await readFile(file, 'utf8');
  await syncArchive(issueBatch('正文已修订。'), {
    root,
    now: '2026-09-09T10:00:00Z',
    acceptRevisions: true,
  });
  const checkpoint = await makeCheckpoint(root, {
    gitRead: async () => 'a distinct checked-in baseline',
  });
  await writeFile(file, historical);
  await restoreCheckpoint(root, checkpoint);
  assert.equal(await readFile(file, 'utf8'), checkpoint.contents[0].text);
  await restoreCheckpoint(root, checkpoint);
  const unknown = historical.replace('正文。', '未登记的本地修改。');
  await writeFile(file, unknown);
  await assert.rejects(
    restoreCheckpoint(root, checkpoint),
    /CLOUD_CHECKPOINT_CONTENT_CONFLICT/,
  );
  assert.equal(await readFile(file, 'utf8'), unknown);
});

test('invalid state mappings cannot be saved or partially restored', async (t) => {
  const root = await workspace(t);
  await syncArchive(issueBatch(), { root });
  const checkpoint = await makeCheckpoint(root, { gitRead: async () => null });
  const destination = await workspace(t);
  checkpoint.state.records['2026-09-08'].archiveHash =
    hash('different content');
  await assert.rejects(
    restoreCheckpoint(destination, checkpoint),
    /CLOUD_CHECKPOINT_STATE_DIVERGED/,
  );
  await assert.rejects(
    readFile(contentFile(destination, '2026-09-08')),
    /ENOENT/,
  );
  await saveState(root, checkpoint.state);
  await assert.rejects(
    makeCheckpoint(root, { gitRead: async () => null }),
    /CLOUD_CHECKPOINT_STATE_DIVERGED/,
  );
});
