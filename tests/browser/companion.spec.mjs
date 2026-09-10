import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { transparentParts } from '../../lib/companion-model.ts';

const [issue] = JSON.parse(await readFile('generated/briefings.json', 'utf8'));

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  // Inspect the real Core model without exposing development globals in the app.
  await page.addInitScript(() => {
    document.addEventListener(
      'load',
      () => {
        const core = window.Live2DCubismCore;
        if (!core?.Model || window.__companionHooked) return;
        window.__companionHooked = true;
        const fromMoc = core.Model.fromMoc;
        core.Model.fromMoc = function (...args) {
          const model = fromMoc.apply(this, args);
          window.__companionCreations = (window.__companionCreations ?? 0) + 1;
          window.__companionModel = model;
          window.__companionFrames = [];
          const update = model.update;
          model.update = function () {
            const ids = [
              'ParamEyeLOpen',
              'ParamEyeROpen',
              'ParamBreath',
              'ParamEyeBallX',
              'ParamAngleX',
            ];
            window.__companionFrames.push(
              Object.fromEntries(
                ids.map((id) => [
                  id,
                  model.parameters.values[model.parameters.ids.indexOf(id)],
                ]),
              ),
            );
            if (window.__companionFrames.length > 600)
              window.__companionFrames.shift();
            return update.call(this);
          };
          return model;
        };
      },
      true,
    );
  });
});

test('client navigation keeps the same animated scene without reloading companion resources', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const resources = [];
  const documents = [];
  page.on('request', (request) => {
    if (
      /\/live2d\/|live2dcubismcore/.test(request.url()) &&
      !/\/motions\/(?!idle\.)/.test(request.url())
    )
      resources.push(request.url());
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(request.url());
  });
  await page.goto('./');
  if (isMobile) await page.getByRole('button', { name: '展开看板娘' }).click();
  await ready(page);
  await page.evaluate(() => {
    window.__initialCompanion = {
      document,
      canvas: document.querySelector('.live2d-canvas-wrap canvas'),
      model: window.__companionModel,
    };
  });
  await page.locator('.live2d-canvas-wrap').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.live2d-stage')).toHaveAttribute(
    'data-phase',
    'responding',
  );
  const dialogue = await page.locator('.live2d-dialogue').textContent();
  const loadedResources = [...resources];
  const preserved = async () => {
    await ready(page);
    expect(
      await page.evaluate(() => {
        const initial = window.__initialCompanion;
        return (
          initial?.document === document &&
          initial.canvas ===
            document.querySelector('.live2d-canvas-wrap canvas') &&
          initial.model === window.__companionModel &&
          window.__companionCreations === 1
        );
      }),
    ).toBe(true);
    expect(resources).toEqual(loadedResources);
    expect(documents).toHaveLength(1);
  };

  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '往期简报' })
    .click();
  await expect(page.locator('.archive-item').first()).toBeVisible();
  await preserved();
  await expect(page.locator('.live2d-dialogue')).toHaveText(dialogue);
  await page.locator('.archive-item').first().click();
  await expect(page).toHaveURL(
    new RegExp(`/briefings/${issue.briefingDate}/$`),
  );
  await preserved();
  await page.getByRole('link', { name: '阅读全文' }).first().click();
  await expect(page.locator('.reader-article > h1')).toHaveText(
    issue.stories[0].title,
  );
  await preserved();
  await page
    .getByRole('navigation', { name: '文章切换' })
    .getByRole('link', { name: /下一篇/ })
    .click();
  await expect(page.locator('.reader-article > h1')).toHaveText(
    issue.stories[1].title,
  );
  await preserved();
  await page.goBack();
  await expect(page.locator('.reader-article > h1')).toHaveText(
    issue.stories[0].title,
  );
  await preserved();
  await page.goForward();
  await expect(page.locator('.reader-article > h1')).toHaveText(
    issue.stories[1].title,
  );
  await preserved();
  await page
    .locator('.reader-breadcrumb')
    .getByRole('link', { name: '每日简报' })
    .click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '探索主题' })
    .click();
  await expect(page.locator('.story-card').first()).toBeVisible();
  await preserved();
  const topic = page.locator('.story-card .story-meta a').first();
  const tag = await topic.textContent();
  await topic.click();
  await expect(
    page.getByRole('button', { name: `移除筛选：${tag}`, exact: true }),
  ).toBeVisible();
  await preserved();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '我的收藏' })
    .click();
  await expect(page).toHaveURL(/\/bookmarks\/$/);
  await preserved();
  await page.evaluate(() => {
    window.__companionFrames.length = 0;
  });
  await expect
    .poll(() => page.evaluate(() => window.__companionFrames.length))
    .toBeGreaterThan(5);
});

