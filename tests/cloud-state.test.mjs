import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  cloudState,
  makeCheckpoint,
  restoreCheckpoint,
  stateClient,
} from '../scripts/cloud-state.mjs';
import { syncArchive } from '../scripts/archive-sync.mjs';
import {
  contentFile,
  readState,
  saveState,
} from '../scripts/archive-store.mjs';
import { hash } from '../scripts/archive-convert.mjs';

const execFile = promisify(spawn);
const commitSha = (char) => char.repeat(40);
const exportSha = 'e'.repeat(64);
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const href = (value) => (typeof value === 'string' ? value : value.href);
const message = (body = '正文。') => ({
  messageId: 'test-message',
  role: 'assistant',
  status: 'completed',
  complete: true,
  sourcePublishedAt: null,
  text: `# AI & Tech Briefing · 2026-09-08\n\n导语。\n\n## 1. 标题\n\n${body}\n`,
});
const input = (body = '正文。') => ({
  version: 1,
  source: 'test-source',
  complete: true,
  messages: [message(body)],
});
async function command(root, args) {
  await execFile('git', args, { cwd: root, maxBuffer: 5 * 1024 * 1024 });
}
async function commandOutput(root, args) {
  return (await execFile('git', args, { cwd: root })).stdout;
}
async function workspace(
  t,
  { body = '正文。', sourceCommit = commitSha('a') } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cloud-state-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await command(root, ['init', '-b', 'master']);
  await command(root, ['config', 'user.name', 'Test']);
  await command(root, ['config', 'user.email', 'test@example.invalid']);
  await syncArchive(input(body), {
    root,
    sourceCommit,
    exportSha256: exportSha,
    now: '2026-09-08T10:00:00Z',
  });
  await command(root, ['add', 'content/briefings']);
  await command(root, ['commit', '-m', 'test archive']);
  return { root, checkpoint: await makeCheckpoint(root) };
}
async function commitUnrelated(root, name = 'README.md') {
  await writeFile(path.join(root, name), 'unrelated\n');
  await command(root, ['add', name]);
  await command(root, ['commit', '-m', 'unrelated']);
}
function clientFor(checkpoint, { sha = commitSha('1'), mode = {} } = {}) {
  let remoteSha = sha;
  let puts = 0;
  let writes = 0;
  const gate = [];
  const text = JSON.stringify(checkpoint);
  const file = {
    sha,
    encoding: 'base64',
    content: Buffer.from(text).toString('base64'),
  };
  const fetcher = async (url, options = {}) => {
    const value = href(url);
    if (mode.fetch) return mode.fetch(value, options, file);
    if (options.method === 'PUT') {
      puts++;
      if (mode.putConflict || JSON.parse(options.body).sha !== remoteSha)
        return response({}, 409);
      writes++;
      remoteSha = commitSha('2');
      return response({ content: { sha: remoteSha } });
    }
    if (value.endsWith('/repos/owner/private'))
      return response({ private: true, default_branch: 'main' });
    if (value.includes('/git/ref/heads/atlas-sync-state'))
      return response({ object: { sha: commitSha('3') } });
    if (value.includes('/contents/atlas-checkpoint.json')) {
      const snapshot = { ...file, sha: remoteSha };
      if (mode.race && gate.length < 2)
        await new Promise((resolve) => {
          gate.push(resolve);
          if (gate.length === 2) gate.forEach((release) => release());
        });
      return response(snapshot);
    }
    throw new Error('unexpected request');
  };
  const client = stateClient({
    repo: 'owner/private',
    token: 'token',
    fetcher,
  });
  return {
    client,
    fetcher,
    get puts() {
      return puts;
    },
    get writes() {
      return writes;
    },
  };
}

test('private state configuration and repository protections fail closed', async () => {
  assert.throws(() => stateClient(), /PRIVATE_STATE_CONFIGURATION_REQUIRED/);
  assert.throws(
    () =>
      stateClient({
        repo: 'owner/private',
        branch: 'bad/branch',
        token: 'token',
      }),
    /PRIVATE_STATE_CONFIGURATION_REQUIRED/,
  );
  for (const [meta, code] of [
    [
      { private: false, default_branch: 'main' },
      'STATE_REPOSITORY_MUST_BE_PRIVATE',
    ],
    [
      { private: true, default_branch: 'atlas-sync-state' },
      'STATE_BRANCH_MUST_BE_SEPARATE',
    ],
  ]) {
    let requests = 0;
    const client = stateClient({
      repo: 'owner/private',
      token: 'token',
      fetcher: async () => {
        requests++;
        return response(meta);
      },
    });
    await assert.rejects(client.restore(), new RegExp(code));
    await assert.rejects(client.save({}, null), new RegExp(code));
    await assert.rejects(client.bootstrap({}), new RegExp(code));
    assert.equal(requests, 3);
  }
});

