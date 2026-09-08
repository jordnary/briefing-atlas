'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { defaultState, validateReadingState } from '@/lib/domain.mjs';
export type ReadingState = {
  version: number;
  bookmarks: string[];
  read: string[];
  theme: string;
  fontSize: number;
  view: string;
  lastRead: { date: string; storyId: string } | null;
};
const STORAGE_KEY = 'briefing-atlas:reading:v1';
const initial = defaultState as ReadingState;
const ReadingContext = createContext<{
  state: ReadingState;
  ready: boolean;
  update: (fn: (state: ReadingState) => ReadingState) => void;
  notice: string;
  notify: (text: string) => void;
}>({
  state: initial,
  ready: false,
  update: () => {},
  notice: '',
  notify: () => {},
});
export function ReadingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initial),
    [ready, setReady] = useState(false),
    [notice, notify] = useState('');
  const current = useRef(state);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = validateReadingState(JSON.parse(raw)) as ReadingState;
        current.current = saved;
        setState(saved);
      }
    } catch {
      notify('浏览器未能读取已保存的记录；请检查存储权限或导入备份。');
    }
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const next = validateReadingState(
            JSON.parse(event.newValue),
          ) as ReadingState;
          current.current = next;
          setState(next);
        } catch {
          notify('其他页面的阅读记录格式无效。');
        }
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const update = useCallback((fn: (state: ReadingState) => ReadingState) => {
    const next = fn(current.current);
    current.current = next;
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      notify('此浏览器无法保存记录。当前操作仅在本页有效，请及时导出备份。');
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.classList.toggle(
        'dark',
        state.theme === 'dark' || (state.theme === 'system' && media.matches),
      );
      document.documentElement.style.setProperty(
        '--reading-size',
        `${state.fontSize}px`,
      );
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [ready, state.theme, state.fontSize]);
  return (
    <ReadingContext.Provider value={{ state, ready, update, notice, notify }}>
      {children}
      {notice && (
        <div className="notice-bar" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => notify('')}>
            ×
          </button>
        </div>
      )}
    </ReadingContext.Provider>
  );
}
export const useReading = () => useContext(ReadingContext);
