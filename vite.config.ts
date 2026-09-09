import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    vinext(),
    {
      name: 'static-export-cached-navigation',
      enforce: 'pre',
      transform(code, id) {
        if (
          !id
            .replaceAll('\\', '/')
            .endsWith('/vinext/dist/server/app-browser-entry.js')
        )
          return;
        // Vinext beta.9 stores the initial export's index.txt URL in its cache.
        // Match the live-response branch: static payload URLs are not redirects.
        const source = 'responseUrl: cachedRoute.response.url,';
        if (code.split(source).length !== 2)
          throw new Error(
            'Review the static navigation compatibility fix after upgrading vinext.',
          );
        return {
          code: code.replace(
            source,
            'responseUrl: IS_STATIC_EXPORT ? currentHref : cachedRoute.response.url,',
          ),
          map: null,
        };
      },
    },
  ],
  server: { host: '127.0.0.1' },
});
