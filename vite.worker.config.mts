import { defineConfig } from 'vite';

// The reader process: native and WASM-backed libraries stay external and ship unpacked next to the app.
// pdf.js is bundled into the reader. It finds its optional canvas support relative to import.meta.url,
// which does not exist in a CommonJS bundle, so it is defined from the file's own location.
export default defineConfig({
  define: { 'import.meta.url': '__readerUrl' },
  build: {
    rollupOptions: {
      external: ['tesseract.js', '@napi-rs/canvas'],
      output: { banner: "const __readerUrl = require('node:url').pathToFileURL(__filename).href;" },
    },
  },
});
