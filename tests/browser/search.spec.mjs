import { test, expect } from '@playwright/test';

const row = (id, title, body = '', extra = {}) => ({
  id,
  title,
  body,
  summary: '简报内容摘要',
  html: '<p>Article body</p>',
  briefingDate: '2026-09-08',
  briefingTitle: '本期简报',
  briefingIntro: '',
  briefingOutro: '',
  tags: ['AI 与大模型'],
  entities: ['OpenAI'],
  sources: [],
  verificationStatus: 'pending',
  verificationNote: '待核验',
  eventDate: null,
  ...extra,
});
const rows = [
  row('title-match', 'Agent 安全', 'incident report', {
    briefingDate: '2026-09-07',
  }),
  row('body-match', '工具实践', 'Agent '.repeat(80)),
  row('game-match', '游戏开发', 'Unity', {
    entities: ['Microsoft'],
    tags: ['开发工具'],
  }),
  ...Array.from({ length: 42 }, (_, i) =>
    row(`filler-${i}`, `普通内容 ${i}`, '其他主题'),
  ),
];
const cards = (page) => page.locator('.story-card');
const input = (page) => page.getByRole('searchbox', { name: '搜索简报内容' });
const status = (page) =>
  page.locator('.search-results-heading [role="status"]');
async function fixture(page, route = 'search/') {
  await page.route('**/search-index.json', (request) =>
    request.fulfill({ json: rows }),
  );
  await page.goto(route);
  await expect(status(page)).toHaveText('45 条');
}
async function advanced(page) {
  if ((await page.locator('.search-advanced').getAttribute('open')) === null)
    await page.locator('.search-advanced > summary').click();
}
async function expectSearchInView(page) {
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      page.locator('.search-field').evaluate((field) => {
        const header = document.querySelector('.site-header');
        return (
          getComputedStyle(header).position !== 'sticky' ||
          field.getBoundingClientRect().top >=
            header.getBoundingClientRect().bottom + 16
        );
      }),
    )
    .toBe(true);
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('header search navigation reveals the field after scrolling', async ({
  page,
}) => {
  await page.route('**/search-index.json', (request) =>
    request.fulfill({ json: rows }),
  );
  await page.goto('./');
  await page.getByRole('link', { name: '打开搜索页', exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.getByRole('link', { name: '打开搜索页', exact: true }).click();
  await expect(page).toHaveURL(/\/search\/#atlas-search-input$/);
  await expect(status(page)).toHaveText('45 条');
  await expectSearchInView(page);
});

test('Control+k reveals the search field after scrolling', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.keyboard.press('Control+k');
  await expectSearchInView(page);
});

test('production index searches titles and links to the real reader', async ({
  page,
}) => {
  await page.goto('search/');
  await expect(cards(page).first()).toBeVisible();
  await input(page).fill('title:OpenAI');
  await expect(cards(page).first().locator('h3 mark')).toHaveText('OpenAI');
  const link = cards(page).first().getByRole('link', { name: '阅读全文' });
  await expect(link).toHaveAttribute('href', /\/read\/\d{4}-\d{2}-\d{2}\//);
  await link.click();
  await expect(page.locator('#reader-body')).toBeVisible();
});

test('Boolean expressions, errors, field highlighting and empty results', async ({
  page,
}) => {
  await fixture(page);
  await input(page).fill('title:(Agent OR 游戏) -body:Unity');
  await expect(status(page)).toHaveText('1 条');
  await expect(cards(page).first()).toHaveAttribute('id', 'title-match');
  await expect(cards(page).locator('mark')).toHaveText('Agent');
  await input(page).fill('body:"incident report"');
  await expect(cards(page).locator('h3 mark')).toHaveCount(0);
  await expect(cards(page).locator('.search-excerpt mark')).toHaveText(
    'incident report',
  );
  await input(page).fill('Agent OR');
  await expect(page.locator('#search-errors')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(input(page)).toHaveAttribute('aria-invalid', 'true');
  await input(page).fill('nosuchkeyword');
  await expect(
    page.getByText('没有找到符合条件的内容', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('#search-errors')).toHaveCount(0);
});

test('weights reverse rank, persist after reload and date sorting overrides score', async ({
  page,
}) => {
  await fixture(page);
  await input(page).fill('Agent');
  await expect(cards(page).first()).toHaveAttribute('id', 'title-match');
  await advanced(page);
  await page.getByRole('button', { name: '正文优先', exact: true }).click();
  await expect(cards(page).first()).toHaveAttribute('id', 'body-match');
  await expect(page).toHaveURL(/w_body=8/);
  await page.reload();
  await expect(cards(page).first()).toHaveAttribute('id', 'body-match');
  await advanced(page);
  await expect(
    page.getByRole('slider', { name: '正文搜索权重', exact: true }),
  ).toHaveValue('8');
  await page.getByRole('combobox', { name: '排序方式' }).selectOption('oldest');
  await expect(cards(page).first()).toHaveAttribute('id', 'title-match');
  await page.getByRole('button', { name: '标题优先 · 默认' }).click();
  await expect(page.getByRole('combobox', { name: '排序方式' })).toHaveValue(
    'relevance',
  );
  await expect(
    page.getByRole('slider', { name: '标题搜索权重', exact: true }),
  ).toHaveValue('8');
});

test('submitted history and copied links restore query, scope and weights', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value) => {
          window.copiedSearch = value;
        },
      },
    }),
  );
  await fixture(page);
  await input(page).fill('Agent');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(status(page)).toHaveText('2 条');
  await input(page).fill('游戏');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(status(page)).toHaveText('1 条');
  await page.goBack();
  await expect(input(page)).toHaveValue('Agent');
  await expect(status(page)).toHaveText('2 条');
  await page.goForward();
  await expect(input(page)).toHaveValue('游戏');
  await advanced(page);
  await page.getByRole('combobox', { name: '搜索范围' }).selectOption('title');
  await page.getByRole('button', { name: '正文优先', exact: true }).click();
  await page.getByRole('button', { name: '复制搜索链接', exact: true }).click();
  const copied = await page.evaluate(() => window.copiedSearch);
  expect(new URL(copied).searchParams.get('scope')).toBe('title');
  expect(new URL(copied).searchParams.get('w_body')).toBe('8');
  await page.goto(copied);
  await expect(input(page)).toHaveValue('游戏');
  await expect(status(page)).toHaveText('1 条');
});

