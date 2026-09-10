import { archiveVersion, verifyOnline } from './archive-publication.mjs';
import { readFile } from 'node:fs/promises';

const siteUrl = process.argv[2] || process.env.PAGES_URL;
if (!siteUrl) {
  console.error(
    'Usage: node scripts/verify-pages-online.mjs <https-pages-url>',
  );
  process.exitCode = 2;
} else {
  try {
    const expected = process.argv[3] || (await archiveVersion('.'));
    const integrityFile = process.env.PAGES_INTEGRITY_FILE;
    const expectedIntegrity = integrityFile
      ? JSON.parse(await readFile(integrityFile, 'utf8')).files
      : undefined;
    await verifyOnline(siteUrl, expected, { expectedIntegrity });
    console.log(`Verified Pages content (${expected}).`);
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
