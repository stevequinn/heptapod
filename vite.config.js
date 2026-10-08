import { defineConfig } from 'vite';

/**
 * Serve the review tool at /compare, in dev and in preview alike.
 *
 * The tool lives in tools/reference/ because its reference frames sit beside
 * it, so the tidy URL is a rewrite rather than a second copy of the file.
 * Cloudflare Pages gets the same mapping from public/_redirects.
 */
function compareRoute() {
  const rewrite = (req, _res, next) => {
    const url = req.url || '';
    const q = url.indexOf('?');
    const path = q === -1 ? url : url.slice(0, q);
    if (path === '/compare' || path === '/compare/') {
      req.url = '/tools/reference/compare.html' + (q === -1 ? '' : url.slice(q));
    }
    next();
  };
  return {
    name: 'serve-compare-at-slash-compare',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  plugins: [compareRoute()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Fail rather than silently fall back to 3001 if something else already
    // holds 3000 — a dev server quietly on a different port than the one the
    // README and any scripts point at wastes more time than an error does.
    strictPort: true,
  },
  // Two entries: the app, and the review tool (built, so /compare works on
  // the deployed site too — there it shows the generator alone, because the
  // reference frames are film assets and are not committed).
  environments: {
    client: {
      input: {
        main: 'index.html',
        compare: 'tools/reference/compare.html',
      },
    },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
