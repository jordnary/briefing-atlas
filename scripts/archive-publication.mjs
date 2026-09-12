import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  withArchiveLock,
  assertArchiveReady,
  readState,
  saveState,
} from './archive-store.mjs';
import { loadBriefings } from './content.mjs';
import { hash, serializeBriefing } from './archive-convert.mjs';
const byteHash = (value) => createHash('sha256').update(value).digest('hex');
const execute = promisify(execFile);
const commitPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^[a-f0-9]{64}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const ONLINE_VERIFY_MAX_ATTEMPTS = 3;
export const RETRYABLE_ONLINE_ERRORS = Object.freeze([
  'TEMPORARY_SERVER_ERROR',
  'ONLINE_INTEGRITY_MISMATCH',
  'ONLINE_PAGE_MISMATCH',
]);
const stableCode = (value) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value)
    ? value
    : null;
export function publicationFailureCode(stage, error) {
  return (
    stableCode(error?.code) ??
    stableCode(error?.message) ??
    `${String(stage).toUpperCase()}_FAILED`
  );
}

export async function archiveVersion(root) {
  const published = (
    await loadBriefings(path.join(root, 'content/briefings'))
  ).filter((item) => item.status === 'published');
  if (published.some((item) => item.sample))
    throw new Error('SAMPLE_CONTENT_IS_NOT_PUBLISHABLE');
  return hash(
    JSON.stringify(
      published.map((item) => ({
        date: item.briefingDate,
        revision: item.revision,
        formatRevision: item.formatRevision,
        hash: hash(serializeBriefing(item)),
      })),
    ),
  );
}
const sameBinding = (left, right) =>
  ['commit', 'archiveVersion', 'sourceCommit'].every((key) => left?.[key] === right?.[key]);
