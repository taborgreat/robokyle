import { cpSync, copyFileSync, mkdirSync } from 'node:fs';

/* Vite builds into dist/; the site is served from the repo root, so the two
   artefacts move up: the app shell (also as 404.html, which GitHub Pages serves
   for unknown paths so the router can read the real URL) and the bundle. */
mkdirSync('../public/assets/react', { recursive: true });
cpSync('dist/public/assets/react', '../public/assets/react', { recursive: true });
copyFileSync('dist/app.html', '../app.html');
copyFileSync('dist/app.html', '../404.html');
console.log('copied app.html, 404.html and public/assets/react/ to the site root');
