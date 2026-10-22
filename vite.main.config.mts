import { defineConfig } from 'vite';

// better-sqlite3 is a native addon: keep it external and ship it via forge.config.ts.
export default defineConfig({
  build: {
    rollupOptions: { external: ['better-sqlite3'] },
  },
});