export function assertPublicationBinding(state, binding) {
  if (!object(binding) || !commitPattern.test(binding.commit || '') ||
      !versionPattern.test(binding.archiveVersion || '') ||
      !commitPattern.test(binding.sourceCommit || ''))
    throw new Error('PUBLICATION_BINDING_REQUIRED');
  if (!sameBinding(state.checkpointBinding, binding) ||
      state.sourceCommit !== binding.sourceCommit)
    throw new Error('PUBLICATION_CHECKPOINT_BINDING_MISMATCH');
  if (!sameBinding(state.publication?.binding, binding))
    throw new Error('PUBLICATION_BINDING_MISMATCH');
  return binding;
}
export async function resolvePublicationBinding(root, state, { gitCommit } = {}) {
  let commit;
  try {
    commit = gitCommit ?? (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  } catch {
    throw new Error('PUBLICATION_COMMIT_REQUIRED');
  }
  return assertPublicationBinding(state, {
    commit,
    archiveVersion: await archiveVersion(root),
    sourceCommit: state.sourceCommit,
  });
}
function validatePublication(publication, binding) {
  if (!sameBinding(publication?.binding, binding))
    throw new Error('PUBLICATION_BINDING_MISMATCH');
  const version = binding.archiveVersion;
  if (!['archived', 'built', 'deployed', 'verified'].includes(publication.stage) ||
      ['builtVersion', 'deployedVersion', 'verifiedVersion'].some((key) =>
        publication[key] !== undefined && publication[key] !== version) ||
      (publication.deployedVersion && !publication.builtVersion) ||
      (publication.verifiedVersion && !publication.deployedVersion) ||
      (publication.stage === 'built' && !publication.builtVersion) ||
      (publication.stage === 'deployed' && !publication.deployedVersion) ||
      (publication.stage === 'verified' && !publication.verifiedVersion) ||
      (publication.deployedVersion && !publication.deployment?.id))
    throw new Error('INVALID_PUBLICATION_STATE');
  if (publication.deploymentIntent &&
      (!object(publication.deploymentIntent) ||
       !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(publication.deploymentIntent.attempt || '') ||
       !publication.builtVersion || publication.deployedVersion))
    throw new Error('INVALID_PUBLICATION_STATE');
}
export function publicationPlan(state, binding) {
  assertPublicationBinding(state, binding);
  const pub = state.publication;
  validatePublication(pub, binding);
  if (pub.deploymentIntent)
    throw new Error('PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED');
  const complete = pub.verifiedVersion === binding.archiveVersion;
  return {
    should_publish: !complete,
    should_build: !complete && !pub.builtVersion,
    should_deploy: !complete && !pub.deployedVersion,
    should_verify: !complete,
    version: binding.archiveVersion,
    page_url: pub.deployment?.url || '',
    deployment_id: pub.deployment?.id || '',
  };
}
// Every receipt applies to one immutable checkpoint binding. Replayed receipts
// are no-ops; stale failures and different receipts cannot roll progress back.
export function transitionPublication(state, binding, event) {
  assertPublicationBinding(state, binding);
  validatePublication(state.publication, binding);
  const pub = structuredClone(state.publication);
  const version = binding.archiveVersion;
  const clearFailure = () => {
    pub.failedStage = null;
    delete pub.failureCode;
  };
  if (event.type === 'built') {
    if (pub.builtVersion) return pub;
    Object.assign(pub, { builtVersion: version, stage: 'built' });
    clearFailure();
  } else if (event.type === 'begin-deploy') {
    if (!pub.builtVersion) throw new Error('BUILD_REQUIRED');
    if (pub.deployedVersion) throw new Error('PUBLICATION_ALREADY_DEPLOYED');
    if (pub.deploymentIntent)
      throw new Error('PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.attempt || ''))
      throw new Error('PUBLICATION_ATTEMPT_REQUIRED');
    pub.deploymentIntent = { attempt: event.attempt };
    clearFailure();
  } else if (event.type === 'deployed') {
    if (!pub.builtVersion || !event.receipt?.id || !event.receipt?.url)
      throw new Error('BUILD_AND_DEPLOYMENT_RECEIPT_REQUIRED');
    let url;
    try { url = new URL(event.receipt.url); } catch { throw new Error('HTTPS_SITE_URL_REQUIRED'); }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('HTTPS_SITE_URL_REQUIRED');
    const receipt = { id: String(event.receipt.id), url: url.href };
    if (pub.deployedVersion) {
      if (pub.deployment.id !== receipt.id || pub.deployment.url !== receipt.url)
        throw new Error('PUBLICATION_RECEIPT_CONFLICT');
      return pub;
    }
    if (!pub.deploymentIntent || pub.deploymentIntent.attempt !== event.attempt)
      throw new Error('PUBLICATION_ATTEMPT_MISMATCH');
    Object.assign(pub, { deployedVersion: version, deployment: receipt, stage: 'deployed' });
    delete pub.deploymentIntent;
    clearFailure();
  } else if (event.type === 'verified') {
    if (!pub.deployedVersion) throw new Error('DEPLOYMENT_REQUIRED');
    if (pub.verifiedVersion && !pub.health) return pub;
    Object.assign(pub, { verifiedVersion: version, stage: 'verified', verifiedAt: event.at || new Date().toISOString() });
    delete pub.health;
    clearFailure();
  } else if (event.type === 'failed') {
    if (!['build', 'deploy', 'verify'].includes(event.stage))
      throw new Error('INVALID_PUBLICATION_STAGE');
    const completed = { build: pub.builtVersion, deploy: pub.deployedVersion, verify: pub.verifiedVersion };
    if (completed[event.stage]) throw new Error('PUBLICATION_STALE_FAILURE');
    Object.assign(pub, { failedStage: event.stage, failureCode: publicationFailureCode(event.stage, event.error) });
  } else if (event.type === 'health') {
    if (!stableCode(event.code)) throw new Error('INVALID_HEALTH_FAILURE_CODE');
    pub.health = { code: event.code, checkedAt: event.at || new Date().toISOString() };
  } else throw new Error('INVALID_PUBLICATION_TRANSITION');
  return pub;
}
// Callbacks are delivery adapters; no adapter creates or retrieves news.
export async function publishArchive({ root = '.', build, deploy, verify, gitCommit, attempt = 'local-publication' }) {
  return withArchiveLock(root, async () => {
    await assertArchiveReady(root);
    const state = await readState(root);
    if (state.pending.length)
      throw new Error('RESOLVE_PENDING_BEFORE_PUBLICATION');
    const binding = await resolvePublicationBinding(root, state, { gitCommit });
    const version = binding.archiveVersion;
    const plan = publicationPlan(state, binding);
    if (!plan.should_publish) return { status: 'unchanged' };
    const record = async (event) => {
      state.publication = transitionPublication(state, binding, event);
      await saveState(root, state);
    };
    let stage = 'build';
    try {
      if (!state.publication.builtVersion) {
        await build(version);
        await record({ type: 'built' });
      }
      stage = 'deploy';
      if (!state.publication.deployedVersion) {
        await record({ type: 'begin-deploy', attempt });
        const receipt = await deploy(version);
        await record({ type: 'deployed', receipt, attempt });
      }
      stage = 'verify';
      if (!(await verify(state.publication.deployment, version)))
        throw new Error('ONLINE_VERSION_MISMATCH');
      await record({ type: 'verified' });
      return { status: 'verified', version };
    } catch (error) {
      await record({ type: 'failed', stage, error });
      throw error;
    }
  });
}
export async function verifyOnline(
  url,
  expectedVersion,
  {
    fetcher = fetch,
    expectedIntegrity,
    delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    throw new Error('HTTPS_SITE_URL_REQUIRED');
  let lastError;
  for (let attempt = 0; attempt < ONLINE_VERIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const target = new URL(
        'archive-manifest.json',
        origin.href.endsWith('/') ? origin.href : origin.href + '/',
      );
      target.searchParams.set('version', expectedVersion);
      const response = await fetcher(target, {
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        cache: 'no-store',
      });
      if (
        response.status === 403 &&
        response.headers.get('server') === 'cloudflare'
      )
        throw new Error('HOST_ACCESS_BLOCKED');
      if (response.status === 401 || response.status === 403)
        throw new Error('SITE_ACCESS_REQUIRES_AUTHORIZATION');
      if (!response.ok)
        throw new Error(
          response.status >= 500
            ? 'TEMPORARY_SERVER_ERROR'
            : 'ONLINE_MANIFEST_UNAVAILABLE',
        );
      const manifest = await response.json();
      if (
        manifest.archiveVersion !== expectedVersion ||
        hash(JSON.stringify(manifest.issues)) !== expectedVersion
      )
        throw new Error('ONLINE_VERSION_MISMATCH');
      const integrityResponse = await fetcher(
        new URL('build-integrity.json', target),
        {
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          cache: 'no-store',
        },
      );
      if (!integrityResponse.ok)
        throw new Error('ONLINE_INTEGRITY_UNAVAILABLE');
      const integrity = await integrityResponse.json();
      if (
        integrity.archiveVersion !== expectedVersion ||
        integrity.version !== 1
      )
        throw new Error('ONLINE_VERSION_MISMATCH');
      if (
        expectedIntegrity &&
        JSON.stringify(integrity.files) !== JSON.stringify(expectedIntegrity)
      )
        throw new Error('ONLINE_INTEGRITY_MISMATCH');
      const checkFile = async (file, relative) => {
        const expected = integrity.files?.[file];
        if (!expected) throw new Error('ONLINE_INTEGRITY_MISMATCH');
        const result = await fetcher(new URL(relative, target), {
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          cache: 'no-store',
        });
        if (
          !result.ok ||
          byteHash(Buffer.from(await result.arrayBuffer())) !== expected
        )
          throw new Error('ONLINE_INTEGRITY_MISMATCH');
      };
      await checkFile('search-index.json', 'search-index.json');
      const latest = manifest.issues[0];
      if (latest) {
        const pageUrl = `briefings/${latest.date}/`;
        const page = await fetcher(new URL(pageUrl, target), {
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          cache: 'no-store',
        });
        if (
          !page.ok ||
          !(await page.text()).includes(`briefing-${latest.date}-01`)
        )
          throw new Error('ONLINE_PAGE_MISMATCH');
        await checkFile(`briefings/${latest.date}/index.html`, pageUrl);
      }
      return true;
    } catch (error) {
      lastError = error;
      if (
        !['TypeError', 'TimeoutError'].includes(error.name) &&
        !RETRYABLE_ONLINE_ERRORS.includes(error.message)
      )
        break;
      if (attempt < ONLINE_VERIFY_MAX_ATTEMPTS - 1)
        await delay(250 * 2 ** attempt);
    }
  }
  throw lastError;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    await withArchiveLock('.', async () => {
      await assertArchiveReady('.');
      const state = await readState('.');
      if (state.pending.length)
        throw new Error('RESOLVE_PENDING_BEFORE_PUBLICATION');
      const binding = await resolvePublicationBinding('.', state);
      const version = binding.archiveVersion;
      const attempt = process.env.BRIEFING_PUBLICATION_ATTEMPT;
      let event;
      if (args[0] === '--plan') {
        const plan = publicationPlan(state, binding);
        const output = Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join('');
        if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
        else process.stdout.write(output);
        return;
      }
      if (args[0] === '--built') {
        const manifest = JSON.parse(
          await readFile('dist/client/archive-manifest.json', 'utf8'),
        );
        if (manifest.archiveVersion !== version)
          throw new Error('BUILD_VERSION_MISMATCH');
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['scripts/verify-build.mjs'], {
            stdio: 'inherit',
          });
          child.on('error', reject);
          child.on('exit', (code) =>
            code === 0
              ? resolve()
              : reject(new Error('BUILD_VERIFICATION_FAILED')),
          );
        });
        event = { type: 'built' };
      } else if (args[0] === '--begin-deploy') {
        event = { type: 'begin-deploy', attempt: args[1] || attempt };
      } else if (args[0] === '--deployed') {
        event = { type: 'deployed', attempt, receipt: { id: args[1], url: args[2] } };
      } else if (args[0] === '--verify') {
        if (state.publication.deployedVersion !== version)
          throw new Error('DEPLOYMENT_REQUIRED');
        try {
          await verifyOnline(state.publication.deployment.url, version);
        } catch (error) {
          state.publication = transitionPublication(state, binding,
            state.publication.verifiedVersion
              ? { type: 'health', code: publicationFailureCode('verify', error) }
              : { type: 'failed', stage: 'verify', error });
          await saveState('.', state);
          throw error;
        }
        event = { type: 'verified' };
      } else if (args[0] === '--health') {
        event = { type: 'health', code: args[1] };
      } else if (
        args[0] === '--failed' &&
        ['build', 'deploy', 'verify'].includes(args[1])
      ) {
        event = { type: 'failed', stage: args[1], error: { message: args[2] || 'EXTERNAL_STAGE_FAILED' } };
      } else
        throw new Error(
          'INVALID_PUBLICATION_OPERATION',
        );
      const next = transitionPublication(state, binding, event);
      if (JSON.stringify(next) !== JSON.stringify(state.publication)) {
        state.publication = next;
        await saveState('.', state);
      }
      const pub = state.publication;
      console.log(
        `Publication stage: ${pub.stage}${pub.failedStage ? ' (requires recovery)' : ''}.`,
      );
    });
  } catch (error) {
    console.error(stableCode(error.message) || 'PUBLICATION_OPERATION_FAILED');
    process.exitCode = 1;
  }
}
