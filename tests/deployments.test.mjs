import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupPagesDeployments } from '../scripts/cleanup-pages-deployments.mjs';

const deployment = (id, extra = {}) => ({
  id,
  environment: 'github-pages',
  sha: 'current-commit',
  ...extra,
});

function fixture(deployments, { state = 'success', fail } = {}) {
  const calls = [];
  const repo = { owner: 'example', repo: 'archive' };
  const repos = {
    listDeployments: Symbol('listDeployments'),
    async listDeploymentStatuses(args) {
      calls.push(['status', args.deployment_id]);
      assert.equal(args.per_page, 1);
      return { data: state ? [{ state }] : [] };
    },
    async createDeploymentStatus(args) {
      calls.push(['inactive', args.deployment_id]);
      assert.equal(args.state, 'inactive');
      assert.equal(args.auto_inactive, false);
      if (fail === 'inactive') throw new Error('API failure');
    },
    async deleteDeployment(args) {
      calls.push(['delete', args.deployment_id]);
      if (fail === 'delete') throw new Error('API failure');
    },
  };
  return {
    calls,
    args: {
      context: { repo, sha: 'current-commit' },
      core: { info() {} },
      github: {
        rest: { repos },
        async paginate(method, args) {
          assert.equal(method, repos.listDeployments);
          assert.deepEqual(args, {
            ...repo,
            environment: 'github-pages',
            per_page: 100,
          });
          calls.push(['list']);
          return deployments;
        },
      },
    },
  };
}

test('retains only the newest successful Pages deployment, including same-SHA reruns', async () => {
  const { args, calls } = fixture([
    deployment(1, { sha: 'older-commit' }),
    deployment(5, { environment: 'preview' }),
    deployment(3),
    deployment(2),
  ]);
  assert.deepEqual(await cleanupPagesDeployments(args), {
    retained: 3,
    deleted: 2,
  });
  assert.deepEqual(calls, [
    ['list'],
    ['status', 3],
    ['inactive', 2],
    ['delete', 2],
    ['inactive', 1],
    ['delete', 1],
  ]);
});

test('cleans records beyond the first API page after collecting the full list', async () => {
  const { args, calls } = fixture(
    Array.from({ length: 205 }, (_, index) => deployment(index + 1)),
  );
  assert.deepEqual(await cleanupPagesDeployments(args), {
    retained: 205,
    deleted: 204,
  });
  assert.equal(
    calls.filter(([operation]) => operation === 'delete').length,
    204,
  );
  assert.deepEqual(calls.at(-1), ['delete', 1]);
});

test('a single current deployment needs no deletion', async () => {
  const { args, calls } = fixture([deployment(1)]);
  assert.deepEqual(await cleanupPagesDeployments(args), {
    retained: 1,
    deleted: 0,
  });
  assert.deepEqual(calls, [['list'], ['status', 1]]);
});

for (const { name, records } of [
  { name: 'missing deployment', records: [] },
  {
    name: 'another environment only',
    records: [deployment(1, { environment: 'preview' })],
  },
  {
    name: 'newer unrelated commit',
    records: [deployment(1), deployment(2, { sha: 'another-commit' })],
  },
]) {
  test(`does not mutate records with ${name}`, async () => {
    const { args, calls } = fixture(records);
    await assert.rejects(cleanupPagesDeployments(args), /does not match/);
    assert.deepEqual(calls, [['list']]);
  });
}

for (const state of [
  'failure',
  'error',
  'inactive',
  'queued',
  'pending',
  'in_progress',
  null,
]) {
  test(`does not delete when latest status is ${state}`, async () => {
    const { args, calls } = fixture([deployment(2), deployment(1)], { state });
    await assert.rejects(cleanupPagesDeployments(args), /not successful/);
    assert.deepEqual(calls, [['list'], ['status', 2]]);
  });
}

for (const fail of ['inactive', 'delete']) {
  test(`reports ${fail} API failures and stops further cleanup`, async () => {
    const { args, calls } = fixture(
      [deployment(3), deployment(2), deployment(1)],
      { fail },
    );
    await assert.rejects(cleanupPagesDeployments(args), /API failure/);
    assert.ok(!calls.some(([, id]) => id === 1));
    assert.ok(
      !calls.some(([operation, id]) => operation !== 'status' && id === 3),
    );
    if (fail === 'inactive')
      assert.ok(!calls.some(([operation]) => operation === 'delete'));
  });
}
