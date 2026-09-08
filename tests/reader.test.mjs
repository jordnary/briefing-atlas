import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, validateReadingState } from '../lib/domain.mjs';
import {
  readingRange,
  readingProgress,
  readingOffset,
} from '../lib/reader.mjs';

test('legacy backups retain bookmarks and gain reader defaults', () => {
  const legacy = {
    version: 1,
    bookmarks: ['story-one'],
    read: [],
    theme: 'system',
    fontSize: 16,
    view: 'summary',
    lastRead: { date: '2026-09-08', storyId: 'story-one' },
  };
  const restored = validateReadingState(legacy);
  assert.deepEqual(restored.reader, defaultState.reader);
  assert.deepEqual(restored.bookmarks, ['story-one']);
  assert.equal(restored.fontSize, 16);
  assert.equal(restored.lastRead.progress, 0);
});

test('reader preferences and positions round trip without unknown fields', () => {
  const saved = {
    ...defaultState,
    theme: 'paper',
    reader: {
      font: 'serif',
      width: 'wide',
      spacing: 'compact',
      unknown: 'discard',
    },
    lastRead: {
      date: '2026-09-08',
      storyId: 'story-one',
      progress: 46,
      unknown: 'discard',
    },
  };
  const restored = validateReadingState(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.reader, {
    font: 'serif',
    width: 'wide',
    spacing: 'compact',
  });
  assert.deepEqual(restored.lastRead, {
    date: '2026-09-08',
    storyId: 'story-one',
    progress: 46,
  });
  assert.equal(restored.theme, 'paper');
  for (const progress of [-1, 101, '40', Infinity, NaN])
    assert.throws(() =>
      validateReadingState({
        ...saved,
        lastRead: { ...saved.lastRead, progress },
      }),
    );
  for (const reader of [
    { font: 'script', width: 'wide', spacing: 'compact' },
    { font: 'sans', width: 'other', spacing: 'compact' },
    { font: 'sans', width: 'wide', spacing: 'other' },
  ])
    assert.throws(() => validateReadingState({ ...saved, reader }));
});

test('article progress excludes the header and footer, and resumes after reflow', () => {
  const range = readingRange(500, 2200, 800);
  assert.equal(readingProgress(0, range), 0);
  assert.equal(readingProgress(range.start, range), 0);
  assert.equal(readingProgress(range.end, range), 100);
  assert.equal(readingProgress(range.end + 1000, range), 100);
  assert.equal(readingProgress(readingOffset(47, range), range), 47);
  const resized = readingRange(620, 4000, 700);
  assert.equal(readingProgress(readingOffset(47, resized), resized), 47);
  const short = readingRange(60, 120, 900);
  assert.ok(short.end > short.start);
  assert.ok(Number.isFinite(readingProgress(0, short)));
});
