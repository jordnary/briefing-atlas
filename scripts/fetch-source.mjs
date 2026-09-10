import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, readMaybe } from './archive-store.mjs';
const MAX_BYTES = 10 * 1024 * 1024;
function configFromEnv(env = process.env) {
  const repo = env.BRIEFING_SOURCE_REPO || env.SOURCE_REPO;
  const token = env.BRIEFING_SOURCE_TOKEN || env.SOURCE_TOKEN || env.GITHUB_TOKEN;
  const file = env.BRIEFING_SOURCE_PATH || env.SOURCE_PATH || 'work/source-export.json';
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('BRIEFING_SOURCE_REPO_REQUIRED');
  if (!token) throw new Error('BRIEFING_SOURCE_TOKEN_REQUIRED');
  if (!file || file.startsWith('/') || file.includes('..')) throw new Error('INVALID_BRIEFING_SOURCE_PATH');
  return { repo, token, file, ref: env.BRIEFING_SOURCE_REF || env.SOURCE_REF || '', api: env.GITHUB_API_URL || 'https://api.github.com' };
}
export function validateSourceExport(value, { expectedSource } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.complete !== true || typeof value.source !== 'string' || !value.source || !Array.isArray(value.messages) || !value.messages.length) throw new Error('INVALID_SOURCE_EXPORT');
  if (expectedSource && value.source !== expectedSource) throw new Error('SOURCE_SELECTION_MISMATCH');
  const ids = new Set();
  for (const message of value.messages) {
    if (!message || typeof message !== 'object' || typeof message.messageId !== 'string' || !message.messageId || ids.has(message.messageId) || message.role !== 'assistant' || message.status !== 'completed' || message.complete !== true || typeof message.text !== 'string' || !message.text.trim()) throw new Error('INVALID_SOURCE_MESSAGE');
    ids.add(message.messageId);
  }
  return value;
}
export async function fetchSourceExport({ env = process.env, fetcher = fetch, expectedSource = env.BRIEFING_SOURCE_ID, repo, token, sourcePath, ref, api } = {}) {
  if (repo || token || sourcePath || ref || api)
    env = { ...env, SOURCE_REPO: repo || env.SOURCE_REPO, SOURCE_TOKEN: token || env.SOURCE_TOKEN, SOURCE_PATH: sourcePath || env.SOURCE_PATH, SOURCE_REF: ref || env.SOURCE_REF, GITHUB_API_URL: api || env.GITHUB_API_URL };
  const config = configFromEnv(env);
  const endpoint = new URL(`repos/${config.repo}/contents/${config.file.split('/').map(encodeURIComponent).join('/')}`, config.api.endsWith('/') ? config.api : `${config.api}/`);
  if (config.ref) endpoint.searchParams.set('ref', config.ref);
  let response;
  try { response = await fetcher(endpoint, { headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${config.token}`, 'User-Agent': 'briefing-atlas-sync', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(30000) }); } catch { throw new Error('BRIEFING_SOURCE_NETWORK_ERROR'); }
  if (response.status === 401 || response.status === 403) throw new Error('BRIEFING_SOURCE_AUTH_FAILED');
  if (response.status === 404) throw new Error('BRIEFING_SOURCE_NOT_FOUND');
  if (!response.ok) throw new Error(response.status >= 500 ? 'BRIEFING_SOURCE_TEMPORARY_FAILURE' : 'BRIEFING_SOURCE_REQUEST_FAILED');
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('SOURCE_EXPORT_TOO_LARGE');
  let value;
  try { value = JSON.parse(body); } catch {
    try { const envelope = JSON.parse(body); if (envelope?.encoding !== 'base64' || typeof envelope.content !== 'string') throw new Error(); value = JSON.parse(Buffer.from(envelope.content.replace(/\s/g, ''), 'base64').toString('utf8')); } catch { throw new Error('INVALID_SOURCE_JSON'); }
  }
  if (value?.encoding === 'base64' && typeof value.content === 'string') {
    try { value = JSON.parse(Buffer.from(value.content.replace(/\s/g, ''), 'base64').toString('utf8')); }
    catch { throw new Error('INVALID_SOURCE_JSON'); }
  }
  return validateSourceExport(value, { expectedSource });
}
export async function fetchSource(options = {}) {
  const value = await fetchSourceExport(options);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const output = options.output || process.env.SOURCE_OUTPUT || 'incoming/source-export.json';
  const previous = await readMaybe(output);
  if (previous !== serialized) await atomicWrite(output, serialized);
  return { output, downloaded: previous !== serialized, messages: value.messages.length, source: value.source };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await fetchSource())); } catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
}