test('navigation during model loading keeps the pending download and calendar and keyboard navigation preserve the scene', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(70000);
  page.setDefaultTimeout(10000);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let downloads = 0;
  await page.route('**/*.moc3', async (route) => {
    downloads++;
    await gate;
    await route.continue();
  });
  await page.goto('./');
  if (isMobile) await page.getByRole('button', { name: '展开看板娘' }).click();
  await expect.poll(() => downloads, { timeout: 30000 }).toBe(1);
  await page.evaluate(() => {
    window.__loadingCanvas = document.querySelector(
      '.live2d-canvas-wrap canvas',
    );
  });
  try {
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('link', { name: '往期简报' })
      .click();
    await expect(page.locator('.archive-item').first()).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          window.__loadingCanvas ===
          document.querySelector('.live2d-canvas-wrap canvas'),
      ),
    ).toBe(true);
  } finally {
    release();
  }
  await ready(page);
  if (isMobile) await page.locator('.mobile-calendar > summary').click();
  await page
    .locator(isMobile ? '.mobile-calendar' : '.left-rail')
    .getByLabel('日期直达', { exact: true })
    .fill(issue.briefingDate);
  await expect(page).toHaveURL(
    new RegExp(`/briefings/${issue.briefingDate}/$`),
  );
  await page.keyboard.press('Control+k');
  await expect(
    page.getByRole('searchbox', { name: '搜索简报内容' }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/search\/#atlas-search-input$/);
  expect(
    await page.evaluate(
      () =>
        window.__loadingCanvas ===
        document.querySelector('.live2d-canvas-wrap canvas'),
    ),
  ).toBe(true);
  expect(downloads).toBe(1);
  expect(await page.evaluate(() => window.__companionCreations)).toBe(1);
});

test('reading, bookmarking and marking read play their motions in order while notices stay visible', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90000);
  const motions = [];
  page.on('request', (request) => {
    const name = request.url().match(/\/motions\/([^/]+)\.motion3\.json/);
    if (name) motions.push(name[1]);
  });
  await page.goto('./');
  if (isMobile) await page.getByRole('button', { name: '展开看板娘' }).click();
  await ready(page);
  const stage = page.locator('.live2d-stage');
  const companion = page.getByRole('complementary', { name: '网站看板娘' });
  const listingPosition = await companion.boundingBox();
  const expectPosition = (position) =>
    expect.poll(() => companion.boundingBox()).toEqual(position);
  const responding = async (reaction) => {
    await expect(stage).toHaveAttribute('data-reaction', reaction, {
      timeout: 18000,
    });
    await expect(stage).toHaveAttribute('data-phase', 'responding');
    await expect(stage).toBeVisible();
  };
  const idle = () =>
    expect(stage).toHaveAttribute('data-phase', 'idle', { timeout: 18000 });

  await page.getByRole('link', { name: '阅读全文' }).first().click();
  await expect(page.locator('.reader-article > h1')).toBeVisible();
  await responding('mission');
  const readerPosition = await companion.boundingBox();
  expect(readerPosition.y).toBeLessThan(listingPosition.y);
  const actions = page.locator('.reader-actions').first();
  await actions.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.locator('.notice-bar')).toContainText('已加入我的收藏');
  await expectPosition(readerPosition);
  await actions.getByRole('button', { name: '标记已读', exact: true }).click();
  await responding('mission_complete');
  await masked(page);
  await page.screenshot({
    path: `test-output/companion-milestone-${isMobile ? 'mobile' : 'desktop'}.png`,
  });
  await responding('complete');
  await idle();
  await actions.getByRole('button', { name: '已收藏', exact: true }).click();
  await actions.getByRole('button', { name: '已读', exact: true }).click();
  await expect(stage).toHaveAttribute('data-phase', 'idle');
  await expectPosition(readerPosition);

  await page.locator('.reader-back-link').click();
  const card = page.locator('.story-card').first();
  await expect(card).toBeVisible();
  await expectPosition(listingPosition);
  await page.getByRole('button', { name: '关闭提示' }).click();
  await expectPosition(listingPosition);
  await card.getByRole('button', { name: '收藏新闻', exact: true }).click();
  await expect(page.locator('.notice-bar')).toContainText('已加入我的收藏');
  await expectPosition(listingPosition);
  await responding('mission_complete');
  await page.screenshot({
    path: `test-output/companion-bookmark-${isMobile ? 'mobile' : 'desktop'}.png`,
  });
  await page.getByRole('button', { name: '关闭提示' }).click();
  await expectPosition(listingPosition);
  await card.getByRole('button', { name: '取消收藏', exact: true }).click();
  await expect(page.locator('.notice-bar')).toContainText('已取消收藏');
  await expectPosition(listingPosition);
  await page.getByRole('button', { name: '关闭提示' }).click();
  await expectPosition(listingPosition);
  await card.getByRole('button', { name: '标记为已读', exact: true }).click();
  await responding('complete');
  await idle();
  for (const name of ['mission', 'mission_complete', 'complete'])
    expect(motions.filter((motion) => motion === name)).toHaveLength(1);
});

