import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDate,
  monthDays,
  shiftMonth,
  shanghaiDate,
  searchStories,
  defaultState,
  validateReadingState,
} from '../lib/domain.mjs';
import {
  loadBriefings,
  parseBriefing,
  validateBriefing,
  validateCollection,
} from '../scripts/content.mjs';
test('calendar handles leap days, empty grid cells and year boundaries', () => {
  assert.equal(isDate('2024-02-29'), true);
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(isDate('2026-02-31'), false);
  assert.equal(isDate('2026-13-01'), false);
  assert.equal(monthDays('2024-02').filter(Boolean).length, 29);
  assert.equal(monthDays('2026-02').filter(Boolean).length, 28);
  assert.equal(monthDays('2026-09')[0], null);
  assert.equal(monthDays('2026-09')[1], '2026-09-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2025-12', 1), '2026-01');
});
test('archive day follows Shanghai regardless of UTC date', () => {
  assert.equal(shanghaiDate(new Date('2026-09-07T15:59:59Z')), '2026-09-07');
  assert.equal(shanghaiDate(new Date('2026-09-07T16:00:00Z')), '2026-09-08');
});
test('search combines multilingual text, entity, topic and inclusive dates', () => {
  const rows = [
    {
      id: 'a',
      title: 'LoRA 低秩适配',
      summary: '模型',
      body: '冻结原有权重',
      tags: ['开发工具'],
      entities: ['Microsoft'],
      briefingDate: '2026-09-08',
    },
    {
      id: 'b',
      title: 'RAG',
      summary: '检索',
      body: '资料',
      tags: ['AI'],
      entities: ['Meta'],
      briefingDate: '2026-08-28',
    },
  ];
  assert.equal(searchStories(rows, { q: 'lora 冻结' }).length, 1);
  assert.equal(
    searchStories(rows, {
      q: 'ＬＯＲＡ',
      tag: '开发工具',
      entity: 'Microsoft',
      from: '2026-09-08',
      to: '2026-09-08',
    })[0].id,
    'a',
  );
  assert.equal(searchStories(rows, { q: 'RAG', tag: '开发工具' }).length, 0);
  assert.equal(
    searchStories(rows, { from: '2026-09-09', to: '2026-09-01' }).length,
    0,
  );
  assert.equal(searchStories(rows, { q: '不存在' }).length, 0);
});
test('backup validator rejects invalid states and strips unknown fields', () => {
  assert.throws(() => validateReadingState({ version: 2 }));
  assert.throws(() =>
    validateReadingState({
      ...defaultState,
      bookmarks: ['javascript:alert(1)'],
    }),
  );
  assert.throws(() =>
    validateReadingState({
      ...defaultState,
      lastRead: { date: '2026-02-30', storyId: 'a' },
    }),
  );
  const clean = validateReadingState({
    ...defaultState,
    bookmarks: ['a', 'a'],
    extra: 'private',
  });
  assert.deepEqual(clean.bookmarks, ['a']);
  assert.equal('extra' in clean, false);
});
const issues = await loadBriefings('tests/fixtures/briefings');
test('content has globally stable ids and validates as a collection', () => {
  assert.ok(issues.length >= 1);
  assert.doesNotThrow(() => validateCollection(issues));
  assert.throws(() => validateCollection([...issues, issues[0]]));
});
test('content rejects impossible dates, duplicate ids, drafts masquerading as statuses and unsafe sources', () => {
  const first = issues[0];
  assert.throws(() =>
    validateBriefing({ ...first, briefingDate: '2026-02-30' }),
  );
  assert.throws(() =>
    validateBriefing({ ...first, updatedAt: '2000-01-01T00:00:00Z' }),
  );
  assert.throws(() => validateBriefing({ ...first, status: 'public' }));
  assert.throws(() =>
    validateBriefing({
      ...first,
      stories: [first.stories[0], first.stories[0]],
    }),
  );
  assert.throws(() =>
    validateBriefing({
      ...first,
      stories: [
        {
          ...first.stories[0],
          sources: [
            { title: 'Unsafe', url: 'javascript:alert(1)', type: 'paper' },
          ],
        },
      ],
    }),
  );
  assert.throws(() =>
    validateBriefing({
      ...first,
      stories: [
        {
          ...first.stories[0],
          body: first.stories[0].body + '\n<script>alert(1)</script>',
        },
      ],
    }),
  );
  assert.throws(() =>
    validateBriefing({
      ...first,
      stories: [
        { ...first.stories[0], sources: [], verificationStatus: 'verified' },
      ],
    }),
  );
});
test('Markdown parser requires a matching body for each story', () => {
  const { stories, ...meta } = issues[0];
  const input = `---\n${JSON.stringify({ ...meta, stories: stories.map(({ body: _body, ...story }) => story) })}\n---\n${stories.map((story) => `## ${story.id}\n${story.body}`).join('\n')}`;
  assert.equal(parseBriefing(input).stories.length, stories.length);
  assert.throws(() =>
    parseBriefing(input.replace(`## ${stories[0].id}`, '## unmatched')),
  );
});
test('adjacent dates come from existing records and cross missing days', () => {
  const dates = ['2026-09-08', '2026-09-07', '2026-09-04', '2025-12-31'];
  assert.equal(dates[dates.indexOf('2026-09-07') + 1], '2026-09-04');
  assert.equal(dates.at(-1), '2025-12-31');
});
