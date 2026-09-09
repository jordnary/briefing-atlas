export const companionMotions = {
  touch_head: {
    duration: 4300,
    text: '嗯？我在呢。读累了的话，就休息一下吧。',
  },
  touch_body: { duration: 5950, text: '今天又有什么新发现？我陪你慢慢看。' },
  touch_special: { duration: 3950, text: '收到你的招呼啦，一起继续探索吧。' },
  mail: {
    duration: 6550,
    text: '有话想对人家说？那就写封信吧，人家会期待的哦。',
  },
  main_1: { duration: 10167, text: '' },
  main_2: { duration: 15683, text: '' },
  main_3: { duration: 11083, text: '' },
  mission: { duration: 7817, text: '' },
  mission_complete: { duration: 6833, text: '' },
  complete: { duration: 8350, text: '' },
} as const;

export type CompanionReaction = keyof typeof companionMotions;
const idleMotions = ['main_1', 'main_2', 'main_3'] as const;
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
  active?: () => boolean;
  change: (state: CompanionState) => void;
};

/** Keep responses single-shot and cancel late work when the scene is suspended. */
export function createCompanionBehavior(driver: Driver) {
  let state: CompanionState = { phase: 'idle', reaction: null, text: '' };
  let generation = 0;
  let disposed = false;
  let chatEnabled = true;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearRecoveryTimer = () => {
    clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  };
  const clearIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const publish = (next: CompanionState) => {
    state = next;
    driver.change(next);
  };
  const scheduleIdleMotion = () => {
    clearIdleTimer();
    if (
      disposed ||
      state.phase !== 'idle' ||
      !chatEnabled ||
      driver.reducedMotion() ||
      driver.active?.() === false
    )
      return;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (
        disposed ||
        state.phase !== 'idle' ||
        !chatEnabled ||
        driver.reducedMotion() ||
        driver.active?.() === false
      )
        return;
      const reaction =
        idleMotions[Math.floor(Math.random() * idleMotions.length)];
      request(reaction);
    }, 60000);
  };
  const recover = () => {
    if (disposed || state.phase === 'idle' || state.phase === 'recovering')
      return;
    generation++;
    clearRecoveryTimer();
    clearIdleTimer();
    driver.idle();
    publish({ ...state, phase: 'recovering', text: '' });
    recoveryTimer = setTimeout(
      () => {
        publish({ phase: 'idle', reaction: null, text: '' });
        scheduleIdleMotion();
      },
      driver.reducedMotion() ? 0 : 450,
    );
  };
  function request(reaction: CompanionReaction) {
    if (disposed || (!chatEnabled && reaction !== 'mail')) return false;
    if (state.phase !== 'idle') {
      if (reaction !== 'mail') return false;
      // Explicit email activation wins over a busy response. Do not publish
      // an intermediate idle state that could release queued page reactions.
      clearRecoveryTimer();
      driver.idle();
    }
    clearIdleTimer();
    const token = ++generation;
    publish({ phase: 'noticing', reaction, text: '' });
    recoveryTimer = setTimeout(recover, 8000);
    const quiet = driver.reducedMotion();
    const prepare = quiet
      ? Promise.resolve(true)
      : driver.prepare(reaction).catch(() => false);
    void prepare.then(async (ready) => {
      if (disposed || token !== generation) return;
      clearRecoveryTimer();
      publish({
        phase: 'responding',
        reaction,
        text: companionMotions[reaction].text,
      });
      recoveryTimer = setTimeout(
        recover,
        quiet || !ready ? 5000 : companionMotions[reaction].duration + 2000,
      );
      if (!quiet && ready) await driver.play(reaction).catch(() => false);
    });
    return true;
  }
  const reset = () => {
    if (disposed) return;
    generation++;
    clearRecoveryTimer();
    clearIdleTimer();
    driver.idle();
    publish({ phase: 'idle', reaction: null, text: '' });
    scheduleIdleMotion();
  };
  scheduleIdleMotion();
  return {
    get state() {
      return state;
    },
    request(reaction: CompanionReaction) {
      return request(reaction);
    },
    finish() {
      if (state.phase === 'responding') recover();
    },
    setChatEnabled(enabled: boolean) {
      if (disposed || enabled === chatEnabled) return;
      chatEnabled = enabled;
      if (!enabled) reset();
      else scheduleIdleMotion();
    },
    reset,
    destroy() {
      disposed = true;
      generation++;
      clearRecoveryTimer();
      clearIdleTimer();
    },
  };
}
