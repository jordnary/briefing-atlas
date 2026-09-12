import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  loadBriefings,
  parseBriefing,
  validateCollection,
} from './content.mjs';
import {
  atomicWrite,
  contentFile,
  privateDir,
  readMaybe,
  readState,
  withArchiveLock,
  recoverBatch,
  saveState,
} from './archive-store.mjs';
import { hash } from './archive-convert.mjs';

const execute = promisify(execFile);
const statePath = 'atlas-checkpoint.json';
const sessionPath = (root) => path.join(privateDir(root), 'cloud-session.json');
const validHash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function validateCheckpoint(checkpoint) {
  const state = checkpoint?.state;
  if (
    checkpoint?.version !== 1 ||
    state?.version !== 1 ||
    !object(state.records) ||
    !Array.isArray(state.pending) ||
    !object(state.publication) ||
    !Array.isArray(checkpoint.contents)
  )
    throw new Error('CLOUD_CHECKPOINT_INVALID');
  if (
    checkpoint.pendingCommit !== undefined &&
    checkpoint.pendingCommit !== null &&
    !/^[0-9a-f]{40}$/.test(checkpoint.pendingCommit)
  )
    throw new Error('CLOUD_CHECKPOINT_INVALID');
  const parsed = [],
    entries = new Map();
  for (const entry of checkpoint.contents) {
    if (
      !entry ||
      typeof entry.text !== 'string' ||
      !validHash(entry.hash) ||
      hash(entry.text) !== entry.hash ||
      !(entry.baseline === null || validHash(entry.baseline)) ||
      entries.has(entry.date)
    )
      throw new Error('CLOUD_CHECKPOINT_INVALID');
    let issue;
    try {
      issue = parseBriefing(entry.text);
    } catch {
      throw new Error('CLOUD_CHECKPOINT_INVALID');
    }
    if (issue.briefingDate !== entry.date)
      throw new Error('CLOUD_CHECKPOINT_INVALID');
    entries.set(entry.date, entry);
    parsed.push(issue);
  }
  try {
    validateCollection(parsed);
  } catch {
    throw new Error('CLOUD_CHECKPOINT_INVALID');
  }
  for (const [date, record] of Object.entries(state.records)) {
    if (
      !object(record) ||
      !validHash(record.archiveHash) ||
      entries.get(date)?.hash !== record.archiveHash
    )
      throw new Error('CLOUD_CHECKPOINT_STATE_DIVERGED');
    if (
      !validHash(record.sourceHash) ||
      !validHash(record.activeSource) ||
      !object(record.sources) ||
      record.sources[record.activeSource] !== record.sourceHash ||
      Object.entries(record.sources).some(
        ([key, value]) => !validHash(key) || !validHash(value),
      ) ||
      !Array.isArray(record.history) ||
      record.history.some(
        (entry) => !object(entry) || !validHash(entry.archiveHash),
      )
    )
      throw new Error('CLOUD_CHECKPOINT_INVALID');
  }
  if (
    Object.keys(state.records).length &&
    (typeof state.source !== 'string' || !state.source)
  )
    throw new Error('CLOUD_CHECKPOINT_INVALID');
  return parsed;
}

export async function makeCheckpoint(root = '.', { gitRead } = {}) {
  // The public archive cannot recreate private source receipts. Bootstrap must
  // transfer the existing private state, including its historical mappings.
  if (
    !(await readMaybe(path.join(privateDir(root), 'state.json'))) &&
    !(await readMaybe(path.join(privateDir(root), 'checkpoint.json')))
  )
    throw new Error('PRIVATE_STATE_RECOVERY_REQUIRED');
  const state = await readState(root);
  if (
    !Object.keys(state.records).length ||
    typeof state.source !== 'string' ||
    !state.source
  )
    throw new Error('PRIVATE_STATE_RECOVERY_REQUIRED');
  const issues = await loadBriefings(path.join(root, 'content/briefings'));
  const contents = [];
  for (const issue of issues) {
    const file = contentFile(root, issue.briefingDate);
    const text = await readMaybe(file);
    const relative = path.relative(root, file).split(path.sep).join('/');
    let baseline = null;
    try {
      baseline = gitRead
        ? await gitRead(relative)
        : (
            await execute('git', ['show', `HEAD:${relative}`], {
              cwd: root,
              maxBuffer: 10 * 1024 * 1024,
            })
          ).stdout;
    } catch {
      /* A new issue is absent from the checked-in baseline. */
    }
    contents.push({
      date: issue.briefingDate,
      text,
      hash: hash(text),
      baseline: baseline === null ? null : hash(baseline),
    });
  }
  const checkpoint = { version: 1, state, contents };
  validateCheckpoint(checkpoint);
  return checkpoint;
}

