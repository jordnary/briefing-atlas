export type LoadStage = 'runtime' | 'assets' | 'motions' | 'frame';
export type LoadFailure =
  | 'network'
  | 'timeout'
  | 'resource'
  | 'webgl'
  | 'module'
  | 'unknown';
export type LoadState = {
  status: 'waiting' | 'loading' | 'ready' | 'offline' | 'recovering' | 'error';
  stage: LoadStage;
  slow: boolean;
  failure?: LoadFailure;
};

export class CompanionLoadError extends Error {
  kind: LoadFailure;
  constructor(kind: LoadFailure) {
    super(`Companion load failed: ${kind}`);
    this.kind = kind;
  }
}

export function classifyLoadError(error: unknown): LoadFailure {
  if (error instanceof CompanionLoadError) return error.kind;
  if (error instanceof SyntaxError) return 'resource';
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number(error.status);
    return status === 0 || status === 408 || status === 429 || status >= 500
      ? 'network'
      : 'resource';
  }
  return 'unknown';
}

type Scene = { destroy: () => void };
type Options<T extends Scene> = {
  load: (signal: AbortSignal, stage: (stage: LoadStage) => void) => Promise<T>;
  change: (state: LoadState) => void;
  ready: (scene: T) => void;
  available?: () => boolean;
  online?: () => boolean;
};

// This controller owns attempts; React only renders its current state.
export function createCompanionLoader<T extends Scene>(options: Options<T>) {
  let disposed = false;
  let generation = 0;
  let controller: AbortController | undefined;
  let scene: T | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let contextTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let retryAt = 0;
  let retries = 0;
  let contextWaiting = false;
  let contextRecovery = false;
  let contextAttempts: number[] = [];
  const online = () => options.online?.() ?? true;
  const available = () => options.available?.() ?? true;
  let state: LoadState = { status: 'waiting', stage: 'runtime', slow: false };
  const diagnostics: {
    stage: LoadStage;
    elapsed: number;
    retries: number;
    failure?: LoadFailure;
  }[] = [];
  const publish = (next: LoadState) => {
    state = next;
    if (!disposed) options.change(next);
  };
  const clearTimers = () => {
    clearTimeout(deadline);
    clearTimeout(slowTimer);
  };
  const release = () => {
    clearTimers();
    controller?.abort();
    scene?.destroy();
    scene = undefined;
  };
  const sync = () => {
    clearTimeout(retryTimer);
    if (disposed || !pending || contextWaiting) return;
    if (!online()) {
      publish({ ...state, status: 'offline' });
      return;
    }
    publish({ ...state, status: 'recovering' });
    if (!available()) return;
    retryTimer = setTimeout(
      () => {
        if (!disposed && pending && available() && online()) {
          pending = false;
          start();
        }
      },
      Math.max(0, retryAt - Date.now()),
    );
  };
  const start = () => {
    if (disposed || state.status === 'loading') return;
    if (!online()) {
      pending = true;
      retryAt = Date.now();
      publish({
        ...state,
        status: 'offline',
        failure: 'network',
        slow: false,
      });
      return;
    }
    pending = false;
    clearTimeout(retryTimer);
    clearTimeout(contextTimer);
    contextWaiting = false;
    release();
    const token = ++generation;
    const attempt = (controller = new AbortController());
    const started = performance.now();
    const active = () =>
      !disposed && token === generation && !attempt.signal.aborted;
    const record = (failure?: LoadFailure) => {
      diagnostics.push({
        stage: state.stage,
        elapsed: Math.round(performance.now() - started),
        retries,
        failure,
      });
      if (diagnostics.length > 20) diagnostics.shift();
    };
    const fail = (error: unknown) => {
      if (!active()) return;
      const failure = classifyLoadError(error);
      record(failure);
      release();
      publish({ ...state, status: 'error', failure });
      const limit = contextRecovery
        ? 0
        : failure === 'network' || failure === 'timeout'
          ? 2
          : failure === 'unknown'
            ? 1
            : 0;
      if (retries < limit) {
        retryAt = Date.now() + [2000, 5000][retries];
        retries++;
        pending = true;
        sync();
      }
    };
    publish({ status: 'loading', stage: 'runtime', slow: false });
    deadline = setTimeout(() => fail(new CompanionLoadError('timeout')), 30000);
    slowTimer = setTimeout(() => {
      if (active()) publish({ ...state, slow: true });
    }, 5000);
    void Promise.resolve()
      .then(() => {
        attempt.signal.throwIfAborted();
        return options.load(attempt.signal, (stage) => {
          if (active()) publish({ ...state, stage });
        });
      })
      .then((loaded) => {
        if (!active()) {
          loaded.destroy();
          return;
        }
        clearTimers();
        scene = loaded;
        record();
        contextRecovery = false;
        publish({ ...state, status: 'ready', slow: false });
        options.ready(loaded);
      })
      .catch(fail);
  };
  return {
    start,
    retry() {
      if (disposed || state.status === 'loading' || contextWaiting) return;
      retries = 0;
      contextRecovery = false;
      start();
    },
    sync,
    connected() {
      if (pending && !contextWaiting) {
        retryAt = Date.now();
        sync();
      }
    },
    contextLost() {
      if (
        disposed ||
        contextWaiting ||
        (state.status !== 'ready' && state.status !== 'loading')
      )
        return;
      generation++;
      contextRecovery = true;
      release();
      clearTimeout(retryTimer);
      contextAttempts = contextAttempts.filter(
        (time) => Date.now() - time < 60000,
      );
      if (contextAttempts.length >= 2) {
        pending = false;
        publish({ ...state, status: 'error', failure: 'webgl' });
        return;
      }
      contextAttempts.push(Date.now());
      contextWaiting = true;
      pending = true;
      publish({
        ...state,
        status: 'recovering',
        failure: 'webgl',
        slow: false,
      });
      contextTimer = setTimeout(() => {
        contextWaiting = false;
        retryAt = Date.now();
        sync();
      }, 10000);
    },
    contextRestored() {
      if (!contextWaiting || disposed) return;
      clearTimeout(contextTimer);
      contextWaiting = false;
      retryAt = Date.now();
      sync();
    },
    get state() {
      return state;
    },
    get diagnostics() {
      return [...diagnostics];
    },
    destroy() {
      disposed = true;
      generation++;
      pending = false;
      clearTimeout(retryTimer);
      clearTimeout(contextTimer);
      release();
    },
  };
}
