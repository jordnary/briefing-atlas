import { createHash } from 'node:crypto';
import { marked } from 'marked';
import { isDate } from '../lib/domain.mjs';
import { validateBriefing } from './content.mjs';
import {
  imageGroupKey,
  imageMarkdown,
  messageResources,
  markdownLabel,
  markdownUrl,
  resourceHash,
} from './archive-resources.mjs';

export const CONVERTER_VERSION = 3;
export const normalizeSource = (s) => s.replace(/\r\n?/g, '\n');
export const hash = (s) =>
  createHash('sha256').update(normalizeSource(s)).digest('hex');
const fail = (ok, code) => {
  if (!ok) throw new Error(code);
};
const plain = (s) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
export const excerpt = (s) =>
  plain(
    s
      .replace(/^:::gallery\n[\s\S]*?\n:::\s*$/gm, '')
      .replace(/（(?:另有 \d+ 条)?原引用链接暂未恢复）/g, '')
      .replace(/原配图暂未恢复/g, ''),
  ).slice(0, 150);

export function convertChat(
  text,
  citations = {},
  imageGroups = {},
  citationGroups = {},
) {
  return text
    .replace(/entity([\s\S]*?)/g, (_raw, data) => {
      const parsed = JSON.parse(data);
      fail(
        Array.isArray(parsed) && typeof parsed[1] === 'string',
        'INVALID_ENTITY',
      );
      return parsed[1];
    })
    .replace(/image_group([\s\S]*?)/g, (_raw, data) => {
      const images = imageGroups[imageGroupKey(data)];
      return images?.length
        ? `:::gallery\n${images.map(imageMarkdown).join('\n\n')}\n:::`
        : '原配图暂未恢复';
    })
    .replace(/cite([\s\S]*?)/g, (_raw, refs) => {
      const group = citationGroups[resourceHash(refs)];
      if (group)
        return (
          group.links
            .map(
              (source) =>
                `[${markdownLabel(source.title)}](${markdownUrl(source.url)})`,
            )
            .join(' · ') +
          (group.missing
            ? `（另有 ${group.missing} 条原引用链接暂未恢复）`
            : '')
        );
      return refs
        .split('')
        .map((ref) => {
          const source = citations[ref];
          if (!source) return '（原引用链接暂未恢复）';
          fail(
            typeof source.title === 'string' && typeof source.url === 'string',
            'INVALID_CITATION',
          );
          return `[${markdownLabel(source.title)}](${markdownUrl(source.url)})`;
        })
        .join('');
    });
}

export function splitOriginal(source) {
  const text = normalizeSource(source);
  fail(
    !/\[(?:truncated|内容截断)\]|\.\.\.\s*\d+ (?:tokens|chars) truncated|[^]*$/i.test(
      text,
    ),
    'TRUNCATED_SOURCE',
  );
  // The lexer keeps fenced code intact: headings and separators inside code are content.
  const tokens = marked.lexer(text);
  const titleToken = tokens.find((t) => t.type !== 'space');
  fail(
    titleToken?.type === 'heading' &&
      /AI\s*&\s*Tech\s*Briefing/i.test(titleToken.text),
    'NOT_A_BRIEFING',
  );
  const dates = [
    ...titleToken.text.matchAll(
      /(20\d{2})(?:\s*年\s*|-)(\d{1,2})(?:\s*月\s*|-)(\d{1,2})(?:\s*日)?/g,
    ),
  ];
  fail(dates.length === 1, 'DATE_MISSING_OR_CONFLICTING');
  const date = `${dates[0][1]}-${dates[0][2].padStart(2, '0')}-${dates[0][3].padStart(2, '0')}`;
  fail(isDate(date), 'INVALID_SOURCE_DATE');
  const starts = tokens.flatMap((t, i) =>
    t.type === 'heading' && /^\d+[.、)）]\s+/.test(t.text) ? [i] : [],
  );
  fail(starts.length > 0, 'STORIES_MISSING');
  const storyTokens = starts.map((start, i) =>
    tokens.slice(start, starts[i + 1] ?? tokens.length),
  );
  let outro = '';
  const last = storyTokens.at(-1);
  const separator = last.findLastIndex((t) => t.type === 'hr');
  if (separator >= 0) {
    outro = last
      .slice(separator + 1)
      .map((t) => t.raw)
      .join('')
      .trim();
    last.splice(separator);
  }
  const stories = storyTokens.map((ts, index) => {
    const header = ts[0];
    fail(
      Number(header.text.match(/^\d+/)[0]) === index + 1,
      'STORY_ORDER_AMBIGUOUS',
    );
    while (ts.at(-1)?.type === 'space' || ts.at(-1)?.type === 'hr') ts.pop();
    return {
      title: header.text.replace(/^\d+[.、)）]\s+/, ''),
      body: ts
        .slice(1)
        .map((t) => t.raw)
        .join('')
        .trim(),
    };
  });
  return {
    date,
    title: titleToken.text,
    intro: tokens
      .slice(tokens.indexOf(titleToken) + 1, starts[0])
      .map((t) => t.raw)
      .join('')
      .trim(),
    outro,
    stories,
  };
}

