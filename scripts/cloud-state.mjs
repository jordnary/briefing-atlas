import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { readdir } from 'node:fs/promises';
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
  validatePrivateState,
} from './archive-store.mjs';
import { hash, serializeBriefing } from './archive-convert.mjs';
import { validatePublication } from './archive-publication.mjs';

const execute = promisify(execFile);
const statePath = 'atlas-checkpoint.json';
const sessionPath = (root) => path.join(privateDir(root), 'cloud-session.json');
const validHash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validCommit = (value) =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const versionOf = (issues) =>
  hash(
    JSON.stringify(
      issues
        .filter((item) => item.status === 'published')
        .sort((a, b) => b.briefingDate.localeCompare(a.briefingDate))
        .map((item) => ({
          date: item.briefingDate,
          revision: item.revision,
          formatRevision: item.formatRevision,
          hash: hash(serializeBriefing(item)),
        })),
    ),
  );
const checkpointId = ({ version, phase, binding, state, contents }) =>
  hash(JSON.stringify({ version, phase, binding, state, contents }));
const git = async (root, args) => {
  try {
    return (
      await execute('git', args, {
        cwd: root,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      })
    ).stdout;
  } catch {
    throw new Error('PUBLIC_COMMIT_UNAVAILABLE');
  }
};

export function validateCheckpoint(checkpoint) {
  const state = checkpoint?.state;
  if (
    ![1, 2].includes(checkpoint?.version) ||
    state?.version !== 1 ||
    !object(state.records) ||
    !Array.isArray(state.pending) ||
    !object(state.publication) ||
    !Array.isArray(checkpoint.contents)
  )
    throw new Error('CLOUD_CHECKPOINT_INVALID');
  validatePrivateState(state);
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
    if (issue.briefingDate !== entry.date || issue.sample)
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
  if (entries.size !== Object.keys(state.records).length)
    throw new Error('CLOUD_CHECKPOINT_STATE_DIVERGED');
  if (checkpoint.version === 2) {
    const binding = checkpoint.binding;
    if (
      !object(binding) ||
      !validCommit(binding.commit) ||
      !validCommit(binding.sourceCommit) ||
      !validHash(binding.archiveVersion) ||
      binding.archiveVersion !== versionOf(parsed) ||
      state.sourceCommit !== binding.sourceCommit ||
      !isDeepStrictEqual(state.checkpointBinding, binding) ||
      !['prepared', 'committed'].includes(checkpoint.phase) ||
      checkpoint.checkpointId !== checkpointId(checkpoint)
    )
      throw new Error('CLOUD_CHECKPOINT_BINDING_INVALID');
    if (!isDeepStrictEqual(state.publication.binding, binding))
      throw new Error('CLOUD_CHECKPOINT_BINDING_INVALID');
    validatePublication(state.publication, binding);
  }
  return parsed;
}

