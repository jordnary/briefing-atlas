import { createHash } from 'node:crypto';
import { isWebUrl, isImageUrl } from '../lib/resource-urls.mjs';

const fail = (ok, code) => {
  if (!ok) throw new Error(code);
};
const label = (value) => typeof value === 'string' && value.trim().length > 0;
const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
      : value;
export const resourceHash = (resources) =>
  createHash('sha256')
    .update(JSON.stringify(sorted(resources)))
    .digest('hex');
export const imageGroupKey = (data) =>
  resourceHash(typeof data === 'string' ? JSON.parse(data) : data);
export const markdownLabel = (value) =>
  value.replace(/[\\`*_{}[\]<>#|]/g, '\\$&').replace(/\r?\n/g, ' ');
export const markdownUrl = (value) =>
  value.replace(
    /[()<>"']/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function link(value) {
  fail(
    value && label(value.title) && isWebUrl(value.url),
    'INVALID_RESOURCE_LINK',
  );
  return { title: value.title, url: value.url };
}
function image(value) {
  fail(
    value &&
      label(value.alt) &&
      isImageUrl(value.path ?? value.url) &&
      label(value.caption) &&
      isWebUrl(value.sourceUrl),
    'INVALID_RESOURCE_IMAGE',
  );
  return {
    ...(value.path ? { path: value.path } : { url: value.url }),
    alt: value.alt,
    caption: value.caption,
    sourceUrl: value.sourceUrl,
    ...(value.license ? { license: value.license } : {}),
  };
}
function mapValues(value, convert) {
  fail(
    value && typeof value === 'object' && !Array.isArray(value),
    'INVALID_RESOURCE_MAP',
  );
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, convert(entry)]),
  );
}
function list(value, convert) {
  fail(Array.isArray(value), 'INVALID_RESOURCE_LIST');
  return value.map(convert);
}

// Only explicit reference ids are resolved; a title or array position is not a citation id.
export function messageResources(message) {
  const citations = { ...message.citations };
  for (const annotation of message.annotations ?? []) {
    const source = annotation.url_citation ?? annotation;
    const ref = source.ref_id ?? source.refId ?? annotation.ref_id;
    if (ref && source.url) {
      const value = link(source);
      fail(
        !citations[ref] ||
          resourceHash(link(citations[ref])) === resourceHash(value),
        'CONFLICTING_CITATION',
      );
      citations[ref] = value;
    }
  }
  return {
    citations: mapValues(citations, link),
    citationGroups: mapValues(message.citationGroups ?? {}, (value) => {
      fail(
        value && Number.isSafeInteger(value.missing) && value.missing >= 0,
        'INVALID_CITATION_GROUP',
      );
      return { links: list(value.links, link), missing: value.missing };
    }),
    imageGroups: mapValues(message.imageGroups ?? {}, (value) =>
      list(value, image),
    ),
  };
}

export function mergeResources(previous, incoming) {
  return Object.fromEntries(
    Object.keys(incoming).map((key) => [
      key,
      { ...previous?.[key], ...incoming[key] },
    ]),
  );
}

export function imageMarkdown(value) {
  const caption = `${value.caption}${value.license ? ` · ${value.license}` : ''}`;
  return `![${markdownLabel(value.alt)}](${markdownUrl(value.path ?? value.url)})\n[${markdownLabel(caption)}](${markdownUrl(value.sourceUrl)})`;
}

export function resourceInventory(message) {
  const groups = [...message.text.matchAll(/image_group([\s\S]*?)/g)].map(
    (match) => ({
      key: imageGroupKey(match[1]),
      description: JSON.parse(match[1]),
    }),
  );
  const citations = [
    ...new Set(
      [...message.text.matchAll(/cite([\s\S]*?)/g)].flatMap((match) =>
        match[1].split(''),
      ),
    ),
  ];
  return { groups, citations };
}
