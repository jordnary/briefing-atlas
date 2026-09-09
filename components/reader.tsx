'use client';

import './reader.css';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Compass,
  Copy,
  ExternalLink,
  List,
  Minus,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings2,
  Sun,
  Type,
  X,
} from 'lucide-react';
import type { Briefing, Story } from '@/lib/content';
import { href, storyHref } from '@/lib/paths';
import { defaultState, readingText } from '@/lib/domain.mjs';
import { readingRange, readingProgress, readingOffset } from '@/lib/reader.mjs';
import { MarkdownContent } from './markdown-content';
import { ImageGallery } from './image-gallery';
import { useReading, type ReadingState } from './reading-provider';

type ReaderProps = {
  briefing: ReaderBriefing;
  story: Story;
  index: number;
};
export type ReaderBriefing = Pick<Briefing, 'briefingDate' | 'outro'> & {
  stories: Pick<Story, 'id' | 'title'>[];
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function readingMinutes(story: Story) {
  return Math.max(1, Math.ceil(readingText(story.body).length / 350));
}

function ReaderHeader({
  date,
  focus,
  setFocus,
}: {
  date: string;
  focus: boolean;
  setFocus: (value: boolean) => void;
}) {
  const { resolvedTheme, update } = useReading();
  return (
    <header className="reader-header">
      <a className="reader-brand" href={href('/')}>
        <span className="reader-brand-icon">
          <Compass size={20} />
        </span>
        <span>
          Briefing Atlas
          <small>科技简报图志</small>
        </span>
      </a>
      <nav className="reader-nav" aria-label="阅览导航">
        <a href={href(`/briefings/${date}/`)}>
          <ArrowLeft size={15} /> 返回本期
        </a>
        <a href={href('/archive/')}>往期简报</a>
        <a href={href('/search/')}>探索主题</a>
      </nav>
      <div className="reader-header-actions">
        <button
          className="icon-button reader-focus-toggle"
          aria-label={focus ? '退出专注模式' : '开启专注模式'}
          title={focus ? '退出专注模式' : '专注模式'}
          aria-pressed={focus}
          onClick={() => setFocus(!focus)}
        >
          {focus ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </button>
        <button
          className="icon-button"
          aria-label={
            resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式'
          }
          title={resolvedTheme === 'dark' ? '浅色模式' : '深色模式'}
          onClick={() =>
            update((current) => ({
              ...current,
              theme: document.documentElement.classList.contains('dark')
                ? 'light'
                : 'dark',
            }))
          }
        >
          {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}

function ReaderActions({
  story,
  date,
  completion = false,
}: {
  story: Story;
  date: string;
  completion?: boolean;
}) {
  const { state, ready, update, notify } = useReading();
  const marked = state.bookmarks.includes(story.id);
  const read = state.read.includes(story.id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(storyHref(date, story.id), location.origin).href,
      );
      notify('文章链接已复制。');
    } catch {
      notify('未能复制链接，请从地址栏复制。');
    }
  };
  return (
    <div
      className={`reader-actions ${completion ? 'reader-completion-actions' : ''}`}
      aria-label={completion ? '读后操作' : '文章操作'}
    >
      <button
        className={`reader-action-button ${marked ? 'is-active' : ''}`}
        disabled={!ready}
        aria-pressed={marked}
        onClick={() => {
          update((current) => ({
            ...current,
            bookmarks: marked
              ? current.bookmarks.filter((id) => id !== story.id)
              : [...current.bookmarks, story.id],
          }));
          notify(marked ? '已取消收藏。' : '已加入我的收藏。');
        }}
      >
        <Bookmark size={16} fill={marked ? 'currentColor' : 'none'} />
        {marked ? '已收藏' : '收藏'}
      </button>
      <button
        className={`reader-action-button ${read ? 'is-active' : ''}`}
        disabled={!ready}
        aria-pressed={read}
        onClick={() =>
          update((current) => ({
            ...current,
            read: read
              ? current.read.filter((id) => id !== story.id)
              : [...current.read, story.id],
          }))
        }
      >
        <Check size={16} />
        {read ? '已读' : completion ? '我读完了' : '标记已读'}
      </button>
      <button className="reader-action-button" onClick={copy}>
        <Copy size={16} />
        复制链接
      </button>
    </div>
  );
}

function TypeControls() {
  const { state, ready, update } = useReading();
  const changeSize = (amount: number) => {
    update((current) => ({
      ...current,
      reader: {
        ...current.reader,
        scale: Math.min(150, Math.max(80, current.reader.scale + amount)),
      },
    }));
  };
  return (
    <div
      className="reader-type-controls"
      role="group"
      aria-label="整篇文字缩放"
    >
      <Type size={15} aria-hidden="true" />
      <button
        className="icon-button"
        aria-label="缩小整篇文字"
        title="缩小整篇文字"
        disabled={!ready || state.reader.scale <= 80}
        onClick={() => changeSize(-5)}
      >
        <Minus size={16} />
      </button>
      <span aria-live="polite">{state.reader.scale}%</span>
      <button
        className="icon-button"
        aria-label="放大整篇文字"
        title="放大整篇文字"
        disabled={!ready || state.reader.scale >= 150}
        onClick={() => changeSize(5)}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

function SizeSetting({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="reader-size-setting">
      <div className="reader-size-label">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>
          {value}
          {unit}
        </output>
      </div>
      <div className="reader-size-input">
        <button
          className="icon-button small"
          aria-label={`减小${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          <Minus size={14} />
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={`${value}${unit}`}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <button
          className="icon-button small"
          aria-label={`增大${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function ReaderSettings() {
  const { state, ready, update } = useReading();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const setPreference = (value: Partial<ReadingState['reader']>) =>
    update((current) => ({
      ...current,
      reader: { ...current.reader, ...value },
    }));
  return (
    <div
      className="reader-settings"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="reader-settings-trigger"
        aria-label="排版与外观"
        aria-expanded={open}
        aria-controls="reader-settings-panel"
        disabled={!ready}
        onClick={() => setOpen(!open)}
        title="排版与外观"
      >
        <Settings2 size={18} />
        <span>阅读设置</span>
      </button>
      {open && (
        <div
          id="reader-settings-panel"
          ref={panel}
          className="reader-settings-panel"
          role="region"
          aria-label="排版与外观"
        >
          <div className="reader-settings-heading">
            <strong>阅读设置</strong>
            <button
              className="icon-button small"
              aria-label="关闭阅读设置"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <SizeSetting
            label="整篇缩放"
            value={state.reader.scale}
            min={80}
            max={150}
            step={5}
            unit="%"
            onChange={(scale) => setPreference({ scale })}
          />
          <p className="reader-setting-hint">
            同步调整标题、摘要、正文和来源文字。
          </p>
          <SizeSetting
            label="标题大小"
            value={state.reader.titleScale}
            min={80}
            max={140}
            step={5}
            unit="%"
            onChange={(titleScale) => setPreference({ titleScale })}
          />
          <SizeSetting
            label="正文大小"
            value={state.fontSize}
            min={16}
            max={28}
            step={1}
            unit="px"
            onChange={(fontSize) =>
              update((current) => ({ ...current, fontSize }))
            }
          />
          <fieldset>
            <legend>页面色调</legend>
            <div className="reader-setting-options reader-theme-options">
              {(
                [
                  { value: 'light', label: '明亮' },
                  { value: 'paper', label: '纸色' },
                  { value: 'dark', label: '夜间' },
                  { value: 'system', label: '自动' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  className={`theme-swatch theme-swatch-${option.value}`}
                  aria-pressed={state.theme === option.value}
                  onClick={() =>
                    update((current) => ({ ...current, theme: option.value }))
                  }
                >
                  <span aria-hidden="true">Aa</span>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>正文字体</legend>
            <div className="reader-setting-options">
              {(
                [
                  { value: 'sans', label: '现代黑体' },
                  { value: 'serif', label: '人文宋体' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  aria-pressed={state.reader.font === option.value}
                  onClick={() => setPreference({ font: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>阅读宽度</legend>
            <div className="reader-setting-options">
              {(
                [
                  { value: 'standard', label: '标准' },
                  { value: 'wide', label: '宽屏' },
                  { value: 'full', label: '铺满' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  aria-pressed={state.reader.width === option.value}
                  onClick={() => setPreference({ width: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>段落行距</legend>
            <div className="reader-setting-options">
              {(
                [
                  { value: 'relaxed', label: '舒展' },
                  { value: 'compact', label: '紧凑' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  aria-pressed={state.reader.spacing === option.value}
                  onClick={() => setPreference({ spacing: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            className="reader-settings-reset"
            onClick={() =>
              update((current) => ({
                ...current,
                theme: defaultState.theme,
                fontSize: defaultState.fontSize,
                reader: { ...defaultState.reader } as ReadingState['reader'],
              }))
            }
          >
            恢复默认排版
          </button>
        </div>
      )}
    </div>
  );
}

function SourcePanel({ story }: { story: Story }) {
  return (
    <section
      id="reader-sources"
      className="reader-source-panel"
      aria-labelledby="source-heading"
    >
      <div className="reader-source-heading">
        <div>
          <p className="eyebrow">SOURCE &amp; CONTEXT</p>
          <h2 id="source-heading">来源</h2>
        </div>
      </div>
      {story.eventDate && (
        <p className="reader-event-date">事件日期：{story.eventDate}</p>
      )}
      <ul className="reader-source-list">
        {story.sources.length ? (
          story.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                <span>{source.title}</span>
                <ExternalLink size={14} />
              </a>
            </li>
          ))
        ) : (
          <li className="muted">来源尚未补全。</li>
        )}
      </ul>
    </section>
  );
}

function ReaderIndex({
  briefing,
  currentId,
  onNavigate,
}: {
  briefing: ReaderBriefing;
  currentId: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="reader-index" aria-label="本期目录">
      <div className="reader-index-title">
        <List size={16} />
        <span>本期目录</span>
      </div>
      <div className="reader-index-list">
        {briefing.stories.map((item, itemIndex) => (
          <a
            href={storyHref(briefing.briefingDate, item.id)}
            className={item.id === currentId ? 'active' : ''}
            aria-current={item.id === currentId ? 'page' : undefined}
            onClick={onNavigate}
            key={item.id}
          >
            <span>{String(itemIndex + 1).padStart(2, '0')}</span>
            <b>{item.title}</b>
          </a>
        ))}
      </div>
      {briefing.outro && (
        <a
          className="reader-index-outro"
          href={href(`/briefings/${briefing.briefingDate}/#issue-outro`)}
        >
          <span>尾</span>
          <b>本期结语</b>
        </a>
      )}
    </nav>
  );
}

export function Reader({ briefing, story, index }: ReaderProps) {
  const { state, ready, update } = useReading();
  const [progress, setProgress] = useState(0);
  const [resume, setResume] = useState<number | null>(null);
  const [focus, setFocus] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const mobileIndex = useRef<HTMLDetailsElement>(null);
  const savedReading = useRef(state.lastRead);
  savedReading.current = state.lastRead;
  const minutes = readingMinutes(story);
  const previous = briefing.stories[index - 1];
  const next = briefing.stories[index + 1];

  useEffect(() => {
    if (!ready || !body.current) return;
    const saved = savedReading.current;
    if (saved?.storyId === story.id && saved.date === briefing.briefingDate) {
      if (
        !location.hash &&
        (saved.progress ?? 0) > 3 &&
        (saved.progress ?? 0) < 98
      )
        setResume(saved.progress!);
    } else {
      update((current) => ({
        ...current,
        lastRead: {
          date: briefing.briefingDate,
          storyId: story.id,
          progress: 0,
        },
      }));
    }
    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;
    let interacted = false;
    let latest = 0;
    const persist = () => {
      if (!interacted) return;
      update((current) =>
        current.lastRead?.storyId === story.id &&
        current.lastRead?.progress === latest
          ? current
          : {
              ...current,
              lastRead: {
                date: briefing.briefingDate,
                storyId: story.id,
                progress: latest,
              },
            },
      );
    };
    const measure = () => {
      if (!body.current) return;
      const bounds = body.current.getBoundingClientRect();
      latest = readingProgress(
        window.scrollY,
        readingRange(
          bounds.top + window.scrollY,
          bounds.height,
          window.innerHeight,
        ),
      );
      setProgress(latest);
    };
    const scroll = () => {
      interacted = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
      clearTimeout(timer);
      timer = setTimeout(persist, 250);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body.current);
    measure();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('pagehide', persist);
    return () => {
      persist();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pagehide', persist);
    };
  }, [briefing.briefingDate, ready, story.id, update]);

  const resumeReading = () => {
    if (!body.current || resume === null) return;
    const bounds = body.current.getBoundingClientRect();
    window.scrollTo({
      top: readingOffset(
        resume,
        readingRange(
          bounds.top + window.scrollY,
          bounds.height,
          window.innerHeight,
        ),
      ),
      behavior: 'auto',
    });
    setResume(null);
  };

  return (
    <div
      className={`reader-page ${focus ? 'reader-focused' : ''}`}
      data-reader-font={state.reader.font}
      data-reader-width={state.reader.width}
      data-reader-spacing={state.reader.spacing}
      style={
        {
          '--reader-scale': state.reader.scale / 100,
          '--reader-title-scale': state.reader.titleScale / 100,
        } as CSSProperties
      }
    >
      <ReaderHeader
        date={briefing.briefingDate}
        focus={focus}
        setFocus={setFocus}
      />
      <div className="reader-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="reader-layout">
        <div className="reader-main-column">
          <div className="reader-breadcrumb">
            <a href={href('/')}>每日简报</a>
            <span>/</span>
            <a href={href(`/briefings/${briefing.briefingDate}/`)}>
              {briefing.briefingDate.replaceAll('-', '.')}
            </a>
            <span>/</span>
            <span>阅读模式</span>
          </div>
          <div className="reader-toolbar">
            <a
              className="reader-back-link"
              href={href(`/briefings/${briefing.briefingDate}/`)}
            >
              <ArrowLeft size={15} /> 返回本期目录
            </a>
            <div className="reader-toolbar-right">
              <span className="reader-progress-label">
                阅读进度 {progress}%
              </span>
            </div>
          </div>
          <details className="reader-mobile-index" ref={mobileIndex}>
            <summary>
              <span>
                <List size={15} /> 本期目录{' '}
                <b>
                  {String(index + 1).padStart(2, '0')} /{' '}
                  {String(briefing.stories.length).padStart(2, '0')}
                </b>
              </span>
              <ChevronDown size={15} />
            </summary>
            <ReaderIndex
              briefing={briefing}
              currentId={story.id}
              onNavigate={() => {
                if (mobileIndex.current) mobileIndex.current.open = false;
              }}
            />
          </details>
          {resume !== null && (
            <div className="reader-resume" role="status">
              <span>
                上次读到 <b>{resume}%</b>，接着读？
              </span>
              <button onClick={resumeReading}>
                回到上次位置 <ArrowRight size={14} />
              </button>
              <button
                className="icon-button small"
                aria-label="忽略上次阅读位置"
                onClick={() => setResume(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <main id="main-content" className="reader-article">
            <div className="reader-article-kicker">
              <span>
                FIELD NOTES <i /> {String(index + 1).padStart(2, '0')} /{' '}
                {String(briefing.stories.length).padStart(2, '0')}
              </span>
              {story.tags[0] && <span>{story.tags[0]}</span>}
            </div>
            <h1>{story.title}</h1>
            <p className="reader-deck">
              <span className="reader-deck-label">
                {story.summaryKind === 'excerpt' ? '内容摘录' : '摘要'}
              </span>
              {story.summary}
            </p>
            <div className="reader-meta-row">
              <span>
                <CalendarDays size={15} />
                {formatDate(briefing.briefingDate)}
              </span>
              <span>
                <Clock3 size={15} />
                {minutes} 分钟阅读
              </span>
            </div>
            <ReaderActions story={story} date={briefing.briefingDate} />
            {story.image &&
              (story.image.available ? (
                <div className="reader-hero-image">
                  <ImageGallery
                    images={[
                      {
                        src: href(`/${story.image.path}`),
                        alt: story.image.alt,
                        caption: [story.image.caption, story.image.source]
                          .filter(Boolean)
                          .join(' · '),
                      },
                    ]}
                  />
                </div>
              ) : (
                <div className="image-fallback reader-image-fallback">
                  配图暂不可用 · {story.image.alt}
                </div>
              ))}
            <div ref={body} id="reader-body" className="reader-content">
              <MarkdownContent html={story.html} />
            </div>
            <div className="reader-end-mark" aria-hidden="true">
              <span />✦<span />
            </div>
            <SourcePanel story={story} />
            <div className="reader-tags" aria-label="相关主题">
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
            <section id="reader-next" className="reader-completion">
              <p className="eyebrow">A MOMENT TO REFLECT</p>
              <h2>读到这里，留下一点思考。</h2>
              <p>收藏这条线索，或接着读本期的下一篇。</p>
              <ReaderActions
                story={story}
                date={briefing.briefingDate}
                completion
              />
            </section>
            <nav className="reader-story-nav" aria-label="文章切换">
              {previous ? (
                <a href={storyHref(briefing.briefingDate, previous.id)}>
                  <ArrowLeft size={16} />
                  <span>
                    <small>上一篇</small>
                    {previous.title}
                  </span>
                </a>
              ) : (
                <a href={href(`/briefings/${briefing.briefingDate}/`)}>
                  <ArrowLeft size={16} />
                  <span>
                    <small>本期导读</small>回到本期简报
                  </span>
                </a>
              )}
              {next ? (
                <a href={storyHref(briefing.briefingDate, next.id)}>
                  <span>
                    <small>下一篇</small>
                    {next.title}
                  </span>
                  <ArrowRight size={16} />
                </a>
              ) : (
                <a
                  href={href(
                    `/briefings/${briefing.briefingDate}/#issue-outro`,
                  )}
                >
                  <span>
                    <small>本期已到尾声</small>
                    {briefing.outro ? '阅读本期结语' : '返回本期简报'}
                  </span>
                  <ArrowRight size={16} />
                </a>
              )}
            </nav>
            <div className="reader-footer-link">
              <a href={href(`/briefings/${briefing.briefingDate}/`)}>
                <ChevronUp size={15} /> 回到本期简报
              </a>
              <a href="#main-content">
                <ChevronUp size={15} /> 返回顶部
              </a>
            </div>
          </main>
        </div>
        <div className="reader-side-column">
          <div className="reader-side-sticky">
            <div className="reader-location">
              <span className="eyebrow">IN THIS EDITION</span>
              <p>{briefing.briefingDate.replaceAll('-', '.')}</p>
            </div>
            <ReaderIndex briefing={briefing} currentId={story.id} />
            <nav className="reader-page-outline" aria-label="本文导航">
              <a href="#reader-body">文章正文</a>
              <a href="#reader-sources">来源</a>
              <a href="#reader-next">接着阅读</a>
            </nav>
            <aside className="reader-side-note">
              <p className="eyebrow">READ SLOWLY</p>
              <h2>
                给重要内容
                <br />
                多一点时间。
              </h2>
              <p>
                阅读到 {progress}% · 约剩{' '}
                {Math.max(0, Math.ceil(minutes * (1 - progress / 100)))} 分钟
              </p>
              <progress value={progress} max={100} aria-label="文章阅读进度" />
            </aside>
          </div>
        </div>
      </div>
      <div className="reader-dock" role="group" aria-label="阅读工具">
        <TypeControls />
        <ReaderSettings />
      </div>
      <footer className="site-footer reader-footer">
        <span>
          Briefing Atlas <b>·</b> 科技简报图志
        </span>
        <span>
          北京时间 <b>·</b> 保持好奇，持续连接。
        </span>
      </footer>
    </div>
  );
}
