import type { Application } from 'pixi.js';
import type {
  Cubism4InternalModel,
  Live2DModel,
} from 'pixi-live2d-display/cubism4';

export type CompanionHit = 'head' | 'special' | 'body' | null;
export const hitAlphaThreshold = 24;

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
  const inArea = (index: number) => {
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
    return (
      local.x >= left && local.x <= right && local.y >= top && local.y <= bottom
    );
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
      if (pixel[3] < hitAlphaThreshold) return null;
      model.worldTransform.applyInverse({ x, y }, local);
      internal.localTransform.applyInverse(local, local);
      if (inArea(head)) return 'head';
      if (inArea(special)) return 'special';
      return 'body';
    },
  };
}