export async function diagnoseCheckpointConflicts(root, checkpoint) {
  validateCheckpoint(checkpoint);
  const conflicts = [];
  for (const entry of checkpoint.contents) {
    const current = await readMaybe(contentFile(root, entry.date));
    const currentHash = current === null ? null : hash(current);
    const history = checkpoint.state.records[entry.date]?.history ?? [];
    if (
      currentHash !== entry.hash &&
      currentHash !== entry.baseline &&
      !history.some((record) => record.archiveHash === currentHash)
    ) {
      conflicts.push({
        date: entry.date,
        currentHash,
        checkpointHash: entry.hash,
        baselineHash: entry.baseline,
        historyHashes: history.map((record) => record.archiveHash),
      });
    }
  }
  return conflicts;
}

export async function restoreCheckpoint(root, checkpoint) {
  const parsed = validateCheckpoint(checkpoint);
  const conflicts = await diagnoseCheckpointConflicts(root, checkpoint);
  if (conflicts.length) {
    const error = new Error('CLOUD_CHECKPOINT_CONTENT_CONFLICT');
    // Hash-only diagnostics are safe to surface in workflow summaries. Never
    // include source text, URLs, or other private receipt data here.
    error.conflicts = conflicts;
    throw error;
  }
  const dates = new Set(parsed.map((issue) => issue.briefingDate));
  const existing = await loadBriefings(path.join(root, 'content/briefings'));
  validateCollection([
    ...parsed,
    ...existing.filter((issue) => !dates.has(issue.briefingDate)),
  ]);
  // Validate the entire snapshot before writing any file. The remote snapshot is
  // the recovery journal if a runner disappears during these atomic writes.
  for (const entry of checkpoint.contents) {
    const file = contentFile(root, entry.date);
    if ((await readMaybe(file)) !== entry.text)
      await atomicWrite(file, entry.text);
  }
  await saveState(root, checkpoint.state);
}

export function stateClient({
  repo,
  branch = 'atlas-sync-state',
  token,
  fetcher = fetch,
} = {}) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') ||
    !/^[A-Za-z0-9_-]+$/.test(branch) ||
    !token
  )
    throw new Error('PRIVATE_STATE_CONFIGURATION_REQUIRED');
  const request = async (endpoint, options = {}) => {
    let response;
    try {
      response = await fetcher(
        `https://api.github.com/repos/${repo}${endpoint}`,
        {
          method: options.method || 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        },
      );
    } catch {
      throw new Error('PRIVATE_STATE_NETWORK_ERROR');
    }
    if (options.allowMissing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        [409, 422].includes(response.status)
          ? 'PRIVATE_STATE_WRITE_CONFLICT'
          : 'PRIVATE_STATE_ACCESS_FAILED',
      );
    return response.json();
  };
  const checkPrivate = async () => {
    const meta = await request('');
    if (meta.private !== true)
      throw new Error('STATE_REPOSITORY_MUST_BE_PRIVATE');
    if (meta.default_branch === branch)
      throw new Error('STATE_BRANCH_MUST_BE_SEPARATE');
    return meta;
  };
  return {
    async restore() {
      await checkPrivate();
      const file = await request(`/contents/${statePath}?ref=${branch}`, {
        allowMissing: true,
      });
      if (!file) return null;
      let content;
      if (file.encoding === 'base64' && file.content)
        content = Buffer.from(file.content, 'base64').toString('utf8');
      else {
        const blob = await request(`/git/blobs/${file.sha}`);
        content = Buffer.from(blob.content, 'base64').toString('utf8');
      }
      return {
        checkpoint: JSON.parse(content),
        sha: file.sha,
        digest: hash(content),
      };
    },
    async save(checkpoint, session) {
      await checkPrivate();
      const text = JSON.stringify(checkpoint);
      // A normal save must follow restore (or bootstrap), so a missing session
      // is an explicit recovery condition instead of an opaque TypeError.
      if (!session || typeof session.sha !== 'string' || !session.sha)
        throw new Error('PRIVATE_STATE_SESSION_REQUIRED');
      const current = await request(`/contents/${statePath}?ref=${branch}`, {
        allowMissing: true,
      });
      if (current?.sha !== session.sha)
        throw new Error('PRIVATE_STATE_WRITE_CONFLICT');
      if (hash(text) === session.digest) return session;
      const result = await request(`/contents/${statePath}`, {
        method: 'PUT',
        body: {
          branch,
          message: 'chore: save private archive checkpoint',
          sha: session.sha,
          content: Buffer.from(text).toString('base64'),
        },
      });
      return { sha: result.content.sha, digest: hash(text) };
    },
    async bootstrap(checkpoint) {
      const meta = await checkPrivate();
      let ref = await request(`/git/ref/heads/${branch}`, {
        allowMissing: true,
      });
      if (!ref) {
        const head = await request(
          `/git/ref/heads/${encodeURIComponent(meta.default_branch)}`,
        );
        ref = await request('/git/refs', {
          method: 'POST',
          body: { ref: `refs/heads/${branch}`, sha: head.object.sha },
        });
      }
      if (
        await request(`/contents/${statePath}?ref=${branch}`, {
          allowMissing: true,
        })
      )
        throw new Error('PRIVATE_STATE_ALREADY_INITIALIZED');
      const text = JSON.stringify(checkpoint);
      const result = await request(`/contents/${statePath}`, {
        method: 'PUT',
        body: {
          branch,
          message: 'chore: initialize private archive checkpoint',
          content: Buffer.from(text).toString('base64'),
        },
      });
      return { sha: result.content.sha, digest: hash(text) };
    },
  };
}

