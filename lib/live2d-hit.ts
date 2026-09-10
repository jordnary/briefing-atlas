import type { Application } from 'pixi.js';
import type {
  Cubism4InternalModel,
  Live2DModel,
} from 'pixi-live2d-display/cubism4';

export type CompanionHit = 'head' | 'special' | 'body' | null;
export const hitAlphaThreshold = 24;

// The exported touch guides cover only the forehead and upper chest. Supplement
// them with the yibei_3 artwork meshes, whose vertices follow the current pose.
const headMeshes = ['ArtMesh124', 'ArtMesh196']; // Head outline and face.
const chestMeshes = ['oppai', 'oppaiR']; // Both sides, including under clothing.

function edgeDistanceSquared(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax,
    dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length))
    : 0;
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
}

/** Read rendered alpha so transparent canvas space leaves the page untouched. */
export function createCompanionHitTest(
  app: Application,
  model: Live2DModel<Cubism4InternalModel>,
  canvas: HTMLCanvasElement,
) {
  if (!('gl' in app.renderer)) throw new Error('Live2D requires WebGL');
  const gl = app.renderer.gl;
  const pixel = new Uint8Array(4);
  const local = { x: 0, y: 0 };
  const internal = model.internalModel;
  const head = internal.coreModel.getDrawableIndex('TouchHead');
  const special = internal.coreModel.getDrawableIndex('TouchSpecial');
  const indices = (ids: string[]) =>
    ids
      .map((id) => internal.coreModel.getDrawableIndex(id))
      .filter((index) => index >= 0);
  const headArtwork = indices(headMeshes);
  const chestArtwork = indices(chestMeshes);
  // Keep a stable normalized coordinate frame for exported touch points.  The
  // model's local bounds follow resize/scale, so this remains valid at both
  // desktop and mobile viewport sizes even when individual meshes animate.
  let bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  internal.getDrawableIDs().forEach((_, index) => {
    const vertices = internal.getDrawableVertices(index);
    for (let i = 0; i < vertices.length; i += 2) {
      bounds.left = Math.min(bounds.left, vertices[i]);
      bounds.right = Math.max(bounds.right, vertices[i]);
      bounds.top = Math.min(bounds.top, vertices[i + 1]);
      bounds.bottom = Math.max(bounds.bottom, vertices[i + 1]);
    }
  });
  const inArea = (index: number, mesh = false, paddingRatio = 0) => {
    if (index < 0) return false;
    const vertices = internal.getDrawableVertices(index);
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (let i = 0; i < vertices.length; i += 2) {
      left = Math.min(left, vertices[i]);
      right = Math.max(right, vertices[i]);
      top = Math.min(top, vertices[i + 1]);
      bottom = Math.max(bottom, vertices[i + 1]);
    }
    const padding = Math.min(right - left, bottom - top) * paddingRatio;
    if (
      !Number.isFinite(left + top + right + bottom) ||
      local.x < left - padding ||
      local.x > right + padding ||
      local.y < top - padding ||
      local.y > bottom + padding
    )
      return false;
    if (!mesh) return true;
    const triangles = internal.coreModel.getDrawableVertexIndices(index);
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] * 2,
        b = triangles[i + 1] * 2,
        c = triangles[i + 2] * 2;
      const ax = vertices[a],
        ay = vertices[a + 1];
      const bx = vertices[b],
        by = vertices[b + 1];
      const cx = vertices[c],
        cy = vertices[c + 1];
      const ab = (bx - ax) * (local.y - ay) - (by - ay) * (local.x - ax);
      const bc = (cx - bx) * (local.y - by) - (cy - by) * (local.x - bx);
      const ca = (ax - cx) * (local.y - cy) - (ay - cy) * (local.x - cx);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (
        area !== 0 &&
        ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0))
      )
        return true;
      if (
        padding > 0 &&
        Math.min(
          edgeDistanceSquared(local.x, local.y, ax, ay, bx, by),
          edgeDistanceSquared(local.x, local.y, bx, by, cx, cy),
          edgeDistanceSquared(local.x, local.y, cx, cy, ax, ay),
        ) <=
          padding ** 2
      )
        return true;
    }
    return false;
  };
  return {
    hitTest(x: number, y: number): CompanionHit {
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x >= app.screen.width ||
        y >= app.screen.height ||
        gl.isContextLost()
      )
        return null;
      app.render();
      pixel.fill(0);
      gl.readPixels(
        Math.floor((x / app.screen.width) * canvas.width),
        canvas.height - 1 - Math.floor((y / app.screen.height) * canvas.height),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      model.worldTransform.applyInverse({ x, y }, local);
      internal.localTransform.applyInverse(local, local);
      if (inArea(head) || headArtwork.some((index) => inArea(index, true)))
        return 'head';
      // A small model-relative margin makes the clothed chest edges usable on
      // compact screens without turning the shoulders, arms or waist into chest.
      if (
        chestArtwork.some((index) => inArea(index, true, 0.08)) ||
        inArea(special)
      )
        return 'special';
      if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
        const nx = (local.x - bounds.left) / (bounds.right - bounds.left);
        const ny = (local.y - bounds.top) / (bounds.bottom - bounds.top);
        if (ny < 0.22) return 'head';
        if (ny >= 0.24 && ny <= 0.38 && nx >= 0.36 && nx <= 0.64)
          return 'special';
      }
      // Keep transparent canvas space inert for the broad body fallback. The
      // authored head/chest meshes above are the interaction zones and remain
      // usable even when WebGL's single-pixel readback lands on a transparent
      // antialiased edge.
      if (pixel[3] < hitAlphaThreshold) return null;
      return 'body';
    },
  };
}
