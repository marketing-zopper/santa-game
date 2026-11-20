import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Two pages: the game (index.html) and the admin dashboard (admin.html → served at /admin).
// The game engine is imported from supabase/functions/_shared/engine.js so the browser and the server-side
// score validator share one file; it sits inside the project root, so no extra fs.allow is needed.
export default defineConfig({
  plugins: [react()],
  build: {
    assetsDir: 'static',   // hashed bundles live in /static; /assets and /fonts hold the original (unhashed) artwork
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), admin: resolve(import.meta.dirname, 'admin.html') },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