test('idle time triggers a random main motion once and reduced motion suppresses the countdown', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(60000);
  const motions = [];
  page.on('request', (request) => {
    const name = request.url().match(/\/motions\/(main_[123])\.motion3\.json/);
    if (name) motions.push(name[1]);
  });
  await page.clock.install({ time: new Date('2026-09-09T00:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  if (isMobile) await page.getByRole('button', { name: '展开看板娘' }).click();
  await ready(page);
  await page.clock.pauseAt(new Date('2026-09-09T00:02:00Z'));
  const stage = page.locator('.live2d-stage');
  await expect(stage).toHaveAttribute('data-phase', 'idle');
  expect(motions).toHaveLength(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.runFor(100);
  await page.clock.fastForward(58900);
  await expect(stage).toHaveAttribute('data-phase', 'idle');
  // Media-query change delivery and timer setup can cross a fake-clock turn.
  // Keep the assertion beyond the exact boundary without changing the idle contract.
  await page.clock.fastForward(2100);
  await expect(stage).toHaveAttribute('data-reaction', /^main_[123]$/);
  await expect(stage).toHaveAttribute('data-phase', 'responding');
  expect(motions).toHaveLength(1);
  await page.clock.fastForward(20000);
  await page.clock.fastForward(450);
  await expect(stage).toHaveAttribute('data-phase', 'idle');
});

async function ready(page) {
  await expect(page.locator('.live2d-stage')).toHaveAttribute(
    'data-load-status',
    'ready',
    { timeout: 45000 },
  );
}

async function masked(page) {
  expect(
    await page.evaluate((names) => {
      const model = window.__companionModel;
      const hidden = model.parts.ids.map((_, index) => {
        let part = index;
        while (part >= 0) {
          if (names.includes(model.parts.ids[part])) return true;
          part = model.parts.parentIndices[part];
        }
        return false;
      });
      return (
        names.every(
          (id) => model.parts.opacities[model.parts.ids.indexOf(id)] === 0,
        ) &&
        Array.from(model.drawables.parentPartIndices).every(
          (part, index) =>
            !hidden[part] || model.drawables.opacities[index] === 0,
        )
      );
    }, transparentParts),
  ).toBe(true);
}

async function artwork(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.is-ready');
    const rect = canvas.getBoundingClientRect();
    // A synchronous hit query renders before reading the WebGL drawing buffer.
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 99,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    window.dispatchEvent(new PointerEvent('pointercancel'));
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let left = copy.width,
      top = copy.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < copy.height; y++)
      for (let x = 0; x < copy.width; x++) {
        if (pixels[(y * copy.width + x) * 4 + 3] < 24) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    return {
      left,
      top,
      right,
      bottom,
      width: copy.width,
      height: copy.height,
      point: {
        x:
          rect.left + ((left + (right - left) * 0.5) / copy.width) * rect.width,
        y:
          rect.top +
          ((top + (bottom - top) * 0.15) / copy.height) * rect.height,
      },
    };
  });
}

// Calibrated on the rendered neutral artwork, independent of hit-guide bounds.
async function artworkPoint(page, x, y) {
  const bounds = await artwork(page);
  const rect = await page.locator('canvas.is-ready').boundingBox();
  return {
    x:
      rect.x +
      ((bounds.left + (bounds.right - bounds.left) * x) / bounds.width) *
        rect.width,
    y:
      rect.y +
      ((bounds.top + (bounds.bottom - bounds.top) * y) / bounds.height) *
        rect.height,
  };
}

test('head, chest and remaining body use anatomical touch zones at both viewport sizes', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(65000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  if (isMobile) await page.getByRole('button', { name: '展开看板娘' }).click();
  await ready(page);
  await page.clock.install();
  // Keep underlying page links out of this region-classification regression.
  await page.evaluate(() => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:39';
    document.body.append(backdrop);
  });
  const stage = page.locator('.live2d-stage');
  const samples = [
    ['left chest', 0.433, 0.32, 'touch_special'],
    ['right chest', 0.548, 0.311, 'touch_special'],
    ['lower chest', 0.487, 0.341, 'touch_special'],
    ['upper chest', 0.508, 0.271, 'touch_special'],
    ['forehead', 0.525, 0.068, 'touch_head'],
    ['lower face', 0.517, 0.173, 'touch_head'],
    ['shoulder', 0.398, 0.259, 'touch_body'],
    ['raised hand', 0.6, 0.207, 'touch_body'],
    ['arm', 0.642, 0.302, 'touch_body'],
    ['waist', 0.49, 0.37, 'touch_body'],
    ['thigh', 0.454, 0.512, 'touch_body'],
    ['boot', 0.465, 0.916, 'touch_body'],
  ];
  for (const resized of [false, true]) {
    if (resized) {
      await page.setViewportSize(
        isMobile ? { width: 320, height: 720 } : { width: 1024, height: 768 },
      );
    }
    for (const [name, x, y, reaction] of samples) {
      await test.step(`${resized ? 'resized' : 'initial'} ${name}`, async () => {
        const point = await artworkPoint(page, x, y);
        if (isMobile) await page.touchscreen.tap(point.x, point.y);
        else await page.mouse.click(point.x, point.y);
        await expect(stage).toHaveAttribute('data-reaction', reaction);
        await expect(stage).toHaveAttribute('data-phase', 'responding');
        await page.clock.fastForward(5100);
        await page.clock.fastForward(1);
        await expect(stage).toHaveAttribute('data-phase', 'idle');
        // Page clock skips dialogue timers, but Chromium's native double-tap
        // interval still uses real time. Each sample must remain a single tap.
        if (isMobile) await delay(600);
      });
    }
    await page.screenshot({
      path: `test-output/companion-touch-${isMobile ? 'mobile' : 'desktop'}-${resized ? 'resized' : 'initial'}.png`,
    });
  }
});

