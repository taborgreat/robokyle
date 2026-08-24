import { copyFileSync } from 'node:fs';
// GitHub Pages serves 404.html for unknown paths; the React router reads the real URL.
copyFileSync('../app.html', '../404.html');
console.log('copied app.html -> 404.html');
