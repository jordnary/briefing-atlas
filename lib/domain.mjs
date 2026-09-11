export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    Number(value.slice(0, 4)) >= 1900
  );
}
export function monthDays(month) {
  if (!/^\d{4}-\d{2}$/.test(month) || !isDate(`${month}-01`)) return [];
  const [year, m] = month.split('-').map(Number);
  const start = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return [
    ...Array(start).fill(null),
    ...Array.from(
      { length: count },
      (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
    ),
  ];
}
export function shiftMonth(month, offset) {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function normalize(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
// Reading metrics and snippets use prose, excluding gallery metadata and URLs.
export function readingText(value) {
  return value
    .replace(/^:::gallery\r?\n[\s\S]*?\r?\n:::\s*$/gm, '')
    .replace(/!\[(?:\\.|[^\]\\])*\]\([^)]*\)/g, '')
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\`*_{}[\]<>#|])/g, '$1')
    .replace(/[#`*$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
// Preserve the original API for archive consumers; the engine lives separately.
export { searchStories } from './search.mjs';
export const defaultState = {
  version: 1,
  bookmarks: [],
  read: [],
  theme: 'system',
  fontSize: 16,
  view: 'summary',
  reader: {
    font: 'sans',
    width: 'wide',
    spacing: 'relaxed',
    scale: 100,
    titleScale: 100,
  },
  lastRead: null,
};
const stableId = (value) =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,100}$/.test(value);
export function validateReadingState(input) {
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.bookmarks) ||
    !Array.isArray(input.read) ||
    input.bookmarks.length > 50000 ||
    input.read.length > 50000 ||
    !input.bookmarks.every(stableId) ||
    !input.read.every(stableId) ||
    !['system', 'light', 'paper', 'dark'].includes(input.theme) ||
    !Number.isInteger(input.fontSize) ||
    input.fontSize < 16 ||
    input.fontSize > 28 ||
    !['summary', 'full'].includes(input.view)
  )
    throw new Error('阅读备份格式不正确或版本不受支持。');
  let lastRead = null;
  if (input.lastRead !== null && input.lastRead !== undefined) {
    if (!isDate(input.lastRead.date) || !stableId(input.lastRead.storyId))
      throw new Error('阅读位置格式不正确。');
    const progress = input.lastRead.progress ?? 0;
    if (!Number.isFinite(progress) || progress < 0 || progress > 100)
      throw new Error('阅读进度格式不正确。');
    lastRead = {
      date: input.lastRead.date,
      storyId: input.lastRead.storyId,
      progress,
    };
  }
  const reader = input.reader ?? defaultState.reader;
  const scale =
    reader.scale === undefined ? defaultState.reader.scale : reader.scale;
  const titleScale =
    reader.titleScale === undefined
      ? defaultState.reader.titleScale
      : reader.titleScale;
  if (
    !reader ||
    !['sans', 'serif'].includes(reader.font) ||
    !['standard', 'wide', 'full'].includes(reader.width) ||
    !['relaxed', 'compact'].includes(reader.spacing) ||
    !Number.isInteger(scale) ||
    scale < 80 ||
    scale > 150 ||
    !Number.isInteger(titleScale) ||
    titleScale < 80 ||
    titleScale > 140
  )
    throw new Error('阅读偏好格式不正确。');
  return {
    version: 1,
    bookmarks: [...new Set(input.bookmarks)],
    read: [...new Set(input.read)],
    theme: input.theme,
    fontSize: input.fontSize,
    view: input.view,
    reader: {
      font: reader.font,
      width: reader.width,
      spacing: reader.spacing,
      scale,
      titleScale,
    },
    lastRead,
  };
}