test('makeCheckpoint binds exact public commit and source snapshot', async (t) => {
  const { root, checkpoint } = await workspace(t);
  assert.equal(checkpoint.version, 2);
  assert.equal(checkpoint.phase, 'committed');
  assert.match(checkpoint.binding.commit, /^[a-f0-9]{40}$/);
  assert.equal(checkpoint.binding.sourceCommit, commitSha('a'));
  assert.equal(checkpoint.state.sourceCommit, commitSha('a'));
  assert.equal((await readState(root)).sourceCommit, commitSha('a'));
});

test('prepared checkpoints reject a later SHA even when content bytes are unchanged', async (t) => {
  const { root } = await workspace(t);
  const prepared = await makeCheckpoint(root, { phase: 'prepared' });
  const before = await readFile(
    path.join(root, 'work/archive-sync/state.json'),
    'utf8',
  );
  await commitUnrelated(root);
  await assert.rejects(
    restoreCheckpoint(root, prepared, { reconcile: true }),
    /PRIVATE_STATE_COMMIT_NOT_READY/,
  );
  assert.equal(
    await readFile(path.join(root, 'work/archive-sync/state.json'), 'utf8'),
    before,
  );
  assert.equal(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
    prepared.contents[0].text,
  );
  await assert.rejects(
    readFile(path.join(root, 'work/archive-sync/cloud-session.json')),
    /ENOENT/,
  );
});

test('same-content descendant commit requires explicit ancestor reconciliation', async (t) => {
  const { root, checkpoint } = await workspace(t);
  await commitUnrelated(root);
  await assert.rejects(
    restoreCheckpoint(root, checkpoint),
    /PRIVATE_STATE_RECONCILE_REQUIRED/,
  );
  await restoreCheckpoint(root, checkpoint, { reconcile: true });
  const state = await readState(root);
  assert.notEqual(state.checkpointBinding.commit, checkpoint.binding.commit);
  assert.equal(
    state.checkpointBinding.archiveVersion,
    checkpoint.binding.archiveVersion,
  );
  await command(root, ['checkout', '--orphan', 'disconnected']);
  await command(root, ['commit', '-m', 'unrelated root']);
  await assert.rejects(
    restoreCheckpoint(root, checkpoint, { reconcile: true }),
    /PRIVATE_STATE_COMMIT_DIVERGED/,
  );
});

test('unknown committed content, extra dates and missing dates never write state', async (t) => {
  const { root, checkpoint } = await workspace(t);
  const stateFile = path.join(root, 'work/archive-sync/state.json');
  const before = await readFile(stateFile, 'utf8');
  const file = contentFile(root, '2026-09-08');
  await writeFile(file, 'unknown\n');
  await command(root, ['add', 'content/briefings']);
  await command(root, ['commit', '-m', 'unknown content']);
  await assert.rejects(
    restoreCheckpoint(root, checkpoint, { reconcile: true }),
    /CLOUD_CHECKPOINT_CONTENT_CONFLICT/,
  );
  assert.equal(await readFile(stateFile, 'utf8'), before);
  await writeFile(file, checkpoint.contents[0].text);
  await writeFile(
    contentFile(root, '2026-09-09'),
    checkpoint.contents[0].text.replace('2026-09-08', '2026-09-09'),
  );
  await command(root, ['add', 'content/briefings']);
  await command(root, ['commit', '-m', 'extra date']);
  await assert.rejects(
    restoreCheckpoint(root, checkpoint, { reconcile: true }),
    /CLOUD_CHECKPOINT_CONTENT_CONFLICT/,
  );
  assert.equal(await readFile(stateFile, 'utf8'), before);
  await command(root, ['rm', 'content/briefings/2026/09/2026-09-09.md']);
  await command(root, ['commit', '-m', 'remove extra date']);
  await command(root, ['rm', 'content/briefings/2026/09/2026-09-08.md']);
  await command(root, ['commit', '-m', 'missing date']);
  await assert.rejects(
    restoreCheckpoint(root, checkpoint, { reconcile: true }),
    /CLOUD_CHECKPOINT_CONTENT_CONFLICT/,
  );
  assert.equal(await readFile(stateFile, 'utf8'), before);
  await assert.rejects(
    readFile(path.join(root, 'work/archive-sync/cloud-session.json')),
    /ENOENT/,
  );
});

