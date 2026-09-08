import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { splitOriginal, convertChat } from './archive-convert.mjs';
import {
  imageGroupKey,
  messageResources,
  resourceHash,
} from './archive-resources.mjs';
import { atomicWrite } from './archive-store.mjs';
import { readSourceExport } from './archive-input.mjs';

const fail = (ok, code) => {
  if (!ok) throw new Error(code);
};
const plain = (value) => {
  const tokens = marked.lexer(value);
  let text = '';
  void marked.walkTokens(tokens, (token) => {
    if (['text', 'codespan', 'escape'].includes(token.type) && !token.tokens)
      text += token.text;
  });
  return text.replace(/\s/g, '').normalize('NFKC');
};
export function importBrowserResources(input, capture) {
  fail(
    Array.isArray(capture.messages) && Array.isArray(capture.galleries),
    'INVALID_BROWSER_CAPTURE',
  );
  const messageIds = new Set(
    capture.messages.map((message) => message.messageId),
  );
  fail(
    messageIds.size === capture.messages.length,
    'DUPLICATE_BROWSER_MESSAGE',
  );
  const galleryIds = new Set();
  for (const gallery of capture.galleries) {
    const message = capture.messages.find(
      (message) => message.messageId === gallery.messageId,
    );
    fail(
      message &&
        Number.isSafeInteger(gallery.story) &&
        gallery.story > 0 &&
        gallery.story <= message.stories.length,
      'BROWSER_GALLERY_NOT_IN_MESSAGE',
    );
    const key = `${gallery.messageId}:${gallery.story}`;
    fail(!galleryIds.has(key), 'DUPLICATE_BROWSER_GALLERY');
    galleryIds.add(key);
  }
  const result = structuredClone(input);
  const stats = {
    issues: 0,
    stories: 0,
    images: 0,
    citationGroups: 0,
    unresolvedCitations: 0,
    unresolvedImageGroups: 0,
  };
  for (const visible of capture.messages) {
    const message = result.messages.find(
      (m) => m.messageId === visible.messageId,
    );
    fail(message, 'BROWSER_MESSAGE_NOT_IN_EXPORT');
    const original = splitOriginal(message.text);
    fail(
      plain(convertChat(original.title)) === plain(visible.title),
      'BROWSER_TITLE_MISMATCH',
    );
    fail(
      visible.stories.length === original.stories.length,
      'BROWSER_STORY_COUNT_MISMATCH',
    );
    const resources = messageResources(message);
    const observations = [];
    for (let i = 0; i < original.stories.length; i++) {
      const raw = original.stories[i],
        story = visible.stories[i];
      fail(
        plain(convertChat(raw.title)) ===
          plain(story.title.replace(/^\d+[.、)）]\s*/, '')),
        'BROWSER_STORY_TITLE_MISMATCH',
      );
      const refs = [...raw.body.matchAll(/cite([\s\S]*?)/g)];
      fail(
        refs.length === story.citations.length,
        'BROWSER_CITATION_COUNT_MISMATCH',
      );
      refs.forEach((ref, index) => {
        const observed = story.citations[index];
        // Confirm the surrounding paragraph, not merely its position in a list.
        const paragraph = raw.body
          .slice(0, ref.index)
          .split(/\n\s*\n/)
          .at(-1);
        const prefix = plain(
          convertChat(paragraph.replace(/cite[\s\S]*?/g, '')),
        );
        fail(
          prefix.length >= 8 && plain(observed.context).includes(prefix),
          'BROWSER_CITATION_CONTEXT_MISMATCH',
        );
        observations.push({
          refs: ref[1],
          source: {
            title: observed.title.replace(/\s*\+\d+$/, '').trim(),
            url: observed.url,
          },
        });
      });
      const groups = [...raw.body.matchAll(/image_group([\s\S]*?)/g)];
      const galleries = capture.galleries.filter(
        (g) => g.messageId === message.messageId && g.story === i + 1,
      );
      if (groups.length && !galleries.length && !story.images.length) {
        stats.unresolvedImageGroups += groups.length;
        stats.stories++;
        continue;
      }
      fail(
        groups.length === galleries.length,
        'BROWSER_IMAGE_GROUP_COUNT_MISMATCH',
      );
      for (let j = 0; j < groups.length; j++) {
        fail(galleries[j].images.length > 0, 'BROWSER_IMAGE_GROUP_EMPTY');
        resources.imageGroups[imageGroupKey(groups[j][1])] =
          galleries[j].images;
        stats.images += galleries[j].images.length;
      }
      stats.stories++;
    }
    // A single-reference marker gives an exact id-to-URL mapping. Reuse only
    // those proven mappings when the same id appears in a combined citation.
    for (const { refs, source } of observations) {
      if (refs.includes('')) continue;
      fail(
        !resources.citations[refs] ||
          resources.citations[refs].url === source.url,
        'BROWSER_CITATION_CONFLICT',
      );
      resources.citations[refs] ??= source;
    }
    for (const { refs, source } of observations) {
      const ids = refs.split('');
      const known = ids.flatMap((id) =>
        resources.citations[id] ? [resources.citations[id]] : [],
      );
      const primaryKnown = known.some((link) => link.url === source.url);
      const links = [
        ...new Map([source, ...known].map((link) => [link.url, link])).values(),
      ];
      const group = {
        links,
        missing: ids.length - known.length - (primaryKnown ? 0 : 1),
      };
      fail(group.missing >= 0, 'BROWSER_CITATION_CONFLICT');
      const key = resourceHash(refs);
      fail(
        !resources.citationGroups[key] ||
          resourceHash(resources.citationGroups[key]) === resourceHash(group),
        'BROWSER_CITATION_CONFLICT',
      );
      resources.citationGroups[key] = group;
      stats.citationGroups++;
      stats.unresolvedCitations += group.missing;
    }
    Object.assign(message, messageResources(resources));
    stats.issues++;
  }
  return { input: result, stats };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [sourceFile, captureFile, output = 'incoming/resource-export.json'] =
      process.argv.slice(2);
    if (!sourceFile || !captureFile)
      throw new Error(
        'Usage: archive:resources <source-export.json> <browser-resources.json> [output.json]',
      );
    const result = importBrowserResources(
      await readSourceExport(sourceFile),
      JSON.parse(await readFile(captureFile, 'utf8')),
    );
    await atomicWrite(output, JSON.stringify(result.input, null, 2));
    console.log(JSON.stringify(result.stats));
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
