import { isDate, normalize, readingText } from './domain.mjs';
import { isImagePath, isWebUrl } from './resource-urls.mjs';

export const SEARCH_LIMITS = Object.freeze({
  length: 2048,
  terms: 64,
  depth: 12,
});
export const DEFAULT_SEARCH_WEIGHTS = Object.freeze({
  title: 8,
  summary: 3,
  body: 1,
  tags: 4,
  entities: 4,
  source: 1.5,
  briefing: 0.5,
});
export const SEARCH_FIELD_LABELS = Object.freeze({
  title: '标题',
  summary: '摘要',
  body: '正文',
  tags: '主题',
  entities: '机构',
  source: '来源',
  briefing: '本期导读',
});
const fields = Object.keys(DEFAULT_SEARCH_WEIGHTS);
const aliases = new Map(
  Object.entries({
    title: 'title',
    标题: 'title',
    summary: 'summary',
    摘要: 'summary',
    body: 'body',
    content: 'body',
    正文: 'body',
    tag: 'tags',
    tags: 'tags',
    主题: 'tags',
    entity: 'entities',
    entities: 'entities',
    机构: 'entities',
    source: 'source',
    来源: 'source',
    briefing: 'briefing',
    简报: 'briefing',
    date: 'date',
    日期: 'date',
    before: 'before',
    after: 'after',
  }),
);
const dateFields = new Set(['date', 'before', 'after']);
const wordCharacter = /[\p{Script=Latin}\p{N}_]/u;
const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('und', { granularity: 'grapheme' })
    : null;

class QueryError extends Error {
  constructor(message, position) {
    super(message);
    this.position = position;
  }
}

// Parse only this bounded grammar; user input is never evaluated as code or RegExp.
function lex(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i])) {
      i++;
      continue;
    }
    const position = i;
    const char = source[i++];
    if ('():-+'.includes(char)) {
      tokens.push({ type: char, value: char, position });
    } else if (char === '"' || char === '“') {
      const closing = char === '“' ? '”' : '"';
      let value = '',
        closed = false;
      while (i < source.length) {
        const next = source[i++];
        if (next === closing) {
          closed = true;
          break;
        }
        if (next === '\\') {
          if (i === source.length) break;
          value += source[i++];
        } else value += next;
      }
      if (!closed) throw new QueryError('短语缺少结束引号。', position);
      tokens.push({ type: 'phrase', value, position });
    } else {
      i--;
      let value = '',
        escaped = false;
      while (i < source.length && !/[\s():"“”]/u.test(source[i])) {
        if (source[i] === '\\') {
          escaped = true;
          i++;
          if (i === source.length)
            throw new QueryError('转义符后面缺少字符。', i - 1);
        }
        value += source[i++];
      }
      if (!value) throw new QueryError('请用成对引号包围短语。', position);
      const type =
        !escaped && ['AND', 'OR', 'NOT'].includes(value) ? value : 'word';
      tokens.push({ type, value, position, escaped });
    }
    if (tokens.length > SEARCH_LIMITS.terms * 8)
      throw new QueryError('搜索条件过多，请简化查询。', position);
  }
  return tokens;
}

