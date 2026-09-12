import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertPublicationBinding,
  publicationPlan,
  transitionPublication,
  resolvePublicationBinding,
  archiveVersion,
  publishArchive,
} from '../scripts/archive-publication.mjs';
import {
  saveState,
  readState,
  privateDir,
  recoverBatch,
  withArchiveLock,
} from '../scripts/archive-store.mjs';

const binding = {
  commit: 'a'.repeat(40),
  archiveVersion: 'b'.repeat(64),
  sourceCommit: 'c'.repeat(40),
};
const receipt = { id: 'deployment-1', url: 'https://example.org/' };
const stateFixture = () => ({
  version: 1,
  records: {},
  pending: [],
  sourceCommit: binding.sourceCommit,
  checkpointBinding: { ...binding },
  publication: { stage: 'archived', binding: { ...binding } },
});
function apply(state, event) {
  state.publication = transitionPublication(state, binding, event);
}
function deploy(state) {
  apply(state, { type: 'built' });
  apply(state, { type: 'begin-deploy', attempt: 'run-1' });
  apply(state, { type: 'deployed', receipt, attempt: 'run-1' });
}
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'publication-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('every publication operation requires the exact public commit, archive version and private source commit', () => {
  for (const field of ['commit', 'archiveVersion', 'sourceCommit']) {
    const state = stateFixture();
    const stale = {
      ...binding,
      [field]: 'd'.repeat(field === 'archiveVersion' ? 64 : 40),
    };
    assert.throws(
      () => publicationPlan(state, stale),
      /PUBLICATION_CHECKPOINT_BINDING_MISMATCH/,
    );
    assert.throws(
      () => transitionPublication(state, stale, { type: 'built' }),
      /PUBLICATION_CHECKPOINT_BINDING_MISMATCH/,
    );
  }
  const state = stateFixture();
  delete state.checkpointBinding;
  assert.throws(
    () => assertPublicationBinding(state, binding),
    /PUBLICATION_CHECKPOINT_BINDING_MISMATCH/,
  );
  assert.throws(
    () => assertPublicationBinding(state, {}),
    /PUBLICATION_BINDING_REQUIRED/,
  );
});

test('saved deployment intent blocks retries even for the same run after uncertain external failure', () => {
  const state = stateFixture();
  apply(state, { type: 'built' });
  apply(state, { type: 'begin-deploy', attempt: 'run-1' });
  apply(state, {
    type: 'failed',
    stage: 'deploy',
    error: new Error('DEPLOYMENT_FAILED'),
  });
  assert.equal(state.publication.deploymentIntent.attempt, 'run-1');
  assert.throws(
    () => publicationPlan(state, binding),
    /PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED/,
  );
  for (const attempt of ['run-1', 'run-2'])
    assert.throws(
      () =>
        transitionPublication(state, binding, {
          type: 'begin-deploy',
          attempt,
        }),
      /PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED/,
    );
  assert.throws(
    () =>
      transitionPublication(state, binding, {
        type: 'deployed',
        receipt,
        attempt: 'run-2',
      }),
    /PUBLICATION_ATTEMPT_MISMATCH/,
  );
  apply(state, { type: 'deployed', receipt, attempt: 'run-1' });
  const plan = publicationPlan(state, binding);
  assert.equal(plan.should_deploy, false);
  assert.equal(plan.should_verify, true);
  assert.equal(state.publication.failureCode, undefined);
});

test('identical receipts are idempotent and delayed failures cannot regress verified publication', () => {
  const state = stateFixture();
  deploy(state);
  apply(state, { type: 'verified', at: '2026-09-12T00:00:00Z' });
  const verified = structuredClone(state.publication);
  for (const event of [
    { type: 'built' },
    { type: 'deployed', receipt, attempt: 'run-1' },
    { type: 'verified', at: '2026-09-13T00:00:00Z' },
  ])
    assert.deepEqual(transitionPublication(state, binding, event), verified);
  for (const stage of ['build', 'deploy', 'verify'])
    assert.throws(
      () =>
        transitionPublication(state, binding, {
          type: 'failed',
          stage,
          error: new Error('LATE_FAILURE'),
        }),
      /PUBLICATION_STALE_FAILURE/,
    );
  assert.throws(
    () =>
      transitionPublication(state, binding, {
        type: 'deployed',
        receipt: { ...receipt, id: 'deployment-2' },
      }),
    /PUBLICATION_RECEIPT_CONFLICT/,
  );
  assert.equal(publicationPlan(state, binding).should_publish, false);
});

test('health drift preserves verified receipts and schedules verification without another deployment', () => {
  const state = stateFixture();
  deploy(state);
  apply(state, { type: 'verified' });
  apply(state, {
    type: 'health',
    code: 'ONLINE_VERSION_DRIFT',
    at: '2026-09-12T00:00:00Z',
  });
  assert.equal(state.publication.stage, 'verified');
  assert.equal(state.publication.verifiedVersion, binding.archiveVersion);
  assert.equal(state.publication.failedStage, null);
  assert.deepEqual(publicationPlan(state, binding), {
    should_publish: true,
    should_build: false,
    should_deploy: false,
    should_verify: true,
    version: binding.archiveVersion,
    page_url: receipt.url,
    deployment_id: receipt.id,
  });
  apply(state, { type: 'verified' });
  assert.equal(state.publication.health, undefined);
  assert.equal(publicationPlan(state, binding).should_publish, false);
});

