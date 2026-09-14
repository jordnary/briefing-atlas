import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const syncWorkflow = new URL(
  '../.github/workflows/sync-source.yml',
  import.meta.url,
);
const pagesWorkflow = new URL(
  '../.github/workflows/pages.yml',
  import.meta.url,
);
const retryWorkflow = new URL(
  '../.github/workflows/pages-retry.yml',
  import.meta.url,
);
const healthWorkflow = new URL(
  '../.github/workflows/pages-health.yml',
  import.meta.url,
);

async function workflows() {
  return {
    sync: await readFile(syncWorkflow, 'utf8'),
    pages: await readFile(pagesWorkflow, 'utf8'),
    retry: await readFile(retryWorkflow, 'utf8'),
    health: await readFile(healthWorkflow, 'utf8'),
  };
}

function job(workflow, name) {
  const jobs = workflow.slice(workflow.indexOf('\njobs:'));
  const section = jobs.match(
    new RegExp(
      `^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|(?![\\s\\S]))`,
      'm',
    ),
  );
  assert.ok(section, `Missing job ${name}`);
  return section[1];
}

function jobCondition(section, needs) {
  const condition = section.match(/^    if: (.+)$/m)?.[1];
  assert.ok(condition, 'A publication gate must have an explicit condition');
  const resolved = condition
    .replace(/always\(\)/g, 'true')
    .replace(/needs\.([\w-]+)\.outputs\.(\w+)/g, (_, name, key) =>
      JSON.stringify(needs[name]?.outputs?.[key] ?? ''),
    )
    .replace(/needs\.([\w-]+)\.result/g, (_, name) =>
      JSON.stringify(needs[name]?.result ?? 'skipped'),
    );
  // Evaluate the actual workflow expression against terminal job snapshots.
  return runInNewContext(resolved, {}, { timeout: 100 });
}

test('sync workflow covers repository and manual inputs without dispatch recursion', async () => {
  const { sync, pages } = await workflows();
  assert.match(sync, /repository_dispatch:/);
  assert.match(sync, /workflow_dispatch:/);
  assert.doesNotMatch(sync, /gh workflow run pages\.yml/);
  assert.match(pages, /^\s*push:/m);
  assert.match(pages, /github\.actor != 'github-actions\[bot\]'/);
  assert.match(pages, /workflow_call:/);
});

