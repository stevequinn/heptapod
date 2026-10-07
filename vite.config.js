import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Fail rather than silently fall back to 3001 if something else already
    // holds 3000 — a dev server quietly on a different port than the one the
    // README and any scripts point at wastes more time than an error does.
    strictPort: true,
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
