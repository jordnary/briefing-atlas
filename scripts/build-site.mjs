import { spawn } from 'node:child_process';
import { buildContent } from './build-content.mjs';
import { withArchiveLock } from './archive-store.mjs';
const run = (file, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('BUILD_FAILED')),
    );
  });
await withArchiveLock('.', async () => {
  await buildContent();
  await run('node_modules/vinext/dist/cli.js', ['build']);
  await run('scripts/finalize-build.mjs');
});
