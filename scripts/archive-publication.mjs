import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  withArchiveLock,
  assertArchiveReady,
  readState,
  saveState,
} from './archive-store.mjs';
import { loadBriefings } from './content.mjs';
import { hash, serializeBriefing } from './archive-convert.mjs';
const byteHash = (value) => createHash('sha256').update(value).digest('hex');
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
// Callbacks are delivery adapters; no adapter creates or retrieves news.
export async function publishArchive({ root = '.', build, deploy, verify }) {
  return withArchiveLock(root, async () => {
    await assertArchiveReady(root);
    const state = await readState(root);
    if (state.pending.length)
      throw new Error('RESOLVE_PENDING_BEFORE_PUBLICATION');
    const version = await archiveVersion(root);
    const pub = state.publication;
    if (pub.verifiedVersion === version) return { status: 'unchanged' };
    let stage = 'build';
    try {
      if (pub.builtVersion !== version) {
        await build(version);
        Object.assign(pub, {
          builtVersion: version,
          stage: 'built',
          failedStage: null,
        });
        await saveState(root, state);
      }
      stage = 'deploy';
      if (pub.deployedVersion !== version) {
        const receipt = await deploy(version);
        if (!receipt?.id || !receipt?.url)
          throw new Error('DEPLOYMENT_RECEIPT_REQUIRED');
        Object.assign(pub, {
          deployedVersion: version,
          deployment: receipt,
          stage: 'deployed',
          failedStage: null,
        });
        await saveState(root, state);
      }
      stage = 'verify';
      if (!(await verify(pub.deployment, version)))
        throw new Error('ONLINE_VERSION_MISMATCH');
      Object.assign(pub, {
        verifiedVersion: version,
        stage: 'verified',
        verifiedAt: new Date().toISOString(),
        failedStage: null,
      });
      await saveState(root, state);
      return { status: 'verified', version };
    } catch (error) {
      Object.assign(pub, {
        failedStage: stage,
        failureCode: publicationFailureCode(stage, error),
      });
      await saveState(root, state);
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
  for (let attempt = 0; attempt < 3; attempt++) {
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
        ![
          'TEMPORARY_SERVER_ERROR',
          'ONLINE_INTEGRITY_MISMATCH',
          'ONLINE_PAGE_MISMATCH',
        ].includes(error.message)
      )
        break;
      if (attempt < 2) await delay(250 * 2 ** attempt);
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
      const version = await archiveVersion('.');
      const pub = state.publication;
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
        Object.assign(pub, {
          builtVersion: version,
          stage: 'built',
          failedStage: null,
        });
      } else if (args[0] === '--deployed') {
        if (pub.builtVersion !== version || !args[1] || !args[2])
          throw new Error('BUILD_AND_DEPLOYMENT_RECEIPT_REQUIRED');
        const url = new URL(args[2]);
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error('HTTPS_SITE_URL_REQUIRED');
        Object.assign(pub, {
          deployedVersion: version,
          deployment: { id: args[1], url: url.href },
          stage: 'deployed',
          failedStage: null,
        });
      } else if (args[0] === '--verify') {
        if (pub.deployedVersion !== version)
          throw new Error('DEPLOYMENT_REQUIRED');
        try {
          await verifyOnline(pub.deployment.url, version);
        } catch (error) {
          Object.assign(pub, {
            failedStage: 'verify',
            failureCode: error.message,
          });
          await saveState('.', state);
          throw error;
        }
        Object.assign(pub, {
          verifiedVersion: version,
          stage: 'verified',
          verifiedAt: new Date().toISOString(),
          failedStage: null,
        });
      } else if (
        args[0] === '--failed' &&
        ['build', 'deploy', 'verify'].includes(args[1])
      ) {
        Object.assign(pub, {
          failedStage: args[1],
          failureCode: publicationFailureCode(args[1], {
            message: args[2] || 'EXTERNAL_STAGE_FAILED',
          }),
        });
      } else
        throw new Error(
          'Usage: archive:publication --built | --deployed <receipt> <url> | --verify | --failed <stage> <code>',
        );
      await saveState('.', state);
      console.log(
        `Publication stage: ${pub.stage}${pub.failedStage ? ' (requires recovery)' : ''}.`,
      );
    });
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
