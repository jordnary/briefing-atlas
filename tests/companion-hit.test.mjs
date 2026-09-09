import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompanionHitTest,
  hitAlphaThreshold,
} from '../lib/live2d-hit.ts';

const rectangle = (left, top, right, bottom) => [
  left,
  top,
  right,
  top,
  right,
  bottom,
  left,
  bottom,
];
const inverse = ({ a = 1, d = 1, tx = 0, ty = 0 } = {}) => ({
  applyInverse(point, result) {
    result.x = (point.x - tx) / a;
    result.y = (point.y - ty) / d;
  },
});

function fixture({ world, layout, omitted = [] } = {}) {
  const meshes = new Map(
    [
      ['TouchHead', rectangle(20, 0, 80, 30)],
      ['TouchSpecial', rectangle(30, 65, 50, 88)],
      ['ArtMesh196', [20, 20, 80, 20, 50, 60]],
      ['oppai', [35, 85, 75, 85, 55, 125]],
      ['oppaiR', [10, 85, 40, 85, 30, 125]],
    ].filter(([id]) => !omitted.includes(id)),
  );
  const ids = [...meshes.keys()];
  const state = { alpha: 255, lost: false, renders: 0, reads: [] };
  const hit = createCompanionHitTest(
    {
      screen: { width: 200, height: 300 },
      render() {
        state.renders++;
      },
      renderer: {
        gl: {
          isContextLost: () => state.lost,
          readPixels(x, y, _width, _height, _format, _type, pixel) {
            state.reads.push([x, y]);
            pixel[3] = state.alpha;
          },
        },
      },
    },
    {
      worldTransform: inverse(world),
      internalModel: {
        localTransform: inverse(layout),
        getDrawableVertices: (index) => meshes.get(ids[index]),
        coreModel: {
          getDrawableIndex: (id) => ids.indexOf(id),
          getDrawableVertexIndices: (index) =>
            meshes.get(ids[index]).length === 6
              ? [0, 1, 2]
              : [0, 1, 2, 0, 2, 3],
        },
      },
    },
    { width: 600, height: 900 },
  );
  return { hitTest: (x, y) => hit.hitTest(x, y), state, meshes };
}

test('face and both sides of the lower chest supplement the undersized authored guides', () => {
  const { hitTest } = fixture();
  for (const point of [
    [50, 15],
    [50, 53],
  ])
    assert.equal(hitTest(...point), 'head');
  for (const point of [
    [40, 75],
    [30, 113],
    [55, 113],
  ])
    assert.equal(hitTest(...point), 'special');
  // The hand beside the chin, arm and waist stay outside the anatomical shapes.
  for (const point of [
    [76, 52],
    [80, 106],
    [51, 140],
  ])
    assert.equal(hitTest(...point), 'body');
});

test('chest edge tolerance is small and head wins where guides overlap', () => {
  const { hitTest, meshes } = fixture();
  assert.equal(hitTest(10, 87), 'special');
  assert.equal(hitTest(6, 87), 'body');
  meshes.set('TouchSpecial', rectangle(10, 0, 90, 35));
  assert.equal(hitTest(50, 15), 'head');
});

test('anatomical regions follow updated vertices instead of keeping neutral-pose bounds', () => {
  const { hitTest, meshes } = fixture();
  assert.equal(hitTest(55, 113), 'special');
  for (const id of ['oppai', 'oppaiR']) {
    meshes.set(
      id,
      meshes.get(id).map((value, index) => (index % 2 ? value : value + 70)),
    );
  }
  assert.equal(hitTest(55, 113), 'body');
  assert.equal(hitTest(125, 113), 'special');
});

test('world/layout transforms and high-DPI pixel reads agree on the same chest point', () => {
  const { hitTest, state } = fixture({
    world: { a: 1.25, d: 1.5, tx: 10, ty: 20 },
    layout: { a: 0.5, d: 0.8, tx: 5, ty: 7 },
  });
  const x = (55 * 0.5 + 5) * 1.25 + 10;
  const y = (113 * 0.8 + 7) * 1.5 + 20;
  assert.equal(hitTest(x, y), 'special');
  assert.deepEqual(state.reads, [[Math.floor(x * 3), 899 - Math.floor(y * 3)]]);
  assert.equal(state.renders, 1);
});

test('transparent space, invalid coordinates and lost WebGL contexts never trigger a reaction', () => {
  const { hitTest, state } = fixture();
  state.alpha = hitAlphaThreshold - 1;
  assert.equal(hitTest(55, 113), null);
  state.alpha = hitAlphaThreshold;
  assert.equal(hitTest(55, 113), 'special');
  state.lost = true;
  assert.equal(hitTest(55, 113), null);
  state.lost = false;
  for (const point of [
    [NaN, 10],
    [10, Infinity],
    [-1, 10],
    [200, 10],
    [10, 300],
  ])
    assert.equal(hitTest(...point), null);
  assert.equal(state.renders, 2);
});

test('missing artwork retains authored guides and missing guides retain anatomical regions', () => {
  const guides = fixture({ omitted: ['ArtMesh196', 'oppai', 'oppaiR'] });
  assert.equal(guides.hitTest(50, 15), 'head');
  assert.equal(guides.hitTest(40, 75), 'special');
  assert.equal(guides.hitTest(55, 113), 'body');
  const artwork = fixture({ omitted: ['TouchHead', 'TouchSpecial'] });
  assert.equal(artwork.hitTest(50, 53), 'head');
  assert.equal(artwork.hitTest(55, 113), 'special');
});
