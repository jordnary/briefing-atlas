import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchIndex,
  parseSearchQuery,
  searchStories,
  searchStoriesDetailed,
  searchPresentation,
  searchHighlightRanges,
  SEARCH_LIMITS,
  DEFAULT_SEARCH_WEIGHTS,
  isSearchIndexPayload,
} from '../lib/search.mjs';
import {
  defaultSearchState,
  readSearchState,
  writeSearchState,
} from '../lib/search-state.mjs';
import { executeSearchTool } from '../lib/search-tool.mjs';

const story = (id, title, body = '', extra = {}) => ({
  id,
  title,
  body,
  summary: '',
  tags: [],
  entities: [],
  sources: [],
  briefingDate: '2026-09-08',
  ...extra,
});
const corpus = [
  story('a', 'Agent 安全研究', 'incident report 与工具调用', {
    entities: ['OpenAI'],
    tags: ['AI 与大模型'],
    briefingDate: '2026-09-08',
  }),
  story('b', '游戏开发', 'Agent 与 Unity', {
    entities: ['Microsoft'],
    tags: ['开发工具'],
    briefingDate: '2026-09-07',
  }),
  story('c', '模型部署', 'LoRA 冻结原有权重', {
    entities: ['Meta'],
    tags: ['AI 与大模型'],
    briefingDate: '2026-08-28',
  }),
  story('d', 'Agentic systems', 'incident response report', {
    sources: [{ title: 'Nature Research' }],
    briefingDate: '2026-08-28',
  }),
];
const ids = (q, filters = {}, rows = corpus) =>
  searchStories(rows, { q, ...filters }).map((row) => row.id);
const unordered = (q, expected, filters = {}, rows = corpus) =>
  assert.deepEqual(
    ids(q, filters, rows).sort((a, b) => a.localeCompare(b)),
    expected.slice().sort((a, b) => a.localeCompare(b)),
  );

test('Boolean precedence, implicit AND, nested groups, exclusion and double negation', () => {
  unordered('Agent OR LoRA AND 冻结', ['a', 'b', 'c']);
  unordered('(Agent OR LoRA) NOT 游戏', ['a', 'c']);
  unordered('Agent -游戏', ['a']);
  unordered('Agent -(游戏 OR 工具)', []);
  unordered('NOT NOT title:Agent', ['a']);
  unordered('-(-title:Agent)', ['a']);
  unordered('+Agent +Unity', ['b']);
  unordered('NOT Agent', ['c', 'd']);
});
test('any-keyword mode preserves explicit AND precedence', () => {
  unordered('LoRA Unity', ['b', 'c'], { match: 'any' });
  unordered('Agent AND 安全 Unity', ['a', 'b'], { match: 'any' });
  unordered('LoRA Unity', []);
});
test('phrases are contiguous and never span fields or metadata entries', () => {
  unordered('"incident report"', ['a']);
  unordered('“incident report”', ['a']);
  const rows = [
    story('a', 'incident', 'report', { entities: ['New', 'York'] }),
    story('b', 'incident-report'),
  ];
  unordered('"incident report"', [], {}, rows);
  unordered('entity:"New York"', [], {}, rows);
  unordered('"incident-report"', ['b'], {}, rows);
});
test('field qualifiers, grouped fields and Chinese aliases target their own field', () => {
  unordered('title:(Agent OR 模型)', ['a', 'c']);
  unordered('body:Agent', ['b']);
  unordered('标题:Agent 正文:"incident report"', ['a']);
  unordered('entity:openai tag:"AI 与大模型"', ['a']);
  unordered('source:"Nature Research"', ['d']);
  unordered('Agent', ['a'], { scope: 'title' });
  unordered('body:Agent', ['b'], { scope: 'title' });
});
test('Latin words avoid incidental substrings, while Chinese works without spaces', () => {
  unordered('Agent', ['a', 'b']);
  unordered('agent*', ['a', 'b', 'd']);
  unordered('冻结 权重', ['c']);
  unordered('AI', [], {}, [story('a', 'daily OpenAI training')]);
  unordered('AI', ['a'], {}, [story('a', '中文AI工具')]);
  unordered('ＧＰＴ-５', ['a'], {}, [story('a', 'GPT-5 release')]);
});
test('literal punctuation, escaped operators and quoted operators remain searchable', () => {
  const rows = [
    story(
      'a',
      'C++ .NET $x a+b [test] (design)',
      'AND OR NOT literal* https://example.org',
    ),
  ];
  for (const q of [
    'C++',
    '.NET',
    '$x',
    'a+b',
    '[test]',
    '"(design)"',
    '"AND"',
    '\\OR',
    '"literal*"',
    '"https://example.org"',
  ])
    unordered(q, ['a'], {}, rows);
});