test('pagination resets with filters and reading/bookmark records keep working', async ({
  page,
}) => {
  await fixture(page);
  await expect(cards(page)).toHaveCount(20);
  await page.getByRole('button', { name: '再显示 20 条' }).click();
  await expect(cards(page)).toHaveCount(40);
  await cards(page)
    .first()
    .getByRole('button', { name: '标记为已读', exact: true })
    .click();
  await page.getByRole('combobox', { name: '阅读状态' }).selectOption('unread');
  await expect(status(page)).toHaveText('44 条');
  await expect(cards(page)).toHaveCount(20);
  await cards(page)
    .first()
    .getByRole('button', { name: '收藏新闻', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '我的收藏' })
    .click();
  await expect(status(page)).toHaveText('1 条');
  await expect(cards(page)).toHaveCount(1);
  await input(page).fill('title:普通内容 OR title:游戏');
  await expect(cards(page)).toHaveCount(1);
});

test('IME composition stays intact and keyboard search shortcut keeps current query', async ({
  page,
}) => {
  await fixture(page);
  await input(page).dispatchEvent('compositionstart');
  await input(page).fill('Agent');
  await expect(status(page)).toHaveText('45 条');
  await input(page).dispatchEvent('compositionend', { data: 'Agent' });
  await expect(status(page)).toHaveText('2 条');
  await page.keyboard.press('Control+k');
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('Agent');
  await page.keyboard.press('Escape');
  await expect(input(page)).toHaveValue('');
  await expect(status(page)).toHaveText('45 条');
});

test('invalid index payload recovers through retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/search-index.json', (request) =>
    request.fulfill({ json: ++attempts === 1 ? [{ id: 'broken' }] : rows }),
  );
  await page.goto('search/');
  await expect(
    page.getByText('暂时无法加载内容', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(status(page)).toHaveText('45 条');
  await expect(cards(page)).toHaveCount(20);
});

test('filter chips, inclusive dates and any-keyword search compose correctly', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: '开发工具', exact: true }).click();
  await expect(status(page)).toHaveText('1 条');
  await page
    .getByRole('combobox', { name: '公司或机构' })
    .selectOption('OpenAI');
  await expect(status(page)).toHaveText('0 条');
  await page
    .getByRole('button', { name: '移除筛选：OpenAI', exact: true })
    .click();
  await expect(status(page)).toHaveText('1 条');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-09-09');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-09-08');
  await expect(page.locator('#search-errors')).toContainText(
    '开始日期不能晚于结束日期',
  );
  await expect(cards(page)).toHaveCount(0);
  await page.getByLabel('开始日期', { exact: true }).fill('2026-09-08');
  await expect(status(page)).toHaveText('1 条');
  await page.getByRole('button', { name: '重置搜索', exact: true }).click();
  await advanced(page);
  await page.getByRole('combobox', { name: '搜索范围' }).selectOption('body');
  await input(page).fill('Agent Unity');
  await expect(status(page)).toHaveText('0 条');
  await page
    .getByRole('combobox', { name: '关键词匹配方式' })
    .selectOption('any');
  await expect(status(page)).toHaveText('2 条');
  await expect(page).toHaveURL(/match=any/);
});

test('advanced controls and results fit narrow screens in both themes', async ({
  page,
}) => {
  await fixture(page);
  await advanced(page);
  await input(page).fill('title:Agent OR body:Agent');
  await expect(status(page)).toHaveText('2 条');
  for (const width of [390, 320, 640]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('slider', { name: '正文搜索权重', exact: true }),
  ).toBeVisible();
});