test('publication is an explicit dependent job bound to the sync commit', async () => {
  const { sync, pages } = await workflows();
  for (const output of [
    'should_publish',
    'publish_commit',
    'review_required',
    'retry_only',
  ])
    assert.match(sync, new RegExp(`${output}:`));
  assert.match(sync, /publish:\s*\r?\n\s*needs: sync/);
  assert.match(sync, /uses: \.\/\.github\/workflows\/pages\.yml/);
  assert.match(
    sync,
    /commit: \$\{\{ needs\.sync\.outputs\.publish_commit \}\}/,
  );
  assert.match(pages, /workflow_dispatch:/);
  assert.match(pages, /description: 'Commit to publish/);
});

test('sync does not advance the private checkpoint before site validation and public commit', async () => {
  const { sync } = await workflows();
  const validate = sync.indexOf('- name: Validate site');
  const commit = sync.indexOf('- name: Commit synchronized public content');
  const save = sync.indexOf('- name: Save private archive checkpoint');
  const prepare = sync.indexOf('- name: Prepare private archive checkpoint');
  const push = sync.indexOf('- name: Push the checkpoint-bound public commit');
  assert.ok(validate >= 0 && commit >= 0 && save >= 0);
  assert.ok(
    validate < commit,
    'site validation must precede the public commit',
  );
  assert.ok(
    commit < save,
    'checkpoint must not advance before the public commit',
  );
  assert.ok(
    commit < prepare && prepare < push && push < save,
    'prepare must bind the local commit before push, then finalize after push',
  );
  assert.doesNotMatch(sync.slice(commit, prepare), /git push/);
  assert.match(
    sync.slice(prepare, push),
    /PUBLIC_COMMIT: \$\{\{ steps\.commit-content\.outputs\.commit_sha \}\}/,
  );
  assert.match(
    sync.slice(push, save),
    /steps\.prepare-state\.outcome == 'success'/,
  );
  assert.match(
    sync.slice(save, sync.indexOf('- name: Decide Pages publication')),
    /if: success\(\).*steps\.validate\.outputs\.available == 'true'/s,
  );
});

test('sync decision records actionable skipped reasons', async () => {
  const { sync } = await workflows();
  for (const reason of [
    'pending_review',
    'pending_checkpoint_save_failed',
    'checkpoint_or_date_conflict',
    'sync_failed',
    'archive_unchanged',
    'retry_failed_publication',
    'unpublished_commit',
    'no_briefings_available',
    'no_publish_commit',
  ])
    assert.match(sync, new RegExp(`reason='${reason}'`));
  assert.match(sync, /SYNC_ERROR_CODE:/);
  assert.match(sync, /grep -q 'CONFLICT'/);
  assert.match(sync, /skipped_reason:/);
});

test('all four publication entry points resolve a concrete commit', async () => {
  const { sync, pages } = await workflows();
  assert.match(sync, /repository_dispatch:/);
  assert.match(sync, /workflow_dispatch:/);
  assert.match(sync, /git commit -m 'feat: sync validated briefings'/);
  assert.match(sync, /publish_commit=\$commit/);
  assert.match(pages, /ref: \$\{\{ inputs\.commit \|\| github\.sha \}\}/);
});

test('ancestor reconciliation is limited to sync and the Pages plan', async () => {
  const { sync, pages } = await workflows();
  assert.equal(
    (sync.match(/state:restore -- --reconcile-ancestor/g) || []).length,
    1,
  );
  const plan = job(pages, 'plan');
  assert.match(plan, /fetch-depth: 0/);
  assert.match(plan, /state:restore -- --reconcile-ancestor/);
  assert.equal(
    (pages.match(/state:restore -- --reconcile-ancestor/g) || []).length,
    1,
  );
  for (const section of [
    'build-release',
    'deploy',
    'verify-online',
    'publication-failure',
  ])
    assert.doesNotMatch(
      job(pages, section),
      /state:restore -- --reconcile-ancestor/,
    );
});

test('sync distinguishes unpublished archives from failed publication retries', async () => {
  const { sync } = await workflows();
  for (const status of ['unchanged', 'reconciled']) {
    const start = sync.indexOf(`elif [ "$status" = ${status} ]`);
    const end = sync.indexOf("elif [ \"$status\" =", start + 1);
    const branch = sync.slice(start, end < 0 ? sync.indexOf('else\n', start) : end);
    const archived = branch.slice(branch.indexOf("publication?.stage === 'archived'"));
    assert.match(archived, /should_publish=true; reason='unpublished_commit'/);
    assert.doesNotMatch(archived, /retry_only=true/);
  }
});

test('Pages writes publication receipts after verification and records retryable failures', async () => {
  const { pages, sync } = await workflows();
  assert.match(
    job(pages, 'verify-online'),
    /archive:publication -- --verify[\s\S]*Save successful publication receipt\r?\n\s+run: npm run state:save/,
  );
  assert.match(pages, /npm run archive:publication -- --built/);
  assert.match(pages, /npm run archive:publication -- --deployed/);
  assert.match(pages, /npm run archive:publication -- --verify/);
  assert.match(pages, /publication-failure:/);
  assert.match(pages, /npm run archive:publication -- --failed/);
  assert.match(pages, /BUILD_FAILED/);
  assert.match(pages, /DEPLOYMENT_FAILED/);
  assert.match(pages, /ONLINE_VERIFY_FAILED/);
  assert.match(sync, /secrets: inherit/);
});

test('Pages retry input skips completed stages and targets the recorded failure', async () => {
  const { pages, retry } = await workflows();
  assert.match(
    job(pages, 'plan'),
    /RETRY_STAGE: \$\{\{ inputs\.retry_stage \}\}/,
  );
  assert.match(job(pages, 'plan'), /archive:publication -- --plan/);
  assert.match(pages, /retry_stage:/);
  assert.match(retry, /retry_stage:/);
  assert.match(retry, /retry_stage: \$\{\{ inputs\.retry_stage \}\}/);
});

test('Pages has one pinned release gate and non-blocking compatibility lanes', async () => {
  const { pages } = await workflows();
  assert.match(pages, /node-version: '22\.18\.0'/);
  assert.match(pages, /build-release:/);
  assert.match(pages, /name: Verify release E2E \(required\)/);
  assert.match(pages, /upload-pages-artifact@v5/);
  assert.match(pages, /compatibility:/);
  assert.match(pages, /continue-on-error: true/);
  assert.match(pages, /node:\s*\[[^\]]*'lts\/\*'/);
  assert.match(pages, /node:\s*\[[^\]]*'node'/);
  assert.match(job(pages, 'deploy'), /needs: \[plan, build-release\]/);
  const buildReceipt = job(pages, 'build-release').slice(
    job(pages, 'build-release').indexOf('- name: Record validated build'),
  );
  assert.match(
    buildReceipt,
    /NEXT_PUBLIC_BASE_PATH: \$\{\{ steps\.pages\.outputs\.base_path \}\}/,
  );
  assert.match(buildReceipt, /archive:publication -- --built/);
});

test('independent retry workflow resolves a public commit without source checkout', async () => {
  const { retry } = await workflows();
  assert.match(retry, /workflow_dispatch:/);
  assert.match(retry, /latest master/);
  assert.match(retry, /git rev-parse origin\/master/);
  assert.match(retry, /git cat-file -e/);
  assert.match(retry, /uses: \.\/\.github\/workflows\/pages\.yml/);
  assert.match(retry, /secrets: inherit/);
  assert.doesNotMatch(retry, /BRIEFING_SOURCE_TOKEN|work\/source-repository/);
});

test('scheduled health workflow verifies published content and records drift recovery', async () => {
  const { health } = await workflows();
  assert.match(health, /schedule:/);
  assert.match(
    health,
    /concurrency:\s*\r?\n\s*group: archive-publication-state\s*\r?\n\s*cancel-in-progress: false/,
  );
  assert.match(health, /listDeployments/);
  assert.match(health, /master_commit/);
  assert.match(health, /npm run verify:online -- "\$PAGE_URL"/);
  assert.match(health, /failure_code=ONLINE_VERSION_DRIFT/);
  assert.doesNotMatch(health, /DEPLOYMENT_VERSION_DRIFT/);
  assert.doesNotMatch(health, /"\$DEPLOYED_COMMIT"\s*!=\s*"\$MASTER_COMMIT"/);
  assert.match(health, /Retry Pages publication/);
  assert.match(health, /publication-failure:/);
  assert.match(health, /archive:publication -- --health/);
  assert.doesNotMatch(health, /archive:publication -- --failed/);
});

test('Pages, health and sync share one lock without locking reusable-workflow callers', async () => {
  const { pages, health, sync, retry } = await workflows();
  for (const workflow of [pages, health]) {
    assert.match(
      workflow.slice(0, workflow.indexOf('\njobs:')),
      /concurrency:\r?\n  group: archive-publication-state\r?\n  cancel-in-progress: false/,
    );
  }
  assert.match(
    job(sync, 'sync'),
    /    concurrency:\r?\n      group: archive-publication-state\r?\n      cancel-in-progress: false/,
  );
  assert.doesNotMatch(sync.slice(0, sync.indexOf('\njobs:')), /concurrency:/);
  assert.doesNotMatch(job(sync, 'publish'), /concurrency:/);
  assert.doesNotMatch(retry, /^\s*concurrency:/m);
  assert.match(
    job(retry, 'publish'),
    /uses: \.\/\.github\/workflows\/pages\.yml/,
  );
});

test('verified checkpoints and verify-only retries never schedule another deployment', async () => {
  const { pages } = await workflows();
  const completed = {
    plan: {
      result: 'success',
      outputs: {
        should_build: 'false',
        should_deploy: 'false',
        should_verify: 'false',
      },
    },
  };
  for (const name of ['build-release', 'deploy', 'verify-online'])
    assert.equal(jobCondition(job(pages, name), completed), false);
  const verifyOnly = structuredClone(completed);
  verifyOnly.plan.outputs.should_verify = 'true';
  assert.equal(jobCondition(job(pages, 'build-release'), verifyOnly), false);
  assert.equal(jobCondition(job(pages, 'deploy'), verifyOnly), false);
  assert.equal(jobCondition(job(pages, 'verify-online'), verifyOnly), true);
  verifyOnly.deploy = { result: 'failure' };
  assert.equal(jobCondition(job(pages, 'verify-online'), verifyOnly), false);
  verifyOnly.plan.result = 'failure';
  assert.equal(jobCondition(job(pages, 'verify-online'), verifyOnly), false);
});

test('deployment requires a saved CAS claim and saves its receipt before verification', async () => {
  const { pages } = await workflows();
  const deploy = job(pages, 'deploy');
  const claim = deploy.indexOf('archive:publication -- --begin-deploy');
  const claimSave = deploy.indexOf('npm run state:save', claim);
  const sideEffect = deploy.indexOf('uses: actions/deploy-pages@');
  const receipt = deploy.indexOf('archive:publication -- --deployed');
  const receiptSave = deploy.indexOf('npm run state:save', receipt);
  assert.ok(0 <= claim && claim < claimSave && claimSave < sideEffect);
  assert.ok(sideEffect < receipt && receipt < receiptSave);
  assert.doesNotMatch(
    deploy.slice(claim, sideEffect),
    /continue-on-error|if: always/,
  );
  assert.match(
    job(pages, 'verify-online'),
    /needs: \[plan, build-release, deploy\]/,
  );
  assert.doesNotMatch(
    job(pages, 'verify-online'),
    /deploy-pages|--built|--deployed/,
  );
});

test('state access and CAS failures cannot trigger a fresh compensating overwrite', async () => {
  const { pages } = await workflows();
  const failedSave = {
    plan: { result: 'success' },
    'build-release': { result: 'success', outputs: {} },
    deploy: { result: 'failure', outputs: {} },
    'verify-online': { result: 'skipped', outputs: {} },
  };
  const handler = job(pages, 'publication-failure');
  assert.equal(jobCondition(handler, failedSave), false);
  failedSave['verify-online'] = {
    result: 'failure',
    outputs: { failure_code: 'ONLINE_VERIFY_FAILED' },
  };
  assert.equal(jobCondition(handler, failedSave), false);
  assert.doesNotMatch(handler, /needs\.verify-online|stage=verify/);
  failedSave.deploy.outputs.failure_code = 'DEPLOYMENT_FAILED';
  assert.equal(jobCondition(handler, failedSave), true);
  failedSave.plan.result = 'failure';
  assert.equal(jobCondition(handler, failedSave), false);
  assert.match(
    job(pages, 'deploy'),
    /failure_code: \$\{\{ steps\.deployment\.outcome == 'failure'/,
  );
});

test('publication and health bind every state write to the observed commit', async () => {
  const { pages, health, sync } = await workflows();
  assert.match(
    pages,
    /PUBLIC_COMMIT: \$\{\{ inputs\.commit \|\| github\.sha \}\}/,
  );
  assert.match(pages, /SOURCE_COMMIT: \$\{\{ inputs\.source_commit \}\}/);
  assert.match(
    pages,
    /BRIEFING_PUBLICATION_ATTEMPT: \$\{\{ github\.run_id \}\}/,
  );
  assert.match(
    sync,
    /source_commit: \$\{\{ needs\.sync\.outputs\.source_commit \}\}/,
  );
  assert.match(
    job(pages, 'plan'),
    /state:restore[\s\S]*archive:publication -- --plan/,
  );
  assert.match(pages, /version: \$\{\{ steps\.plan\.outputs\.version \}\}/);
  for (const section of Object.keys({
    plan: 1,
    'build-release': 1,
    deploy: 1,
    'verify-online': 1,
    'publication-failure': 1,
  }))
    assert.match(
      job(pages, section),
      /ref: \$\{\{ inputs\.commit \|\| github\.sha \}\}/,
    );
  const observation = job(health, 'publication-failure');
  assert.match(
    observation,
    /PUBLIC_COMMIT: \$\{\{ needs\.health\.outputs\.master_commit \}\}/,
  );
  assert.match(
    observation,
    /ref: \$\{\{ needs\.health\.outputs\.master_commit \}\}/,
  );
  assert.doesNotMatch(observation, /\|\| github\.sha/);
  assert.equal(
    jobCondition(observation, { health: { result: 'failure', outputs: {} } }),
    false,
  );
});

test('pending reviews persist privately without advancing the source or public binding', async () => {
  const { sync } = await workflows();
  const pending = sync.slice(
    sync.indexOf('- name: Save pending review checkpoint'),
    sync.indexOf('- name: Validate site'),
  );
  assert.match(
    pending,
    /if: always\(\) && steps\.sync\.outputs\.status == 'pending' && steps\.state\.outcome == 'success'/,
  );
  assert.match(pending, /SOURCE_COMMIT: ''/);
  assert.match(pending, /run: npm run state:save/);
  assert.doesNotMatch(pending, /state:prepare|git push|git commit/);
  assert.match(
    sync,
    /steps\.save-review\.outcome.*failure[\s\S]*private review checkpoint: FAILED/,
  );
  assert.match(sync, /reason='pending_checkpoint_save_failed'/);
});

test('bootstrap is limited to an explicitly uninitialized private checkpoint', async () => {
  const { sync } = await workflows();
  assert.match(
    sync,
    /steps\.state\.outputs\.error_code == 'PRIVATE_STATE_NOT_INITIALIZED'/,
  );
  assert.doesNotMatch(
    sync,
    /if: steps\.state\.outcome == 'failure' && vars\.BRIEFING_STATE_BOOTSTRAP == 'true'/,
  );
});