test('anatomical clicks play each authored touch motion once and recover', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(80000);
  const motions = [];
  page.on('request', (request) => {
    const match = request.url().match(/\/motions\/(touch_\w+)\.motion3\.json/);
    if (match) motions.push(match[1]);
  });
  await page.goto('./');
  if (isMobile) await page.getByRole('button', { name: '展开看板娘' }).click();
  await ready(page);
  const stage = page.locator('.live2d-stage');
  for (const [x, y, reaction] of [
    [0.433, 0.32, 'touch_special'],
    [0.517, 0.173, 'touch_head'],
    [0.454, 0.512, 'touch_body'],
  ]) {
    const point = await artworkPoint(page, x, y);
    if (isMobile) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await expect(stage).toHaveAttribute('data-reaction', reaction);
    await expect(stage).toHaveAttribute('data-phase', 'responding');
    await masked(page);
    await expect(stage).toHaveAttribute('data-phase', 'idle', {
      timeout: 12000,
    });
  }
  expect(motions).toEqual(['touch_special', 'touch_head', 'touch_body']);
});

test('real model fits, animates, follows the mouse, speaks, and stays transparent through a response', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(65000);
  await page.goto('./');
  if (isMobile) {
    await expect(
      page.getByRole('button', { name: '展开看板娘' }),
    ).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    await page.getByRole('button', { name: '展开看板娘' }).tap();
  }
  await ready(page);
  await expect
    .poll(() => page.evaluate(() => window.__companionFrames.length), {
      timeout: 15000,
    })
    .toBeGreaterThan(180);
  await masked(page);
  const ranges = await page.evaluate(() =>
    Object.fromEntries(
      ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamBreath'].map((id) => {
        const values = window.__companionFrames.map((frame) => frame[id]);
        return [id, Math.max(...values) - Math.min(...values)];
      }),
    ),
  );
  expect(ranges.ParamEyeLOpen).toBeGreaterThan(0.4);
  expect(ranges.ParamEyeROpen).toBeGreaterThan(0.4);
  expect(ranges.ParamBreath).toBeGreaterThan(0.1);
  if (!isMobile) {
    const eye = () =>
      page.evaluate(() => window.__companionFrames.at(-1).ParamEyeBallX);
    await page.mouse.move(20, 100);
    await expect.poll(eye).toBeLessThan(-0.3);
    await page.mouse.move(1250, 100);
    await expect.poll(eye).toBeGreaterThan(0.3);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const bounds = await artwork(page);
  expect(bounds.bottom - bounds.top).toBeGreaterThan(bounds.height * 0.5);
  expect(bounds.left).toBeGreaterThan(0);
  expect(bounds.right).toBeLessThan(bounds.width);
  expect(bounds.bottom).toBeLessThan(bounds.height);
  if (isMobile) await page.touchscreen.tap(bounds.point.x, bounds.point.y);
  else await page.mouse.click(bounds.point.x, bounds.point.y);
  await expect(page.locator('.live2d-dialogue')).not.toBeEmpty();
  await masked(page);
  await page.screenshot({
    path: `test-output/companion-${isMobile ? 'mobile' : 'desktop'}.png`,
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.live2d-canvas-wrap').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.live2d-stage')).toHaveAttribute(
    'data-phase',
    'responding',
  );
  await masked(page);
  await expect(page.locator('.live2d-stage')).toHaveAttribute(
    'data-phase',
    'idle',
    { timeout: 12000 },
  );
  await masked(page);
  // Page controls underneath the transparent overlay retain their own click.
  const point = (await artwork(page)).point;
  await page.evaluate(({ x, y }) => {
    const button = document.createElement('button');
    button.id = 'under-companion';
    button.textContent = 'Underlying page action';
    button.style.cssText = `position:fixed;left:${x - 10}px;top:${y - 10}px;width:20px;height:20px;z-index:1`;
    button.onclick = () => {
      button.dataset.clicked = 'true';
    };
    document.body.append(button);
  }, point);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#under-companion')).toHaveAttribute(
    'data-clicked',
    'true',
  );
  await expect(page.locator('.live2d-stage')).toHaveAttribute(
    'data-phase',
    'idle',
  );
  await page
    .locator('#under-companion')
    .evaluate((element) => element.remove());
  await page.getByRole('button', { name: '收起看板娘' }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '展开看板娘' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('reader tools stay clear and settings, print, and narrow screens keep the companion out of the way', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`read/${issue.briefingDate}/${issue.stories[0].id}/`);
  if (isMobile) await page.getByRole('button', { name: '展开看板娘' }).click();
  await ready(page);
  const stage = page.locator('.live2d-stage');
  const dock = await page.locator('.reader-dock').boundingBox();
  const canvas = await page.locator('canvas').boundingBox();
  expect(canvas.y + canvas.height).toBeLessThan(dock.y - 5);
  await page.getByRole('button', { name: '排版与外观', exact: true }).click();
  await expect(stage).toBeHidden();
  await page.getByRole('button', { name: '关闭阅读设置' }).click();
  await expect(stage).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(
    page.getByRole('complementary', { name: '网站看板娘' }),
  ).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(320);
  if (!isMobile)
    await expect(
      page.getByRole('button', { name: '展开看板娘' }),
    ).toBeVisible();
  await page.screenshot({
    path: `test-output/companion-reader-${isMobile ? 'mobile' : 'desktop'}.png`,
  });
});

test('phone visits fetch no model until expanded and failed loading remains collapsible', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Mobile default and optional resource failure');
  const requests = [];
  page.on('request', (request) => {
    if (/\/live2d\/|live2dcubismcore/.test(request.url()))
      requests.push(request.url());
  });
  await page.route('**/live2dcubismcore.min.js', (route) =>
    route.abort('failed'),
  );
  await page.goto('./');
  await expect(page.getByRole('button', { name: '展开看板娘' })).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '往期简报' })
    .click();
  await expect(page.locator('.archive-item').first()).toBeVisible();
  await page.goBack();
  await expect(page.locator('.reader-entry')).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '展开看板娘' }).tap();
  await expect(page.getByRole('button', { name: '收起看板娘' })).toBeVisible();
  await expect(page.getByRole('button', { name: '再试一次' })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: '收起看板娘' }).tap();
  await expect(page.getByRole('button', { name: '展开看板娘' })).toBeVisible();
});
