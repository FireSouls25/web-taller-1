import { defineConfig } from 'astro/config';

// Single-threaded WASM: no threaded WASM / SharedArrayBuffer, so no
// COOP/COEP cross-origin isolation headers are required.
export default defineConfig({
  compressHTML: true,
});