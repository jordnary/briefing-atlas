'use client';

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ChevronRight,
  Mail,
  MessageCircle,
  MessageCircleOff,
} from 'lucide-react';
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

function readChatEnabled() {
  try {
    return localStorage.getItem('briefing-atlas:companion:chat') !== 'false';
  } catch {
    return true;
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
  const [chatEnabled, setChatEnabled] = useState(true);
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(
    () =>
      setPreferences({
        desktop: readCollapsed(false),
        mobile: readCollapsed(true),
      }),
    [],
  );
  useEffect(() => setChatEnabled(readChatEnabled()), []);
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
  const toggleChat = () => {
    setChatEnabled(!chatEnabled);
    try {
      localStorage.setItem(
        'briefing-atlas:companion:chat',
        String(!chatEnabled),
      );
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
          chatEnabled={chatEnabled}
          onToggleChat={toggleChat}
          onCollapse={toggle}
          focusOnReady={restoreFocus}
        />
      )}
    </aside>
  );
}

function CompanionStage({
  actions,
  chatEnabled,
  onToggleChat,
  onCollapse,
  focusOnReady,
}: {
  actions: readonly CompanionAction[];
  chatEnabled: boolean;
  onToggleChat: () => void;
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
  const [hovered, setHovered] = useState(false);
  const chatEnabledRef = useRef(chatEnabled);
  const pendingReactions = useRef<CompanionReaction[]>([]);
  const status = loadState.status;
  const react = (reaction: CompanionReaction) => {
    if (
      status === 'ready' &&
      !suspended &&
      !document.hidden &&
      !document.querySelector(overlaySelector) &&
      (chatEnabled || reaction === 'mail')
    )
      sceneRef.current?.react(reaction);
  };
  const talk = (hit: CompanionHit = 'body') => {
    react(
      hit === 'head'
        ? 'touch_head'
        : hit === 'special'
          ? 'touch_special'
          : 'touch_body',
    );
  };
  const pointerTalk = useEffectEvent(talk);

  useEffect(() => {
    chatEnabledRef.current = chatEnabled;
    if (status === 'ready') sceneRef.current?.setChatEnabled(chatEnabled);
    if (!chatEnabled) pendingReactions.current.splice(0);
  }, [status, chatEnabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let canvas = document.createElement('canvas');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const compactMedia = window.matchMedia(compactQuery);
    let hideTimer = 0;
    let touchTimer = 0;
    const clearHover = () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(touchTimer);
      hideTimer = touchTimer = 0;
      setHovered(false);
    };
    const hover = (active: boolean, timed = false) => {
      window.clearTimeout(touchTimer);
      if (active) {
        window.clearTimeout(hideTimer);
        hideTimer = 0;
        setHovered(true);
        if (timed) touchTimer = window.setTimeout(clearHover, 3000);
      } else if (!hideTimer) {
        // Bridge brief exits between the character and the toolbar.
        hideTimer = window.setTimeout(clearHover, 240);
      }
    };
    const available = () =>
      !document.hidden && !document.querySelector(overlaySelector);
    const flushReactions = () => {
      if (!available() || !chatEnabledRef.current) return;
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
    const inHoverArea = (event: PointerEvent) => {
      if (!sceneRef.current) return false;
      const contains = (rect: DOMRect) =>
        event.clientX >= rect.left &&
        event.clientX < rect.right &&
        event.clientY >= rect.top &&
        event.clientY < rect.bottom;
      const stage = container.parentElement;
      const dialogue = stage?.querySelector('.live2d-dialogue');
      if (dialogue && contains(dialogue.getBoundingClientRect())) return false;
      const tools = stage?.querySelector('.live2d-tools');
      if (tools && contains(tools.getBoundingClientRect())) return true;
      // Include the shared character area and gaps, but exclude empty space
      // above the artwork. Actual clicks still use the rendered hit test.
      const rect = canvas.getBoundingClientRect();
      const artworkTop =
        Number.parseFloat(
          stage?.style.getPropertyValue('--companion-artwork-top') ?? '',
        ) || 0;
      return (
        contains(rect) &&
        event.clientY >= rect.top + Math.max(0, artworkTop - 8)
      );
    };
    const resetFocus = () => {
      sceneRef.current?.focus(0, 0);
      press = null;
      clearHover();
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
      hover(inHoverArea(event));
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
    const touchTools = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary || !available())
        return;
      const target = event.target;
      const inTools =
        target instanceof Element && !!target.closest('.live2d-tools');
      const pageControl =
        target instanceof Element && !!target.closest(interactiveSelector);
      hover(inTools || (!pageControl && inHoverArea(event)), true);
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
          clearHover();
        }
        setLoadState(state);
      },
      ready(scene) {
        sceneRef.current = scene;
        canvas.classList.add('is-ready');
        syncVisibility();
        if (compactMedia.matches && available()) hover(true, true);
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
    window.addEventListener('pointerup', touchTools, { passive: true });
    window.addEventListener('click', click);
    window.addEventListener('pointercancel', resetFocus);
    window.addEventListener('scroll', resetFocus, { passive: true });
    window.addEventListener('blur', resetFocus);
    document.documentElement.addEventListener('pointerleave', leave);
    syncVisibility();
    return () => {
      window.clearTimeout(startup);
      window.clearTimeout(hideTimer);
      window.clearTimeout(touchTimer);
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
      window.removeEventListener('pointerup', touchTools);
      window.removeEventListener('click', click);
      window.removeEventListener('pointercancel', resetFocus);
      window.removeEventListener('scroll', resetFocus);
      window.removeEventListener('blur', resetFocus);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div
      className={`live2d-stage${hovered ? ' is-hovered' : ''}`}
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
        {interaction.text &&
          (chatEnabled || interaction.reaction === 'mail') && (
            <p>{interaction.text}</p>
          )}
      </div>
      <div
        ref={containerRef}
        className="live2d-canvas-wrap"
        role="button"
        aria-disabled={status !== 'ready' || !chatEnabled}
        tabIndex={status === 'ready' ? 0 : undefined}
        aria-label={
          chatEnabled
            ? '看板娘，点击人物或按 Enter、空格与她打招呼'
            : '看板娘，对话已关闭，可在工具栏中开启'
        }
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
      {status === 'ready' ? (
        <CompanionTools
          actions={[
            {
              id: 'github',
              label: '访问 GitHub 主页',
              icon: <GithubIcon />,
              href: 'https://github.com/jordnary',
              external: true,
            },
            {
              id: 'email',
              label: '通过 Gmail 联系我',
              icon: <Mail />,
              href: 'mailto:jordnary@gmail.com',
              onSelect: () => react('mail'),
            },
            {
              id: 'chat-toggle',
              label: chatEnabled ? '关闭人物点击对话' : '开启人物点击对话',
              icon: chatEnabled ? <MessageCircle /> : <MessageCircleOff />,
              pressed: chatEnabled,
              onSelect: onToggleChat,
            },
            ...actions,
            {
              id: 'collapse',
              label: '收起看板娘',
              icon: <ChevronRight />,
              onSelect: onCollapse,
            },
          ]}
        />
      ) : (
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
      )}
    </div>
  );
}

function GithubIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.48.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.62-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
