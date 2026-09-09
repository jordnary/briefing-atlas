export const companionMotions = {
  touch_head: {
    duration: 4300,
    text: '嗯？我在呢。读累了的话，就休息一下吧。',
  },
  touch_body: { duration: 5950, text: '今天又有什么新发现？我陪你慢慢看。' },
  touch_special: { duration: 3950, text: '收到你的招呼啦，一起继续探索吧。' },
} as const;

export type CompanionReaction = keyof typeof companionMotions;
export type CompanionState = {
  phase: 'idle' | 'noticing' | 'responding' | 'recovering';
  reaction: CompanionReaction | null;
  text: string;
};

type Driver = {
  prepare: (reaction: CompanionReaction) => Promise<boolean>;
  play: (reaction: CompanionReaction) => Promise<boolean>;
  idle: () => void;
  reducedMotion: () => boolean;
  change: (state: CompanionState) => void;
};

/** Keep responses single-shot and cancel late work when the scene is suspended. */
export function createCompanionBehavior(driver: Driver) {
  let state: CompanionState = { phase: 'idle', reaction: null, text: '' };
  let generation = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: CompanionState) => {
    state = next;
    driver.change(next);
  };
  const recover = () => {
    if (disposed || state.phase === 'idle' || state.phase === 'recovering')
      return;
    generation++;
    clearTimeout(timer);
    driver.idle();
    publish({ ...state, phase: 'recovering', text: '' });
    timer = setTimeout(
      () => publish({ phase: 'idle', reaction: null, text: '' }),
      driver.reducedMotion() ? 0 : 450,
    );
  };
  return {
    get state() {
      return state;
    },
    request(reaction: CompanionReaction) {
      if (disposed || state.phase !== 'idle') return false;
      const token = ++generation;
      publish({ phase: 'noticing', reaction, text: '' });
      timer = setTimeout(recover, 8000);
      const quiet = driver.reducedMotion();
      const prepare = quiet
        ? Promise.resolve(true)
        : driver.prepare(reaction).catch(() => false);
      void prepare.then(async (ready) => {
        if (disposed || token !== generation) return;
        clearTimeout(timer);
        publish({
          phase: 'responding',
          reaction,
          text: companionMotions[reaction].text,
        });
        timer = setTimeout(
          recover,
          quiet || !ready ? 5000 : companionMotions[reaction].duration + 2000,
        );
        if (!quiet && ready) await driver.play(reaction).catch(() => false);
      });
      return true;
    },
    finish() {
      if (state.phase === 'responding') recover();
    },
    reset() {
      if (disposed) return;
      generation++;
      clearTimeout(timer);
      driver.idle();
      publish({ phase: 'idle', reaction: null, text: '' });
    },
    destroy() {
      disposed = true;
      generation++;
      clearTimeout(timer);
    },
  };
}