export async function cloudState(
  operation,
  { root = '.', env = process.env, fetcher } = {},
) {
  const client = stateClient({
    repo: env.BRIEFING_STATE_REPO || env.BRIEFING_SOURCE_REPO,
    branch: env.BRIEFING_STATE_BRANCH || 'atlas-sync-state',
    token: env.BRIEFING_STATE_TOKEN,
    fetcher,
  });
  return withArchiveLock(root, async () => {
    if (operation === 'restore') {
      const result = await client.restore();
      if (!result) throw new Error('PRIVATE_STATE_NOT_INITIALIZED');
      const { checkpoint, ...session } = result;
      // A prepared checkpoint is written only after validation and carries the
      // public commit it is waiting for.  If that commit is already checked
      // out, it is safe to recover the private receipts even when the previous
      // run died before the normal state save.
      await restoreCheckpoint(root, checkpoint);
      await atomicWrite(sessionPath(root), JSON.stringify(session));
    } else if (operation === 'save' || operation === 'bootstrap' || operation === 'prepare') {
      await recoverBatch(root);
      const checkpoint = await makeCheckpoint(root);
      // A prepared checkpoint is a recovery journal. It intentionally does
      // not represent a completed sync until a later normal save clears the
      // marker after the public commit and publication stages finish.
      if (operation === 'prepare') {
        checkpoint.state = {
          ...checkpoint.state,
          checkpointPrepared: true,
        };
      } else if (operation === 'save') {
        delete checkpoint.state.checkpointPrepared;
      }
      const session =
        operation === 'bootstrap'
          ? await client.bootstrap(checkpoint)
          : await client.save(
              checkpoint,
              JSON.parse((await readMaybe(sessionPath(root))) || 'null'),
            );
      await atomicWrite(sessionPath(root), JSON.stringify(session));
    } else throw new Error('INVALID_CLOUD_STATE_OPERATION');
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const operation = process.argv[2];
    await cloudState(operation);
    console.log('Private checkpoint operation completed.');
  } catch (error) {
    if (Array.isArray(error.conflicts) && error.conflicts.length) {
      for (const conflict of error.conflicts) {
        const history = conflict.historyHashes.length
          ? conflict.historyHashes.join(',')
          : '(none)';
        console.error(
          `Checkpoint conflict ${conflict.date}: current=${conflict.currentHash ?? '(missing)'} checkpoint=${conflict.checkpointHash} baseline=${conflict.baselineHash ?? '(none)'} history=${history}`,
        );
      }
    }
    console.error(
      /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'PRIVATE_CHECKPOINT_OPERATION_FAILED',
    );
    process.exitCode = 1;
  }
}

