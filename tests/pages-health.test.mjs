import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparePagesVersions,
  retryCommandIsAllowed,
} from '../scripts/pages-health.mjs';
import {
  ONLINE_VERIFY_MAX_ATTEMPTS,
  RETRYABLE_ONLINE_ERRORS,
} from '../scripts/archive-publication.mjs';

test('health detects deployment and online version drift', () => {
  assert.deepEqual(
    comparePagesVersions({
      masterCommit: 'a',
      deployedCommit: 'b',
      expectedVersion: 'v1',
      onlineVersion: 'v2',
    }),
    {
      healthy: false,
      drift: ['DEPLOYMENT_VERSION_DRIFT', 'ONLINE_VERSION_DRIFT'],
    },
  );
  assert.equal(
    comparePagesVersions({
      masterCommit: 'a',
      deployedCommit: 'a',
      expectedVersion: 'v1',
      onlineVersion: 'v1',
    }).healthy,
    true,
  );
});

test('only explicit transient errors are retryable', () => {
  assert.equal(retryCommandIsAllowed('TEMPORARY_SERVER_ERROR'), true);
  assert.equal(retryCommandIsAllowed('NETWORK_ERROR'), true);
  assert.equal(retryCommandIsAllowed('ONLINE_VERSION_MISMATCH'), false);
  assert.equal(retryCommandIsAllowed('TEST_FAILED'), false);
  assert.equal(ONLINE_VERIFY_MAX_ATTEMPTS, 3);
  assert.ok(RETRYABLE_ONLINE_ERRORS.includes('TEMPORARY_SERVER_ERROR'));
});
