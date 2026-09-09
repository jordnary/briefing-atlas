import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const issues = JSON.parse(await readFile('generated/briefings.json', 'utf8'));
const issue = issues.find((item) =>
  item.stories.some((story) => story.html.includes('data-gallery=')),
);
const story = issue.stories.find((item) => item.html.includes('data-gallery='));
const route = `read/${issue.briefingDate}/${story.id}/`;
const gallery = (page) =>
  page.getByRole('region', { name: '文章配图', exact: true }).first();
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><rect width="1400" height="900" fill="#ceddd9"/><rect x="80" y="80" width="1240" height="740" fill="#317267"/><text x="120" y="220" font-size="60" fill="white">Reading image</text></svg>';

async function expectIndex(page, index) {
  const root = gallery(page);
  const count = await root.locator('.gallery-page').count();
  await expect(root.locator('.gallery-count')).toHaveText(
    `${index} / ${count}`,
  );
  await expect(
    root.getByRole('button', { name: `第 ${index} 张图片`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      root
        .locator('.gallery-viewport')
        .evaluate((track) => Math.round(track.scrollLeft / track.clientWidth)),
    )
    .toBe(index - 1);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.route('https://images.openai.com/**', (request) =>
    request.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  await page.goto(route);
  await expect(
    page.getByRole('button', { name: '排版与外观', exact: true }),
  ).toBeEnabled();
});

test('buttons, direct selection and keyboard navigate every image and survive reader updates', async ({
  page,
}) => {
  const root = gallery(page);
  const next = root.getByRole('button', { name: '下一张图片', exact: true });
  const previous = root.getByRole('button', {
    name: '上一张图片',
    exact: true,
  });
  await expect(previous).toBeDisabled();
  await next.click();
  await expectIndex(page, 2);
  await previous.click();
  await expectIndex(page, 1);
  await root.getByRole('button', { name: '第 4 张图片', exact: true }).click();
  await expectIndex(page, 4);
  await page.getByRole('button', { name: '放大整篇文字', exact: true }).click();
  await expectIndex(page, 4);
  await root.getByRole('button', { name: '第 4 张图片', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expectIndex(page, 3);
  await page.keyboard.press('End');
  await expectIndex(page, await root.locator('.gallery-page').count());
  await expect(next).toBeDisabled();
  await page.keyboard.press('Home');
  await expectIndex(page, 1);
  await expect(root.locator('.gallery-asset').first()).toHaveCSS(
    'object-fit',
    'contain',
  );
});

test('image preview navigates, traps focus and returns to the current picture', async ({
  page,
}) => {
  const root = gallery(page);
  await root
    .getByRole('button', { name: '放大第 1 张图片', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '图片预览' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '关闭图片预览' }),
  ).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await dialog.getByRole('button', { name: '下一张图片' }).click();
  await expect(dialog.locator('.image-viewer-count')).toHaveText('2 / 6');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('.image-viewer-count')).toHaveText('3 / 6');
  await expect(dialog.getByRole('link', { name: '查看原图' })).toHaveAttribute(
    'target',
    '_blank',
  );
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    root.getByRole('button', { name: '放大第 3 张图片', exact: true }),
  ).toBeFocused();
  await expectIndex(page, 3);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

test('long captions expand without clipping on small screens, in dark mode and print', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 650 });
  const root = gallery(page);
  await root.getByRole('button', { name: '第 6 张图片', exact: true }).click();
  await expectIndex(page, 6);
  const caption = root.locator('.gallery-caption-text');
  await expect(
    root.getByRole('button', { name: '展开图注', exact: true }),
  ).toBeVisible();
  const collapsed = await caption.boundingBox();
  expect(
    await caption.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(14);
  await root.getByRole('button', { name: '展开图注', exact: true }).click();
  await expect(root.getByRole('button', { name: '收起图注' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect((await caption.boundingBox()).height).toBeGreaterThan(
    collapsed.height,
  );
  await root.getByRole('button', { name: '收起图注' }).click();
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  for (const button of await root.locator('.gallery-navigation button').all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.emulateMedia({ media: 'print' });
  await expect(root.locator('.gallery-toolbar')).toBeHidden();
  await expect(root.locator('.gallery-print-images')).toBeVisible();
  await expect(root.locator('.gallery-print-images figure')).toHaveCount(6);
});

test('native swiping or scrolling updates the selection and resize keeps the image', async ({
  page,
  isMobile,
}) => {
  const track = gallery(page).locator('.gallery-viewport');
  await track.scrollIntoViewIfNeeded();
  if (isMobile) {
    const box = await track.boundingBox();
    const session = await page.context().newCDPSession(page);
    const y = box.y + box.height / 2;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width * 0.85, y }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: box.x + box.width * (0.85 - step * 0.085), y }],
      });
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await session.detach();
  } else {
    await track.hover();
    await page.mouse.wheel((await track.boundingBox()).width, 0);
  }
  await expectIndex(page, 2);
  await page.setViewportSize({ width: isMobile ? 700 : 1100, height: 850 });
  await expectIndex(page, 2);
});

test('failed images keep their layout and other pictures remain accessible with reduced motion', async ({
  page,
}) => {
  const root = gallery(page);
  const firstSource = await root
    .locator('.gallery-asset')
    .first()
    .getAttribute('src');
  await page.route(firstSource, (route) =>
    route.fulfill({ status: 404, body: 'Unavailable' }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(root.locator('.gallery-asset').first()).toHaveClass(/is-failed/);
  const height = (await root.locator('.gallery-viewport').boundingBox()).height;
  await root.getByRole('button', { name: '下一张图片', exact: true }).click();
  await expectIndex(page, 2);
  await expect(root.locator('.gallery-asset').nth(1)).toHaveClass(/is-ready/);
  expect((await root.locator('.gallery-viewport').boundingBox()).height).toBe(
    height,
  );
});
