import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.ok(validate >= 0 && commit >= 0 && save >= 0);
  assert.ok(validate < commit, 'site validation must precede the public commit');
  assert.ok(commit < save, 'checkpoint must not advance before the public commit');
  assert.match(
    sync.slice(save, sync.indexOf('- name: Decide Pages publication')),
    /if: success\(\).*steps\.validate\.outputs\.available == 'true'/s,
  );
});

test('sync decision records actionable skipped reasons', async () => {
  const { sync } = await workflows();
  for (const reason of [
    'pending_review',
    'checkpoint_or_date_conflict',
    'sync_failed',
    'archive_unchanged',
    'retry_failed_publication',
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

test('Pages writes publication receipts after verification and records retryable failures', async () => {
  const { pages, sync } = await workflows();
  assert.match(pages, /publication-state:/);
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
  assert.match(pages, /needs: build-release/);
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

test('scheduled health workflow compares deployment and records drift recovery', async () => {
  const { health } = await workflows();
  assert.match(health, /schedule:/);
  assert.match(health, /listDeployments/);
  assert.match(health, /master_commit/);
  assert.match(health, /DEPLOYMENT_VERSION_DRIFT/);
  assert.match(health, /Retry Pages publication/);
  assert.match(health, /publication-failure:/);
  assert.match(health, /archive:publication -- --failed verify/);
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