test('legacy checkpoints require explicit reconcile and preserve private evidence', async (t) => {
  const { root, checkpoint } = await workspace(t);
  const state = structuredClone(checkpoint.state);
  delete state.sourceCommit;
  delete state.exportSha256;
  delete state.checkpointBinding;
  state.publication = { stage: 'archived' };
  const legacy = { version: 1, state, contents: checkpoint.contents };
  await assert.rejects(
    restoreCheckpoint(root, legacy),
    /PRIVATE_STATE_RECONCILE_REQUIRED/,
  );
  await restoreCheckpoint(root, legacy, { reconcile: true });
  const restored = await readState(root);
  assert.equal(restored.reconciliation.code, 'PRIVATE_STATE_BINDING_REQUIRED');
  assert.deepEqual(restored.records, state.records);
  assert.equal(restored.sourceCommit, undefined);
  await assert.rejects(
    makeCheckpoint(root),
    /PRIVATE_STATE_SOURCE_COMMIT_REQUIRED/,
  );
});

test('invalid checkpoint mappings fail before any local state or content write', async (t) => {
  const { root, checkpoint } = await workspace(t);
  const stateFile = path.join(root, 'work/archive-sync/state.json');
  const before = await readFile(stateFile, 'utf8');
  const content = await readFile(contentFile(root, '2026-09-08'), 'utf8');
  checkpoint.state.records['2026-09-08'].archiveHash = hash('different');
  await assert.rejects(
    restoreCheckpoint(root, checkpoint),
    /CLOUD_CHECKPOINT_STATE_DIVERGED/,
  );
  assert.equal(await readFile(stateFile, 'utf8'), before);
  assert.equal(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
    content,
  );
  await assert.rejects(
    readFile(path.join(root, 'work/archive-sync/cloud-session.json')),
    /ENOENT/,
  );
});

test('state client restores valid checkpoints and maps malformed responses', async (t) => {
  const { checkpoint } = await workspace(t);
  const { client } = clientFor(checkpoint);
  const restored = await client.restore();
  assert.deepEqual(restored.checkpoint, checkpoint);
  assert.equal(restored.sha, commitSha('1'));
  for (const mode of [
    'json',
    'base64',
    'schema',
    'response',
    'access',
    'repo404',
    'missing-ref',
  ]) {
    const broken = stateClient({
      repo: 'owner/private',
      token: 'token',
      fetcher: async (url) => {
        const value = href(url);
        if (value.endsWith('/repos/owner/private')) {
          if (mode === 'json') return new Response('{', { status: 200 });
          if (mode === 'access' || mode === 'repo404')
            return response({}, mode === 'access' ? 403 : 404);
          return response({ private: true, default_branch: 'main' });
        }
        if (mode === 'missing-ref') return response({}, 404);
        if (value.includes('/git/ref/heads/atlas-sync-state'))
          return response({ object: { sha: commitSha('3') } });
        if (value.includes('/contents/')) {
          if (mode === 'response') return response({ sha: 'bad' });
          if (mode === 'base64')
            return response({
              sha: commitSha('1'),
              encoding: 'base64',
              content: '%%%',
            });
          return response({
            sha: commitSha('1'),
            encoding: 'base64',
            content: Buffer.from(JSON.stringify({ version: 1 })).toString(
              'base64',
            ),
          });
        }
        return response({}, 404);
      },
    });
    await assert.rejects(
      broken.restore(),
      new RegExp(
        mode === 'missing-ref'
          ? 'PRIVATE_STATE_BRANCH_UNAVAILABLE'
          : ['access', 'repo404'].includes(mode)
            ? 'PRIVATE_STATE_ACCESS_FAILED'
            : 'PRIVATE_STATE_CORRUPT',
      ),
    );
  }
});

