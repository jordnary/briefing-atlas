import { href } from './paths';
import { createPartVisibility } from './companion-model';
import type { Application } from 'pixi.js';
import type {
  Cubism4InternalModel,
  Live2DModel,
} from 'pixi-live2d-display/cubism4';
import {
  createCompanionBehavior,
  type CompanionReaction,
  type CompanionState,
} from './companion-behavior';
import {
  createCompanionHitTest,
  hitAlphaThreshold,
  type CompanionHit,
} from './live2d-hit';
import {
  CompanionLoadError,
  classifyLoadError,
  type LoadStage,
} from './companion-loading';
import { loadCompanionAssets } from './live2d-assets';
import { createMotionLoader } from './companion-motion-loader';

const coreUrl =
  'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
let corePromise: Promise<void> | undefined;

function loadCore() {
  if ('Live2DCubismCore' in window) return Promise.resolve();
  if (corePromise) return corePromise;

  corePromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => finish(false), 15000);
    const finish = (success: boolean) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (success) {
        resolve();
      } else {
        script.remove();
        corePromise = undefined;
        reject(new CompanionLoadError('network'));
      }
    };
    script.src = coreUrl;
    script.async = true;
    script.onload = () => finish('Live2DCubismCore' in window);
    script.onerror = () => finish(false);
    document.head.append(script);
  });
  return corePromise;
}

export type Live2DScene = {
  destroy: () => void;
  focus: (x: number, y: number) => void;
  pause: (paused: boolean) => void;
  hitTest: (x: number, y: number) => CompanionHit;
  react: (reaction: CompanionReaction) => boolean;
};