test('retry stages and malformed publication receipts are rejected before an external action', () => {
  const state = stateFixture();
  assert.throws(
    () => publicationPlan(state, binding, { retryStage: 'verify' }),
    /PUBLICATION_RETRY_STAGE_MISMATCH/,
  );
  deploy(state);
  assert.throws(
    () => publicationPlan(state, binding, { retryStage: 'build' }),
    /PUBLICATION_RETRY_STAGE_MISMATCH/,
  );
  for (const change of [
    { deployedVersion: 'd'.repeat(64) },
    { deployment: { ...receipt, id: 'id\ninjected=true' } },
    { deployment: { ...receipt, url: 'http://example.org/' } },
    { verifiedVersion: binding.archiveVersion, builtVersion: undefined },
    { stage: 'archived' },
    { failedStage: 'deploy' },
  ]) {
    const corrupt = structuredClone(state);
    Object.assign(corrupt.publication, change);
    assert.throws(
      () => publicationPlan(corrupt, binding),
      /INVALID_PUBLICATION_STATE/,
    );
  }
});

test('explicit workflow commit and source pins are checked before publication', async (t) => {
  const root = await workspace(t);
  for (const [env, code] of [
    [{ PUBLIC_COMMIT: 'd'.repeat(40) }, 'PUBLICATION_COMMIT_MISMATCH'],
    [{ SOURCE_COMMIT: 'd'.repeat(40) }, 'PUBLICATION_SOURCE_COMMIT_MISMATCH'],
  ])
    await assert.rejects(
      resolvePublicationBinding(root, stateFixture(), {
        gitCommit: binding.commit,
        env,
      }),
      new RegExp(code),
    );
});

test('a checkpoint write failure preserves its error and never triggers deployment or a compensating failed write', async (t) => {
  const root = await workspace(t);
  const state = stateFixture();
  const version = await archiveVersion(root);
  state.checkpointBinding.archiveVersion = version;
  state.publication.binding.archiveVersion = version;
  await saveState(root, state);
  let built = 0,
    deployed = 0;
  await assert.rejects(
    publishArchive({
      root,
      gitCommit: binding.commit,
      build: async () => {
        built++;
        await mkdir(path.join(privateDir(root), 'checkpoint.json.tmp'));
      },
      deploy: async () => {
        deployed++;
        return receipt;
      },
      verify: async () => true,
    }),
    (error) =>
      ['EISDIR', 'EACCES', 'EPERM'].includes(error.code) ||
      error.message === 'PRIVATE_STATE_ACCESS_FAILED',
  );
  assert.equal(built, 1);
  assert.equal(deployed, 0);
  const after = await readState(root);
  assert.deepEqual(after, state);
});

test('verification of health drift retains successful publication on a failed online check', async (t) => {
  const root = await workspace(t);
  const state = stateFixture();
  const currentBinding = {
    ...binding,
    archiveVersion: await archiveVersion(root),
  };
  state.checkpointBinding = currentBinding;
  state.publication.binding = currentBinding;
  for (const event of [
    { type: 'built' },
    { type: 'begin-deploy', attempt: 'run-1' },
    { type: 'deployed', receipt, attempt: 'run-1' },
    { type: 'verified' },
    { type: 'health', code: 'ONLINE_VERSION_DRIFT' },
  ])
    state.publication = transitionPublication(state, currentBinding, event);
  await saveState(root, state);
  await assert.rejects(
    publishArchive({
      root,
      gitCommit: binding.commit,
      build: async () => assert.fail('build repeated'),
      deploy: async () => assert.fail('deploy repeated'),
      verify: async () => false,
    }),
    /ONLINE_VERSION_MISMATCH/,
  );
  const after = (await readState(root)).publication;
  assert.equal(after.stage, 'verified');
  assert.equal(after.failedStage, null);
  assert.equal(after.health.code, 'ONLINE_VERSION_MISMATCH');
});

test('empty, malformed and structurally corrupt local state fail explicitly without checkpoint fallback', async (t) => {
  const root = await workspace(t);
  await saveState(root, stateFixture());
  const backup = await readFile(
    path.join(privateDir(root), 'checkpoint.json'),
    'utf8',
  );
  for (const content of [
    '',
    '{"broken":',
    'null',
    JSON.stringify({ ...stateFixture(), publication: {} }),
  ]) {
    await writeFile(path.join(privateDir(root), 'state.json'), content);
    await assert.rejects(readState(root), /INVALID_PRIVATE_STATE/);
    assert.equal(
      await readFile(path.join(privateDir(root), 'checkpoint.json'), 'utf8'),
      backup,
    );
  }
  const different = stateFixture();
  different.publication.failedStage = 'build';
  await writeFile(
    path.join(privateDir(root), 'state.json'),
    JSON.stringify(different),
  );
  await assert.rejects(readState(root), /PRIVATE_STATE_SNAPSHOTS_DIVERGED/);
});

test('corrupt recovery journals are rejected before writing their targets', async (t) => {
  const root = await workspace(t);
  await saveState(root, stateFixture());
  const before = await readFile(
    path.join(privateDir(root), 'state.json'),
    'utf8',
  );
  for (const batch of [
    '{',
    JSON.stringify({
      version: 1,
      entries: [{ date: '../outside' }],
      state: stateFixture(),
    }),
  ]) {
    await writeFile(path.join(privateDir(root), 'batch.json'), batch);
    await assert.rejects(recoverBatch(root), /CORRUPT_BATCH/);
    assert.equal(
      await readFile(path.join(privateDir(root), 'state.json'), 'utf8'),
      before,
    );
  }
});

test('competing local publication writers cannot overwrite the active writer', async (t) => {
  const root = await workspace(t);
  await saveState(root, stateFixture());
  await withArchiveLock(root, async () => {
    await assert.rejects(
      withArchiveLock(root, async () => assert.fail('second writer ran')),
      /ARCHIVE_LOCKED/,
    );
    const state = await readState(root);
    apply(state, { type: 'built' });
    await saveState(root, state);
  });
  assert.equal((await readState(root)).publication.stage, 'built');
});
