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
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
/** @param {Array<any>} records @param {{q?:string,tag?:string,entity?:string,from?:string,to?:string}} filters */
export function searchStories(records, filters = {}) {
  const { q = '', tag = '', entity = '', from = '', to = '' } = filters;
  const terms = normalize(q).split(' ').filter(Boolean);
  return records.filter(
    (story) =>
      (!from || story.briefingDate >= from) &&
      (!to || story.briefingDate <= to) &&
      (!tag || story.tags.includes(tag)) &&
      (!entity || story.entities.includes(entity)) &&
      terms.every((term) =>
        normalize(
          [
            story.title,
            story.summary,
            story.body,
            ...story.tags,
            ...story.entities,
          ].join(' '),
        ).includes(term),
      ),
  );
}
export const defaultState = {
  version: 1,
  bookmarks: [],
  read: [],
  theme: 'system',
  fontSize: 16,
  view: 'summary',
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
    !['system', 'light', 'dark'].includes(input.theme) ||
    ![16, 18, 20].includes(input.fontSize) ||
    !['summary', 'full'].includes(input.view)
  )
    throw new Error('阅读备份格式不正确或版本不受支持。');
  let lastRead = null;
  if (input.lastRead !== null && input.lastRead !== undefined) {
    if (!isDate(input.lastRead.date) || !stableId(input.lastRead.storyId))
      throw new Error('阅读位置格式不正确。');
    lastRead = { date: input.lastRead.date, storyId: input.lastRead.storyId };
  }
  return {
    version: 1,
    bookmarks: [...new Set(input.bookmarks)],
    read: [...new Set(input.read)],
    theme: input.theme,
    fontSize: input.fontSize,
    view: input.view,
    lastRead,
  };
}
