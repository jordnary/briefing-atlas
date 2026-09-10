import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  fetchSourceExport,
  validateSourceExport,
} from '../scripts/fetch-source.mjs';
import { syncFromGitHub } from '../scripts/sync-source.mjs';

const text = `# AI & Tech Briefing · 2026-09-10\n\n导语。\n\n## 1. 测试新闻\n\n正文。\n\n---\n\n结语。\n`;
const payload = {
  version: 1,
  source: 'private-thread',
  complete: true,
  messages: [
    {
      messageId: 'm-1',
      role: 'assistant',
      status: 'completed',
      complete: true,
      text,
    },
  ],
};
const env = {
  BRIEFING_SOURCE_REPO: 'org/briefing_source',
  BRIEFING_SOURCE_PATH: 'exports/latest.json',
  BRIEFING_SOURCE_REF: 'abc123',
  BRIEFING_SOURCE_TOKEN: 'secret-token',
  BRIEFING_SOURCE_ID: 'private-thread',
  GITHUB_API_URL: 'https://api.github.test',
};

test('fetches pinned private GitHub Contents path without exposing token', async () => {
  let request;
  const result = await fetchSourceExport({
    env,
    fetcher: async (url, options) => {
      request = { url: url instanceof URL ? url.href : url, options };
      return Response.json(payload);
    },
  });
  assert.deepEqual(result, payload);
  assert.match(request.url, /repos\/org\/briefing_source\/contents\/exports\/latest\.json\?ref=abc123$/);
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  assert.equal(request.options.headers.Accept, 'application/vnd.github.raw+json');
});

test('decodes Contents API base64 envelope and rejects malformed source', async () => {
  const envelope = {
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(payload)).toString('base64'),
  };
  assert.deepEqual(
    await fetchSourceExport({ env, fetcher: async () => Response.json(envelope) }),
    payload,
  );
  await assert.rejects(
    fetchSourceExport({ env, fetcher: async () => new Response('oops') }),
    /INVALID_SOURCE_JSON/,
  );
});

test('maps private API failures and validates message invariants', async () => {
  for (const [status, code] of [
    [401, 'BRIEFING_SOURCE_AUTH_FAILED'],
    [404, 'BRIEFING_SOURCE_NOT_FOUND'],
    [503, 'BRIEFING_SOURCE_TEMPORARY_FAILURE'],
  ])
    await assert.rejects(
      fetchSourceExport({ env, fetcher: async () => new Response('', { status }) }),
      new RegExp(code),
    );
  assert.throws(() => validateSourceExport({ ...payload, complete: false }), /INVALID_SOURCE_EXPORT/);
  assert.throws(
    () => validateSourceExport({ ...payload, messages: [{ ...payload.messages[0], role: 'user' }] }),
    /INVALID_SOURCE_MESSAGE/,
  );
  assert.throws(
    () => validateSourceExport({ ...payload, source: 'other' }, { expectedSource: 'private-thread' }),
    /SOURCE_SELECTION_MISMATCH/,
  );
});

test('writes incoming export atomically and leaves it untouched when unchanged', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fetch-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'incoming/source-export.json');
  const opts = { root, output, repo: env.BRIEFING_SOURCE_REPO, token: env.BRIEFING_SOURCE_TOKEN, sourcePath: env.BRIEFING_SOURCE_PATH, ref: env.BRIEFING_SOURCE_REF, api: env.GITHUB_API_URL, fetcher: async () => Response.json(payload), now: '2026-09-11T00:00:00Z' };
  const first = await syncFromGitHub(opts);
  assert.equal(first.fetched.downloaded, true);
  const file = output;
  const before = await stat(file);
  const content = await readFile(file, 'utf8');
  assert.match(content, /private-thread/);
  const second = await syncFromGitHub(opts);
  assert.equal(second.fetched.downloaded, false);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal((await readFile(file, 'utf8')), content);
});
