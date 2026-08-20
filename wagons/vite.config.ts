import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5176, open: false },
  // heavy media (GLB/HDR/OGG) live in public/media and load on demand
  build: { chunkSizeWarningLimit: 3000 },
});