export async function createLive2DScene(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  signal: AbortSignal,
  onState: (state: CompanionState) => void = () => {},
  initiallyPaused: () => boolean = () => document.hidden,
  onLoadStage: (stage: LoadStage) => void = () => {},
): Promise<Live2DScene> {
  signal.throwIfAborted();
  onLoadStage('runtime');
  await loadCore();
  signal.throwIfAborted();
  const [
    { Application, Container, Texture },
    { Live2DModel, Live2DFactory, Cubism4ModelSettings, MotionPreloadStrategy },
  ] = await Promise.all([
    import('pixi.js'),
    import('pixi-live2d-display/cubism4'),
  ]).catch(() => {
    throw new CompanionLoadError(navigator.onLine ? 'module' : 'network');
  });
  signal.throwIfAborted();
  onLoadStage('assets');
  const assets = await loadCompanionAssets(
    new URL(href('/live2d/yibei_3/yibei_3.model3.json'), document.baseURI).href,
    signal,
  );

  let app: Application | undefined;
  let model: Live2DModel<Cubism4InternalModel> | undefined;
  let observer: ResizeObserver | undefined;
  let behavior: ReturnType<typeof createCompanionBehavior> | undefined;
  let destroyed = false;
  let reconnect: (() => void) | undefined;
  let preparing = false;
  const textures: import('pixi.js').Texture[] = [];
  const releaseModel = () => {
    if (model) {
      if (model.internalModel) model.destroy({ children: true });
      else {
        model.emit('destroy');
        Container.prototype.destroy.call(model, { children: true });
      }
      model = undefined;
    }
    textures.splice(0).forEach((texture) => texture.destroy(true));
    assets.release();
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    if (reconnect) window.removeEventListener('online', reconnect);
    behavior?.destroy();
    // Stop the ticker immediately, including when unmounted during a model fetch.
    app?.stop();
    if (!preparing) releaseModel();
    app?.destroy(false);
    signal.removeEventListener('abort', destroy);
  };

  try {
    signal.throwIfAborted();
    try {
      app = new Application({
        view: canvas,
        // An overlay can hide the widget while its resources are still arriving.
        width: container.clientWidth || 320,
        height: container.clientHeight || 440,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoStart: false,
        sharedTicker: false,
      });
    } catch {
      throw new CompanionLoadError('webgl');
    }
    signal.addEventListener('abort', destroy, { once: true });
    const settings = new Cubism4ModelSettings(assets.source);
    // The adapter's legacy URL resolver corrupts blob URLs; retain native resolution.
    settings.resolveURL = (path) => new URL(path, settings.url).href;
    const options = {
      autoInteract: false,
      autoUpdate: false,
      motionPreload: MotionPreloadStrategy.NONE,
      idleMotionGroup: 'idle',
    };
    preparing = true;
    try {
      // Own textures and the partial model even when the factory rejects during setup.
      const results = await Promise.allSettled(
        settings.textures.map(async (path) => {
          const texture = await Texture.fromURL(settings.resolveURL(path));
          textures.push(texture);
        }),
      );
      if (results.some((result) => result.status === 'rejected'))
        throw new CompanionLoadError('resource');
      signal.throwIfAborted();
      model = new Live2DModel(options) as Live2DModel<Cubism4InternalModel>;
      await Live2DFactory.setupLive2DModel(model, settings, options).catch(
        () => {
          throw new CompanionLoadError('resource');
        },
      );
    } finally {
      preparing = false;
      if (destroyed) releaseModel();
    }
    signal.throwIfAborted();
    if (!model) throw new CompanionLoadError('resource');
    const currentApp = app;
    const currentModel = model;
    const internal = model.internalModel;
    const maskParts = createPartVisibility(internal.coreModel.getModel());
    // Motions and physics run first; visibility is enforced before and after Core.
    internal.on('beforeModelUpdate', maskParts);
    const updateModel = internal.update.bind(internal);
    internal.update = (dt, now) => {
      updateModel(dt, now);
      maskParts();
    };
    maskParts();
    const manager = internal.motionManager;
    const failedMotions = new Map<string, boolean>();
    manager.on(
      'motionLoadError',
      (group: string, index: number, error: unknown) => {
        failedMotions.set(
          `${group}:${index}`,
          classifyLoadError(error) === 'network',
        );
      },
    );
    const originalLoadMotion = manager.loadMotion.bind(manager);
    const motions = createMotionLoader(
      {
        load: originalLoadMotion,
        reset(group, index) {
          // pixi-live2d-display 0.4.0 retains both a null motion and its failed task.
          const cached = manager.motionGroups[group];
          if (cached?.[index] === null)
            Reflect.deleteProperty(cached, String(index));
          const tasks = Live2DFactory.motionTasksMap.get(manager)?.[group];
          if (tasks) Reflect.deleteProperty(tasks, String(index));
          failedMotions.delete(`${group}:${index}`);
        },
        networkFailure: (group, index) =>
          failedMotions.get(`${group}:${index}`) ?? false,
      },
      signal,
    );
    manager.loadMotion = motions.load;
    reconnect = () => motions.connected();
    window.addEventListener('online', reconnect);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    app.stage.addChild(model);
    onLoadStage('motions');
    const idleMotion = await manager.loadMotion('idle', 0);
    idleMotion?.setIsLoop(true);
    idleMotion?.setFadeInTime(0.45);
    signal.throwIfAborted();
    // Frame the neutral pose with the requested parts already transparent.
    onLoadStage('frame');
    app.render();

    // Fit the visible artwork, excluding the empty canvas around the exported model.
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    internal.getDrawableIDs().forEach((_, index) => {
      if (internal.coreModel.getDrawableOpacity(index) < 0.05) return;
      const vertices = internal.getDrawableVertices(index);
      for (let i = 0; i < vertices.length; i += 2) {
        left = Math.min(left, vertices[i]);
        right = Math.max(right, vertices[i]);
        top = Math.min(top, vertices[i + 1]);
        bottom = Math.max(bottom, vertices[i + 1]);
      }
    });
    if (!Number.isFinite(left) || right <= left || bottom <= top) {
      left = top = 0;
      right = internal.width;
      bottom = internal.height;
    }

    let layoutWidth = container.clientWidth || 320;
    let layoutHeight = container.clientHeight || 440;
    const resize = () => {
      if (destroyed) return;
      const width = (layoutWidth = container.clientWidth || layoutWidth);
      const height = (layoutHeight = container.clientHeight || layoutHeight);
      const scale = Math.min(
        (width - 32) / (right - left),
        (height - 28) / (bottom - top),
      );
      currentApp.renderer.resize(width, height);
      currentModel.scale.set(scale);
      // Keep spare canvas space on the left when the window height limits the model.
      currentModel.position.set(
        width - 12 - right * scale,
        height - 8 - bottom * scale,
      );
      // Anchor the bubble to visible artwork, including the export's transparent padding.
      const stage = container.parentElement;
      stage?.style.setProperty(
        '--companion-artwork-top',
        `${currentModel.y + top * scale}px`,
      );
      stage?.style.setProperty(
        '--companion-artwork-center',
        `${currentModel.x + ((left + right) * scale) / 2}px`,
      );
      stage?.style.setProperty(
        '--companion-artwork-width',
        `${(right - left) * scale}px`,
      );
      currentApp.render();
    };
    resize();

    // Some exported meshes include large transparent regions. Measure the rendered
    // alpha once so those regions do not shrink the character to a tiny thumbnail.
    if (!('gl' in app.renderer)) throw new CompanionLoadError('webgl');
    const gl = app.renderer.gl;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let pixelLeft = canvas.width;
    let pixelRight = -1;
    let pixelTop = canvas.height;
    let pixelBottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] < hitAlphaThreshold)
          continue;
        pixelLeft = Math.min(pixelLeft, x);
        pixelRight = Math.max(pixelRight, x);
        pixelTop = Math.min(pixelTop, canvas.height - 1 - y);
        pixelBottom = Math.max(pixelBottom, canvas.height - 1 - y);
      }
    }
    if (pixelRight > pixelLeft && pixelBottom > pixelTop) {
      const resolution = app.renderer.resolution;
      const scale = model.scale.x;
      left = (pixelLeft / resolution - model.x) / scale;
      right = ((pixelRight + 1) / resolution - model.x) / scale;
      top = (pixelTop / resolution - model.y) / scale;
      bottom = ((pixelBottom + 1) / resolution - model.y) / scale;
    }
    resize();
    if (idleMotion) await model.motion('idle', 0, 3);
    signal.throwIfAborted();
    model.update(1);
    app.render();
    observer = new ResizeObserver(resize);
    observer.observe(container);
    app.ticker.maxFPS = 30;
    app.ticker.add(() =>
      currentModel.update(Math.min(currentApp.ticker.deltaMS, 100)),
    );

    const hit = createCompanionHitTest(currentApp, currentModel, canvas);
    let paused = initiallyPaused();
    let wasReduced = reducedMotion.matches;
    behavior = createCompanionBehavior({
      async prepare(reaction) {
        const motion = await manager.loadMotion(reaction, 0);
        if (!motion || destroyed) return false;
        motion.setIsLoop(false);
        return true;
      },
      play: (reaction) => currentModel.motion(reaction, 0, 3),
      idle() {
        if (destroyed) return;
        manager.stopAllMotions();
        internal.focusController.focus(0, 0, true);
        void manager
          .loadMotion('idle', 0)
          .then((motion) => {
            if (
              !motion ||
              destroyed ||
              behavior?.state.phase === 'responding' ||
              behavior?.state.phase === 'noticing'
            )
              return;
            motion.setFadeInTime(0.45);
            return currentModel.motion('idle', 0, 3);
          })
          .catch(() => false);
      },
      reducedMotion: () => reducedMotion.matches,
      active: () => !paused && !destroyed,
      change(state) {
        if (state.phase === 'noticing') internal.focusController.focus(0, 0);
        // Let the authored response own head, eye and body parameters completely.
        if (state.phase === 'responding' || state.phase === 'recovering')
          internal.focusController.focus(0, 0, true);
        onState(state);
      },
    });
    manager.on('motionFinish', () => behavior?.finish());
    const pause = (next: boolean) => {
      if (destroyed) return;
      const changed = next !== paused || wasReduced !== reducedMotion.matches;
      paused = next;
      wasReduced = reducedMotion.matches;
      if (changed) behavior?.reset();
      if (paused || reducedMotion.matches) currentApp.stop();
      else currentApp.start();
    };
    pause(initiallyPaused());

    return {
      destroy,
      pause,
      focus(x, y) {
        if (
          destroyed ||
          paused ||
          reducedMotion.matches ||
          behavior?.state.phase !== 'idle'
        )
          return;
        // Normalize against the viewport so tracking stays gentle outside the small canvas.
        internal.focusController.focus(x * 0.65, y * 0.45);
      },
      hitTest(x, y) {
        return destroyed || paused ? null : hit.hitTest(x, y);
      },
      react(reaction) {
        return !destroyed && !paused && (behavior?.request(reaction) ?? false);
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