test('contextual Unicode casing uses the same normalization for matching and highlighting', () => {
  const row = story('a', 'ΟΣ Cafe\u0301');
  const result = searchStoriesDetailed([row], { q: 'ος café' }).results[0];
  assert.deepEqual(
    searchPresentation(result).title.map(([start, end]) =>
      row.title.slice(start, end),
    ),
    ['ΟΣ', 'Cafe\u0301'],
  );
});
test('dates are validated; picker dates include endpoints; before/after are exclusive', () => {
  unordered('date:2026-09', ['a', 'b']);
  unordered('date:2026', ['a', 'b', 'c', 'd']);
  unordered('after:2026-08-28 before:2026-09-08', ['b']);
  unordered('date:(2026-09-08 OR 2026-08-28)', ['a', 'c', 'd']);
  unordered('', ['a'], { from: '2026-09-08', to: '2026-09-08' });
  unordered('', [], { from: '2026-09-09', to: '2026-09-08' });
});
test('invalid expressions fail closed with helpful diagnostics', () => {
  for (const q of [
    'AND Agent',
    'Agent AND',
    'Agent OR',
    'NOT',
    '-',
    '+',
    '()',
    '(Agent',
    'Agent)',
    '"Agent',
    '""',
    'title:',
    'typo:Agent',
    'Agent OR OR Unity',
    'date:2026-02-30',
    'date:2026-13',
    'before:2026-09',
    '*',
    'a*',
    'ag*ent',
    'agent**',
    'Agent \\',
  ]) {
    const parsed = parseSearchQuery(q);
    assert.ok(parsed.errors.length, q);
    assert.equal(typeof parsed.errors[0].position, 'number');
    const result = searchStoriesDetailed(corpus, { q });
    assert.equal(result.results.length, 0, q);
    assert.ok(result.errors.length, q);
  }
});
test('query limits prevent excessive nesting and unbounded clauses', () => {
  for (const q of [
    'x'.repeat(SEARCH_LIMITS.length + 1),
    '('.repeat(SEARCH_LIMITS.depth + 1) +
      'a' +
      ')'.repeat(SEARCH_LIMITS.depth + 1),
    Array(SEARCH_LIMITS.terms + 1)
      .fill('Agent')
      .join(' '),
  ])
    assert.ok(parseSearchQuery(q).errors.length);
  assert.equal(parseSearchQuery(' ').errors.length, 0);
});
test('filters normalize metadata, reject invalid configuration and preserve input records', () => {
  const snapshot = structuredClone(corpus);
  unordered('Agent', ['a'], { entity: 'ＯＰＥＮＡＩ', tag: 'ai 与大模型' });
  for (const filters of [
    { from: 'invalid' },
    { to: '2026-02-30' },
    { entity: [] },
    { sort: 'bad' },
    { scope: 'unknown' },
    { match: 'maybe' },
    { weights: null },
    { weights: [] },
    { weights: { title: -1 } },
    { weights: { title: 21 } },
    { weights: { title: NaN } },
    { weights: { title: Infinity } },
    { weights: { title: '8' } },
    { weights: { unknown: 8 } },
  ])
    assert.ok(searchStoriesDetailed(corpus, filters).errors.length);
  assert.deepEqual(corpus, snapshot);
});
test('default ranking favors title over repetitive body and custom weights reverse it', () => {
  const rows = [
    story('body', 'Other', 'Agent '.repeat(100), {
      briefingDate: '2026-09-09',
    }),
    story('title', 'Agent', 'Unrelated'),
  ];
  assert.deepEqual(ids('Agent', {}, rows), ['title', 'body']);
  assert.deepEqual(ids('Agent', { weights: { title: 1, body: 20 } }, rows), [
    'body',
    'title',
  ]);
  assert.deepEqual(ids('Agent', { weights: { title: 0, body: 1 } }, rows), [
    'body',
    'title',
  ]);
  const zero = Object.fromEntries(
    Object.keys(DEFAULT_SEARCH_WEIGHTS).map((field) => [field, 0]),
  );
  assert.ok(
    searchStoriesDetailed(rows, { q: 'Agent', weights: zero }).results.every(
      (result) => result.score === 0,
    ),
  );
});
test('rank has deterministic date/id ties, date sorting and deduplicated query scores', () => {
  const rows = [
    story('z', 'Agent'),
    story('a', 'Agent'),
    story('old', 'Agent', '', { briefingDate: '2026-08-28' }),
  ];
  assert.deepEqual(ids('Agent', {}, rows), ['a', 'z', 'old']);
  assert.deepEqual(ids('', { sort: 'oldest' }, rows), ['old', 'a', 'z']);
  assert.deepEqual(ids('Agent', { sort: 'newest' }, rows), ['a', 'z', 'old']);
  assert.equal(
    searchStoriesDetailed(rows, { q: 'Agent Agent' }).results[0].score,
    searchStoriesDetailed(rows, { q: 'Agent' }).results[0].score,
  );
});
test('reusable index and direct search return identical records and scores', () => {
  const index = createSearchIndex(corpus);
  for (const q of ['', 'Agent', 'title:Agent OR LoRA', '-游戏', 'agent*'])
    assert.deepEqual(
      searchStoriesDetailed(index, { q }),
      searchStoriesDetailed(corpus, { q }),
    );
});
test('negative and failed OR branches never contribute scores, badges or highlights', () => {
  const rows = [story('a', 'Agent report', 'tools')];
  const positive = searchStoriesDetailed(rows, { q: 'Agent' }).results[0];
  const result = searchStoriesDetailed(rows, {
    q: 'Agent OR (report AND missing)',
  }).results[0];
  assert.equal(result.score, positive.score);
  assert.deepEqual(
    result.terms.map((term) => term.value),
    ['agent'],
  );
  const excluded = searchStoriesDetailed(rows, {
    q: 'NOT (report AND missing)',
  }).results[0];
  assert.equal(excluded.score, 0);
  assert.deepEqual(searchPresentation(excluded), {
    title: [],
    summary: [],
    snippet: null,
  });
});
test('highlighting follows normalized graphemes, field scope, phrases, prefix expansion and overlapping matches', () => {
  const rows = [story('a', 'ＬｏＲＡ ﬁne Cafe\u0301 agentic', 'LoRA')];
  const result = searchStoriesDetailed(rows, { q: 'lora fine café agent*' })
    .results[0];
  const ranges = searchPresentation(result).title;
  assert.deepEqual(
    ranges.map(([start, end]) => rows[0].title.slice(start, end)),
    ['ＬｏＲＡ', 'ﬁne', 'Cafe\u0301', 'agentic'],
  );
  const scoped = searchStoriesDetailed(rows, { q: 'body:lora' }).results[0];
  assert.deepEqual(searchPresentation(scoped).title, []);
  assert.equal(searchPresentation(scoped).snippet.field, 'body');
  const phrase = searchStoriesDetailed(corpus, { q: '"incident report"' })
    .results[0];
  assert.deepEqual(
    searchHighlightRanges('incident   report', phrase.terms, 'body'),
    [[0, 17]],
  );
});
test('snippets locate distant body matches and report briefing/source-only matches', () => {
  const rows = [
    story('a', '标题', `${'前文。'.repeat(180)}target 研究细节`, {
      briefingIntro: '仅有导读线索',
      sources: [{ title: '独特来源' }],
    }),
  ];
  const body = searchPresentation(
    searchStoriesDetailed(rows, { q: 'target' }).results[0],
  );
  assert.match(body.snippet.text, /^….*target/u);
  assert.ok(body.snippet.text.length <= 222);
  assert.ok(body.snippet.ranges.length);
  for (const [q, field] of [
    ['导读线索', 'briefing'],
    ['独特来源', 'source'],
  ])
    assert.equal(
      searchPresentation(searchStoriesDetailed(rows, { q }).results[0]).snippet
        .field,
      field,
    );
});
test('metadata gallery text and link destinations never enter search prose', () => {
  const rows = [
    story(
      'a',
      'Title',
      ':::gallery\n![privategallery](https://example.org/image)\n:::\n\n[Visible](https://example.org/hidden) body',
    ),
  ];
  unordered('Visible body', ['a'], {}, rows);
  unordered('privategallery OR hidden', [], {}, rows);
});

