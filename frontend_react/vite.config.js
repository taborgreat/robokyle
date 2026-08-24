import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

// The React app builds straight into the repo root (next to the flat HTML pages).
// Its shell is emitted as app.html so it never clobbers index.html; postbuild.mjs
// copies that shell to 404.html so GitHub Pages serves clean URLs like /login.
const APP_ROUTES = ['/login', '/register', '/verify', '/user', '/works', '/designs'];

export default defineConfig({
  plugins: [
    react(),
    {
      // Dev-only: serve app.html for the React routes instead of index.html.
      name: 'app-shell-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url.split('?')[0];
          if (APP_ROUTES.some(r => url === r || url.startsWith(r + '/'))) { req.url = '/app.html'; return next(); }
          // Dev-only: also serve the flat site (index.html, about.html, index.css...) from the repo root.
          const file = resolve('..', '.' + (url === '/' ? '/index.html' : url));
          if (!url.startsWith('/src/') && !url.startsWith('/@') && !url.startsWith('/node_modules/')
              && existsSync(file) && statSync(file).isFile()) {
            const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
            res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
            return createReadStream(file).pipe(res);
          }
          next();
        });
      },
    },
  ],
  build: {
    outDir: '..',
    emptyOutDir: false,
    assetsDir: 'public/assets/react',
    rollupOptions: {
      input: 'app.html',
      // Fixed names (no hashes) so rebuilds overwrite in place instead of piling up in git.
      output: {
        entryFileNames: 'public/assets/react/app.js',
        chunkFileNames: 'public/assets/react/[name].js',
        assetFileNames: 'public/assets/react/[name][extname]',
      },
    },
  },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:4000' },
  },
});
