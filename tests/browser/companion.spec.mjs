import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '展开看板娘' }).tap();
  await expect(page.getByRole('button', { name: '收起看板娘' })).toBeVisible();
  await expect(page.getByRole('button', { name: '再试一次' })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: '收起看板娘' }).tap();
  await expect(page.getByRole('button', { name: '展开看板娘' })).toBeVisible();
});
