import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDate, normalize } from '../lib/domain.mjs';
import { marked } from 'marked';
const idPattern = /^[a-z0-9][a-z0-9-]{0,100}$/;
function requireField(ok, message) {
  if (!ok) throw new Error(message);
}
const text = (x) => typeof x === 'string' && x.trim().length > 0;
export function validateMarkdown(value) {
  requireField(typeof value === 'string', 'Markdown must be text.');
  requireField(
    !/(?:mention=|turn\d+(?:search|view|news)||)/i.test(value),
    'Unresolved chat markers are not allowed.',
  );
  void marked.walkTokens(marked.lexer(value), (token) => {
    requireField(token.type !== 'html', 'Raw HTML is not allowed.');
    if (token.type === 'link' || token.type === 'image') {
      let url;
      try {
        url = new URL(token.href);
      } catch {
        throw new Error('Invalid Markdown URL.');
      }
      requireField(
        url.protocol === 'https:' && !url.username && !url.password,
        'Markdown links require credential-free HTTPS.',
      );
    }
  });
}
function onlyKeys(value, keys) {
  requireField(
    value &&
      typeof value === 'object' &&
      Object.keys(value).every((key) => keys.includes(key)),
    'Unknown content field; private metadata is not publishable.',
  );
}
function timestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    isDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value))
  );
}
export function parseBriefing(source) {
  const match = source
    .replace(/^\uFEFF/, '')
    .match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  requireField(match, 'Expected JSON frontmatter enclosed in --- delimiters.');
  const meta = JSON.parse(match[1]);
  const bodies = new Map();
  let current = null;
  for (const token of marked.lexer(match[2])) {
    if (
      token.type === 'heading' &&
      token.depth === 2 &&
      idPattern.test(token.text)
    ) {
      requireField(!bodies.has(token.text), 'Duplicate story body.');
      current = token.text;
      bodies.set(current, '');
    } else if (current) bodies.set(current, bodies.get(current) + token.raw);
  }
  requireField(Array.isArray(meta.stories), 'stories must be an array.');
  const stories = meta.stories.map((story) => ({
    ...story,
    body: (bodies.get(story.id) || '').trim(),
  }));
  requireField(
    bodies.size === stories.length,
    'Each story must have exactly one Markdown body.',
  );
  return validateBriefing({ ...meta, stories });
}
export function validateBriefing(item) {
  onlyKeys(item, [
    'id',
    'briefingDate',
    'title',
    'summary',
    'summaryKind',
    'status',
    'sample',
    'publishedAt',
    'updatedAt',
    'sourcePublishedAt',
    'sourceUpdatedAt',
    'archivedAt',
    'revision',
    'formatRevision',
    'intro',
    'outro',
    'corrections',
    'stories',
  ]);
  requireField(item && idPattern.test(item.id), 'Invalid briefing id.');
  requireField(isDate(item.briefingDate), 'Invalid briefingDate.');
  requireField(
    text(item.title) && typeof item.summary === 'string',
    'Title and a summary string are required.',
  );
  requireField(
    ['draft', 'published'].includes(item.status),
    'Invalid publication status.',
  );
  requireField(
    typeof item.sample === 'boolean',
    'sample must be explicitly true or false.',
  );
  for (const key of ['publishedAt', 'updatedAt']) {
    if (item.archivedAt && item[key] === undefined) continue;
    requireField(
      typeof item[key] === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(
          item[key],
        ) &&
        isDate(item[key].slice(0, 10)) &&
        !Number.isNaN(Date.parse(item[key])),
      `Invalid ${key}; an explicit time zone is required.`,
    );
  }
  requireField(
    item.archivedAt ||
      Date.parse(item.updatedAt) >= Date.parse(item.publishedAt),
    'updatedAt must not precede publishedAt.',
  );
  if (item.archivedAt) {
    requireField(timestamp(item.archivedAt), 'Invalid archivedAt.');
    requireField(
      Number.isInteger(item.revision) && item.revision >= 1,
      'Invalid revision.',
    );
    requireField(
      Number.isInteger(item.formatRevision) && item.formatRevision >= 1,
      'Invalid formatRevision.',
    );
    for (const key of ['sourcePublishedAt', 'sourceUpdatedAt'])
      requireField(
        item[key] === null || timestamp(item[key]),
        `Invalid ${key}.`,
      );
    if (item.sourcePublishedAt && item.sourceUpdatedAt)
      requireField(
        Date.parse(item.sourceUpdatedAt) >= Date.parse(item.sourcePublishedAt),
        'Source revision predates publication.',
      );
    for (const key of ['intro', 'outro']) validateMarkdown(item[key]);
    requireField(
      Array.isArray(item.corrections),
      'corrections must be an array.',
    );
    for (const correction of item.corrections) {
      onlyKeys(correction, ['date', 'note', 'kind']);
      requireField(
        isDate(correction.date) &&
          text(correction.note) &&
          ['source', 'format', 'cross-issue'].includes(correction.kind),
        'Invalid correction.',
      );
      validateMarkdown(correction.note);
    }
  }
  requireField(
    Array.isArray(item.stories) && item.stories.length > 0,
    'At least one story is required.',
  );
  const ids = new Set();
  for (const story of item.stories) {
    onlyKeys(story, [
      'id',
      'title',
      'summary',
      'summaryKind',
      'body',
      'eventDate',
      'tags',
      'entities',
      'verificationStatus',
      'verificationNote',
      'sources',
      'relatedEventId',
      'image',
      'imageStatus',
      'citationStatus',
    ]);
    requireField(
      idPattern.test(story.id) && !ids.has(story.id),
      'Invalid or duplicate story id.',
    );
    ids.add(story.id);
    requireField(
      text(story.title) &&
        typeof story.summary === 'string' &&
        text(story.body),
      'Story title, summary and body are required.',
    );
    requireField(
      story.eventDate === null || isDate(story.eventDate),
      'Invalid eventDate.',
    );
    for (const key of ['tags', 'entities'])
      requireField(
        Array.isArray(story[key]) && story[key].every(text),
        `Invalid ${key}.`,
      );
    requireField(
      ['verified', 'pending', 'correction'].includes(
        story.verificationStatus,
      ) && text(story.verificationNote),
      'Verification status and note are required.',
    );
    requireField(Array.isArray(story.sources), 'sources must be an array.');
    requireField(
      story.sources.length > 0 || story.verificationStatus !== 'verified',
      'Verified stories need a source.',
    );
    for (const source of story.sources) {
      onlyKeys(source, ['title', 'url', 'type', 'publishedAt']);
      requireField(
        text(source.title) &&
          ['paper', 'official', 'report'].includes(source.type),
        'Invalid source.',
      );
      let url;
      try {
        url = new URL(source.url);
      } catch {
        throw new Error('Invalid source URL.');
      }
      requireField(
        url.protocol === 'https:' && !url.username && !url.password,
        'Sources require credential-free HTTPS URLs.',
      );
      requireField(
        source.publishedAt === undefined ||
          source.publishedAt === null ||
          isDate(source.publishedAt),
        'Invalid source publication date.',
      );
    }
    validateMarkdown(story.body);
    if (story.image) {
      onlyKeys(story.image, ['alt', 'caption', 'source', 'path']);
      requireField(
        text(story.image.alt) &&
          text(story.image.caption) &&
          text(story.image.source),
        'Image attribution and alt text are required.',
      );
      requireField(
        /^images\/[a-z0-9/_.-]+$/i.test(story.image.path) &&
          !story.image.path.includes('..'),
        'Image must use a safe path inside public/images.',
      );
    }
  }
  return item;
}
export function validateCollection(items) {
  const dates = new Set(),
    ids = new Set(),
    stories = new Set(),
    titles = new Set(),
    warnings = [];
  for (const item of items) {
    validateBriefing(item);
    requireField(
      !dates.has(item.briefingDate) && !ids.has(item.id),
      'Duplicate briefing date or id.',
    );
    dates.add(item.briefingDate);
    ids.add(item.id);
    for (const story of item.stories) {
      requireField(
        !stories.has(story.id),
        'Story ids must be globally unique.',
      );
      stories.add(story.id);
      const title = normalize(story.title);
      if (titles.has(title))
        warnings.push(`Possible repeated story: ${story.id}`);
      titles.add(title);
    }
  }
  return warnings;
}
export async function loadBriefings(directory = 'content/briefings') {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith('.md')) files.push(file);
    }
  }
  try {
    await walk(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const items = [];
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    const item = parseBriefing(await readFile(file, 'utf8'));
    requireField(
      path.basename(file) === `${item.briefingDate}.md`,
      'Content filename must match briefingDate.',
    );
    items.push(item);
  }
  validateCollection(items);
  return items.sort((a, b) => b.briefingDate.localeCompare(a.briefingDate));
}
