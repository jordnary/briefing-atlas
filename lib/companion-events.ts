import type { CompanionReaction } from './companion-behavior';

type Listener = (reaction: CompanionReaction) => void;

const listeners = new Set<Listener>();
const pending: CompanionReaction[] = [];

/** Deliver page-level milestones to the persistent companion scene. */
export function requestCompanionReaction(reaction: CompanionReaction) {
  if (!listeners.size) {
    pending.push(reaction);
    return;
  }
  listeners.forEach((listener) => listener(reaction));
}

export function subscribeCompanionReactions(listener: Listener) {
  listeners.add(listener);
  if (pending.length) {
    const queued = pending.splice(0);
    queued.forEach(listener);
  }
  return () => listeners.delete(listener);
}
