import { mkdir, readFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { isDate } from '../lib/domain.mjs';
import { hash } from './archive-convert.mjs';

export const privateDir = (root) => path.join(root, 'work/archive-sync');
export async function readMaybe(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
export async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(`${file}.tmp`, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(`${file}.tmp`, file);
}
export async function withArchiveLock(root, action) {
  const dir = privateDir(root);
  await mkdir(dir, { recursive: true });
  let handle;
  try {
    handle = await open(path.join(dir, 'writer.lock'), 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('ARCHIVE_LOCKED');
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    await handle.sync();
    return await action();
  } finally {
    await handle.close();
    await unlink(path.join(dir, 'writer.lock'));
  }
}
export async function unlockAbandoned(root) {
  const file = path.join(privateDir(root), 'writer.lock');
  const value = await readMaybe(file);
  if (!value) return;
  const { pid } = JSON.parse(value);
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error('LOCK_REQUIRES_MANUAL_REVIEW');
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') {
      await unlink(file);
      return;
    }
    throw error;
  }
  throw new Error('WRITER_IS_STILL_RUNNING');
}
export function contentFile(root, date) {
  if (!isDate(date)) throw new Error('INVALID_ARCHIVE_DATE');
  return path.join(
    root,
    `content/briefings/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`,
  );
}
export async function readState(root) {
  const dir = privateDir(root);
  const data =
    (await readMaybe(path.join(dir, 'state.json'))) ??
    (await readMaybe(path.join(dir, 'checkpoint.json')));
  if (!data)
    return {
      version: 1,
      records: {},
      pending: [],
      missingDates: [],
      publication: { stage: 'unpublished' },
    };
  let state;
  try {
    state = JSON.parse(data);
  } catch {
    throw new Error('INVALID_PRIVATE_STATE');
  }
  const publication = state?.publication;
  const stages = new Set(['unpublished', 'archived', 'built', 'deployed', 'verified']);
  const failedStages = new Set(['build', 'deploy', 'verify']);
  if (
    state?.version !== 1 ||
    !state.records ||
    typeof state.records !== 'object' ||
    Array.isArray(state.records) ||
    !Array.isArray(state.pending) ||
    !publication ||
    typeof publication !== 'object' ||
    Array.isArray(publication) ||
    !stages.has(publication.stage) ||
    (publication.failedStage != null && !failedStages.has(publication.failedStage)) ||
    (publication.failureCode != null &&
      (typeof publication.failureCode !== 'string' ||
        !/^[A-Z][A-Z0-9_]+$/.test(publication.failureCode)))
  )
    throw new Error('INVALID_PRIVATE_STATE');
  return state;
}
export async function saveState(root, state) {
  // Validate before writing either copy. A malformed publication object must
  // never silently replace a recoverable checkpoint.
  const stages = new Set(['unpublished', 'archived', 'built', 'deployed', 'verified']);
  const failedStages = new Set(['build', 'deploy', 'verify']);
  const publication = state?.publication;
  if (
    state?.version !== 1 ||
    !state.records ||
    typeof state.records !== 'object' ||
    Array.isArray(state.records) ||
    !Array.isArray(state.pending) ||
    !publication ||
    typeof publication !== 'object' ||
    Array.isArray(publication) ||
    !stages.has(publication.stage) ||
    (publication.failedStage != null && !failedStages.has(publication.failedStage)) ||
    (publication.failureCode != null &&
      (typeof publication.failureCode !== 'string' ||
        !/^[A-Z][A-Z0-9_]+$/.test(publication.failureCode)))
  )
    throw new Error('INVALID_PRIVATE_STATE');
  const data = JSON.stringify(state, null, 2) + '\n';
  try {
    await atomicWrite(path.join(privateDir(root), 'checkpoint.json'), data);
    await atomicWrite(path.join(privateDir(root), 'state.json'), data);
  } catch (error) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code))
      throw new Error('PRIVATE_STATE_ACCESS_FAILED');
    throw error;
  }
}
export async function recoverBatch(root) {
  const file = path.join(privateDir(root), 'batch.json');
  const text = await readMaybe(file);
  if (!text) return false;
  const batch = JSON.parse(text);
  // Validate every target before touching any: protect edits made after an interruption.
  for (const entry of batch.entries) {
    const current = await readMaybe(contentFile(root, entry.date));
    const actual = current === null ? null : hash(current);
    if (actual !== entry.beforeHash && actual !== entry.afterHash)
      throw new Error('RECOVERY_CONTENT_CONFLICT');
    if (entry.afterHash !== (entry.source === null ? null : hash(entry.source)))
      throw new Error('CORRUPT_BATCH');
  }
  for (const entry of batch.entries) {
    const target = contentFile(root, entry.date);
    if (entry.source === null) {
      if ((await readMaybe(target)) !== null) await unlink(target);
    } else await atomicWrite(target, entry.source);
  }
  await saveState(root, batch.state);
  await unlink(file);
  return true;
}
export async function commitBatch(
  root,
  entries,
  state,
  { interruptAfter } = {},
) {
  const prepared = [];
  for (const entry of entries) {
    const old = await readMaybe(contentFile(root, entry.date));
    prepared.push({
      ...entry,
      beforeHash: old === null ? null : hash(old),
      afterHash: entry.source === null ? null : hash(entry.source),
    });
  }
  const file = path.join(privateDir(root), 'batch.json');
  await atomicWrite(
    file,
    JSON.stringify({ version: 1, entries: prepared, state }),
  );
  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i];
    if (entry.source === null) await unlink(contentFile(root, entry.date));
    else await atomicWrite(contentFile(root, entry.date), entry.source);
    if (interruptAfter === i + 1)
      throw new Error('SIMULATED_SAVE_INTERRUPTION');
  }
  await saveState(root, state);
  await unlink(file);
}
export async function assertArchiveReady(root) {
  if (await readMaybe(path.join(privateDir(root), 'batch.json')))
    throw new Error('RECOVERY_REQUIRED_BEFORE_BUILD');
}
