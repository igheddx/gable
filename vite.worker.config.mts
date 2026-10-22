import { defineConfig } from 'vite';

// The OCR worker thread: native and WASM-backed libraries stay external and ship unpacked next to the app.
export default defineConfig({
  build: {
    rollupOptions: { external: ['tesseract.js', '@napi-rs/canvas'] },
  },
});
