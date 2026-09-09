'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultSearchState,
  readSearchState,
  writeSearchState,
  type SearchState,
} from '@/lib/search-state.mjs';

export function useSearchState() {
  const [filters, setFilters] = useState(defaultSearchState);
  const [paramsReady, setReady] = useState(false);
  const current = useRef(filters);
  const committed = useRef('');
  const observed = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const relativeUrl = useCallback((value: SearchState) => {
    const query = writeSearchState(value);
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  }, []);
  const applyLocation = useCallback(() => {
    cancel();
    current.current = readSearchState(location.search);
    committed.current = `${location.pathname}${location.search}${location.hash}`;
    observed.current = committed.current;
    setFilters(current.current);
    setReady(true);
  }, [cancel]);
  const syncLocation = useCallback(() => {
    if (
      `${location.pathname}${location.search}${location.hash}` !==
      observed.current
    )
      applyLocation();
  }, [applyLocation]);
  useEffect(() => {
    syncLocation();
    window.addEventListener('popstate', applyLocation);
    return () => {
      cancel();
      window.removeEventListener('popstate', applyLocation);
    };
  }, [applyLocation, cancel, syncLocation]);
  const change = useCallback(
    (patch: Partial<SearchState>) => {
      current.current = { ...current.current, ...patch };
      setFilters(current.current);
      cancel();
      // Debounce URL writes so rapid typing does not hit the History API rate limit.
      timer.current = setTimeout(() => {
        // Our own URL writes must not reset the submitted-search history.
        observed.current = relativeUrl(current.current);
        history.replaceState(history.state, '', observed.current);
      }, 200);
    },
    [cancel, relativeUrl],
  );
  const submit = useCallback(() => {
    cancel();
    const url = relativeUrl(current.current);
    observed.current = url;
    // Preserve the previous submitted search before creating a new history entry.
    if (url !== committed.current) {
      history.replaceState(history.state, '', committed.current);
      history.pushState(history.state, '', url);
      committed.current = url;
    } else history.replaceState(history.state, '', url);
  }, [cancel, relativeUrl]);
  const shareUrl = useCallback(
    () => new URL(relativeUrl(current.current), location.origin).href,
    [relativeUrl],
  );
  return { filters, paramsReady, change, submit, shareUrl, syncLocation };
}
