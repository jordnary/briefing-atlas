'use client';

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ChevronRight, MessageCircle } from 'lucide-react';
import type { Live2DScene } from '@/lib/live2d';
import type { CompanionHit } from '@/lib/live2d-hit';
import type {
  CompanionReaction,
  CompanionState,
} from '@/lib/companion-behavior';
import { subscribeCompanionReactions } from '@/lib/companion-events';
import {
  CompanionLoadError,
  createCompanionLoader,
  type LoadState,
} from '@/lib/companion-loading';
import { CompanionTools, type CompanionAction } from './companion-tools';
import './live2d-companion.css';

const compactQuery = '(max-width: 767px), (pointer: coarse), (hover: none)';
const preferenceKey = (compact: boolean) =>
  `briefing-atlas:companion:${compact ? 'mobile' : 'desktop'}`;
const interactiveSelector =
  'a, button, input, textarea, select, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="slider"], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
const overlaySelector =
  '.image-viewer[open], .reader-settings-panel, [aria-modal="true"]';
const noActions: readonly CompanionAction[] = [];
const idleState: CompanionState = { phase: 'idle', reaction: null, text: '' };

function subscribeCompact(callback: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function readCollapsed(compact: boolean) {
  try {
    const stored = sessionStorage.getItem(preferenceKey(compact));
    return stored === null ? compact : stored === 'true';
  } catch {
    return compact;
  }
}

/** Pass additional toolbar actions here without changing the model or its lifecycle. */
export function Live2DCompanion({
  actions = noActions,
}: {
  actions?: readonly CompanionAction[];
}) {
  const compact = useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(compactQuery).matches,
    () => true,
  );
  const [preferences, setPreferences] = useState<{
    desktop: boolean;
    mobile: boolean;
  } | null>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(
    () =>
      setPreferences({
        desktop: readCollapsed(false),
        mobile: readCollapsed(true),
      }),
    [],
  );
  const collapsed = preferences
    ? compact
      ? preferences.mobile
      : preferences.desktop
    : true;
  useEffect(() => {
    if (collapsed && restoreFocus)
      launcher.current?.focus({ preventScroll: true });
  }, [collapsed, restoreFocus]);
  const toggle = (event: { detail: number }) => {
    setRestoreFocus(event.detail === 0);
    setPreferences((value) => ({
      ...(value ?? { desktop: false, mobile: true }),
      [compact ? 'mobile' : 'desktop']: !collapsed,
    }));
    try {
      sessionStorage.setItem(preferenceKey(compact), String(!collapsed));
    } catch {
      /* Storage is optional. */
    }
  };
  if (!preferences) return null;
  return (
    <aside
      aria-label="网站看板娘"
      className={`live2d-companion${collapsed ? ' is-collapsed' : ''}`}
    >
      {collapsed ? (
        <button
          type="button"
          className="live2d-launcher"
          aria-label="展开看板娘"
          aria-expanded="false"
          title="展开看板娘"
          onClick={toggle}
          ref={launcher}
        >
          <MessageCircle size={20} aria-hidden="true" />
        </button>
      ) : (
        <CompanionStage
          actions={actions}
          onCollapse={toggle}
          focusOnReady={restoreFocus}
        />
      )}
    </aside>
  );
}

