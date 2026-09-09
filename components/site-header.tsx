'use client';

import { useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Compass, Moon, Search, Sun } from 'lucide-react';
import { useReading } from './reading-provider';

const sections = [
  { path: '/', label: '每日简报' },
  { path: '/archive', label: '往期简报' },
  { path: '/search', label: '探索主题' },
  { path: '/bookmarks', label: '我的收藏' },
] as const;

function focusHeaderSearch(smooth = true) {
  const input = document.getElementById(
    'atlas-search-input',
  ) as HTMLInputElement | null;
  if (!input) return false;
  input.focus({ preventScroll: true });
  input.select();
  input.scrollIntoView({
    block: 'center',
    behavior:
      smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'auto',
  });
  return true;
}

export function SiteHeader() {
  const pathname = (usePathname() || '/').replace(/\/$/, '') || '/';
  const router = useRouter();
  const { resolvedTheme, update } = useReading();
  const isIssue = /^\/briefings\/\d{4}-\d{2}-\d{2}$/.test(pathname);
  const activeIndex = isIssue
    ? 0
    : sections.findIndex((section) => section.path === pathname);
  const hasSearch = pathname === '/search' || pathname === '/bookmarks';
  const searchLabel = hasSearch
    ? pathname === '/bookmarks'
      ? '搜索收藏'
      : '定位搜索框'
    : '打开搜索页';
  const searchTarget = hasSearch
    ? '#atlas-search-input'
    : '/search/#atlas-search-input';

  useEffect(() => {
    if (activeIndex < 0) return;
    if (location.hash === '#atlas-search-input') focusHeaderSearch(false);
    const key = (event: KeyboardEvent) => {
      if (
        !event.isComposing &&
        !event.repeat &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        if (!focusHeaderSearch()) router.push('/search/#atlas-search-input');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [router, pathname, activeIndex]);

  if (activeIndex < 0) return null;

  return (
    <header className="site-header">
      <Link prefetch={false} className="brand" href="/">
        <span className="brand-icon">
          <Compass size={25} />
        </span>
        <span>
          Briefing Atlas<small>科技简报图志</small>
        </span>
      </Link>
      <nav
        aria-label="主导航"
        style={{ '--nav-index': activeIndex } as CSSProperties}
      >
        <span className="nav-indicator" aria-hidden="true" />
        {sections.map(({ path, label }, index) => (
          <Link
            prefetch={false}
            key={path}
            className={activeIndex === index ? 'active' : ''}
            aria-current={
              activeIndex === index
                ? isIssue
                  ? 'location'
                  : 'page'
                : undefined
            }
            href={path === '/' ? path : `${path}/`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <Link
          prefetch={false}
          className="header-search"
          href={searchTarget}
          aria-label={searchLabel}
          aria-keyshortcuts="Control+k Meta+k"
          title={`${searchLabel}（Ctrl+K / ⌘K）`}
          onClick={(event) => {
            if (
              !hasSearch ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.altKey ||
              event.button !== 0
            )
              return;
            event.preventDefault();
            focusHeaderSearch();
          }}
        >
          <Search size={17} aria-hidden="true" />
          <span>{searchLabel}</span>
          <kbd aria-hidden="true">Ctrl K</kbd>
          <ArrowRight
            className="header-search-arrow"
            size={14}
            aria-hidden="true"
          />
        </Link>
        <button
          className="icon-button theme-button"
          aria-label={
            resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式'
          }
          onClick={() =>
            update((s) => ({
              ...s,
              theme: document.documentElement.classList.contains('dark')
                ? 'light'
                : 'dark',
            }))
          }
        >
          {resolvedTheme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </div>
    </header>
  );
}