test('CAS saves allow one writer and never retry a conflict; no-op detects stale session', async (t) => {
  const first = await workspace(t);
  const second = await workspace(t, {
    body: '第二版。',
    sourceCommit: commitSha('b'),
  });
  const prepared = await makeCheckpoint(second.root, { phase: 'prepared' });
  const noop = clientFor(first.checkpoint);
  const api = clientFor(first.checkpoint, { mode: { race: true } });
  const session = {
    sha: commitSha('1'),
    digest: hash(JSON.stringify(first.checkpoint)),
  };
  assert.deepEqual(await noop.client.save(first.checkpoint, session), session);
  assert.equal(noop.puts, 0);
  const results = await Promise.allSettled([
    api.client.save(prepared, session),
    api.client.save(prepared, session),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter(
      (item) =>
        item.status === 'rejected' &&
        /PRIVATE_STATE_WRITE_CONFLICT/.test(item.reason.message),
    ).length,
    1,
  );
  assert.equal(api.puts, 2);
  assert.equal(api.writes, 1);
  await assert.rejects(
    api.client.save(first.checkpoint, session),
    /PRIVATE_STATE_WRITE_CONFLICT/,
  );
});

test('save requires a valid restore session and bootstrap cannot overwrite', async (t) => {
  const { checkpoint } = await workspace(t);
  const api = clientFor(checkpoint);
  await assert.rejects(
    api.client.save(checkpoint, null),
    /PRIVATE_STATE_SESSION_REQUIRED/,
  );
  await assert.rejects(
    api.client.save(checkpoint, { sha: 'bad', digest: 'bad' }),
    /PRIVATE_STATE_SESSION_REQUIRED/,
  );
  await assert.rejects(
    api.client.bootstrap(checkpoint),
    /PRIVATE_STATE_ALREADY_INITIALIZED/,
  );
  assert.equal(api.puts, 0);
});

test('source rebinding preserves publication receipts and CAS rejects receipt regression', async (t) => {
  const { root, checkpoint } = await workspace(t);
  const state = checkpoint.state;
  const version = checkpoint.binding.archiveVersion;
  Object.assign(state.publication, {
    stage: 'verified',
    builtVersion: version,
    deployedVersion: version,
    verifiedVersion: version,
    deployment: { id: 'receipt', url: 'https://example.org/' },
  });
  await saveState(root, state);
  const previous = await makeCheckpoint(root);
  state.sourceCommit = commitSha('b');
  await saveState(root, state);
  const rebound = await makeCheckpoint(root, { phase: 'prepared' });
  assert.equal(rebound.state.publication.verifiedVersion, version);
  assert.deepEqual(
    rebound.state.publication.deployment,
    previous.state.publication.deployment,
  );
  const api = clientFor(previous);
  const session = {
    sha: commitSha('1'),
    digest: hash(JSON.stringify(previous)),
  };
  await api.client.save(rebound, session);
  assert.equal(api.writes, 1);
  const regressionApi = clientFor(previous);
  const reset = structuredClone(previous.state);
  reset.publication = { stage: 'archived', binding: previous.binding };
  await saveState(root, reset);
  const regression = await makeCheckpoint(root);
  await assert.rejects(
    regressionApi.client.save(regression, session),
    /PUBLICATION_STATE_REGRESSION/,
  );
  assert.equal(regressionApi.puts, 0);
});

test('cloud reconcile keeps local state and session untouched when CAS fails', async (t) => {
  const { root, checkpoint } = await workspace(t);
  await commitUnrelated(root);
  const stateFile = path.join(root, 'work/archive-sync/state.json');
  const sessionFile = path.join(root, 'work/archive-sync/cloud-session.json');
  const beforeState = await readFile(stateFile, 'utf8');
  await writeFile(sessionFile, '{"local":"session"}');
  const beforeSession = await readFile(sessionFile, 'utf8');
  const api = clientFor(checkpoint, { mode: { putConflict: true } });
  await assert.rejects(
    cloudState('reconcile', {
      root,
      env: {
        BRIEFING_STATE_REPO: 'owner/private',
        BRIEFING_STATE_BRANCH: 'atlas-sync-state',
        BRIEFING_STATE_TOKEN: 'token',
      },
      fetcher: api.fetcher,
    }),
    /PRIVATE_STATE_WRITE_CONFLICT/,
  );
  assert.equal(await readFile(stateFile, 'utf8'), beforeState);
  assert.equal(await readFile(sessionFile, 'utf8'), beforeSession);
});

const cloudEnv = {
  BRIEFING_STATE_REPO: 'owner/private',
  BRIEFING_STATE_BRANCH: 'atlas-sync-state',
  BRIEFING_STATE_TOKEN: 'token',
};

test('restore remains strict by default for a same-content descendant commit', async (t) => {
  const { root, checkpoint } = await workspace(t);
  await commitUnrelated(root);
  const api = clientFor(checkpoint);
  await assert.rejects(
    cloudState('restore', {
      root,
      env: cloudEnv,
      fetcher: api.fetcher,
    }),
    /PRIVATE_STATE_RECONCILE_REQUIRED/,
  );
  assert.equal(api.puts, 0);
});

test('ancestor reconciliation rebinds with CAS and archives verified publication evidence', async (t) => {
  const { root, checkpoint } = await workspace(t);
  const state = structuredClone(checkpoint.state);
  const version = checkpoint.binding.archiveVersion;
  state.publication = {
    stage: 'verified',
    binding: checkpoint.binding,
    builtVersion: version,
    deployedVersion: version,
    verifiedVersion: version,
    deployment: { id: 'receipt', url: 'https://example.org/' },
  };
  await saveState(root, state);
  const remoteCheckpoint = await makeCheckpoint(root);
  await commitUnrelated(root);
  const api = clientFor(remoteCheckpoint);
  await cloudState('restore', {
    root,
    env: cloudEnv,
    fetcher: api.fetcher,
    reconcileAncestor: true,
  });
  const restored = await readState(root);
  assert.equal(restored.publication.stage, 'archived');
  assert.equal(restored.publicationHistory?.length, 1);
  assert.deepEqual(restored.publicationHistory[0].deployment, {
    id: 'receipt',
    url: 'https://example.org/',
  });
  assert.deepEqual(restored.records, checkpoint.state.records);
  assert.equal(restored.source, checkpoint.state.source);
  assert.equal(restored.sourceCommit, checkpoint.state.sourceCommit);
  assert.equal(api.writes, 1);
  assert.equal(
    restored.checkpointBinding.commit,
    (await commandOutput(root, ['rev-parse', 'HEAD'])).trim(),
  );
});

test('ancestor reconciliation on the same commit performs no remote write', async (t) => {
  const { root, checkpoint } = await workspace(t);
  const api = clientFor(checkpoint);
  await cloudState('restore', {
    root,
    env: cloudEnv,
    fetcher: api.fetcher,
    reconcileAncestor: true,
  });
  assert.equal(api.puts, 0);
  assert.equal(api.writes, 0);
});

test('ancestor reconciliation keeps legacy checkpoints strict and rejects prepared descendants', async (t) => {
  const legacyWorkspace = await workspace(t);
  const legacyState = structuredClone(legacyWorkspace.checkpoint.state);
  delete legacyState.sourceCommit;
  delete legacyState.exportSha256;
  delete legacyState.checkpointBinding;
  legacyState.publication = { stage: 'archived' };
  const legacy = {
    version: 1,
    state: legacyState,
    contents: legacyWorkspace.checkpoint.contents,
  };
  const legacyApi = clientFor(legacy);
  await assert.rejects(
    cloudState('restore', {
      root: legacyWorkspace.root,
      env: cloudEnv,
      fetcher: legacyApi.fetcher,
      reconcileAncestor: true,
    }),
    /PRIVATE_STATE_RECONCILE_REQUIRED/,
  );
  assert.equal(legacyApi.puts, 0);

  const preparedWorkspace = await workspace(t);
  const prepared = await makeCheckpoint(preparedWorkspace.root, {
    phase: 'prepared',
  });
  await commitUnrelated(preparedWorkspace.root);
  const stateFile = path.join(
    preparedWorkspace.root,
    'work/archive-sync/state.json',
  );
  const before = await readFile(stateFile, 'utf8');
  const preparedApi = clientFor(prepared);
  await assert.rejects(
    cloudState('restore', {
      root: preparedWorkspace.root,
      env: cloudEnv,
      fetcher: preparedApi.fetcher,
      reconcileAncestor: true,
    }),
    /PRIVATE_STATE_RECONCILE_REQUIRED/,
  );
  assert.equal(preparedApi.puts, 0);
  assert.equal(await readFile(stateFile, 'utf8'), before);
});

test('ancestor reconciliation leaves local state and session untouched when CAS fails', async (t) => {
  const { root, checkpoint } = await workspace(t);
  await commitUnrelated(root);
  const stateFile = path.join(root, 'work/archive-sync/state.json');
  const sessionFile = path.join(root, 'work/archive-sync/cloud-session.json');
  const beforeState = await readFile(stateFile, 'utf8');
  await writeFile(sessionFile, '{"local":"session"}');
  const beforeSession = await readFile(sessionFile, 'utf8');
  const api = clientFor(checkpoint, { mode: { putConflict: true } });
  await assert.rejects(
    cloudState('restore', {
      root,
      env: cloudEnv,
      fetcher: api.fetcher,
      reconcileAncestor: true,
    }),
    /PRIVATE_STATE_WRITE_CONFLICT/,
  );
  assert.equal(await readFile(stateFile, 'utf8'), beforeState);
  assert.equal(await readFile(sessionFile, 'utf8'), beforeSession);
});