function CompanionStage({
  actions,
  onCollapse,
  focusOnReady,
}: {
  actions: readonly CompanionAction[];
  onCollapse: (event: { detail: number }) => void;
  focusOnReady: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Live2DScene | null>(null);
  const loaderRef = useRef<ReturnType<
    typeof createCompanionLoader<Live2DScene>
  > | null>(null);
  const focusPending = useRef(focusOnReady);
  const [loadState, setLoadState] = useState<LoadState>({
    status: 'waiting',
    stage: 'runtime',
    slow: false,
  });
  const [interaction, setInteraction] = useState(idleState);
  const [suspended, setSuspended] = useState(false);
  const pendingReactions = useRef<CompanionReaction[]>([]);
  const status = loadState.status;
  const talk = (hit: CompanionHit = 'body') => {
    if (status === 'ready' && !suspended && !document.hidden)
      sceneRef.current?.react(
        hit === 'head'
          ? 'touch_head'
          : hit === 'special'
            ? 'touch_special'
            : 'touch_body',
      );
  };
  const pointerTalk = useEffectEvent(talk);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let canvas = document.createElement('canvas');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const available = () =>
      !document.hidden && !document.querySelector(overlaySelector);
    const flushReactions = () => {
      if (!available()) return;
      const scene = sceneRef.current;
      while (scene && pendingReactions.current.length) {
        if (!scene.react(pendingReactions.current[0])) return;
        pendingReactions.current.shift();
      }
    };
    const dispatchReaction = (reaction: CompanionReaction) => {
      pendingReactions.current.push(reaction);
      flushReactions();
    };
    const unsubscribeReactions = subscribeCompanionReactions(dispatchReaction);
    let press: {
      x: number;
      y: number;
      pointerId: number;
      hit: CompanionHit;
    } | null = null;
    const hitModel = (event: MouseEvent) => {
      if (
        !available() ||
        !(event.target instanceof Element) ||
        event.target.closest(interactiveSelector) ||
        window.getSelection()?.toString()
      )
        return null;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
      return (
        sceneRef.current?.hitTest(
          (x / rect.width) * Number.parseFloat(canvas.style.width),
          (y / rect.height) * Number.parseFloat(canvas.style.height),
        ) ?? null
      );
    };
    const resetFocus = () => {
      sceneRef.current?.focus(0, 0);
      press = null;
    };
    const syncVisibility = () => {
      const paused = !available();
      setSuspended(paused);
      sceneRef.current?.pause(paused);
      loaderRef.current?.sync();
      if (paused) resetFocus();
      else flushReactions();
    };
    const move = (event: PointerEvent) => {
      if (
        press?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6
      )
        press = null;
      if (event.pointerType !== 'mouse' || !available()) return;
      sceneRef.current?.focus(
        (event.clientX / window.innerWidth) * 2 - 1,
        1 - (event.clientY / window.innerHeight) * 2,
      );
    };
    const startPress = (event: PointerEvent) => {
      const eligible =
        event.isPrimary &&
        event.button === 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.defaultPrevented;
      const hit = eligible ? hitModel(event) : null;
      press = hit
        ? {
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
            hit,
          }
        : null;
    };
    const click = (event: MouseEvent) => {
      const started = press;
      press = null;
      if (
        !started ||
        event.button !== 0 ||
        event.detail !== 1 ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (
        event instanceof PointerEvent &&
        event.pointerId !== started.pointerId
      )
        return;
      if (
        Math.hypot(event.clientX - started.x, event.clientY - started.y) <= 6 &&
        hitModel(event) === started.hit
      )
        pointerTalk(started.hit);
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') resetFocus();
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      loader.contextLost();
    };
    const contextRestored = () => loader.contextRestored();
    const disconnectCanvas = () => {
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      canvas.remove();
    };
    const loader = createCompanionLoader<Live2DScene>({
      available,
      online: () => navigator.onLine,
      async load(signal, stage) {
        disconnectCanvas();
        canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.addEventListener('webglcontextlost', contextLost);
        canvas.addEventListener('webglcontextrestored', contextRestored);
        container.append(canvas);
        const { createLive2DScene } = await import('@/lib/live2d').catch(() => {
          throw new CompanionLoadError(navigator.onLine ? 'module' : 'network');
        });
        signal.throwIfAborted();
        return createLive2DScene(
          canvas,
          container,
          signal,
          (state) => {
            if (!signal.aborted) {
              setInteraction(state);
              if (state.phase === 'idle') flushReactions();
            }
          },
          () => !available(),
          stage,
        );
      },
      change(state) {
        if (state.status !== 'ready') {
          sceneRef.current = null;
          canvas.classList.remove('is-ready');
          setInteraction(idleState);
        }
        setLoadState(state);
      },
      ready(scene) {
        sceneRef.current = scene;
        canvas.classList.add('is-ready');
        syncVisibility();
        if (focusPending.current && available()) {
          focusPending.current = false;
          requestAnimationFrame(() => {
            if (canvas.isConnected) container.focus({ preventScroll: true });
          });
        }
      },
    });
    loaderRef.current = loader;
    const startup = window.setTimeout(() => loader.start(), 300);
    const connected = () => loader.connected();
    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'aria-modal'],
    });
    document.addEventListener('visibilitychange', syncVisibility);
    reducedMotion.addEventListener('change', syncVisibility);
    window.addEventListener('online', connected);
    window.addEventListener('offline', loader.sync);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', startPress, { passive: true });
    window.addEventListener('click', click);
    window.addEventListener('pointercancel', resetFocus);
    window.addEventListener('scroll', resetFocus, { passive: true });
    window.addEventListener('blur', resetFocus);
    document.documentElement.addEventListener('pointerleave', leave);
    syncVisibility();
    return () => {
      window.clearTimeout(startup);
      observer.disconnect();
      loader.destroy();
      loaderRef.current = null;
      sceneRef.current = null;
      unsubscribeReactions();
      disconnectCanvas();
      document.removeEventListener('visibilitychange', syncVisibility);
      reducedMotion.removeEventListener('change', syncVisibility);
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', loader.sync);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', startPress);
      window.removeEventListener('click', click);
      window.removeEventListener('pointercancel', resetFocus);
      window.removeEventListener('scroll', resetFocus);
      window.removeEventListener('blur', resetFocus);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div
      className="live2d-stage"
      hidden={suspended}
      data-load-status={status}
      data-load-stage={loadState.stage}
      data-phase={interaction.phase}
      data-reaction={interaction.reaction ?? undefined}
    >
      <div
        className="live2d-dialogue"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {interaction.text && <p>{interaction.text}</p>}
      </div>
      <div
        ref={containerRef}
        className="live2d-canvas-wrap"
        role="button"
        aria-disabled={status !== 'ready'}
        tabIndex={status === 'ready' ? 0 : undefined}
        aria-label="看板娘，点击人物或按 Enter、空格与她打招呼"
        aria-busy={['waiting', 'loading', 'recovering'].includes(status)}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !['Enter', ' '].includes(event.key)
          )
            return;
          event.preventDefault();
          if (!event.repeat) talk();
        }}
      />
      {status !== 'ready' && (
        <div className="live2d-placeholder">
          <p role="status">
            {status === 'error'
              ? '暂时没能赶到，请稍后再试。'
              : status === 'offline'
                ? '连接恢复后，我会再试一次。'
                : loadState.slow
                  ? '还在准备中，请稍等…'
                  : '正在赶来…'}
          </p>
          {status === 'error' && (
            <button type="button" onClick={() => loaderRef.current?.retry()}>
              再试一次
            </button>
          )}
        </div>
      )}
      <CompanionTools actions={actions} />
      <button
        type="button"
        className="live2d-collapse"
        aria-label="收起看板娘"
        aria-expanded="true"
        title="收起看板娘"
        onClick={onCollapse}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
