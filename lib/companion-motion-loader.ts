type MotionSource<T> = {
  load: (group: string, index: number) => Promise<T | undefined>;
  reset: (group: string, index: number) => void;
  networkFailure: (group: string, index: number) => boolean;
};

/** Keep in-flight work shared, but permit a failed motion to load on a later interaction. */
export function createMotionLoader<T>(
  source: MotionSource<T>,
  signal: AbortSignal,
) {
  const pending = new Map<string, Promise<T | undefined>>();
  const failures = new Map<string, { until: number; network: boolean }>();
  const load = (group: string, index: number): Promise<T | undefined> => {
    if (signal.aborted) return Promise.resolve(undefined);
    const key = `${group}:${index}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const failure = failures.get(key);
    if (failure && Date.now() < failure.until)
      return Promise.resolve(undefined);
    if (failure) {
      source.reset(group, index);
      failures.delete(key);
    }
    let finish!: (motion: T | undefined) => void;
    const result = new Promise<T | undefined>((resolve) => {
      finish = resolve;
    });
    pending.set(key, result);
    const cancel = () => {
      clearTimeout(timer);
      finish(undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      // Keep the pending entry until the underlying request settles; no duplicate downloads.
      finish(undefined);
    }, 8000);
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return source.load(group, index);
      })
      .catch(() => undefined)
      .then((motion) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        pending.delete(key);
        if (signal.aborted) {
          finish(undefined);
          return;
        }
        if (!motion)
          failures.set(key, {
            until: Date.now() + 30000,
            network: source.networkFailure(group, index),
          });
        finish(motion);
      });
    return result;
  };
  return {
    load,
    connected() {
      for (const failure of failures.values())
        if (failure.network) failure.until = 0;
    },
  };
}