export function convertMessage(
  message,
  { now = new Date().toISOString(), previous = null, mapping = null } = {},
) {
  fail(
    message.role === 'assistant' &&
      message.status === 'completed' &&
      message.complete === true &&
      typeof message.text === 'string',
    'INCOMPLETE_OR_NONFINAL_SOURCE',
  );
  fail(
    message.text.length <= 1000000 && message.text.length > 0,
    'SOURCE_SIZE_LIMIT',
  );
  const original = splitOriginal(message.text);
  const resources = messageResources(message);
  const convert = (text) =>
    convertChat(
      text,
      resources.citations,
      resources.imageGroups,
      resources.citationGroups,
    );
  if (message.briefingDate)
    fail(message.briefingDate === original.date, 'DATE_MISSING_OR_CONFLICTING');
  const used = new Set();
  const previousIds = new Set(previous?.stories.map((story) => story.id) ?? []);
  const previousUsed = new Set();
  const stories = original.stories.map((raw, index) => {
    const title = convert(raw.title);
    const body = convert(raw.body);
    let id;
    if (previous) {
      const explicit = message.storyMapping?.[String(index + 1)];
      if (explicit && !previousIds.has(explicit)) {
        // New stories may be introduced only with an explicit, date-scoped ID.
        fail(
          typeof explicit === 'string' &&
            new RegExp(`^briefing-${original.date}-[0-9]{2}$`).test(explicit) &&
            !used.has(explicit),
          'STORY_MAPPING_INVALID',
        );
        id = explicit;
      } else {
        const matches = previous.stories.filter(
          (s) =>
            !previousUsed.has(s.id) &&
            (explicit ? s.id === explicit : s.title === title || s.body === body),
        );
        fail(matches.length === 1, 'STORY_MAPPING_REQUIRED');
        id = matches[0].id;
        previousUsed.add(id);
      }
    } else
      id =
        mapping?.[index]?.id ??
        `briefing-${original.date}-${String(index + 1).padStart(2, '0')}`;
    used.add(id);
    const sources = [];
    const sourceBody = convert(raw.body.replace(/image_group[\s\S]*?/g, ''));
    void marked.walkTokens(marked.lexer(sourceBody), (token) => {
      if (token.type === 'link' && !sources.some((s) => s.url === token.href))
        sources.push({
          title: plain(token.text),
          url: token.href,
          type: 'report',
          publishedAt: null,
        });
    });
    // Explicit, reproducible title mappings. Absence of metadata is valid.
    const tags = [];
    if (/AI|Agent|模型|GPT|Claude|Gemini|人工智能|推理/i.test(title))
      tags.push('AI 与大模型');
    if (/游戏|Gaming|Unity|Unreal|DLSS/i.test(title)) tags.push('游戏与交互');
    if (/芯片|算力|GPU|NVIDIA|AMD|Intel|Broadcom|CUDA/i.test(title))
      tags.push('科技行业');
    if (/论文|研究|数学|科学|证明/i.test(title)) tags.push('机器学习');
    if (/Coding|Codex|开发|MCP|Skills|Cursor|Harness/i.test(title))
      tags.push('开发工具');
    const entities = [
      'OpenAI',
      'NVIDIA',
      'Anthropic',
      'Google',
      'Meta',
      'Microsoft',
      'ByteDance',
      'Cloudflare',
      'Cursor',
      'Unity',
      'Epic Games',
      'DeepSeek',
      'Tencent',
      'Intel',
      'AMD',
      'Broadcom',
      'JFrog',
      'Hugging Face',
    ].filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(title));
    return {
      id,
      title,
      summary: excerpt(convertChat(raw.body)),
      summaryKind: 'excerpt',
      body,
      eventDate: null,
      tags,
      entities,
      sources,
      verificationStatus: 'pending',
      verificationNote:
        '尚未独立核验；以下为原有链接，机构首页不作为具体报道证据。',
      imageStatus: body.includes('原配图暂未恢复')
        ? 'unresolved'
        : /!\[/.test(body)
          ? 'preserved'
          : 'none',
      citationStatus: body.includes('原引用链接暂未恢复')
        ? 'unresolved'
        : 'preserved',
    };
  });
  if (previous)
    fail(previousUsed.size === previous.stories.length, 'STORY_MAPPING_REQUIRED');
  const item = {
    id: `briefing-${original.date}`,
    briefingDate: original.date,
    title: convert(original.title),
    summary: excerpt(convertChat(original.intro)),
    summaryKind: 'excerpt',
    intro: convert(original.intro),
    outro: convert(original.outro),
    status: 'published',
    sample: false,
    sourcePublishedAt:
      message.sourcePublishedAt ?? previous?.sourcePublishedAt ?? null,
    sourceUpdatedAt: message.sourceUpdatedAt ?? null,
    archivedAt: now,
    revision: previous?.revision ?? 1,
    formatRevision: previous?.formatRevision ?? 1,
    corrections: previous?.corrections ?? [],
    stories,
  };
  return validateBriefing(item);
}
export function serializeBriefing(item) {
  const { stories, ...meta } = item;
  return `---\n${JSON.stringify({ ...meta, stories: stories.map(({ body: _body, ...story }) => story) }, null, 2)}\n---\n\n${stories.map((s) => `## ${s.id}\n\n${s.body}`).join('\n\n')}\n`;
}