export function parseSearchQuery(input = '', options = {}) {
  try {
    if (typeof input !== 'string')
      throw new QueryError('搜索内容必须是文字。', 0);
    if (input.length > SEARCH_LIMITS.length)
      throw new QueryError(
        `搜索内容不能超过 ${SEARCH_LIMITS.length} 个字符。`,
        SEARCH_LIMITS.length,
      );
    const tokens = lex(input.normalize('NFKC'));
    let cursor = 0,
      termCount = 0;
    const peek = () => tokens[cursor];
    const fail = (message) => {
      throw new QueryError(message, peek()?.position ?? input.length);
    };
    const starts = () =>
      ['word', 'phrase', '(', '-', '+', 'NOT'].includes(peek()?.type);
    const combine = (type, left, right) => ({ type, left, right });
    function parseOr(scope, depth) {
      let node = parseAnd(scope, depth);
      while (peek()?.type === 'OR' || (options.match === 'any' && starts())) {
        if (peek()?.type === 'OR') cursor++;
        node = combine('or', node, parseAnd(scope, depth));
      }
      return node;
    }
    function parseAnd(scope, depth) {
      let node = parseUnary(scope, depth);
      while (peek()?.type === 'AND' || (options.match !== 'any' && starts())) {
        if (peek()?.type === 'AND') cursor++;
        node = combine('and', node, parseUnary(scope, depth));
      }
      return node;
    }
    function parseUnary(scope, depth) {
      if (depth > SEARCH_LIMITS.depth)
        fail(`括号或否定嵌套不能超过 ${SEARCH_LIMITS.depth} 层。`);
      if (!starts()) fail('此处缺少关键词或括号内的搜索条件。');
      if (['NOT', '-', '+'].includes(peek().type)) {
        const operator = tokens[cursor++].type;
        const child = parseUnary(scope, depth + 1);
        return operator === '+'
          ? child
          : child.type === 'not'
            ? child.child
            : { type: 'not', child };
      }
      if (peek().type === '(') {
        cursor++;
        const node = parseOr(scope, depth + 1);
        if (peek()?.type !== ')') fail('缺少右括号。');
        cursor++;
        return node;
      }
      const token = tokens[cursor++];
      if (token.type === 'word' && peek()?.type === ':') {
        const field = aliases.get(normalize(token.value));
        if (!field)
          throw new QueryError(
            '未知字段；可使用 title、summary、body、tag、entity、source、briefing、date、before 或 after。',
            token.position,
          );
        cursor++;
        return parseUnary(field, depth + 1);
      }
      const phrase = token.type === 'phrase';
      let value = normalize(token.value);
      if (!value)
        throw new QueryError('短语或字段值不能为空。', token.position);
      const prefix = !phrase && !token.escaped && value.includes('*');
      if (prefix) {
        if (!/^[\p{Script=Latin}\p{N}_-]{2,}\*$/u.test(value))
          throw new QueryError(
            '前缀搜索使用至少两个英文字母或数字，并只在末尾加 *；查找星号本身请加引号。',
            token.position,
          );
        value = value.slice(0, -1);
      }
      if (dateFields.has(scope)) {
        const date =
          scope === 'date' && /^\d{4}(-\d{2})?$/.test(value)
            ? `${value}${value.length === 4 ? '-01-01' : '-01'}`
            : value;
        if (prefix || !isDate(date))
          throw new QueryError(
            '日期无效：date 使用 YYYY、YYYY-MM 或 YYYY-MM-DD；before / after 使用 YYYY-MM-DD。',
            token.position,
          );
      }
      if (++termCount > SEARCH_LIMITS.terms)
        throw new QueryError(
          `最多支持 ${SEARCH_LIMITS.terms} 个搜索条件。`,
          token.position,
        );
      return {
        type: 'term',
        id: termCount,
        field: scope || null,
        value,
        phrase,
        prefix,
      };
    }
    const ast = tokens.length ? parseOr(null, 0) : null;
    if (peek())
      fail(
        peek().type === ')'
          ? '出现了多余的右括号。'
          : '搜索条件之间缺少运算符。',
      );
    return { ast, errors: [] };
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return {
      ast: null,
      errors: [{ message: error.message, position: error.position }],
    };
  }
}

function storyFields(story) {
  return {
    title: [story.title || ''],
    summary: [story.summary || ''],
    body: [searchText(story.body || '')],
    tags: story.tags || [],
    entities: story.entities || [],
    source: (story.sources || []).map((source) => source.title || ''),
    // Keep prose sections and metadata entries separate so phrases cannot cross them.
    briefing: [story.briefingTitle, story.briefingIntro, story.briefingOutro]
      .filter(Boolean)
      .map(readingText),
  };
}

