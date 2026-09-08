'use client';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownContent } from './markdown-content';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Link as LinkIcon,
  Moon,
  Search,
  Settings2,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import type { Briefing, BriefingMeta, IndexStory, Story } from '@/lib/content';
import { href, storyHref, topics } from '@/lib/paths';
import {
  isDate,
  monthDays,
  readingText,
  shanghaiDate,
  shiftMonth,
  validateReadingState,
} from '@/lib/domain.mjs';
import {
  createSearchIndex,
  isSearchIndexPayload,
  searchStoriesDetailed,
  searchPresentation,
  SEARCH_FIELD_LABELS,
  type SearchResult,
  type HighlightRange,
} from '@/lib/search.mjs';
import {
  defaultSearchState,
  writeSearchState,
  type SearchState,
} from '@/lib/search-state.mjs';
import { executeSearchTool, searchToolSchema } from '@/lib/search-tool.mjs';
import { SearchControls } from './search-controls';
import { useSearchState } from './use-search-state';
import { useReading, type ReadingState } from './reading-provider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
type View = 'latest' | 'issue' | 'archive' | 'search' | 'bookmarks';
type Props = {
  view: View;
  meta: BriefingMeta[];
  briefing?: Briefing;
  entities?: string[];
};
function Choice({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v || '')}>
      <SelectTrigger aria-label={label} className="filter-select">
        <SelectValue>
          {items.find((item) => item.value === value)?.label || label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem value={item.value} key={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function NoResults({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Empty className="empty-state">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle className="empty-title">{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
function Header({ view }: { view: View }) {
  const { resolvedTheme, update } = useReading();
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const input = document.getElementById(
          'atlas-search-input',
        ) as HTMLInputElement | null;
        if (input) {
          input.focus();
          input.select();
        } else location.assign(href('/search/'));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <header className="site-header">
      <a className="brand" href={href('/')}>
        <span className="brand-icon">
          <Compass size={25} />
        </span>
        <span>
          Briefing Atlas<small>科技简报图志</small>
        </span>
      </a>
      <nav aria-label="主导航">
        {[
          ['latest', '/', '每日简报'],
          ['archive', '/archive/', '往期简报'],
          ['search', '/search/', '探索主题'],
          ['bookmarks', '/bookmarks/', '我的收藏'],
        ].map(([key, path, label]) => (
          <a
            key={key}
            className={
              view === key || (view === 'issue' && key === 'latest')
                ? 'active'
                : ''
            }
            aria-current={view === key ? 'page' : undefined}
            href={href(path)}
          >
            {label}
          </a>
        ))}
      </nav>
      <a className="header-search" href={href('/search/')}>
        <Search size={17} />
        <span>搜索简报</span>
        <kbd>Ctrl K</kbd>
      </a>
      <button
        className="icon-button theme-button"
        aria-label={resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式'}
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
    </header>
  );
}
function Calendar({
  meta,
  month,
  setMonth,
  selected,
  onDate,
}: {
  meta: BriefingMeta[];
  month: string;
  setMonth: (m: string) => void;
  selected: string;
  onDate: (date: string) => void;
}) {
  const [today, setToday] = useState('');
  useEffect(() => setToday(shanghaiDate()), []);
  const available = new Map(
    meta.map((item) => [item.briefingDate, item.count]),
  );
  const go = (e: React.KeyboardEvent<HTMLButtonElement>, date: string) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (!(e.key in offsets)) return;
    e.preventDefault();
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + offsets[e.key]);
    const target = next.toISOString().slice(0, 10);
    if (Number(target.slice(0, 4)) < 1900 || Number(target.slice(0, 4)) > 2100)
      return;
    setMonth(target.slice(0, 7));
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(`[data-date="${target}"]`)
        ?.focus(),
    );
  };
  return (
    <div className="calendar">
      <div className="calendar-title">
        <label className="month-input-label">
          <span className="sr-only">简报年月</span>
          <input
            aria-label="简报年月"
            type="month"
            min="1900-01"
            max="2100-12"
            value={month}
            onChange={(e) => {
              if (
                /^\d{4}-\d{2}$/.test(e.target.value) &&
                isDate(`${e.target.value}-01`)
              )
                setMonth(e.target.value);
            }}
          />
        </label>
        <button
          className="icon-button small"
          aria-label="上个月"
          disabled={month <= '1900-01'}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button small"
          aria-label="下个月"
          disabled={month >= '2100-12'}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="calendar-grid" role="group" aria-label={`${month} 日历`}>
        {'一二三四五六日'.split('').map((day) => (
          <span className="weekday" key={day}>
            {day}
          </span>
        ))}
        {monthDays(month).map((date: string | null, index: number) =>
          date ? (
            <button
              key={date}
              data-date={date}
              onKeyDown={(event) => go(event, date)}
              onClick={() => onDate(date)}
              aria-label={`${date}，${available.has(date) ? `${available.get(date)} 条简报内容` : '暂无简报'}${date === today ? '，今天' : ''}`}
              aria-pressed={selected === date}
              aria-current={date === today ? 'date' : undefined}
              className={`${selected === date ? 'selected ' : ''}${available.has(date) ? 'has-issue ' : ''}${date === today ? 'today' : ''}`}
            >
              {Number(date.slice(-2))}
              {available.has(date) && <i />}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
      <p className="calendar-note">
        <i /> 有简报 <span>◎ 今天</span>
      </p>
      <label className="date-jump">
        日期直达
        <input
          aria-label="日期直达"
          type="date"
          min="1900-01-01"
          max="2100-12-31"
          value={selected}
          onChange={(e) => {
            if (isDate(e.target.value)) {
              setMonth(e.target.value.slice(0, 7));
              onDate(e.target.value);
            }
          }}
        />
      </label>
      <button
        className="text-button calendar-latest"
        onClick={() => {
          if (!meta[0]) return;
          setMonth(meta[0].briefingDate.slice(0, 7));
          onDate(meta[0].briefingDate);
        }}
      >
        回到最新一期 <ArrowRight size={14} />
      </button>
    </div>
  );
}
function ReadingSettings() {
  const { state, update } = useReading();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="icon-button" aria-label="阅读设置">
        <Settings2 size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="settings-menu">
        {[16, 18, 20].map((size) => (
          <DropdownMenuItem
            key={size}
            onClick={() => update((s) => ({ ...s, fontSize: size }))}
          >
            {state.fontSize === size ? (
              <Check size={15} />
            ) : (
              <span className="menu-spacer" />
            )}
            {size === 16 ? '标准字号' : size === 18 ? '舒适字号' : '大号字体'}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onClick={() => update((s) => ({ ...s, theme: 'system' }))}
        >
          跟随系统主题
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function StoryCard({
  story,
  date,
  index,
  full = false,
  searchResult,
}: {
  story: Story;
  date: string;
  index: number;
  full?: boolean;
  searchResult?: SearchResult<IndexStory>;
}) {
  const { state, ready, update, notify } = useReading();
  const presentation = useMemo(
    () => (searchResult ? searchPresentation(searchResult) : null),
    [searchResult],
  );
  const [expanded, setExpanded] = useState(full),
    [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setExpanded(full);
  }, [full]);
  useEffect(() => {
    const expand = () => {
      if (decodeURIComponent(location.hash.slice(1)) === story.id)
        setExpanded(true);
    };
    expand();
    window.addEventListener('hashchange', expand);
    return () => window.removeEventListener('hashchange', expand);
  }, [story.id]);
  const marked = state.bookmarks.includes(story.id),
    read = state.read.includes(story.id);
  const setPosition = () =>
    update((s) =>
      s.lastRead?.storyId === story.id
        ? s
        : { ...s, lastRead: { date, storyId: story.id } },
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(storyHref(date, story.id), location.origin).href,
      );
      notify('已复制这条新闻的直达链接。');
    } catch {
      notify('未能复制链接。可右键标题链接，选择复制链接地址。');
    }
  };
  return (
    <article
      className={`story-card ${read ? 'is-read' : ''}`}
      id={story.id}
      data-story-date={date}
    >
      <div className="story-number">{String(index + 1).padStart(2, '0')}</div>
      <div className="story-content">
        <div className="story-meta">
          {story.tags[0] && (
            <a href={href(`/search/?tag=${encodeURIComponent(story.tags[0])}`)}>
              {story.tags[0]}
            </a>
          )}
          <span>· {date}</span>
          {read && (
            <span className="read-badge">
              <Check size={12} />
              已读
            </span>
          )}
          {Boolean(searchResult?.matchedFields.length) && (
            <span className="search-match-fields" title="命中字段">
              命中{' '}
              {searchResult?.matchedFields
                .map((field) => SEARCH_FIELD_LABELS[field])
                .join(' · ')}
            </span>
          )}
        </div>
        <h3>
          <a href={storyHref(date, story.id)}>
            <Highlight value={story.title} ranges={presentation?.title} />
          </a>
        </h3>
        {!expanded && (
          <p className="story-summary">
            {story.summaryKind === 'excerpt' && (
              <span className="excerpt-label">内容摘录</span>
            )}
            <Highlight value={story.summary} ranges={presentation?.summary} />
          </p>
        )}
        {presentation?.snippet && (
          <p className="search-excerpt">
            <span className="search-excerpt-label">
              {SEARCH_FIELD_LABELS[presentation.snippet.field]}
            </span>
            <Highlight
              value={presentation.snippet.text}
              ranges={presentation.snippet.ranges}
            />
          </p>
        )}
        {expanded && (
          <div className="expanded-story">
            <MarkdownContent html={story.html} />
            {story.image &&
              (story.image.available && !imageFailed ? (
                <figure>
                  <img
                    src={href(`/${story.image.path}`)}
                    alt={story.image.alt}
                    width={800}
                    height={450}
                    loading="lazy"
                    onError={() => setImageFailed(true)}
                  />
                  <figcaption>
                    {story.image.caption} · {story.image.source}
                  </figcaption>
                </figure>
              ) : (
                <div className="image-fallback">
                  配图暂不可用 · {story.image.alt}
                </div>
              ))}
            <div className="source-box">
              {story.eventDate && <p>事件日期：{story.eventDate}</p>}
              <ul>
                {story.sources.length ? (
                  story.sources.map((source) => (
                    <li key={source.url}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink size={13} />
                        {source.title}
                      </a>
                    </li>
                  ))
                ) : (
                  <li>来源尚未补全。</li>
                )}
              </ul>
            </div>
            <div className="tag-list">
              {story.tags.map((tag) => (
                <a
                  href={href(`/search/?tag=${encodeURIComponent(tag)}`)}
                  key={tag}
                >
                  # {tag}
                </a>
              ))}
              {story.entities.map((entity) => (
                <a
                  href={href(`/search/?entity=${encodeURIComponent(entity)}`)}
                  key={entity}
                >
                  {entity}
                </a>
              ))}
            </div>
            <a
              className="related-link"
              href={href(
                `/search/?q=${encodeURIComponent(story.entities.at(-1) || story.tags[0] || story.title)}`,
              )}
            >
              沿这个主题继续阅读 <ArrowUpRight size={14} />
            </a>
          </div>
        )}
        <div className="story-actions">
          <a className="text-button" href={storyHref(date, story.id)}>
            <BookOpen size={15} />
            阅读全文
            <ArrowRight size={14} />
          </a>
          <button
            className="text-button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(!expanded);
              setPosition();
            }}
          >
            {expanded ? '收起预览' : '展开预览'}
          </button>
          <div>
            <button
              className={`icon-button ${read ? 'is-active' : ''}`}
              disabled={!ready}
              aria-label={read ? '标记为未读' : '标记为已读'}
              title={read ? '标记为未读' : '标记为已读'}
              onClick={() =>
                update((s) => ({
                  ...s,
                  read: read
                    ? s.read.filter((id) => id !== story.id)
                    : [...s.read, story.id],
                }))
              }
            >
              <Check size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="复制新闻链接"
              title="复制新闻链接"
              onClick={copy}
            >
              <LinkIcon size={15} />
            </button>
          </div>
        </div>
      </div>
      <button
        className={`icon-button save-button ${marked ? 'is-active' : ''}`}
        aria-label={marked ? '取消收藏' : '收藏新闻'}
        title={marked ? '取消收藏' : '收藏新闻'}
        aria-pressed={marked}
        disabled={!ready}
        onClick={() => {
          update((s) => ({
            ...s,
            bookmarks: marked
              ? s.bookmarks.filter((id) => id !== story.id)
              : [...s.bookmarks, story.id],
          }));
          notify(marked ? '已取消收藏。' : '已加入我的收藏。');
        }}
      >
        <Bookmark size={18} fill={marked ? 'currentColor' : 'none'} />
      </button>
    </article>
  );
}
function Highlight({
  value,
  ranges = [],
}: {
  value: string;
  ranges?: HighlightRange[];
}) {
  if (!ranges.length) return <>{value}</>;
  let offset = 0;
  const parts: React.ReactNode[] = [];
  for (const [start, end] of ranges) {
    parts.push(
      value.slice(offset, start),
      <mark key={start}>{value.slice(start, end)}</mark>,
    );
    offset = end;
  }
  parts.push(value.slice(offset));
  return <>{parts}</>;
}

function Issue({
  briefing,
  meta,
  isLatest,
}: {
  briefing: Briefing;
  meta: BriefingMeta[];
  isLatest: boolean;
}) {
  const { state, ready, update } = useReading();
  const [today, setToday] = useState('');
  useEffect(() => setToday(shanghaiDate()), []);
  const position = meta.findIndex(
    (item) => item.briefingDate === briefing.briefingDate,
  );
  const previous = meta[position + 1],
    next = meta[position - 1];
  useEffect(() => {
    if (!ready || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            update((current) =>
              current.lastRead?.date === briefing.briefingDate &&
              current.lastRead.storyId === el.id
                ? current
                : {
                    ...current,
                    lastRead: {
                      date: briefing.briefingDate,
                      storyId: el.id,
                    },
                  },
            );
          }
      },
      { rootMargin: '-10% 0px -65% 0px', threshold: 0 },
    );
    document
      .querySelectorAll('article[data-story-date]')
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ready, briefing.briefingDate, update]);
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${briefing.briefingDate}T00:00:00Z`));
  return (
    <>
      <div className="edition-line">
        <span>
          <i />
          {isLatest ? '最新一期' : '历史简报'}
        </span>
        <span>
          AI & TECH BRIEFING <b>/</b> NO.{' '}
          {String(meta.length - position).padStart(3, '0')}
        </span>
      </div>
      <div className="issue-heading">
        <h1>
          {briefing.title.replace(/\s*·\s*20\d{2}.*$/, '')}
          <span>
            {briefing.briefingDate.replaceAll('-', '.')}{' '}
            <small>{weekday}</small>
          </span>
        </h1>
        <ReadingSettings />
      </div>
      <p className="issue-subtitle">每天几条值得关注的科技线索。</p>
      {isLatest && today && today !== briefing.briefingDate && (
        <p className="update-note">今天的简报尚未更新，先读最近一期。</p>
      )}
      <section className="daily-summary">
        <span className="eyebrow">本期导读</span>
        {briefing.introHtml ? (
          <MarkdownContent html={briefing.introHtml} className="issue-intro" />
        ) : (
          <p>{briefing.summary}</p>
        )}
        <div className="reading-estimate">
          <span>{briefing.stories.length} 条精选</span>
          <span>
            约{' '}
            {Math.max(
              1,
              Math.ceil(
                briefing.stories.reduce(
                  (n, s) => n + readingText(s.body).length,
                  0,
                ) / 350,
              ),
            )}{' '}
            分钟
          </span>
          <span>修订 {briefing.revision}</span>
        </div>
      </section>
      {briefing.stories[0] && (
        <a
          className="reader-entry"
          href={storyHref(
            briefing.briefingDate,
            briefing.stories.find(
              (story) => story.id === state.lastRead?.storyId,
            )?.id ||
              briefing.stories.find((story) => !state.read.includes(story.id))
                ?.id ||
              briefing.stories[0].id,
          )}
        >
          <span className="reader-entry-icon">
            <BookOpen size={24} strokeWidth={1.5} />
          </span>
          <span>
            <small>THE READING ROOM</small>
            <strong>留一点时间，读得更深入。</strong>
            <span>独立阅览 · 自在排版 · 记录进度</span>
          </span>
          <span className="reader-entry-cta">
            进入阅览室 <ArrowRight size={17} />
          </span>
        </a>
      )}
      <details className="mobile-toc">
        <summary>本期目录 · {briefing.stories.length} 条</summary>
        <nav aria-label="本期新闻目录">
          {briefing.stories.map((story, index) => (
            <a key={story.id} href={`#${story.id}`}>
              {String(index + 1).padStart(2, '0')} · {story.title}
            </a>
          ))}
          {briefing.outro && <a href="#issue-outro">结语</a>}
        </nav>
      </details>
      <div className="reading-completion" aria-live="polite">
        <span>
          已读{' '}
          {
            briefing.stories.filter((story) => state.read.includes(story.id))
              .length
          }{' '}
          / {briefing.stories.length}
        </span>
        <progress
          aria-label="本期已读进度"
          max={briefing.stories.length}
          value={
            briefing.stories.filter((story) => state.read.includes(story.id))
              .length
          }
        />
      </div>
      <div className="section-heading">
        <h2>
          本期精选{' '}
          <span>{String(briefing.stories.length).padStart(2, '0')}</span>
        </h2>
        <ToggleGroup
          aria-label="阅读视图"
          value={[state.view]}
          onValueChange={(values) => {
            if (values.length)
              update((s) => ({ ...s, view: String(values[0]) }));
          }}
          className="view-toggle"
        >
          <ToggleGroupItem value="summary">摘录</ToggleGroupItem>
          <ToggleGroupItem value="full">全文</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {briefing.stories.map((story, index) => (
        <StoryCard
          key={story.id}
          story={story}
          date={briefing.briefingDate}
          index={index}
          full={state.view === 'full'}
        />
      ))}
      {briefing.outroHtml && (
        <section id="issue-outro" className="issue-outro">
          <p className="eyebrow">结语</p>
          <MarkdownContent html={briefing.outroHtml} />
        </section>
      )}
      {briefing.corrections.some((entry) => entry.kind !== 'format') && (
        <section className="correction-history">
          <h2>修订与更正</h2>
          <ul>
            {briefing.corrections
              .filter((entry) => entry.kind !== 'format')
              .map((entry, index) => (
                <li key={index}>
                  <time>{entry.date}</time> · {entry.note}
                </li>
              ))}
          </ul>
        </section>
      )}
      <nav className="issue-pagination" aria-label="相邻简报">
        {previous ? (
          <a href={href(`/briefings/${previous.briefingDate}/`)}>
            <ArrowLeft size={16} />
            <span>
              上一期<small>{previous.briefingDate}</small>
            </span>
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={href(`/briefings/${next.briefingDate}/`)}>
            <span>
              下一期<small>{next.briefingDate}</small>
            </span>
            <ArrowRight size={16} />
          </a>
        ) : (
          <span className="muted">已经是最新一期</span>
        )}
      </nav>
    </>
  );
}
function Archive({
  meta,
  month,
  setMonth,
  selected,
  onDate,
}: {
  meta: BriefingMeta[];
  month: string;
  setMonth: (month: string) => void;
  selected: string;
  onDate: (date: string) => void;
}) {
  const [all, setAll] = useState(false);
  const list = all
    ? meta
    : meta.filter((item) => item.briefingDate.startsWith(month));
  const years = [...new Set(meta.map((item) => item.briefingDate.slice(0, 4)))];
  const year = month.slice(0, 4);
  return (
    <>
      <p className="eyebrow">PAST EDITIONS</p>
      <div className="page-heading">
        <h1>往期简报</h1>
        <CalendarDays size={25} />
      </div>
      <p className="page-description">
        每一期都是一个坐标，连接曾经关注的技术与想法。
      </p>
      <div className="archive-stats">
        <span>
          <b>{meta.length}</b> 期简报
        </span>
        <span>
          <b>{meta.reduce((n, item) => n + item.count, 0)}</b> 条内容
        </span>
        <span>
          <b>{years.length}</b> 个年份
        </span>
      </div>
      <details className="mobile-calendar">
        <summary>
          按日期查找 <CalendarDays size={16} />
        </summary>
        <Calendar
          meta={meta}
          month={month}
          setMonth={setMonth}
          selected={selected}
          onDate={onDate}
        />
      </details>
      <div className="archive-controls">
        <Choice
          label="选择年份"
          value={year}
          onChange={(y) => {
            setMonth(`${y}-${month.slice(5, 7)}`);
            setAll(false);
          }}
          items={[...new Set([...years, year])]
            .sort()
            .reverse()
            .map((y) => ({ value: y, label: `${y} 年` }))}
        />
        <button
          className={`pill ${all ? 'active' : ''}`}
          onClick={() => setAll(!all)}
        >
          {all ? '返回所选月份' : '全部简报'}
        </button>
      </div>
      <div className="month-overview">
        {Array.from({ length: 12 }, (_, i) => {
          const m = `${year}-${String(i + 1).padStart(2, '0')}`;
          const count = meta.filter((item) =>
            item.briefingDate.startsWith(m),
          ).length;
          return (
            <button
              key={m}
              className={!all && m === month ? 'active' : ''}
              onClick={() => {
                setMonth(m);
                setAll(false);
              }}
              aria-pressed={!all && m === month}
            >
              {i + 1} 月<small>{count} 期</small>
            </button>
          );
        })}
      </div>
      {selected && !meta.some((item) => item.briefingDate === selected) && (
        <div className="date-empty" role="status">
          {selected} 暂无简报。可以选择有圆点标记的日期，或浏览以下简报。
        </div>
      )}
      <div className="section-heading">
        <h2>
          {all
            ? '全部简报'
            : `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`}{' '}
          <span>{list.length} 期</span>
        </h2>
      </div>
      {list.length ? (
        Object.entries(
          Object.groupBy(list, (item) => item.briefingDate.slice(0, 7)),
        ).map(([group, items]) => (
          <section key={group}>
            {all && <h3 className="archive-group-title">{group}</h3>}
            {items?.map((item) => (
              <a
                className="archive-item"
                href={href(`/briefings/${item.briefingDate}/`)}
                key={item.id}
              >
                <time dateTime={item.briefingDate}>
                  <b>{item.briefingDate.slice(-2)}</b>
                  <small>{item.briefingDate.slice(0, 7)}</small>
                </time>
                <div>
                  <p className="story-meta">{item.count} 条精选</p>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                </div>
                <ArrowUpRight size={18} />
              </a>
            ))}
          </section>
        ))
      ) : (
        <NoResults title="这个月还没有简报">
          试试有内容的月份，或
          <button className="text-button" onClick={() => setAll(true)}>
            查看全部简报
          </button>
          。
        </NoResults>
      )}
    </>
  );
}
function useIndex() {
  const [index, setIndex] = useState<IndexStory[] | null>(null),
    [error, setError] = useState(false),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch(href('/search-index.json'), {
      signal: controller.signal,
      cache: 'no-cache',
    })
      .then((response) => {
        if (!response.ok) throw new Error('Index unavailable');
        return response.json();
      })
      .then((value) => {
        if (!isSearchIndexPayload(value)) throw new Error('Invalid index');
        if (!controller.signal.aborted) setIndex(value);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  return { index, error, retry: () => retry((n) => n + 1) };
}
function SearchView({
  entities,
  bookmarks = false,
}: {
  entities: string[];
  bookmarks?: boolean;
}) {
  const { state, ready, update, notify } = useReading();
  const { index, error, retry } = useIndex();
  const { filters, paramsReady, change, submit, shareUrl } = useSearchState();
  const [limit, setLimit] = useState(20);
  const fileRef = useRef<HTMLInputElement>(null);
  const deferredFilters = useDeferredValue(filters);
  const prepared = useMemo(() => createSearchIndex(index || []), [index]);
  const search = useMemo(
    () => searchStoriesDetailed(prepared, deferredFilters),
    [prepared, deferredFilters],
  );
  const results = useMemo(() => {
    const saved = new Set(state.bookmarks),
      read = new Set(state.read);
    return search.results.filter(
      ({ story }) =>
        (!bookmarks || saved.has(story.id)) &&
        (deferredFilters.read === 'all' ||
          (deferredFilters.read === 'read'
            ? read.has(story.id)
            : !read.has(story.id))),
    );
  }, [search, bookmarks, state.bookmarks, state.read, deferredFilters.read]);
  const searching = filters !== deferredFilters;
  const loaded = Boolean(index && ready && paramsReady);
  const updateFilters = (patch: Partial<SearchState>) => {
    change(patch);
    setLimit(20);
  };
  const clear = () => updateFilters(defaultSearchState());
  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      notify('已复制搜索链接，包含筛选条件、排序和权重。');
    } catch {
      notify('未能复制链接。可复制浏览器地址栏中的搜索地址。');
    }
  };
  useEffect(() => {
    setLimit(20);
  }, [deferredFilters]);
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context || !index || bookmarks) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'search_briefing_archive',
            description:
              'Search published news using Boolean expressions, phrases, field weights and date filters. Returns paginated stable links and match fields without changing reading records.',
            inputSchema: searchToolSchema,
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: (input) => executeSearchTool(prepared, input, storyHref),
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Unsupported experimental registry must not affect reading. */
    }
    return () => lifecycle.abort();
  }, [index, prepared, bookmarks]);
  const exportBackup = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { ...state, exportedAt: new Date().toISOString() },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `briefing-atlas-backup-${shanghaiDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('阅读记录备份已导出。请保存到安全的位置。');
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('备份文件不能超过 5 MB。');
      const incoming = validateReadingState(
        JSON.parse(await file.text()),
      ) as ReadingState;
      update((current) => ({
        ...incoming,
        bookmarks: [...new Set([...current.bookmarks, ...incoming.bookmarks])],
        read: [...new Set([...current.read, ...incoming.read])],
      }));
      notify('备份已合并，现有收藏和已读记录均已保留。');
    } catch (error) {
      notify(
        error instanceof SyntaxError
          ? '文件不是有效的 JSON 备份。'
          : error instanceof Error
            ? error.message
            : '无法导入此文件。',
      );
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <>
      <p className="eyebrow">
        {bookmarks ? 'YOUR READING COLLECTION' : 'FOLLOW YOUR CURIOSITY'}
      </p>
      <div className="page-heading">
        <h1>{bookmarks ? '我的收藏' : '探索主题'}</h1>
        {bookmarks ? <Bookmark size={25} /> : <Search size={25} />}
      </div>
      <p className="page-description">
        {bookmarks
          ? '把值得再次阅读的内容，留在这里。'
          : '从一个关键词出发，找到散落在时间里的线索。'}
      </p>
      {bookmarks && (
        <>
          <div className="backup-toolbar">
            <button
              className="outline-button"
              disabled={!ready}
              onClick={exportBackup}
            >
              <ArrowDownToLine size={16} />
              导出备份
            </button>
            <button
              className="outline-button"
              disabled={!ready}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={16} />
              导入备份
            </button>
            <input
              ref={fileRef}
              className="sr-only"
              tabIndex={-1}
              aria-label="导入阅读备份文件"
              type="file"
              accept="application/json,.json"
              onChange={(e) => void importBackup(e.target.files?.[0])}
            />
          </div>
          <p className="storage-note">
            收藏与阅读记录保存在此浏览器。更换设备或清理浏览器前，请先导出备份。
          </p>
        </>
      )}
      <SearchControls
        value={filters}
        onChange={updateFilters}
        onSubmit={submit}
        entities={entities}
        invalid={!searching && search.errors.length > 0}
      />
      {!searching && search.errors.length > 0 && (
        <div className="search-query-warning" id="search-errors" role="alert">
          <strong>请调整搜索条件</strong>
          <ul>
            {search.errors.map((error, i) => (
              <li key={i}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="section-heading search-results-heading">
        <h2>
          {bookmarks ? '收藏内容' : filters.q ? '搜索结果' : '全部内容'}{' '}
          <span role="status" aria-live="polite" aria-atomic="true">
            {loaded
              ? searching
                ? '正在搜索…'
                : search.errors.length
                  ? '条件无效'
                  : `${results.length} 条`
              : ''}
          </span>
        </h2>
        <div className="search-result-tools">
          <label>
            <span className="sr-only">排序方式</span>
            <select
              aria-label="排序方式"
              value={filters.sort}
              onChange={(e) =>
                updateFilters({ sort: e.target.value as SearchState['sort'] })
              }
            >
              <option value="relevance">相关度优先</option>
              <option value="newest">最新优先</option>
              <option value="oldest">最早优先</option>
            </select>
          </label>
          <button
            className="text-button"
            onClick={() => void share()}
            disabled={!paramsReady}
          >
            <LinkIcon size={14} />
            复制搜索链接
          </button>
          {Boolean(writeSearchState(filters)) && (
            <button className="text-button" onClick={clear}>
              重置搜索
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      {error ? (
        <NoResults title="暂时无法加载内容">
          请检查网络后
          <button className="text-button" onClick={retry}>
            重新加载
          </button>
          。
        </NoResults>
      ) : !loaded ? (
        <p className="loading-text" role="status">
          正在加载简报…
        </p>
      ) : search.errors.length ? null : !results.length ? (
        <NoResults
          title={
            bookmarks && !state.bookmarks.length
              ? '还没有收藏的内容'
              : '没有找到符合条件的内容'
          }
        >
          {bookmarks && !state.bookmarks.length ? (
            <>
              <a href={href('/')} className="text-button">
                去阅读最新简报
              </a>
              ，点击新闻右上角的书签即可收藏。
            </>
          ) : (
            <>
              试试减少条件、使用 OR / 任一关键词、英文前缀（如 agent*），或
              <button className="text-button" onClick={clear}>
                重置搜索
              </button>
              。
            </>
          )}
        </NoResults>
      ) : (
        <>
          {results.slice(0, limit).map((result, index) => (
            <StoryCard
              key={result.story.id}
              story={result.story}
              date={result.story.briefingDate}
              index={index}
              searchResult={result}
            />
          ))}
          {results.length > limit && (
            <button
              className="load-more outline-button"
              onClick={() => setLimit((n) => n + 20)}
            >
              再显示 {Math.min(20, results.length - limit)} 条
            </button>
          )}
        </>
      )}
    </>
  );
}
export default function Atlas({ view, meta, briefing, entities = [] }: Props) {
  const [month, setMonth] = useState(
      (briefing?.briefingDate || meta[0]?.briefingDate || '2026-09-01').slice(
        0,
        7,
      ),
    ),
    [selected, setSelected] = useState(briefing?.briefingDate || ''),
    [emptyDate, setEmptyDate] = useState('');
  const { state } = useReading();
  useEffect(() => {
    if (view === 'archive') {
      const date = new URLSearchParams(location.search).get('date');
      if (date && isDate(date)) {
        setMonth(date.slice(0, 7));
        setSelected(date);
      }
    }
  }, [view]);
  const onDate = (date: string) => {
    setSelected(date);
    if (meta.some((item) => item.briefingDate === date)) {
      location.assign(href(`/briefings/${date}/`));
      return;
    }
    setEmptyDate(date);
    if (view === 'archive')
      history.replaceState(null, '', `${href('/archive/')}?date=${date}`);
  };
  return (
    <>
      <Header view={view} />
      <div
        className={`workspace ${view === 'issue' || view === 'latest' ? '' : 'wide-content'}`}
      >
        <aside className="left-rail">
          <p className="eyebrow">YOUR KNOWLEDGE, MAPPED</p>
          <h2>
            把值得关注的，
            <br />
            留在时间里。
          </h2>
          <p className="muted rail-intro">从今天的新闻，读懂明天的变化。</p>
          <Calendar
            meta={meta}
            month={month}
            setMonth={setMonth}
            selected={selected}
            onDate={onDate}
          />
          {emptyDate && (
            <p className="calendar-empty" role="status">
              {emptyDate} 暂无简报
            </p>
          )}
          <a className="rail-link" href={href('/archive/')}>
            查看全部简报 <ArrowUpRight size={16} />
          </a>
          <div className="rail-section">
            <p className="eyebrow">关注的方向</p>
            {topics.map((topic, i) => (
              <a
                href={href(`/search/?tag=${encodeURIComponent(topic)}`)}
                key={topic}
              >
                <span className={`topic-dot dot-${i}`} />
                {topic}
                <span className="topic-count">
                  {meta.filter((item) => item.tags.includes(topic)).length}
                </span>
              </a>
            ))}
          </div>
          {state.lastRead &&
            meta.some((item) => item.briefingDate === state.lastRead?.date) && (
              <a
                className="continue-reading"
                href={storyHref(state.lastRead.date, state.lastRead.storyId)}
              >
                <BookOpen size={17} />
                <span>
                  继续上次阅读<small>{state.lastRead.date}</small>
                </span>
                <ArrowRight size={14} />
              </a>
            )}
          <div className="rail-footer">
            <Compass size={18} />
            <p>
              少一些信息噪音，
              <br />
              多一些理解世界的线索。
            </p>
          </div>
        </aside>
        <main id="main-content">
          {(view === 'latest' || view === 'issue') && briefing ? (
            <Issue
              briefing={briefing}
              meta={meta}
              isLatest={briefing.briefingDate === meta[0].briefingDate}
            />
          ) : view === 'latest' || view === 'issue' ? (
            <NoResults title="第一期简报即将见面">
              之后可以在这里阅读最新内容，或按日期回看。
            </NoResults>
          ) : view === 'archive' ? (
            <Archive
              meta={meta}
              month={month}
              setMonth={setMonth}
              selected={selected}
              onDate={onDate}
            />
          ) : (
            <SearchView entities={entities} bookmarks={view === 'bookmarks'} />
          )}
        </main>
        {briefing && (
          <aside className="right-rail">
            <p className="eyebrow">本期目录</p>
            {briefing.stories.map((story, index) => (
              <a href={`#${story.id}`} key={story.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {story.title}
              </a>
            ))}
            {briefing.outro && (
              <a href="#issue-outro">
                <span>尾</span>结语
              </a>
            )}
            <div className="archive-note">
              <CalendarDays size={22} />
              <h3>让信息成为积累</h3>
              <p>
                按时间回看，沿主题深入。
                <br />
                下一次需要时，再找到它。
              </p>
              <a href={href('/archive/')}>
                探索历史简报 <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="recent-issues">
              <p className="eyebrow">最近几期</p>
              {meta
                .filter((item) => item.briefingDate !== briefing.briefingDate)
                .slice(0, 3)
                .map((item) => (
                  <a
                    href={href(`/briefings/${item.briefingDate}/`)}
                    key={item.id}
                  >
                    <time>{item.briefingDate}</time>
                    <span>{item.title}</span>
                  </a>
                ))}
            </div>
            <a className="back-top" href="#main-content">
              <ArrowUp size={15} />
              返回顶部
            </a>
          </aside>
        )}
      </div>
      <footer className="site-footer">
        <span>
          Briefing Atlas <b>·</b> 科技简报图志
        </span>
        <span>
          北京时间 <b>·</b> 保持好奇，持续连接。
        </span>
      </footer>
    </>
  );
}
