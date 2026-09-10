import { archiveVersion, verifyOnline } from './archive-publication.mjs';

const siteUrl = process.argv[2] || process.env.PAGES_URL;
if (!siteUrl) {
  console.error(
    'Usage: node scripts/verify-pages-online.mjs <https-pages-url>',
  );
  process.exitCode = 2;
} else {
  try {
    const expected = process.argv[3] || (await archiveVersion('.'));
    await verifyOnline(siteUrl, expected);
    console.log(`Verified Pages content (${expected}).`);
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
