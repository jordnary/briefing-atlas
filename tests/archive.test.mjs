import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  readFile,
  unlink,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncArchive } from '../scripts/archive-sync.mjs';
import {
  convertMessage,
  convertChat,
  serializeBriefing,
  hash,
} from '../scripts/archive-convert.mjs';
import { parseBriefing, validateBriefing } from '../scripts/content.mjs';
import {
  readState,
  withArchiveLock,
  recoverBatch,
  assertArchiveReady,
  contentFile,
} from '../scripts/archive-store.mjs';
import { renderMarkdown } from '../scripts/render-markdown.mjs';
import {
  exportThreadPages,
  readSourceExport,
} from '../scripts/archive-input.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  publishArchive,
  verifyOnline,
  archiveVersion,
} from '../scripts/archive-publication.mjs';
const now = '2026-09-08T10:00:00Z';
test('reader exports exclude chatter, require complete pages, and accept Markdown with private receipts', async (t) => {
  const root = await workspace(t);
  const page = {
    thread: { id: 'test-source' },
    page: { hasMore: false },
    turns: [
      {
        status: 'completed',
        items: [
          { type: 'userMessage', text: message().text },
          { type: 'agentMessage', id: 'setup', text: 'Task saved.' },
          { type: 'agentMessage', id: 'source', text: message().text },
        ],
      },
    ],
  };
  const exported = exportThreadPages([page]);
  assert.equal(exported.messages.length, 1);
  assert.throws(
    () => exportThreadPages([{ ...page, page: { hasMore: true } }]),
    /READ_ALL_PAGES/,
  );
  assert.throws(
    () => exportThreadPages([{ isError: true, content: [] }]),
    /SOURCE_READER_FAILED/,
  );
  const file = path.join(root, 'briefing.md');
  await writeFile(file, message().text);
  await writeFile(
    `${file}.receipt.json`,
    JSON.stringify({
      source: 'test-source',
      messageId: 'source',
      role: 'assistant',
      status: 'completed',
      complete: true,
      sourcePublishedAt: null,
    }),
  );
  assert.equal((await readSourceExport(file)).messages[0].text, message().text);
});
test('empty content builds an empty index and published samples fail the production gate', async (t) => {
  const root = await workspace(t);
  const script = fileURLToPath(
    new URL('../scripts/build-content.mjs', import.meta.url),
  );
  await promisify(execFile)(process.execPath, [script], { cwd: root });
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(root, 'public/search-index.json'), 'utf8'),
    ),
    [],
  );
  await syncArchive(batch(), { root, now });
  const file = contentFile(root, '2026-09-08');
  const content = await readFile(file, 'utf8');
  await writeFile(file, content.replace('"sample": false', '"sample": true'));
  await assert.rejects(
    promisify(execFile)(process.execPath, [script], { cwd: root }),
    (error) => error.stderr.includes('SAMPLE_CONTENT_IS_NOT_PUBLISHABLE'),
  );
});
const message = (date = '2026-09-08', id = date) => ({
  messageId: id,
  role: 'assistant',
  status: 'completed',
  complete: true,
  sourcePublishedAt: null,
  text: `# AI & Tech Briefing · ${date}\n\n原文导语。\n\n## 1. 保留标题\n\n正文数字 129，不改写。\n\n**研究启示：** 保留原有小标题。\n\n[原来源](https://example.org/story)\n\n---\n\n## 2. 第二条\n\n代码：\n\n\x60\x60\x60text\n## 3. 这不是新闻\n<script>code sample</script>\n---\n\x60\x60\x60\n\n---\n\n结语含公式：\n\n\\[\nx^2 + y^2\n\\]\n`,
});
const batch = (messages = [message()]) => ({
  version: 1,
  source: 'test-source',
  complete: true,
  messages,
  missingDates: ['2026-08-27'],
});
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('faithful conversion preserves headings, code, closing math and nullable times', () => {
  const item = convertMessage(message(), { now });
  assert.equal(item.stories.length, 2);
  assert.match(item.stories[1].body, /## 3\. 这不是新闻/);
  assert.equal(item.sourcePublishedAt, null);
  assert.match(item.outro, /\\\[/);
  assert.equal(item.stories[0].verificationStatus, 'pending');
  assert.deepEqual(parseBriefing(serializeBriefing(item)), item);
  assert.doesNotThrow(() =>
    validateBriefing({
      ...item,
      stories: item.stories.map((s) => ({ ...s, tags: [], entities: [] })),
    }),
  );
  assert.throws(
    () => validateBriefing({ ...item, sourceMessageId: 'private' }),
    /Unknown content field/,
  );
  assert.throws(
    () => convertMessage({ ...message(), briefingDate: '2026-09-07' }),
    /DATE/,
  );
  assert.throws(
    () =>
      convertMessage({
        ...message(),
        text: message().text.replace('2026-09-08', '没有日期'),
      }),
    /DATE/,
  );
});
test('chat conversion uses only provided citation metadata and keeps image loss explicit', () => {
  assert.equal(
    convertChat('entity["company","OpenAI","description"]'),
    'OpenAI',
  );
  assert.equal(convertChat('citeturn0news1'), '（原引用链接暂未恢复）');
  assert.equal(
    convertChat('citeturn0news1', {
      turn0news1: { title: 'Article', url: 'https://example.org/a' },
    }),
    '[Article](https://example.org/a)',
  );
  assert.equal(
    convertChat('image_group{"query":["never search"]}'),
    '原配图暂未恢复',
  );
});
test('math renderer supports both block syntaxes, inline math and literal code', () => {
  for (const src of ['\\[\nx^2\n\\]\n', '$$\nx^2\n$$\n'])
    assert.match(renderMarkdown(src), /katex-display/);
  assert.match(renderMarkdown('value $x$ and \\(y\\)'), /katex/);
  assert.doesNotMatch(renderMarkdown('`$x$`'), /class="katex/);
  assert.doesNotMatch(
    renderMarkdown('[unsafe](javascript:alert%281%29)'),
    /href=/,
  );
  assert.match(renderMarkdown('<script>x</script>'), /&lt;script&gt;/);
});
test('unchanged source does not touch content or private state; aliases do not republish', async (t) => {
  const root = await workspace(t);
  const opts = { root, now };
  assert.equal((await syncArchive(batch(), opts)).status, 'archived');
  const file = contentFile(root, '2026-09-08'),
    stateFile = path.join(root, 'work/archive-sync/state.json');
  const before = await stat(file),
    stateBefore = await readFile(stateFile, 'utf8');
  assert.equal((await syncArchive(batch(), opts)).status, 'unchanged');
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(stateFile, 'utf8'), stateBefore);
  assert.equal(
    (await syncArchive(batch([message('2026-09-08', 'alias')]), opts)).status,
    'reconciled',
  );
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
});
test('same-date conflicts and partial input protect the entire batch', async (t) => {
  const root = await workspace(t);
  await syncArchive(batch(), { root, now });
  const before = await readFile(contentFile(root, '2026-09-08'), 'utf8');
  const conflicting = {
    ...message('2026-09-08', 'other'),
    text: message().text.replace('129', '130'),
  };
  const result = await syncArchive(
    batch([message('2026-09-09'), conflicting]),
    { root, now },
  );
  assert.equal(result.pending[0].code, 'SAME_DATE_CONFLICT');
  assert.equal(await readFile(contentFile(root, '2026-09-08'), 'utf8'), before);
  await assert.rejects(readFile(contentFile(root, '2026-09-09')), /ENOENT/);
  for (const update of [
    { complete: false },
    { role: 'user' },
    { status: 'running' },
    { text: message().text + '\n[truncated]' },
  ]) {
    assert.equal(
      (await syncArchive(batch([{ ...message(), ...update }]), { root, now }))
        .status,
      'pending',
    );
    assert.equal(
      await readFile(contentFile(root, '2026-09-08'), 'utf8'),
      before,
    );
  }
  await assert.rejects(
    syncArchive({ ...batch(), complete: false }, { root, now }),
    /INVALID_SOURCE_EXPORT/,
  );
});
test('edited source requires review and preserves stable anchors when reordered or renamed', async (t) => {
  const root = await workspace(t);
  await syncArchive(batch(), { root, now });
  const update = { ...message(), text: message().text.replace('129', '130') };
  assert.equal(
    (await syncArchive(batch([update]), { root, now })).pending[0].code,
    'REVISION_REVIEW_REQUIRED',
  );
  await syncArchive(batch([update]), { root, now, acceptRevisions: true });
  const first = parseBriefing(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
  );
  assert.equal(first.revision, 2);
  assert.equal(first.corrections.length, 1);
  const renamed = {
    ...update,
    text: update.text.replace('保留标题', '修订标题'),
  };
  await syncArchive(batch([renamed]), { root, now, acceptRevisions: true });
  const second = parseBriefing(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
  );
  assert.equal(second.stories[0].id, first.stories[0].id);
  const reordered = {
    ...second,
    stories: [second.stories[1], second.stories[0]],
  };
  const source = {
    ...message(),
    text: `# AI & Tech Briefing · 2026-09-08\n\n${second.intro}\n\n${reordered.stories.map((s, i) => `## ${i + 1}. ${s.title}\n\n${s.body}`).join('\n\n---\n\n')}\n\n---\n\n${second.outro}`,
  };
  await syncArchive(batch([source]), { root, now, acceptRevisions: true });
  const third = parseBriefing(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
  );
  assert.equal(third.stories[0].id, first.stories[1].id);
  const ambiguous = {
    ...source,
    text: source.text
      .replace('第二条', '完全改名')
      .replace('代码：', '内容也变化：'),
  };
  assert.equal(
    (
      await syncArchive(batch([ambiguous]), {
        root,
        now,
        acceptRevisions: true,
      })
    ).pending[0].code,
    'STORY_MAPPING_REQUIRED',
  );
});
test('explicit story mappings may add date-scoped stories while retaining all prior IDs', async (t) => {
  const root = await workspace(t);
  const text = (stories) =>
    `# AI & Tech Briefing · 2026-09-08\n\n原文导语。\n\n${stories
      .map((title, index) => `## ${index + 1}. ${title}\n\n正文 ${index + 1}。`)
      .join('\n\n---\n\n')}\n\n---\n\n结语。`;
  const initial = {
    ...message('2026-09-08', 'mapped'),
    text: text(['第一条', '第二条', '第三条']),
  };
  await syncArchive(batch([initial]), { root, now });
  const revised = {
    ...initial,
    text: text(['第一条', '第二条', '第三条', '新增第四条', '新增第五条']),
    storyMapping: {
      '4': 'briefing-2026-09-08-04',
      '5': 'briefing-2026-09-08-05',
    },
  };
  assert.equal(
    (await syncArchive(batch([revised]), { root, now })).pending[0].code,
    'REVISION_REVIEW_REQUIRED',
  );
  await syncArchive(batch([revised]), {
    root,
    now,
    acceptRevisions: true,
  });
  const parsed = parseBriefing(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
  );
  assert.deepEqual(
    parsed.stories.map((story) => story.id),
    [
      'briefing-2026-09-08-01',
      'briefing-2026-09-08-02',
      'briefing-2026-09-08-03',
      'briefing-2026-09-08-04',
      'briefing-2026-09-08-05',
    ],
  );
});
test('format-only conversion does not pretend that the original source was revised', async (t) => {
  const root = await workspace(t);
  await syncArchive(batch(), { root, now });
  await syncArchive(batch(), { root, now, converterVersion: 4 });
  const item = parseBriefing(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
  );
  assert.equal(item.revision, 1);
  assert.equal(item.formatRevision, 2);
  assert.equal(item.corrections[0].kind, 'format');
});
test('interrupted saves block builds and recover content plus state before the next run', async (t) => {
  const root = await workspace(t),
    input = batch([message(), message('2026-09-09')]);
  await assert.rejects(
    syncArchive(input, { root, now, interruptAfter: 1 }),
    /SIMULATED_SAVE_INTERRUPTION/,
  );
  await assert.rejects(assertArchiveReady(root), /RECOVERY_REQUIRED/);
  await withArchiveLock(root, () => recoverBatch(root));
  assert.equal(Object.keys((await readState(root)).records).length, 2);
  assert.equal((await syncArchive(input, { root, now })).status, 'unchanged');
  await unlink(path.join(root, 'work/archive-sync/state.json'));
  assert.equal((await syncArchive(input, { root, now })).status, 'unchanged');
  assert.equal(Object.keys((await readState(root)).records).length, 2);
});
test('recovery protects intervening edits, and concurrent writers share the lock', async (t) => {
  const root = await workspace(t);
  await withArchiveLock(root, async () => {
    await assert.rejects(syncArchive(batch(), { root, now }), /ARCHIVE_LOCKED/);
  });
  await assert.rejects(
    syncArchive(batch(), { root, now, interruptAfter: 1 }),
    /SIMULATED_SAVE_INTERRUPTION/,
  );
  await writeFile(contentFile(root, '2026-09-08'), 'intervening edit');
  await assert.rejects(
    withArchiveLock(root, () => recoverBatch(root)),
    /RECOVERY_CONTENT_CONFLICT/,
  );
});
test('missing dates are filled only by real source; exact cross-issue corrections are appended once', async (t) => {
  const root = await workspace(t);
  await syncArchive(batch(), { root, now });
  const late = message('2026-08-27');
  await syncArchive(batch([late]), { root, now });
  assert.deepEqual((await readState(root)).missingDates, []);
  const note = '2026-09-08 更正：数字应为 130。';
  const correction = {
    ...message('2026-09-09'),
    text: message('2026-09-09').text + '\n' + note,
    corrections: [{ targetDate: '2026-09-08', note }],
  };
  await syncArchive(batch([correction]), { root, now });
  await syncArchive(batch([correction]), { root, now });
  const item = parseBriefing(
    await readFile(contentFile(root, '2026-09-08'), 'utf8'),
  );
  assert.equal(item.corrections.length, 1);
  assert.match(item.stories[0].body, /129/);
  assert.equal(
    (await readState(root)).records['2026-09-08'].archiveHash,
    hash(serializeBriefing(item)),
  );
});
test('publication resumes only failed stages and becomes quiet after online verification', async (t) => {
  const root = await workspace(t);
  await syncArchive(batch(), { root, now });
  const calls = { build: 0, deploy: 0, verify: 0 };
  const adapters = {
    root,
    build: async () => {
      calls.build++;
    },
    deploy: async () => {
      calls.deploy++;
      if (calls.deploy === 1) throw new Error('DEPLOY_FAILED');
      return { id: 'receipt', url: 'https://example.org/' };
    },
    verify: async () => {
      calls.verify++;
      return calls.verify > 1;
    },
  };
  await assert.rejects(publishArchive(adapters), /DEPLOY_FAILED/);
  assert.equal((await readState(root)).publication.failedStage, 'deploy');
  await assert.rejects(publishArchive(adapters), /ONLINE_VERSION_MISMATCH/);
  assert.equal((await readState(root)).publication.verifiedVersion, undefined);
  assert.equal((await publishArchive(adapters)).status, 'verified');
  assert.equal((await publishArchive(adapters)).status, 'unchanged');
  assert.deepEqual(calls, { build: 1, deploy: 2, verify: 2 });
});
test('build failure keeps deployment unchanged and succeeds using already saved content', async (t) => {
  const root = await workspace(t);
  await syncArchive(batch(), { root, now });
  let fail = true;
  const opts = {
    root,
    build: async () => {
      if (fail) throw new Error('BUILD_FAILED');
    },
    deploy: async () => ({ id: 'receipt', url: 'https://example.org/' }),
    verify: async () => true,
  };
  await assert.rejects(publishArchive(opts), /BUILD_FAILED/);
  assert.equal((await readState(root)).publication.deployedVersion, undefined);
  fail = false;
  assert.equal((await publishArchive(opts)).status, 'verified');
});
test('online verification checks content version and latest page, bounds retries, and stops at access errors', async (t) => {
  const root = await workspace(t);
  await syncArchive(batch(), { root, now });
  const version = await archiveVersion(root);
  let count = 0;
  await assert.rejects(
    verifyOnline('https://example.org/', version, {
      fetcher: async () => {
        count++;
        return new Response('', { status: 401 });
      },
    }),
    /AUTHORIZATION/,
  );
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(
    verifyOnline('https://example.org/', version, {
      fetcher: async () => {
        count++;
        throw new TypeError('network');
      },
    }),
  );
  assert.equal(count, 3);
  await assert.rejects(
    verifyOnline('https://example.org/', version, {
      fetcher: async () => Response.json({ archiveVersion: 'old', issues: [] }),
    }),
    /ONLINE_VERSION_MISMATCH/,
  );
});

test('online verification checks integrity files and retries stale CDN responses', async () => {
  const issues = [{ date: '2026-09-10' }];
  const version = hash(JSON.stringify(issues));
  const search = '[]';
  const page = '<a id="briefing-2026-09-10-01"></a>';
  const integrity = {
    version: 1,
    archiveVersion: version,
    files: {
      'search-index.json': hash(search),
      'briefings/2026-09-10/index.html': hash(page),
    },
  };
  let attempt = 0;
  let searchAttempts = 0;
  const delays = [];
  await verifyOnline('https://example.org/', version, {
    delay: async (ms) => delays.push(ms),
    fetcher: async (url) => {
      const href = url instanceof URL ? url.href : typeof url === 'string' ? url : url.href ?? '';
      if (href.includes('archive-manifest')) {
        attempt++;
        if (attempt === 1)
          return Response.json({ archiveVersion: version, issues });
        return Response.json({ archiveVersion: version, issues });
      }
      if (href.includes('build-integrity')) return Response.json(integrity);
      if (href.includes('search-index')) {
        searchAttempts++;
        return new Response(searchAttempts === 1 ? 'stale' : search);
      }
      return new Response(page);
    },
  });
  assert.deepEqual(delays, [250]);
});
