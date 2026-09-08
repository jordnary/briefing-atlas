'use client';
import { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import {
  DEFAULT_SEARCH_WEIGHTS,
  SEARCH_FIELD_LABELS,
  SEARCH_LIMITS,
  type SearchField,
} from '@/lib/search.mjs';
import type { SearchState } from '@/lib/search-state.mjs';
import { topics } from '@/lib/paths';

const examples = [
  ['复杂组合', 'title:(Agent OR 模型) -游戏'],
  ['连续短语', 'body:"incident report"'],
  ['机构与日期', 'entity:OpenAI after:2026-08-28'],
  ['前缀匹配', 'agent*'],
];

export function SearchControls({
  value,
  onChange,
  onSubmit,
  entities,
  invalid,
}: {
  value: SearchState;
  onChange: (patch: Partial<SearchState>) => void;
  onSubmit: () => void;
  entities: string[];
  invalid: boolean;
}) {
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value.q);
  useEffect(() => {
    if (!composing.current) setDraft(value.q);
  }, [value.q]);
  const customWeights = Object.entries(value.weights).some(
    ([key, weight]) => weight !== DEFAULT_SEARCH_WEIGHTS[key as SearchField],
  );
  return (
    <>
      <form
        className="search-field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing.current) onSubmit();
        }}
      >
        <Search size={21} aria-hidden="true" />
        <input
          ref={input}
          id="atlas-search-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="搜索简报内容"
          aria-invalid={invalid}
          aria-describedby={`search-hint${invalid ? ' search-errors' : ''}`}
          placeholder="搜索标题、正文、公司或技术名词…"
          value={draft}
          maxLength={SEARCH_LIMITS.length}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            onChange({ q: event.currentTarget.value });
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            if (!composing.current) onChange({ q: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !composing.current) {
              setDraft('');
              onChange({ q: '' });
            }
          }}
        />
        {draft && (
          <button
            type="button"
            className="icon-button"
            aria-label="清空关键词"
            onClick={() => {
              setDraft('');
              onChange({ q: '' });
              input.current?.focus();
            }}
          >
            <X size={17} />
          </button>
        )}
        <button type="submit" className="search-submit">
          搜索
        </button>
      </form>
      <p className="search-help" id="search-hint">
        空格组合关键词，引号查找连续短语；支持中文、英文及全角字符。
      </p>
      <div className="topic-filters" role="group" aria-label="主题筛选">
        {['', ...new Set([...topics, ...(value.tag ? [value.tag] : [])])].map(
          (topic, i) => (
            <button
              key={topic}
              className={`pill ${value.tag === topic ? 'active' : ''}`}
              aria-pressed={value.tag === topic}
              onClick={() =>
                onChange({ tag: value.tag === topic ? '' : topic })
              }
            >
              {topic && (
                <span className={`topic-dot dot-${(i - 1) % topics.length}`} />
              )}
              {topic || '全部主题'}
            </button>
          ),
        )}
      </div>
      <div className="search-filters">
        <label>
          <span className="sr-only">公司或机构</span>
          <select
            aria-label="公司或机构"
            value={value.entity}
            onChange={(e) => onChange({ entity: e.target.value })}
          >
            <option value="">全部公司 / 机构</option>
            {[
              ...new Set([
                ...entities,
                ...(value.entity ? [value.entity] : []),
              ]),
            ].map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </label>
        <label>
          从
          <input
            aria-label="开始日期"
            type="date"
            min="1900-01-01"
            max="9999-12-31"
            value={value.from}
            onChange={(e) => onChange({ from: e.target.value })}
          />
        </label>
        <label>
          至
          <input
            aria-label="结束日期"
            type="date"
            min="1900-01-01"
            max="9999-12-31"
            value={value.to}
            onChange={(e) => onChange({ to: e.target.value })}
          />
        </label>
        <label>
          <span className="sr-only">阅读状态</span>
          <select
            aria-label="阅读状态"
            value={value.read}
            onChange={(e) =>
              onChange({ read: e.target.value as SearchState['read'] })
            }
          >
            <option value="all">全部阅读状态</option>
            <option value="unread">未读</option>
            <option value="read">已读</option>
          </select>
        </label>
      </div>
      <details className="search-advanced">
        <summary>
          <SlidersHorizontal size={15} aria-hidden="true" />
          高级搜索与权重
          {customWeights && (
            <span className="search-custom-badge">已调整权重</span>
          )}
        </summary>
        <div className="search-advanced-content">
          <div className="search-scope-row">
            <label>
              搜索范围
              <select
                aria-label="搜索范围"
                value={value.scope}
                onChange={(e) =>
                  onChange({ scope: e.target.value as SearchState['scope'] })
                }
              >
                <option value="all">全部字段</option>
                {Object.entries(SEARCH_FIELD_LABELS).map(([field, label]) => (
                  <option key={field} value={field}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              空格连接方式
              <select
                aria-label="关键词匹配方式"
                value={value.match}
                onChange={(e) =>
                  onChange({ match: e.target.value as SearchState['match'] })
                }
              >
                <option value="all">包含全部关键词</option>
                <option value="any">包含任一关键词</option>
              </select>
            </label>
          </div>
          <fieldset className="search-weight-settings">
            <legend>相关度权重</legend>
            <p>
              数值越大，该字段命中时越靠前。0
              只取消排序加分；限定检索位置请使用搜索范围。调整后自动按相关度排序。
            </p>
            <div className="search-presets">
              <button
                type="button"
                className="pill"
                onClick={() =>
                  onChange({
                    weights: { ...DEFAULT_SEARCH_WEIGHTS },
                    sort: 'relevance',
                  })
                }
              >
                标题优先 · 默认
              </button>
              <button
                type="button"
                className="pill"
                onClick={() =>
                  onChange({
                    weights: {
                      title: 4,
                      summary: 2,
                      body: 2,
                      tags: 2,
                      entities: 2,
                      source: 1,
                      briefing: 0.5,
                    },
                    sort: 'relevance',
                  })
                }
              >
                均衡
              </button>
              <button
                type="button"
                className="pill"
                onClick={() =>
                  onChange({
                    weights: {
                      title: 2,
                      summary: 2,
                      body: 8,
                      tags: 1,
                      entities: 1,
                      source: 1,
                      briefing: 0.5,
                    },
                    sort: 'relevance',
                  })
                }
              >
                正文优先
              </button>
            </div>
            <div className="weight-grid">
              {Object.entries(SEARCH_FIELD_LABELS).map(([key, label]) => {
                const field = key as SearchField;
                return (
                  <label key={field} htmlFor={`weight-${field}`}>
                    <span>{label}</span>
                    <input
                      id={`weight-${field}`}
                      type="range"
                      min="0"
                      max="20"
                      step="0.5"
                      aria-label={`${label}搜索权重`}
                      value={value.weights[field]}
                      onChange={(e) =>
                        onChange({
                          weights: {
                            ...value.weights,
                            [field]: Number(e.target.value),
                          },
                          sort: 'relevance',
                        })
                      }
                    />
                    <output htmlFor={`weight-${field}`}>
                      {value.weights[field]}
                    </output>
                  </label>
                );
              })}
            </div>
            {customWeights && (
              <button
                type="button"
                className="text-button reset-weights"
                onClick={() =>
                  onChange({ weights: { ...DEFAULT_SEARCH_WEIGHTS } })
                }
              >
                恢复默认权重
              </button>
            )}
          </fieldset>
          <div className="search-syntax">
            <h3>组合搜索语法</h3>
            <p>
              <code>NOT</code> 优先于 <code>AND</code>，<code>AND</code> 优先于{' '}
              <code>OR</code>；括号改变顺序。运算符使用大写，
              <code>-关键词</code> 表示排除。
            </p>
            <p>
              字段支持 <code>title:</code>、<code>summary:</code>、
              <code>body:</code>、<code>tag:</code>、<code>entity:</code>、
              <code>source:</code>、<code>briefing:</code>
              ；字段限定优先于上方搜索范围。
            </p>
            <p>
              <code>date:2026-09</code> 查找整月；<code>before:</code> /{' '}
              <code>after:</code>{' '}
              使用完整日期且不含当天。上方日期筛选包含起止当天，所有日期均指简报日期。
            </p>
            <p>
              英文按单词匹配，<code>agent*</code> 可匹配
              Agentic；中文按连续文字匹配。用引号包围含冒号、括号或星号的字面内容，例如{' '}
              <code>{'"C*"'}</code>。
            </p>
            <div className="search-examples">
              {examples.map(([label, query]) => (
                <button
                  key={query}
                  type="button"
                  onClick={() => {
                    onChange({ q: query, scope: 'all', match: 'all' });
                    input.current?.focus();
                  }}
                  aria-label={`填入示例：${label}`}
                >
                  <span>{label}</span>
                  <code>{query}</code>
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>
      <div className="search-active-filters" aria-label="当前筛选">
        {(
          [
            ['entity', value.entity],
            ['tag', value.tag],
            ['from', value.from && `从 ${value.from}`],
            ['to', value.to && `至 ${value.to}`],
            [
              'read',
              value.read !== 'all'
                ? value.read === 'read'
                  ? '已读'
                  : '未读'
                : '',
            ],
            [
              'scope',
              value.scope !== 'all'
                ? `仅${SEARCH_FIELD_LABELS[value.scope]}`
                : '',
            ],
            ['match', value.match === 'any' ? '任一关键词' : ''],
          ] as const
        )
          .filter(([, label]) => label)
          .map(([key, label]) => (
            <button
              className="search-filter-chip"
              key={key}
              aria-label={`移除筛选：${label}`}
              onClick={() =>
                onChange({
                  [key]: ['read', 'scope', 'match'].includes(key) ? 'all' : '',
                })
              }
            >
              {label}
              <X size={12} />
            </button>
          ))}
      </div>
    </>
  );
}
