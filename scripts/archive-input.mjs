import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './archive-store.mjs';
import { messageResources, resourceHash } from './archive-resources.mjs';

export async function readSourceExport(file) {
  if (file.endsWith('.md')) {
    const receipt = JSON.parse(await readFile(`${file}.receipt.json`, 'utf8'));
    const { source, ...message } = receipt;
    return {
      version: 1,
      source,
      complete: receipt.complete === true,
      messages: [{ ...message, text: await readFile(file, 'utf8') }],
    };
  }
  return JSON.parse(await readFile(file, 'utf8'));
}
export function exportThreadPages(pages) {
  let source = null;
  const messages = new Map();
  let complete = false;
  for (let page of pages) {
    if (page.content) {
      if (page.isError) throw new Error('SOURCE_READER_FAILED');
      page = JSON.parse(page.content.find((item) => item.type === 'text').text);
    }
    if (!page.thread?.id || !Array.isArray(page.turns))
      throw new Error('INVALID_THREAD_PAGE');
    if (source && source !== page.thread.id)
      throw new Error('MIXED_SOURCE_THREADS');
    source = page.thread.id;
    complete ||= page.page?.hasMore === false;
    for (const turn of page.turns)
      for (const item of turn.items ?? []) {
        if (
          item.type !== 'agentMessage' ||
          !/^#{1,2} .*AI\s*&\s*Tech\s*Briefing/m.test(item.text || '')
        )
          continue;
        if (turn.status !== 'completed' || turn.error || item.truncated)
          throw new Error('INCOMPLETE_THREAD_MESSAGE');
        const resources = messageResources(item);
        if (
          messages.has(item.id) &&
          (messages.get(item.id).text !== item.text ||
            resourceHash(messageResources(messages.get(item.id))) !==
              resourceHash(resources))
        )
          throw new Error('SOURCE_CHANGED_DURING_READ');
        messages.set(item.id, {
          messageId: item.id,
          role: 'assistant',
          status: 'completed',
          complete: true,
          text: item.text,
          sourcePublishedAt: null,
          ...resources,
        });
      }
  }
  if (!complete) throw new Error('READ_ALL_PAGES_BEFORE_EXPORT');
  return {
    version: 1,
    source,
    complete: true,
    messages: [...messages.values()],
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const files = process.argv.slice(2);
    if (!files.length)
      throw new Error(
        'Usage: archive:prepare <private-read-thread-page.json> [more-pages.json]',
      );
    const pages = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
    );
    const data = exportThreadPages(pages);
    await atomicWrite(
      'incoming/source-export.json',
      JSON.stringify(data, null, 2),
    );
    console.log(
      `Prepared ${data.messages.length} completed briefing messages.`,
    );
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
