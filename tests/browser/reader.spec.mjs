import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { defaultState } from '../../lib/domain.mjs';

const issues = JSON.parse(await readFile('generated/briefings.json', 'utf8'));
const issue = issues.find((item) => item.stories.length > 1);
const [story, nextStory] = issue.stories;
const route = (item = story) => `read/${issue.briefingDate}/${item.id}/`;
const storageKey = 'briefing-atlas:reading:v1';
const settings = (page) =>
  page.getByRole('button', { name: '排版与外观', exact: true });
const panel = (page) => page.getByRole('region', { name: '排版与外观' });
const slider = (page, name) => page.getByRole('slider', { name, exact: true });

async function setRange(page, name, value) {
  await slider(page, name).fill(String(value));
  await expect(slider(page, name)).toHaveValue(String(value));
}

async function fontSize(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
}

async function savedState(page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    storageKey,
  );
}

async function assertWithinViewport(page, selector) {
  const bounds = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('floating tools scale the whole article while reading and dismiss accessibly', async ({
  page,
}) => {
  await page.goto(route());
  await expect(settings(page)).toBeEnabled();
  const selectors = [
    '.reader-article > h1',
    '.reader-deck',
    '.reader-content .prose',
    '.reader-source-list a',
    '.reader-meta-row',
  ];
  const original = await Promise.all(
    selectors.map((selector) => fontSize(page, selector)),
  );
  const headerSize = await fontSize(page, '.reader-brand');
  await page.locator('#reader-body').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await assertWithinViewport(page, '.reader-dock');
  await page.getByRole('button', { name: '放大整篇文字', exact: true }).click();
  for (const [index, selector] of selectors.entries()) {
    await expect
      .poll(() => fontSize(page, selector))
      .toBeCloseTo(original[index] * 1.05, 2);
  }
  expect(await fontSize(page, '.reader-brand')).toBe(headerSize);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await settings(page).click();
  await expect(panel(page)).toBeVisible();
  await assertWithinViewport(page, '#reader-settings-panel');
  await expect(
    page.getByRole('button', { name: '关闭阅读设置' }),
  ).toBeFocused();
  await slider(page, '正文大小').focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider(page, '正文大小')).toHaveValue('19');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(settings(page)).toBeFocused();
  await settings(page).click();
  await page.locator('.reader-header').click({ position: { x: 3, y: 3 } });
  await expect(panel(page)).toHaveCount(0);
});

test('title and body sizes adjust separately, persist across articles, and reset without losing reading records', async ({
  page,
}) => {
  const legacy = {
    ...defaultState,
    bookmarks: [story.id],
    read: [story.id],
    reader: { font: 'serif', width: 'standard', spacing: 'compact' },
  };
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(value));
    },
    { key: storageKey, value: legacy },
  );
  await page.goto(route());
  await expect(settings(page)).toBeEnabled();
  await settings(page).click();
  await expect(slider(page, '整篇缩放')).toHaveValue('100');
  await expect(
    panel(page).getByRole('button', { name: '标准', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const title = await fontSize(page, '.reader-article > h1');
  const body = await fontSize(page, '.reader-content .prose');
  await setRange(page, '标题大小', 120);
  await expect
    .poll(() => fontSize(page, '.reader-article > h1'))
    .toBeCloseTo(title * 1.2, 2);
  expect(await fontSize(page, '.reader-content .prose')).toBe(body);
  await setRange(page, '正文大小', 23);
  await expect.poll(() => fontSize(page, '.reader-content .prose')).toBe(23);
  expect(await fontSize(page, '.reader-article > h1')).toBeCloseTo(
    title * 1.2,
    2,
  );
  await setRange(page, '整篇缩放', 125);
  await panel(page).getByRole('button', { name: '铺满', exact: true }).click();
  await panel(page).getByRole('button', { name: '纸色', exact: true }).click();
  await page.reload();
  await expect(settings(page)).toBeEnabled();
  await expect.poll(() => fontSize(page, '.reader-content .prose')).toBe(28.75);
  await expect(page.locator('html')).toHaveClass(/paper/);
  await page.goto(route(nextStory));
  await settings(page).click();
  await expect(slider(page, '整篇缩放')).toHaveValue('125');
  await expect(slider(page, '标题大小')).toHaveValue('120');
  await expect(slider(page, '正文大小')).toHaveValue('23');
  await expect(page.locator('.reader-page')).toHaveAttribute(
    'data-reader-width',
    'full',
  );
  await panel(page).getByRole('button', { name: '恢复默认排版' }).click();
  const restored = await savedState(page);
  expect(restored.reader).toEqual(defaultState.reader);
  expect(restored.fontSize).toBe(defaultState.fontSize);
  expect(restored.bookmarks).toEqual([story.id]);
  expect(restored.read).toEqual([story.id]);
  expect(restored.lastRead.storyId).toBe(nextStory.id);
});

test('wide layouts use available space and large type stays usable on small screens', async ({
  page,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(route());
  await expect(settings(page)).toBeEnabled();
  const article = await page.locator('.reader-article').boundingBox();
  const prose = await page.locator('.reader-content .prose').boundingBox();
  if (isMobile) {
    expect(article.width / page.viewportSize().width).toBeGreaterThan(0.9);
  } else {
    expect(article.width).toBeGreaterThan(1300);
    expect(prose.width).toBeGreaterThan(1200);
  }
  await settings(page).click();
  for (const name of ['标准', '宽屏', '铺满']) {
    await panel(page).getByRole('button', { name, exact: true }).click();
    const layout = await page.locator('.reader-layout').boundingBox();
    const expectedWidth = { 标准: 1440, 宽屏: 1680, 铺满: 1824 }[name];
    if (!isMobile) expect(layout.width).toBe(expectedWidth);
  }
  await setRange(page, '整篇缩放', 150);
  await setRange(page, '标题大小', 140);
  await setRange(page, '正文大小', 28);
  await expect(
    page.getByRole('button', { name: '放大整篇文字', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '增大标题大小' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '增大正文大小' }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 568 });
  await assertWithinViewport(page, '.reader-dock');
  await assertWithinViewport(page, '#reader-settings-panel');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await panel(page).getByRole('button', { name: '恢复默认排版' }).click();
  await setRange(page, '整篇缩放', 80);
  await setRange(page, '标题大小', 80);
  await setRange(page, '正文大小', 16);
  await expect(
    page.getByRole('button', { name: '缩小整篇文字', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '减小标题大小' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '减小正文大小' }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '开启专注模式' }).click();
  await expect(page.locator('.reader-side-column')).toBeHidden();
  const focusedArticle = await page.locator('.reader-article').boundingBox();
  expect(focusedArticle.width).toBeGreaterThan(1300);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.reader-dock')).toBeHidden();
});
