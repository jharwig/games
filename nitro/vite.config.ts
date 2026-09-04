import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5178, open: false },
  // mockup.html is a dev-only style reference; only index.html is built.
});