test('long phrases keep a highlighted excerpt when their match is clipped', () => {
  const phrase = '连续长短语'.repeat(55);
  const result = searchStoriesDetailed([story('a', 'Title', phrase)], {
    q: `body:"${phrase}"`,
  }).results[0];
  const snippet = searchPresentation(result).snippet;
  assert.ok(snippet.text.length <= 222);
  assert.deepEqual(snippet.ranges, [[0, 220]]);
});
test('URL state round trips Unicode, special syntax, filters, zero/fractional weights and read state', () => {
  const state = {
    ...defaultSearchState(),
    q: 'title:("AI 与大模型" OR C++) -游戏',
    entity: 'OpenAI',
    tag: 'AI 与大模型',
    from: '2026-08-28',
    to: '2026-09-08',
    read: 'unread',
    sort: 'oldest',
    scope: 'body',
    match: 'any',
    weights: { ...DEFAULT_SEARCH_WEIGHTS, title: 0, body: 9.5 },
  };
  assert.deepEqual(readSearchState(writeSearchState(state)), state);
  assert.equal(writeSearchState(defaultSearchState()), '');
  const fallback = readSearchState(
    'sort=bad&read=bad&scope=bad&match=bad&w_title=Infinity&w_body=-1&w_source=',
  );
  assert.deepEqual(fallback, defaultSearchState());
  assert.equal(readSearchState('from=bad').from, 'bad');
});
test('read-only tool uses shared parsing, weights, pagination and validation', () => {
  const index = createSearchIndex(corpus),
    link = (date, id) => `/read/${date}/${id}/`;
  const result = executeSearchTool(index, { q: 'Agent', limit: 1 }, link);
  assert.equal(result.total, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.results[0].id, 'a');
  assert.equal(result.results[0].url, '/read/2026-09-08/a/');
  assert.equal(
    executeSearchTool(index, { q: 'Agent', limit: 1, offset: 1 }, link)
      .results[0].id,
    'b',
  );
  for (const input of [
    null,
    [],
    { unknown: 'a' },
    { q: 'Agent OR' },
    { q: 2 },
    { q: null },
    { sort: null },
    { match: false },
    { limit: 0 },
    { offset: -1 },
    { weights: { title: Infinity } },
  ])
    assert.throws(() => executeSearchTool(index, input, link));
});

test('index payload rejects malformed rows and duplicate ids before rendering', () => {
  const row = {
    ...corpus[0],
    html: '<p>Body</p>',
    verificationStatus: 'pending',
  };
  assert.ok(isSearchIndexPayload([row]));
  for (const payload of [
    null,
    {},
    [null],
    [row, row],
    [{ ...row, tags: null }],
    [{ ...row, sources: [null] }],
    [{ ...row, briefingDate: 'bad' }],
    [{ ...row, body: 5 }],
    [{ ...row, sources: [{ title: 'Invalid', url: 'javascript:alert(1)' }] }],
  ])
    assert.equal(isSearchIndexPayload(payload), false);
});