// Search prose keeps code and punctuation searchable while removing gallery
// metadata and link destinations that are not part of the article's text.
function searchText(value) {
  return String(value)
    .replace(/^:::gallery\r?\n[\s\S]*?\r?\n:::\s*$/gm, '')
    .replace(/!\[(?:\\.|[^\]\\])*\]\([^)]*\)/g, '')
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}(?:`{3,}|~{3,})[^\r\n]*$/gm, '')
    .replace(/(`+)([\s\S]*?)\1/g, '$2')
    .replace(/(\*{1,3}|_{1,3}|~{2})(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\\([\\`*_{}[\]<>#|])/g, '$1')
    .replace(/^(?:#{1,6}|>)[ \t]+/gm, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createSearchIndex(records) {
  const documents = records.map((story, order) => {
    const text = storyFields(story);
    const values = Object.fromEntries(
      fields.map((field) => [field, text[field].map(normalize)]),
    );
    const lengths = Object.fromEntries(
      fields.map((field) => [
        field,
        values[field].reduce((sum, value) => sum + value.length, 0),
      ]),
    );
    return { story, order, values, lengths };
  });
  const averages = Object.fromEntries(
    fields.map((field) => [
      field,
      documents.reduce((sum, document) => sum + document.lengths[field], 0) /
        (documents.length || 1) || 1,
    ]),
  );
  return { documents, averages };
}

export function isSearchIndexPayload(value) {
  if (!Array.isArray(value)) return false;
  const ids = new Set();
  return value.every((story) => {
    if (
      !story ||
      typeof story !== 'object' ||
      !['id', 'title', 'summary', 'body', 'html'].every(
        (field) => typeof story[field] === 'string',
      ) ||
      !/^[a-z0-9][a-z0-9-]{0,100}$/.test(story.id) ||
      ids.has(story.id) ||
      !isDate(story.briefingDate) ||
      !['tags', 'entities'].every(
        (field) =>
          Array.isArray(story[field]) &&
          story[field].every((item) => typeof item === 'string'),
      ) ||
      !Array.isArray(story.sources) ||
      !story.sources.every(
        (source) =>
          source &&
          typeof source.title === 'string' &&
          typeof source.url === 'string' &&
          isWebUrl(source.url),
      ) ||
      !['verified', 'pending', 'correction'].includes(
        story.verificationStatus,
      ) ||
      (story.image !== undefined &&
        (!story.image ||
          typeof story.image !== 'object' ||
          !isImagePath(story.image.path) ||
          typeof story.image.alt !== 'string' ||
          typeof story.image.caption !== 'string' ||
          typeof story.image.source !== 'string' ||
          typeof story.image.available !== 'boolean'))
    )
      return false;
    ids.add(story.id);
    return true;
  });
}

function occurrences(text, term) {
  const matches = [];
  let offset = 0;
  const needle = term.value;
  while (offset <= text.length - needle.length) {
    const start = text.indexOf(needle, offset);
    if (start < 0) break;
    let end = start + needle.length;
    offset = end;
    // English words use word boundaries; Chinese remains a contiguous substring.
    if (
      wordCharacter.test(needle[0]) &&
      start &&
      wordCharacter.test(text[start - 1])
    )
      continue;
    if (term.prefix) {
      while (end < text.length && wordCharacter.test(text[end])) end++;
    } else if (
      wordCharacter.test(needle.at(-1)) &&
      end < text.length &&
      wordCharacter.test(text[end])
    )
      continue;
    matches.push([start, end]);
    if (matches.length >= 100) break;
  }
  return matches;
}

function collectTerms(node, output = []) {
  if (!node) return output;
  if (node.type === 'term') output.push(node);
  else if (node.type === 'not') collectTerms(node.child, output);
  else {
    collectTerms(node.left, output);
    collectTerms(node.right, output);
  }
  return output;
}

function evaluate(node, evidence, order) {
  if (!node) return [];
  if (node.type === 'term')
    return evidence.get(node.id).hits[order].matched ? [node.id] : null;
  if (node.type === 'not')
    return evaluate(node.child, evidence, order) === null ? [] : null;
  const left = evaluate(node.left, evidence, order),
    right = evaluate(node.right, evidence, order);
  if (node.type === 'and')
    return left !== null && right !== null ? [...left, ...right] : null;
  return left === null && right === null
    ? null
    : [...(left || []), ...(right || [])];
}

function filterErrors(filters) {
  const errors = [];
  for (const key of ['tag', 'entity', 'from', 'to'])
    if (filters[key] !== undefined && typeof filters[key] !== 'string')
      errors.push({ message: '筛选条件必须是文字。', position: 0 });
  for (const key of ['from', 'to'])
    if (filters[key] && !isDate(filters[key]))
      errors.push({ message: '请选择有效的开始或结束日期。', position: 0 });
  if (filters.from && filters.to && filters.from > filters.to)
    errors.push({ message: '开始日期不能晚于结束日期。', position: 0 });
  if (
    filters.sort !== undefined &&
    !['relevance', 'newest', 'oldest'].includes(filters.sort)
  )
    errors.push({ message: '排序方式无效。', position: 0 });
  if (filters.match !== undefined && !['all', 'any'].includes(filters.match))
    errors.push({ message: '关键词匹配方式无效。', position: 0 });
  if (
    filters.scope !== undefined &&
    !['all', ...fields].includes(filters.scope)
  )
    errors.push({ message: '搜索范围无效。', position: 0 });
  if (filters.weights !== undefined) {
    if (
      !filters.weights ||
      typeof filters.weights !== 'object' ||
      Array.isArray(filters.weights)
    )
      errors.push({ message: '搜索权重格式无效。', position: 0 });
    else
      for (const [field, weight] of Object.entries(filters.weights))
        if (
          !fields.includes(field) ||
          !Number.isFinite(weight) ||
          weight < 0 ||
          weight > 20
        )
          errors.push({
            message: '字段权重必须是 0 至 20 的有限数字。',
            position: 0,
          });
  }
  return errors;
}

export function searchStoriesDetailed(recordsOrIndex, filters = {}) {
  const parsed = parseSearchQuery(
    filters.q === undefined ? '' : filters.q,
    filters,
  );
  const errors = [...parsed.errors, ...filterErrors(filters)];
  if (errors.length) return { results: [], errors };
  const index = Array.isArray(recordsOrIndex)
    ? createSearchIndex(recordsOrIndex)
    : recordsOrIndex;
  const { documents, averages } = index;
  const terms = collectTerms(parsed.ast);
  const weights = { ...DEFAULT_SEARCH_WEIGHTS, ...filters.weights };
  const evidence = new Map(),
    cached = new Map();
  for (const term of terms) {
    const key = JSON.stringify([
      term.field,
      term.value,
      term.phrase,
      term.prefix,
    ]);
    if (cached.has(key)) {
      evidence.set(term.id, cached.get(key));
      continue;
    }
    const names = term.field
      ? [term.field]
      : filters.scope && filters.scope !== 'all'
        ? [filters.scope]
        : fields;
    let frequency = 0;
    const hits = documents.map((document) => {
      const matchedFields = {};
      if (dateFields.has(term.field)) {
        const date = document.story.briefingDate || '';
        const matched =
          Boolean(date) &&
          (term.field === 'before'
            ? date < term.value
            : term.field === 'after'
              ? date > term.value
              : date === term.value || date.startsWith(`${term.value}-`));
        return { matched, fields: matchedFields };
      }
      for (const field of names) {
        const count = document.values[field].reduce(
          (sum, value) => sum + occurrences(value, term).length,
          0,
        );
        if (count) matchedFields[field] = count;
      }
      const matched = Object.keys(matchedFields).length > 0;
      if (matched) frequency++;
      return { matched, fields: matchedFields };
    });
    const value = {
      hits,
      idf:
        1 +
        Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)),
    };
    evidence.set(term.id, value);
    cached.set(key, value);
  }
  const results = [];
  for (const document of documents) {
    const { story, order } = document;
    if (
      (filters.from && story.briefingDate < filters.from) ||
      (filters.to && story.briefingDate > filters.to)
    )
      continue;
    if (
      filters.tag &&
      !(story.tags || []).some(
        (value) => normalize(value) === normalize(filters.tag),
      )
    )
      continue;
    if (
      filters.entity &&
      !(story.entities || []).some(
        (value) => normalize(value) === normalize(filters.entity),
      )
    )
      continue;
    const matchedIds = evaluate(parsed.ast, evidence, order);
    if (matchedIds === null) continue;
    const matchedFields = new Set(),
      scored = new Set(),
      matchedTerms = [];
    let score = 0;
    for (const id of matchedIds) {
      const term = terms.find((item) => item.id === id);
      if (dateFields.has(term.field)) continue;
      const termKey = JSON.stringify([
        term.field,
        term.value,
        term.phrase,
        term.prefix,
      ]);
      if (scored.has(termKey)) continue;
      scored.add(termKey);
      matchedTerms.push({
        ...term,
        field:
          term.field ||
          (filters.scope !== 'all' ? filters.scope : null) ||
          null,
      });
      const { hits, idf } = evidence.get(id);
      for (const [field, count] of Object.entries(hits[order].fields)) {
        matchedFields.add(field);
        // BM25-style saturation and length normalization prevent long repeated
        // bodies from overwhelming useful title matches. Zero weights affect rank only.
        const lengthRatio = document.lengths[field] / averages[field];
        const tf = (count * 2.2) / (count + 1.2 * (0.65 + 0.35 * lengthRatio));
        score +=
          weights[field] *
          idf *
          tf *
          (term.phrase ? 1.4 : term.prefix ? 0.85 : 1);
      }
    }
    results.push({
      story,
      score,
      matchedFields: fields.filter((field) => matchedFields.has(field)),
      terms: matchedTerms,
    });
  }
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  results.sort(
    (a, b) =>
      (filters.sort !== 'newest' && filters.sort !== 'oldest'
        ? b.score - a.score
        : 0) ||
      (filters.sort === 'oldest' ? 1 : -1) *
        compare(a.story.briefingDate || '', b.story.briefingDate || '') ||
      compare(a.story.id || '', b.story.id || ''),
  );
  return { results, errors: [] };
}

export function searchStories(recordsOrIndex, filters = {}) {
  return searchStoriesDetailed(recordsOrIndex, filters).results.map(
    ({ story }) => story,
  );
}

// Map normalized matches back to original graphemes, including full-width text,
// ligatures and combining accents. Rendering uses React text nodes, never HTML.
function normalizedMap(value) {
  let text = '';
  const starts = [],
    ends = [];
  const segments = segmenter
    ? segmenter.segment(value)
    : Array.from(value.matchAll(/\P{M}\p{M}*|\p{M}+/gu), (match) => ({
        segment: match[0],
        index: match.index,
      }));
  for (const { segment, index } of segments) {
    for (const char of segment.normalize('NFKC').toLowerCase()) {
      const space = /\s/u.test(char);
      if (space && (!text || text.endsWith(' '))) {
        if (text.endsWith(' ')) ends[ends.length - 1] = index + segment.length;
        continue;
      }
      text += space ? ' ' : char;
      for (let i = 0; i < (space ? 1 : char.length); i++) {
        starts.push(index);
        ends.push(index + segment.length);
      }
    }
  }
  // Whole-string casing also handles contextual forms such as Greek final sigma.
  return { text: normalize(value), starts, ends };
}

export function searchHighlightRanges(value, terms, field) {
  const mapped = normalizedMap(value);
  const ranges = terms
    .filter((term) => !term.field || term.field === field)
    .flatMap((term) =>
      occurrences(mapped.text, term).map(([start, end]) => [
        mapped.starts[start],
        mapped.ends[end - 1],
      ]),
    )
    .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1])
      previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

export function searchPresentation(result) {
  const { story, terms } = result;
  const title = searchHighlightRanges(story.title || '', terms, 'title');
  const summary = searchHighlightRanges(story.summary || '', terms, 'summary');
  const missing = terms.filter(
    (term) =>
      !searchHighlightRanges(story.title || '', [term], 'title').length &&
      !searchHighlightRanges(story.summary || '', [term], 'summary').length,
  );
  let best = null;
  const values = missing.length ? storyFields(story) : {};
  for (const field of ['body', 'tags', 'entities', 'source', 'briefing']) {
    for (const text of values[field] || []) {
      const candidates = missing.filter(
        (term) => !term.field || term.field === field,
      );
      const locations = candidates.map((term) =>
        searchHighlightRanges(text, [term], field),
      );
      const ranges = locations.flat().sort((a, b) => a[0] - b[0]);
      for (const [position] of ranges) {
        const start = Math.max(0, position - 48);
        const end = Math.min(text.length, start + 220);
        const count = locations.filter((matches) =>
          matches.some(([a, b]) => a >= start && b <= end),
        ).length;
        if (!best || count > best.count)
          best = { field, text, start, end, count };
      }
    }
  }
  if (!best) return { title, summary, snippet: null };
  // Avoid slicing a UTF-16 surrogate pair at either edge.
  if (/[\uDC00-\uDFFF]/.test(best.text[best.start] || '')) best.start--;
  if (/[\uDC00-\uDFFF]/.test(best.text[best.end] || '')) best.end++;
  const text = `${best.start ? '…' : ''}${best.text.slice(best.start, best.end)}${best.end < best.text.length ? '…' : ''}`;
  const prefixLength = best.start ? 1 : 0;
  const ranges = searchHighlightRanges(best.text, terms, best.field)
    .filter(([start, end]) => start < best.end && end > best.start)
    .map(([start, end]) => [
      Math.max(start, best.start) - best.start + prefixLength,
      Math.min(end, best.end) - best.start + prefixLength,
    ]);
  return {
    title,
    summary,
    snippet: {
      field: best.field,
      text,
      ranges,
    },
  };
}
