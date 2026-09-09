import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createPartVisibility,
  transparentParts,
} from '../lib/companion-model.ts';
import {
  createCompanionBehavior,
  companionMotions,
} from '../lib/companion-behavior.ts';
import { createCompanionLoader } from '../lib/companion-loading.ts';
import {
  requestCompanionReaction,
  subscribeCompanionReactions,
} from '../lib/companion-events.ts';

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('visibility masks requested parts and nested meshes after animation restores their opacity', () => {
  const ids = ['root', 'Part', ...transparentParts, 'nested', 'visible'];
  const model = {
    parts: {
      ids,
      parentIndices: Int32Array.from([-1, 0, 0, 0, 0, 0, 0, 2, 0]),
      opacities: new Float32Array(ids.length).fill(1),
    },
    drawables: {
      parentPartIndices: Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      opacities: new Float32Array(9).fill(1),
    },
  };
  const mask = createPartVisibility(model);
  for (let frame = 0; frame < 3; frame++) {
    model.parts.opacities.fill(1);
    model.drawables.opacities.fill(1);
    mask();
    assert.deepEqual([...model.parts.opacities], [1, 1, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(
      [...model.drawables.opacities],
      [1, 1, 0, 0, 0, 0, 0, 0, 1],
    );
  }
});

test('single-shot dialogue recovers and late motion preparation cannot play after collapse', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let complete;
  let plays = 0,
    idles = 0;
  const behavior = createCompanionBehavior({
    prepare: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    play: async () => {
      plays++;
      return true;
    },
    idle: () => {
      idles++;
    },
    reducedMotion: () => false,
    change() {},
  });
  assert.equal(behavior.request('touch_head'), true);
  assert.equal(behavior.request('touch_body'), false);
  complete(true);
  await flush();
  assert.equal(behavior.state.text, companionMotions.touch_head.text);
  assert.equal(plays, 1);
  behavior.finish();
  t.mock.timers.tick(450);
  assert.equal(behavior.state.phase, 'idle');
  assert.equal(idles, 1);
  behavior.request('touch_body');
  behavior.destroy();
  complete(true);
  await flush();
  t.mock.timers.tick(20000);
  assert.equal(plays, 1);
});

test('reduced motion offers dialogue without loading or playing a response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const behavior = createCompanionBehavior({
    prepare() {
      assert.fail();
    },
    play() {
      assert.fail();
    },
    idle() {},
    reducedMotion: () => true,
    change() {},
  });
  behavior.request('touch_body');
  await flush();
  assert.equal(behavior.state.text, companionMotions.touch_body.text);
  t.mock.timers.tick(5001);
  assert.equal(behavior.state.phase, 'idle');
  behavior.destroy();
});

test('sixty uninterrupted idle seconds choose a main motion and every response restarts the countdown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const random = t.mock.method(Math, 'random', () => 0);
  const played = [];
  const behavior = createCompanionBehavior({
    prepare: async () => true,
    play: async (reaction) => {
      played.push(reaction);
      return true;
    },
    idle() {},
    reducedMotion: () => false,
    change() {},
  });
  t.mock.timers.tick(59999);
  await flush();
  assert.deepEqual(played, []);
  behavior.request('mission');
  await flush();
  t.mock.timers.tick(1);
  assert.deepEqual(played, ['mission']);
  behavior.finish();
  t.mock.timers.tick(450);
  for (const [index, reaction] of ['main_1', 'main_2', 'main_3'].entries()) {
    random.mock.mockImplementation(() => index / 3);
    t.mock.timers.tick(59999);
    await flush();
    assert.equal(behavior.state.phase, 'idle');
    t.mock.timers.tick(1);
    await flush();
    assert.equal(played.at(-1), reaction);
    assert.equal(behavior.state.reaction, reaction);
    behavior.finish();
    t.mock.timers.tick(450);
  }
  behavior.destroy();
});

test('suspension, reduced motion and disposal cancel autonomous animations', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let active = true;
  let quiet = false;
  const played = [];
  const behavior = createCompanionBehavior({
    prepare: async () => true,
    play: async (reaction) => {
      played.push(reaction);
      return true;
    },
    idle() {},
    reducedMotion: () => quiet,
    active: () => active,
    change() {},
  });
  t.mock.timers.tick(59000);
  active = false;
  behavior.reset();
  t.mock.timers.tick(120000);
  await flush();
  assert.deepEqual(played, []);
  active = true;
  quiet = true;
  behavior.reset();
  t.mock.timers.tick(120000);
  await flush();
  assert.deepEqual(played, []);
  quiet = false;
  behavior.reset();
  t.mock.timers.tick(59999);
  await flush();
  assert.deepEqual(played, []);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(played.length, 1);
  behavior.reset();
  behavior.destroy();
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(played.length, 1);
});

test('page milestones survive a scene that subscribes after navigation', () => {
  requestCompanionReaction('mission');
  const received = [];
  const unsubscribe = subscribeCompanionReactions((reaction) =>
    received.push(reaction),
  );
  requestCompanionReaction('mission_complete');
  requestCompanionReaction('complete');
  assert.deepEqual(received, ['mission', 'mission_complete', 'complete']);
  unsubscribe();
  const again = [];
  const stop = subscribeCompanionReactions((reaction) => again.push(reaction));
  assert.deepEqual(again, []);
  stop();
});

test('a cancelled load aborts requests and disposes a scene that arrives late', async () => {
  let complete, signal;
  let destroyed = 0;
  const loader = createCompanionLoader({
    load: (next) => {
      signal = next;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    change() {},
    ready() {
      assert.fail('Cancelled scene became visible');
    },
  });
  loader.start();
  await flush();
  loader.destroy();
  assert.equal(signal.aborted, true);
  complete({
    destroy() {
      destroyed++;
    },
  });
  await flush();
  assert.equal(destroyed, 1);
});

test('an offline start waits for connectivity instead of issuing a doomed request', async () => {
  let online = false;
  let loads = 0;
  let resolveLoad;
  const loader = createCompanionLoader({
    online: () => online,
    load: async () => {
      loads++;
      return new Promise((resolve) => {
        resolveLoad = resolve;
      });
    },
    change() {},
    ready() {},
  });
  loader.start();
  await flush();
  assert.equal(loader.state.status, 'offline');
  assert.equal(loads, 0);
  online = true;
  loader.connected();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  assert.equal(loader.state.status, 'loading');
  assert.equal(loads, 1);
  resolveLoad({ destroy() {} });
  await flush();
  assert.equal(loader.state.status, 'ready');
  loader.destroy();
});

test('dialogue recovery durations match the shipped model motions', async () => {
  for (const [name, settings] of Object.entries(companionMotions)) {
    const motion = JSON.parse(
      await readFile(
        `public/live2d/yibei_3/motions/${name}.motion3.json`,
        'utf8',
      ),
    );
    assert.ok(Math.abs(motion.Meta.Duration * 1000 - settings.duration) < 5);
  }
});