async function assertCommittedContents(root, checkpoint, commit) {
  const expected = checkpoint.contents
    .map((entry) =>
      path
        .relative(root, contentFile(root, entry.date))
        .split(path.sep)
        .join('/'),
    )
    .sort();
  const files = (
    await git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      commit,
      '--',
      'content/briefings',
    ])
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
  if (!isDeepStrictEqual(files, expected))
    throw new Error('PRIVATE_STATE_COMMIT_CONTENT_MISMATCH');
  for (const entry of checkpoint.contents) {
    const relative = path
      .relative(root, contentFile(root, entry.date))
      .split(path.sep)
      .join('/');
    if (hash(await git(root, ['show', `${commit}:${relative}`])) !== entry.hash)
      throw new Error('PRIVATE_STATE_COMMIT_CONTENT_MISMATCH');
  }
  if (
    (
      await git(root, ['status', '--porcelain', '--', 'content/briefings'])
    ).trim()
  )
    throw new Error('PRIVATE_STATE_PUBLIC_CHECKOUT_DIRTY');
}
function bindState(state, binding) {
  const next = structuredClone(state);
  if (!isDeepStrictEqual(next.checkpointBinding, binding)) {
    if (next.publication.deploymentIntent)
      throw new Error('PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED');
    if (next.publication.binding || next.publication.deployment)
      next.publicationHistory = [
        ...(next.publicationHistory ?? []),
        next.publication,
      ];
    const samePublic =
      next.checkpointBinding?.commit === binding.commit &&
      next.checkpointBinding?.archiveVersion === binding.archiveVersion;
    next.publication = samePublic
      ? { ...next.publication, binding }
      : { stage: 'archived', binding };
  }
  next.checkpointBinding = binding;
  delete next.checkpointPrepared;
  delete next.reconciliation;
  return next;
}
export async function makeCheckpoint(
  root = '.',
  { phase = 'committed', state: suppliedState } = {},
) {
  if (
    !suppliedState &&
    !(await readMaybe(path.join(privateDir(root), 'state.json'))) &&
    !(await readMaybe(path.join(privateDir(root), 'checkpoint.json')))
  )
    throw new Error('PRIVATE_STATE_RECOVERY_REQUIRED');
  const state = suppliedState ?? (await readState(root));
  if (!Object.keys(state.records).length || !state.source)
    throw new Error('PRIVATE_STATE_RECOVERY_REQUIRED');
  if (!validCommit(state.sourceCommit))
    throw new Error('PRIVATE_STATE_SOURCE_COMMIT_REQUIRED');
  const issues = await loadBriefings(path.join(root, 'content/briefings'));
  if (issues.some((issue) => issue.sample))
    throw new Error('SAMPLE_CONTENT_IS_NOT_PUBLISHABLE');
  const contents = [];
  for (const issue of issues) {
    const text = await readMaybe(contentFile(root, issue.briefingDate));
    contents.push({
      date: issue.briefingDate,
      text,
      hash: hash(text),
      baseline: hash(text),
    });
  }
  const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const binding = {
    commit,
    archiveVersion: versionOf(issues),
    sourceCommit: state.sourceCommit,
  };
  const checkpoint = {
    version: 2,
    phase,
    binding,
    state: bindState(state, binding),
    contents,
  };
  checkpoint.checkpointId = checkpointId(checkpoint);
  validateCheckpoint(checkpoint);
  await assertCommittedContents(root, checkpoint, commit);
  return checkpoint;
}
async function currentContents(root) {
  const dir = path.join(root, 'content/briefings');
  const entries = new Map();
  let files;
  try {
    files = await readdir(dir, { recursive: true });
  } catch (error) {
    if (error.code === 'ENOENT') return entries;
    throw error;
  }
  for (const relative of files
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))) {
    const date = path.basename(relative, '.md');
    if (
      !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
      relative.split(path.sep).join('/') !==
        `${date.slice(0, 4)}/${date.slice(5, 7)}/${date}.md`
    )
      throw new Error('CLOUD_CHECKPOINT_CONTENT_CONFLICT');
    entries.set(date, await readMaybe(path.join(dir, relative)));
  }
  return entries;
}
export async function diagnoseCheckpointConflicts(root, checkpoint) {
  validateCheckpoint(checkpoint);
  const current = await currentContents(root);
  const contents = new Map(
    checkpoint.contents.map((entry) => [entry.date, entry]),
  );
  const conflicts = [];
  for (const date of [...new Set([...current.keys(), ...contents.keys()])].sort(
    (a, b) => a.localeCompare(b),
  )) {
    const entry = contents.get(date);
    const currentHash = current.has(date) ? hash(current.get(date)) : null;
    if (currentHash !== (entry?.hash ?? null))
      conflicts.push({
        date,
        currentHash,
        checkpointHash: entry?.hash ?? null,
        baselineHash: entry?.baseline ?? null,
        historyHashes: (checkpoint.state.records[date]?.history ?? []).map(
          (item) => item.archiveHash,
        ),
      });
  }
  return conflicts;
}
export async function restoreCheckpoint(
  root,
  checkpoint,
  { reconcile = false, dryRun = false } = {},
) {
  validateCheckpoint(checkpoint);
  const conflicts = await diagnoseCheckpointConflicts(root, checkpoint);
  if (conflicts.length) {
    const error = new Error('CLOUD_CHECKPOINT_CONTENT_CONFLICT');
    error.conflicts = conflicts;
    throw error;
  }
  if (checkpoint.version !== 2) {
    if (!reconcile) throw new Error('PRIVATE_STATE_RECONCILE_REQUIRED');
    // Legacy migration transfers intact private evidence only. A pinned source
    // sync must supply sourceCommit before a bound checkpoint can be saved.
    const legacyState = {
      ...checkpoint.state,
      publication: { ...checkpoint.state.publication },
      reconciliation: {
        status: 'required',
        code: 'PRIVATE_STATE_BINDING_REQUIRED',
      },
    };
    delete legacyState.checkpointBinding;
    delete legacyState.sourceCommit;
    delete legacyState.exportSha256;
    delete legacyState.publication.binding;
    if (!dryRun) await saveState(root, legacyState);
    return legacyState;
  }
  const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  if (commit !== checkpoint.binding.commit) {
    if (!reconcile) throw new Error('PRIVATE_STATE_RECONCILE_REQUIRED');
    if (checkpoint.phase === 'prepared')
      throw new Error('PRIVATE_STATE_COMMIT_NOT_READY');
    try {
      await git(root, [
        'merge-base',
        '--is-ancestor',
        checkpoint.binding.commit,
        commit,
      ]);
    } catch {
      throw new Error('PRIVATE_STATE_COMMIT_DIVERGED');
    }
  }
  await assertCommittedContents(root, checkpoint, commit);
  const state = bindState(checkpoint.state, { ...checkpoint.binding, commit });
  if (!dryRun) await saveState(root, state);
  return state;
}
function assertCheckpointTransition(previous, next, reconcile) {
  if (previous.version !== 2) {
    if (next.phase !== 'prepared')
      throw new Error('PRIVATE_STATE_RECONCILE_REQUIRED');
    return;
  }
  const same = isDeepStrictEqual(previous.binding, next.binding);
  const before = previous.state.publication,
    after = next.state.publication;
  if (!same) {
    if (before.deploymentIntent)
      throw new Error('PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED');
    if (previous.phase === 'prepared')
      throw new Error('PRIVATE_STATE_COMMIT_NOT_READY');
    if (next.phase !== 'prepared' && !reconcile)
      throw new Error('PRIVATE_STATE_RECONCILE_REQUIRED');
  }
  if (
    previous.binding.commit === next.binding.commit &&
    previous.binding.archiveVersion === next.binding.archiveVersion
  ) {
    for (const field of [
      'builtVersion',
      'deployedVersion',
      'verifiedVersion',
      'deployment',
    ])
      if (
        before[field] !== undefined &&
        !isDeepStrictEqual(before[field], after[field])
      )
        throw new Error('PUBLICATION_STATE_REGRESSION');
    if (
      before.deploymentIntent &&
      !after.deployedVersion &&
      !isDeepStrictEqual(before.deploymentIntent, after.deploymentIntent)
    )
      throw new Error('PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED');
  }
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
    try {
      return await response.json();
    } catch {
      throw new Error('PRIVATE_STATE_CORRUPT');
    }
  };
  const checkPrivate = async () => {
    const meta = await request('');
    if (
      !object(meta) ||
      typeof meta.private !== 'boolean' ||
      typeof meta.default_branch !== 'string'
    )
      throw new Error('PRIVATE_STATE_CORRUPT');
    if (!meta.private) throw new Error('STATE_REPOSITORY_MUST_BE_PRIVATE');
    if (meta.default_branch === branch)
      throw new Error('STATE_BRANCH_MUST_BE_SEPARATE');
    return meta;
  };
  const decode = async (file) => {
    if (!validCommit(file?.sha)) throw new Error('PRIVATE_STATE_CORRUPT');
    const blob =
      file.encoding === 'base64' && file.content
        ? file
        : await request(`/git/blobs/${file.sha}`);
    if (
      blob?.encoding !== 'base64' ||
      typeof blob.content !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(blob.content.replace(/\s/g, ''))
    )
      throw new Error('PRIVATE_STATE_CORRUPT');
    const content = Buffer.from(blob.content, 'base64').toString('utf8');
    let checkpoint;
    try {
      checkpoint = JSON.parse(content);
      validateCheckpoint(checkpoint);
    } catch {
      throw new Error('PRIVATE_STATE_CORRUPT');
    }
    return { checkpoint, sha: file.sha, digest: hash(content) };
  };
  const resultSession = (result, text) => {
    if (!validCommit(result?.content?.sha))
      throw new Error('PRIVATE_STATE_CORRUPT');
    return { sha: result.content.sha, digest: hash(text) };
  };
  return {
    async restore() {
      await checkPrivate();
      const ref = await request(`/git/ref/heads/${branch}`, {
        allowMissing: true,
      });
      if (!ref) throw new Error('PRIVATE_STATE_BRANCH_UNAVAILABLE');
      if (!validCommit(ref.object?.sha))
        throw new Error('PRIVATE_STATE_CORRUPT');
      const file = await request(`/contents/${statePath}?ref=${branch}`, {
        allowMissing: true,
      });
      return file ? decode(file) : null;
    },
    async save(checkpoint, session, { reconcile = false } = {}) {
      await checkPrivate();
      if (!session || !validCommit(session.sha) || !validHash(session.digest))
        throw new Error('PRIVATE_STATE_SESSION_REQUIRED');
      validateCheckpoint(checkpoint);
      if (checkpoint.version !== 2)
        throw new Error('PRIVATE_STATE_RECONCILE_REQUIRED');
      const current = await request(`/contents/${statePath}?ref=${branch}`, {
        allowMissing: true,
      });
      if (current?.sha !== session.sha)
        throw new Error('PRIVATE_STATE_WRITE_CONFLICT');
      const restored = await decode(current);
      if (restored.digest !== session.digest)
        throw new Error('PRIVATE_STATE_WRITE_CONFLICT');
      assertCheckpointTransition(restored.checkpoint, checkpoint, reconcile);
      const text = JSON.stringify(checkpoint);
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
      return resultSession(result, text);
    },
    async bootstrap(checkpoint) {
      const meta = await checkPrivate();
      validateCheckpoint(checkpoint);
      if (checkpoint.version !== 2)
        throw new Error('PRIVATE_STATE_RECONCILE_REQUIRED');
      const ref = await request(`/git/ref/heads/${branch}`, {
        allowMissing: true,
      });
      if (ref && !validCommit(ref.object?.sha))
        throw new Error('PRIVATE_STATE_CORRUPT');
      if (!ref) {
        const head = await request(
          `/git/ref/heads/${encodeURIComponent(meta.default_branch)}`,
        );
        if (!validCommit(head?.object?.sha))
          throw new Error('PRIVATE_STATE_CORRUPT');
        await request('/git/refs', {
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
      return resultSession(
        await request(`/contents/${statePath}`, {
          method: 'PUT',
          body: {
            branch,
            message: 'chore: initialize private archive checkpoint',
            content: Buffer.from(text).toString('base64'),
          },
        }),
        text,
      );
    },
  };
}

export async function cloudState(
  operation,
  { root = '.', env = process.env, fetcher, reconcileAncestor = false } = {},
) {
  const client = stateClient({
    repo: env.BRIEFING_STATE_REPO || env.BRIEFING_SOURCE_REPO,
    branch: env.BRIEFING_STATE_BRANCH || 'atlas-sync-state',
    token: env.BRIEFING_STATE_TOKEN,
    fetcher,
  });
  return withArchiveLock(root, async () => {
    if (
      env.PUBLIC_COMMIT &&
      (await git(root, ['rev-parse', 'HEAD'])).trim() !== env.PUBLIC_COMMIT
    )
      throw new Error('PRIVATE_STATE_PUBLIC_COMMIT_MISMATCH');
    if (operation === 'restore' || operation === 'reconcile') {
      const result = await client.restore();
      if (!result) throw new Error('PRIVATE_STATE_NOT_INITIALIZED');
      const { checkpoint, ...restoredSession } = result;
      let session = restoredSession;
      if (
        env.SOURCE_COMMIT &&
        checkpoint.binding?.sourceCommit !== env.SOURCE_COMMIT
      )
        throw new Error('PRIVATE_STATE_SOURCE_COMMIT_MISMATCH');
      // Workflow entry points may advance a committed v2 checkpoint across
      // code-only descendants. Legacy migration remains an explicit operation.
      const advanceAncestor =
        operation === 'restore' &&
        reconcileAncestor &&
        checkpoint.version === 2 &&
        checkpoint.phase === 'committed' &&
        checkpoint.binding.commit !==
          (await git(root, ['rev-parse', 'HEAD'])).trim();
      const restoredState = await restoreCheckpoint(root, checkpoint, {
        reconcile: operation === 'reconcile' || advanceAncestor,
        dryRun: true,
      });
      if (
        (operation === 'reconcile' && checkpoint.version === 2) ||
        advanceAncestor
      ) {
        const reconciled = await makeCheckpoint(root, { state: restoredState });
        session = await client.save(reconciled, session, { reconcile: true });
      }
      await saveState(root, restoredState);
      await atomicWrite(sessionPath(root), JSON.stringify(session));
    } else if (['save', 'bootstrap', 'prepare'].includes(operation)) {
      await recoverBatch(root);
      const checkpoint = await makeCheckpoint(root, {
        phase: operation === 'prepare' ? 'prepared' : 'committed',
      });
      if (
        env.SOURCE_COMMIT &&
        checkpoint.binding.sourceCommit !== env.SOURCE_COMMIT
      )
        throw new Error('PRIVATE_STATE_SOURCE_COMMIT_MISMATCH');
      let previous;
      try {
        previous = JSON.parse((await readMaybe(sessionPath(root))) || 'null');
      } catch {
        throw new Error('PRIVATE_STATE_SESSION_CORRUPT');
      }
      const session =
        operation === 'bootstrap'
          ? await client.bootstrap(checkpoint)
          : await client.save(checkpoint, previous);
      await saveState(root, checkpoint.state);
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
    await cloudState(operation, {
      reconcileAncestor: process.argv.includes('--reconcile-ancestor'),
    });
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
